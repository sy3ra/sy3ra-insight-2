import express from "express";
import path from "path";
import getBtcData from "./api/getBtcData.js";
const app = express();
const port = 3000;

// CORS 설정 추가
import cors from "cors";
app.use(cors());

// API 엔드포인트 설정
app.get("/api/getBtcData", async (req, res) => {
  try {
    const { symbol = "BTCUSDT", interval = "1h", limit = 24 } = req.query; // 기본값 설정
    const data = await getBtcData(symbol, interval, limit);
    res.json(data);
  } catch (error) {
    console.error("Error fetching BTC data:", error.message);
    console.error("Stack trace:", error.stack);
    res.status(500).json({ error: "Failed to fetch BTC data" });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
