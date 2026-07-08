// prisma.config.js

require("dotenv").config(); // ★環境変数を読み込むためにこれを追加！

module.exports = {
  datasource: {
    url: process.env.DATABASE_URL,
  },
};
