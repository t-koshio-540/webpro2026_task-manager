const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// JSON形式のリクエストボディを解析できるようにする
app.use(express.json());

// 'public' フォルダ内の静的ファイル（HTML, CSS, JS）を公開
app.use(express.static(path.join(__dirname, "public")));

// データベースの接続設定（自動的に database.sqlite ファイルが作成されます）
const db = new sqlite3.Database("./database.sqlite", (err) => {
  if (err) {
    console.error("データベース接続エラー:", err.message);
  } else {
    console.log("SQLite データベースに接続しました。");
    // SQLiteはデフォルトで外部キー制約がオフなので有効化する
    db.run("PRAGMA foreign_keys = ON;");
  }
});

// テーブルの初期化処理
db.serialize(() => {
  // 1. ジャンルテーブルの作成
  db.run(`
        CREATE TABLE IF NOT EXISTS genres (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL
        )
    `);

  // 2. タスクテーブルの作成（ご指定のパラメータをすべて格納）
  db.run(`
        CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            due_date TEXT NOT NULL,          -- YYYY-MM-DD 形式で保存
            due_time TEXT,                   -- 任意の時刻（HH:MM 形式、NULL可）
            genre_id INTEGER,
            priority INTEGER NOT NULL,       -- 重要度（数字の大小で比較。大きいほど重要）
            comment TEXT,                    -- 任意のコメント（NULL可）
            is_completed INTEGER DEFAULT 0,  -- 0: 未完了, 1: 完了
            FOREIGN KEY(genre_id) REFERENCES genres(id) ON DELETE SET NULL -- ジャンル削除時はNULLにする
        )
    `);

  // 初回起動時のみ、初期ジャンルをいくつか登録しておく
  db.get("SELECT COUNT(*) as count FROM genres", [], (err, row) => {
    if (!err && row.count === 0) {
      const defaultGenres = [
        "大学の課題",
        "アルバイト",
        "プライベート",
        "就職活動",
      ];
      const stmt = db.prepare("INSERT INTO genres (name) VALUES (?)");
      defaultGenres.forEach((genre) => stmt.run(genre));
      stmt.finalize();
    }
  });
});

/* ==========================================
   APIエンドポイント設計（RESTful API）
   ========================================== */

// --- ジャンル関連のAPI ---

// 全ジャンルの取得
app.get("/api/genres", (req, res) => {
  db.all("SELECT * FROM genres ORDER BY id ASC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// ジャンルの新規追加
app.post("/api/genres", (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "ジャンル名が必要です" });

  db.run("INSERT INTO genres (name) VALUES (?)", [name], function (err) {
    if (err)
      return res
        .status(500)
        .json({ error: "同名のジャンルが存在するか、追加に失敗しました。" });
    res.json({ id: this.lastID, name });
  });
});

// ジャンルの削除
app.delete("/api/genres/:id", (req, res) => {
  const { id } = req.params;
  db.run("DELETE FROM genres WHERE id = ?", [id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "ジャンルを削除しました", changes: this.changes });
  });
});

// --- タスク関連のAPI ---

// 全タスクの取得（ジャンル名も結合して取得）
app.get("/api/tasks", (req, res) => {
  const query = `
        SELECT tasks.*, genres.name AS genre_name 
        FROM tasks 
        LEFT JOIN genres ON tasks.genre_id = genres.id
    `;
  db.all(query, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// タスクの新規登録
app.post("/api/tasks", (req, res) => {
  const { title, due_date, due_time, genre_id, priority, comment } = req.body;

  // 必須項目のバリデーション
  if (!title || !due_date || !priority) {
    return res
      .status(400)
      .json({ error: "タイトル、期限(日付)、重要度は必須項目です。" });
  }

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

  db.run(query, params, function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ id: this.lastID, message: "タスクを登録しました" });
  });
});

// タスクの更新（完了ステータスのトグルやその他の情報の更新）
app.put("/api/tasks/:id", (req, res) => {
  const { id } = req.params;
  const { is_completed } = req.body; // 今回は完了・未完了のトグルを主に想定

  db.run(
    "UPDATE tasks SET is_completed = ? WHERE id = ?",
    [is_completed, id],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({
        message: "タスクの状態を更新しました",
        changes: this.changes,
      });
    },
  );
});

// タスクの削除
app.delete("/api/tasks/:id", (req, res) => {
  const { id } = req.params;
  db.run("DELETE FROM tasks WHERE id = ?", [id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "タスクを削除しました" });
  });
});

// サーバーの起動
app.listen(PORT, () => {
  console.log(`サーバーがポート ${PORT} で起動しました。`);
  console.log(`ブラウザで http://localhost:${PORT} を開いてください。`);
});
