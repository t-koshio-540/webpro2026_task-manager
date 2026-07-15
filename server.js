const express = require("express");
const { Pool } = require("pg");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000; // ポートエラー対策を維持

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

let pgPool = null;
let sqliteDb = null;
const isProduction = process.env.DATABASE_URL !== undefined;

if (isProduction) {
  console.log("Render環境（PostgreSQL）で起動します。");
  pgPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
} else {
  console.log("ローカル開発環境（SQLite）で起動します。");
  sqliteDb = new sqlite3.Database("./database.sqlite", (err) => {
    if (err) console.error("SQLite接続エラー:", err.message);
    else sqliteDb.run("PRAGMA foreign_keys = ON;");
  });
}

// ==========================================
// データベースの初期化 & 自動カラム追加
// ==========================================
if (isProduction) {
  // 1. PostgreSQL テーブル初期化（color カラムをデフォルト値付きで追加）
  pgPool
    .query(
      `
        CREATE TABLE IF NOT EXISTS genres (
            id SERIAL PRIMARY KEY,
            name VARCHAR(100) UNIQUE NOT NULL,
            color VARCHAR(7) DEFAULT '#3498db'
        );
    `,
    )
    .then(() => {
      // 既存のDBにcolor列がない場合のための自動マイグレーション
      return pgPool.query(
        `ALTER TABLE genres ADD COLUMN IF NOT EXISTS color VARCHAR(7) DEFAULT '#3498db';`,
      );
    })
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
      const res = await pgPool.query("SELECT COUNT(*) FROM genres");
      if (parseInt(res.rows[0].count) === 0) {
        // 初期ジャンルに分かりやすい色をセット
        const defaultGenres = [
          { name: "大学の課題", color: "#e74c3c" }, // 赤
          { name: "アルバイト", color: "#f1c40f" }, // 黄
          { name: "プライベート", color: "#2ecc71" }, // 緑
          { name: "就職活動", color: "#9b59b6" }, // 紫
        ];
        for (const g of defaultGenres) {
          await pgPool.query(
            "INSERT INTO genres (name, color) VALUES ($1, $2)",
            [g.name, g.color],
          );
        }
      }
    })
    .catch((err) => console.error("PostgreSQL初期化エラー:", err));
} else {
  // 2. SQLite テーブル初期化 & マイグレーション
  sqliteDb.serialize(() => {
    sqliteDb.run(
      "CREATE TABLE IF NOT EXISTS genres (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, color TEXT DEFAULT '#3498db')",
    );

    // SQLite用の color 列追加（すでに存在する場合は無視されます）
    sqliteDb.run(
      "ALTER TABLE genres ADD COLUMN color TEXT DEFAULT '#3498db'",
      (err) => {
        // エラーは「既に列がある」という内容が多いため無視してOK
      },
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
          { name: "大学の課題", color: "#e74c3c" },
          { name: "アルバイト", color: "#f1c40f" },
          { name: "プライベート", color: "#2ecc71" },
          { name: "就職活動", color: "#9b59b6" },
        ];
        const stmt = sqliteDb.prepare(
          "INSERT INTO genres (name, color) VALUES (?, ?)",
        );
        defaultGenres.forEach((g) => stmt.run(g.name, g.color));
        stmt.finalize();
      }
    });
  });
}

// ==========================================
// API エンドポイント（color の返却/格納に対応）
// ==========================================

// ジャンル一覧取得
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

// ジャンル追加
app.post("/api/genres", async (req, res) => {
  const { name, color } = req.body;
  if (!name) return res.status(400).json({ error: "ジャンル名が必要です" });
  const genreColor = color || "#3498db";

  if (isProduction) {
    try {
      const result = await pgPool.query(
        "INSERT INTO genres (name, color) VALUES ($1, $2) RETURNING id",
        [name, genreColor],
      );
      res.json({ id: result.rows[0].id, name, color: genreColor });
    } catch (err) {
      res
        .status(500)
        .json({
          error: "追加に失敗しました。同名ジャンルがある可能性があります。",
        });
    }
  } else {
    sqliteDb.run(
      "INSERT INTO genres (name, color) VALUES (?, ?)",
      [name, genreColor],
      function (err) {
        if (err)
          return res
            .status(500)
            .json({
              error: "追加に失敗しました。同名ジャンルがある可能性があります。",
            });
        res.json({ id: this.lastID, name, color: genreColor });
      },
    );
  }
});

// ジャンル削除
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

// 全タスクの取得（JOINしてジャンルの色情報も一緒に引っ張ります）
app.get("/api/tasks", async (req, res) => {
  const query = `
        SELECT tasks.*, genres.name AS genre_name, genres.color AS genre_color
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

// タスク新規登録
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

// タスク更新 (完了状態トグル)
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

// タスク削除
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
