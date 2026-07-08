const express = require("express");
// --- ここからPrisma v7用のインポートを追加 ---
const { Pool } = require("pg");
const { PrismaPg } = require("@prisma/adapter-pg");
const { PrismaClient } = require("@prisma/client");

const app = express();

// PostgreSQLの接続プールを作成し、Prismaのアダプターに渡す
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);

// アダプターを指定してPrismaインスタンスを作成
const prisma = new PrismaClient({ adapter });
// --- ここまで ---

app.use(express.json());
app.use(express.static("public"));

// ...（これ以降のAPIルーティングやサーバー起動コードは変更なし）
/**
 * 1. タスク一覧取得 API (GET /tasks)
 */
app.get("/tasks", async (req, res) => {
  try {
    const { categoryId, order } = req.query;
    const whereCondition = { is_deleted: false };

    if (categoryId) {
      whereCondition.categoryId = parseInt(categoryId, 10);
    }

    const sortOrder = order === "asc" ? "asc" : "desc";

    const tasks = await prisma.task.findMany({
      where: whereCondition,
      orderBy: { priority: sortOrder },
      include: { category: true },
    });

    res.json(tasks);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "サーバーエラーが発生しました" });
  }
});

/**
 * 2. 【追加】タスク登録 API (POST /tasks)
 * フロントエンドのフォームからデータを受け取ってDBに保存します
 */
app.post("/tasks", async (req, res) => {
  try {
    const { title, priority, categoryId } = req.body;

    const newTask = await prisma.task.create({
      data: {
        title,
        priority: parseInt(priority, 10),
        categoryId: parseInt(categoryId, 10),
      },
      include: { category: true },
    });

    res.status(201).json(newTask);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "タスクの登録に失敗しました" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server holds on http://localhost:${PORT}`);
});
