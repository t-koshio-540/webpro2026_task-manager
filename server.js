const express = require("express");
const { Pool } = require("pg");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ==========================================
// パスワード認証設定
// ==========================================
const READ_PASSWORD = process.env.READ_PASSWORD || "Yomitori";
const WRITE_PASSWORD = process.env.WRITE_PASSWORD || "Kakikomi";

// 書き込み権限チェック用ミドルウェア
function requireWriteAuth(req, res, next) {
  const inputPassword = req.headers["x-write-password"];
  if (inputPassword !== WRITE_PASSWORD) {
    return res
      .status(401)
      .json({ error: "書き込みパスワードが正しくありません。" });
  }
  next();
}

// 読み取りパスワード検証用API（任意確認用）
app.post("/api/auth/read", (req, res) => {
  const { password } = req.body;
  if (password === READ_PASSWORD) {
    res.json({ success: true });
  } else {
    res.status(401).json({ error: "読み取りパスワードが違います。" });
  }
});

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
// 日時加算ヘルパー関数
// ==========================================
function calculateOffsetDateTime(
  baseDateStr,
  baseTimeStr,
  intervalMinutes,
  stepIndex,
) {
  const timeStr = baseTimeStr || "00:00";
  const [year, month, day] = baseDateStr.split("-").map(Number);
  const [hours, minutes] = timeStr.split(":").map(Number);

  // JavaScriptのDateオブジェクトで加算処理
  const dt = new Date(year, month - 1, day, hours, minutes);
  dt.setMinutes(dt.getMinutes() + intervalMinutes * stepIndex);

  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  const due_date = `${yyyy}-${mm}-${dd}`;

  let due_time = null;
  if (baseTimeStr) {
    const hh = String(dt.getHours()).padStart(2, "0");
    const min = String(dt.getMinutes()).padStart(2, "0");
    due_time = `${hh}:${min}`;
  }

  return { due_date, due_time };
}

// ==========================================
// データベースの初期化 & 自動カラム追加
// ==========================================
if (isProduction) {
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
              repeat_count INTEGER DEFAULT 1,
              repeat_index INTEGER DEFAULT 1,
              repeat_interval_min INTEGER DEFAULT 0,
              CONSTRAINT fk_genre FOREIGN KEY(genre_id) REFERENCES genres(id) ON DELETE SET NULL
          );
      `);
    })
    .then(() => {
      return Promise.all([
        pgPool.query(
          `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS repeat_count INTEGER DEFAULT 1;`,
        ),
        pgPool.query(
          `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS repeat_index INTEGER DEFAULT 1;`,
        ),
        pgPool.query(
          `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS repeat_interval_min INTEGER DEFAULT 0;`,
        ),
      ]);
    })
    .then(async () => {
      const res = await pgPool.query("SELECT COUNT(*) FROM genres");
      if (parseInt(res.rows[0].count) === 0) {
        const defaultGenres = [
          { name: "大学の課題", color: "#e74c3c" },
          { name: "アルバイト", color: "#f1c40f" },
          { name: "プライベート", color: "#2ecc71" },
          { name: "就職活動", color: "#9b59b6" },
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
  sqliteDb.serialize(() => {
    sqliteDb.run(
      "CREATE TABLE IF NOT EXISTS genres (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, color TEXT DEFAULT '#3498db')",
    );
    sqliteDb.run(
      "ALTER TABLE genres ADD COLUMN color TEXT DEFAULT '#3498db'",
      () => {},
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
          repeat_count INTEGER DEFAULT 1,
          repeat_index INTEGER DEFAULT 1,
          repeat_interval_min INTEGER DEFAULT 0,
          FOREIGN KEY(genre_id) REFERENCES genres(id) ON DELETE SET NULL
      )
    `);

    sqliteDb.run(
      "ALTER TABLE tasks ADD COLUMN repeat_count INTEGER DEFAULT 1",
      () => {},
    );
    sqliteDb.run(
      "ALTER TABLE tasks ADD COLUMN repeat_index INTEGER DEFAULT 1",
      () => {},
    );
    sqliteDb.run(
      "ALTER TABLE tasks ADD COLUMN repeat_interval_min INTEGER DEFAULT 0",
      () => {},
    );

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
// API エンドポイント
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
app.post("/api/genres", requireWriteAuth, async (req, res) => {
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
      res.status(500).json({
        error: "追加に失敗しました。同名ジャンルがある可能性があります。",
      });
    }
  } else {
    sqliteDb.run(
      "INSERT INTO genres (name, color) VALUES (?, ?)",
      [name, genreColor],
      function (err) {
        if (err)
          return res.status(500).json({
            error: "追加に失敗しました。同名ジャンルがある可能性があります。",
          });
        res.json({ id: this.lastID, name, color: genreColor });
      },
    );
  }
});

// ジャンル削除
app.delete("/api/genres/:id", requireWriteAuth, async (req, res) => {
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

// 全タスクの取得
app.get("/api/tasks", async (req, res) => {
  const query = `
        SELECT tasks.*, genres.name AS genre_name, genres.color AS genre_color
        FROM tasks 
        LEFT JOIN genres ON tasks.genre_id = genres.id
        ORDER BY tasks.id ASC
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

// 🔁 タスク新規登録（一括繰返し登録対応・非同期処理安全版）
app.post("/api/tasks", requireWriteAuth, async (req, res) => {
  const {
    title,
    due_date,
    due_time,
    genre_id,
    priority,
    comment,
    repeat_days,
    repeat_hours,
    repeat_minutes,
    repeat_times,
  } = req.body;

  if (!title || !due_date || !priority) {
    return res.status(400).json({ error: "必須項目が不足しています。" });
  }

  const rDays = parseInt(repeat_days) || 0;
  const rHours = parseInt(repeat_hours) || 0;
  const rMins = parseInt(repeat_minutes) || 0;
  const intervalMins = rDays * 1440 + rHours * 60 + rMins;

  const totalCount = Math.max(1, parseInt(repeat_times) || 1);

  if (isProduction) {
    try {
      const insertedIds = [];
      for (let i = 0; i < totalCount; i++) {
        const { due_date: calcDate, due_time: calcTime } =
          calculateOffsetDateTime(due_date, due_time, intervalMins, i);

        const query = `
          INSERT INTO tasks (title, due_date, due_time, genre_id, priority, comment, is_completed, repeat_count, repeat_index, repeat_interval_min)
          VALUES ($1, $2, $3, $4, $5, $6, 0, $7, $8, $9) RETURNING id
        `;
        const params = [
          title,
          calcDate,
          calcTime,
          genre_id ? parseInt(genre_id) : null,
          parseInt(priority),
          comment || null,
          totalCount,
          i + 1,
          intervalMins,
        ];
        const result = await pgPool.query(query, params);
        insertedIds.push(result.rows[0].id);
      }
      res.json({
        message: `${totalCount}件のタスクを登録しました`,
        ids: insertedIds,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  } else {
    // SQLite環境：Promiseで1件ずつの登録完了を確実に待機する
    try {
      for (let i = 0; i < totalCount; i++) {
        const { due_date: calcDate, due_time: calcTime } =
          calculateOffsetDateTime(due_date, due_time, intervalMins, i);

        await new Promise((resolve, reject) => {
          sqliteDb.run(
            `INSERT INTO tasks (title, due_date, due_time, genre_id, priority, comment, is_completed, repeat_count, repeat_index, repeat_interval_min)
             VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
            [
              title,
              calcDate,
              calcTime,
              genre_id ? parseInt(genre_id) : null,
              parseInt(priority),
              comment || null,
              totalCount,
              i + 1,
              intervalMins,
            ],
            function (err) {
              if (err) reject(err);
              else resolve(this.lastID);
            },
          );
        });
      }
      res.json({ message: `${totalCount}件のタスクを登録しました` });
    } catch (err) {
      console.error("SQLite挿入エラー:", err);
      res.status(500).json({ error: err.message });
    }
  }
});

// タスク更新 (単純な完了トグル)
app.put("/api/tasks/:id", requireWriteAuth, async (req, res) => {
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
app.delete("/api/tasks/:id", requireWriteAuth, async (req, res) => {
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
