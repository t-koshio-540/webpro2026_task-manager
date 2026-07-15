const express = require("express");
const { Pool } = require("pg"); // PostgreSQL用の接続プール
const sqlite3 = require("sqlite3").verbose(); // ローカルフォールバック用のSQLite
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000; // すでに実施されたポート対策！

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// データベース接続用の変数
let pgPool = null;
let sqliteDb = null;
const isProduction = process.env.DATABASE_URL !== undefined;

if (isProduction) {
  console.log("Render環境（PostgreSQL）で起動します。");
  // Render上の環境変数 DATABASE_URL を用いて接続設定を行います
  pgPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false, // Renderの無料PostgreSQL接続に必要なSSL設定
    },
  });
} else {
  console.log("ローカル開発環境（SQLite）で起動します。");
  sqliteDb = new sqlite3.Database("./database.sqlite", (err) => {
    if (err) console.error("SQLite接続エラー:", err.message);
    else sqliteDb.run("PRAGMA foreign_keys = ON;");
  });
}

// ==========================================
// データベースの初期化（テーブル作成）
// ==========================================
if (isProduction) {
  // PostgreSQLでのテーブル作成（シリアル型、外部キー制約の設定など）
  pgPool
    .query(
      `
        CREATE TABLE IF NOT EXISTS genres (
            id SERIAL PRIMARY KEY,
            name VARCHAR(100) UNIQUE NOT NULL
        );
    `,
    )
    .then(() => {
      return pgPool.query(`
            CREATE TABLE IF NOT EXISTS tasks (
                id SERIAL PRIMARY KEY,
                title VARCHAR(255) NOT NULL,
                due_date VARCHAR(10) NOT NULL,
                due_time VARCHAR(8),
                genre_id INTEGER,
                priority INTEGER NOT NULL,
                comment TEXT,
                is_completed INTEGER DEFAULT 0,
                CONSTRAINT fk_genre FOREIGN KEY(genre_id) REFERENCES genres(id) ON DELETE SET NULL
            );
        `);
    })
    .then(async () => {
      // 初期データ登録
      const res = await pgPool.query("SELECT COUNT(*) FROM genres");
      if (parseInt(res.rows[0].count) === 0) {
        const defaultGenres = [
          "大学の課題",
          "アルバイト",
          "プライベート",
          "就職活動",
        ];
        for (const genre of defaultGenres) {
          await pgPool.query("INSERT INTO genres (name) VALUES ($1)", [genre]);
        }
      }
    })
    .catch((err) => console.error("PostgreSQL初期化エラー:", err));
} else {
  // ローカル用SQLite初期化
  sqliteDb.serialize(() => {
    sqliteDb.run(
      "CREATE TABLE IF NOT EXISTS genres (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL)",
    );
    sqliteDb.run(`
            CREATE TABLE IF NOT EXISTS tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                due_date TEXT NOT NULL,
                due_time TEXT,
                genre_id INTEGER,
                priority INTEGER NOT NULL,
                comment TEXT,
                is_completed INTEGER DEFAULT 0,
                FOREIGN KEY(genre_id) REFERENCES genres(id) ON DELETE SET NULL
            )
        `);
    sqliteDb.get("SELECT COUNT(*) as count FROM genres", [], (err, row) => {
      if (!err && row.count === 0) {
        const defaultGenres = [
          "大学の課題",
          "アルバイト",
          "プライベート",
          "就職活動",
        ];
        const stmt = sqliteDb.prepare("INSERT INTO genres (name) VALUES (?)");
        defaultGenres.forEach((genre) => stmt.run(genre));
        stmt.finalize();
      }
    });
  });
}

// ==========================================
// API エンドポイント
// ==========================================

// --- ジャンル一覧取得 ---
app.get("/api/genres", async (req, res) => {
  if (isProduction) {
    try {
      const result = await pgPool.query("SELECT * FROM genres ORDER BY id ASC");
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  } else {
    sqliteDb.all("SELECT * FROM genres ORDER BY id ASC", [], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    });
  }
});

// --- ジャンル追加 ---
app.post("/api/genres", async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "ジャンル名が必要です" });

  if (isProduction) {
    try {
      // PostgreSQLのプレースホルダーは $1 を使用
      const result = await pgPool.query(
        "INSERT INTO genres (name) VALUES ($1) RETURNING id",
        [name],
      );
      res.json({ id: result.rows[0].id, name });
    } catch (err) {
      res
        .status(500)
        .json({ error: "同名のジャンルが存在するか、追加に失敗しました。" });
    }
  } else {
    sqliteDb.run(
      "INSERT INTO genres (name) VALUES (?)",
      [name],
      function (err) {
        if (err)
          return res
            .status(500)
            .json({
              error: "同名のジャンルが存在するか、追加に失敗しました。",
            });
        res.json({ id: this.lastID, name });
      },
    );
  }
});

// --- ジャンル削除 ---
app.delete("/api/genres/:id", async (req, res) => {
  const { id } = req.params;
  if (isProduction) {
    try {
      await pgPool.query("DELETE FROM genres WHERE id = $1", [id]);
      res.json({ message: "ジャンルを削除しました" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  } else {
    sqliteDb.run("DELETE FROM genres WHERE id = ?", [id], function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: "ジャンルを削除しました" });
    });
  }
});

// --- 全タスクの取得 ---
app.get("/api/tasks", async (req, res) => {
  const query = `
        SELECT tasks.*, genres.name AS genre_name 
        FROM tasks 
        LEFT JOIN genres ON tasks.genre_id = genres.id
    `;
  if (isProduction) {
    try {
      const result = await pgPool.query(query);
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  } else {
    sqliteDb.all(query, [], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    });
  }
});

// --- タスク新規追加 ---
app.post("/api/tasks", async (req, res) => {
  const { title, due_date, due_time, genre_id, priority, comment } = req.body;
  if (!title || !due_date || !priority) {
    return res.status(400).json({ error: "必須項目が不足しています。" });
  }

  if (isProduction) {
    const query = `
            INSERT INTO tasks (title, due_date, due_time, genre_id, priority, comment, is_completed)
            VALUES ($1, $2, $3, $4, $5, $6, 0) RETURNING id
        `;
    const params = [
      title,
      due_date,
      due_time || null,
      genre_id ? parseInt(genre_id) : null,
      parseInt(priority),
      comment || null,
    ];
    try {
      const result = await pgPool.query(query, params);
      res.json({ id: result.rows[0].id, message: "タスクを登録しました" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  } else {
    const query = `
            INSERT INTO tasks (title, due_date, due_time, genre_id, priority, comment, is_completed)
            VALUES (?, ?, ?, ?, ?, ?, 0)
        `;
    const params = [
      title,
      due_date,
      due_time || null,
      genre_id || null,
      parseInt(priority),
      comment || null,
    ];
    sqliteDb.run(query, params, function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, message: "タスクを登録しました" });
    });
  }
});

// --- タスク更新（完了状態のトグル） ---
app.put("/api/tasks/:id", async (req, res) => {
  const { id } = req.params;
  const { is_completed } = req.body;

  if (isProduction) {
    try {
      await pgPool.query("UPDATE tasks SET is_completed = $1 WHERE id = $2", [
        is_completed,
        id,
      ]);
      res.json({ message: "タスクの状態を更新しました" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  } else {
    sqliteDb.run(
      "UPDATE tasks SET is_completed = ? WHERE id = ?",
      [is_completed, id],
      function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "タスクの状態を更新しました" });
      },
    );
  }
});

// --- タスク削除 ---
app.delete("/api/tasks/:id", async (req, res) => {
  const { id } = req.params;
  if (isProduction) {
    try {
      await pgPool.query("DELETE FROM tasks WHERE id = $1", [id]);
      res.json({ message: "タスクを削除しました" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  } else {
    sqliteDb.run("DELETE FROM tasks WHERE id = ?", [id], function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: "タスクを削除しました" });
    });
  }
});

app.listen(PORT, () => {
  console.log(`サーバーがポート ${PORT} で起動しました。`);
});
