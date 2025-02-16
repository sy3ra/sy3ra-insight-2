import axios from "axios";

export default async function handler(req, res) {
  const {
    symbol = "BTCUSDT",
    interval = "1d",
    limit = 24,
    endTime,
  } = req.query;

  try {
    let url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;

    // endTime이 제공되면 해당 시간 이전의 데이터를 요청
    if (endTime) {
      url += `&endTime=${endTime}`;
    }

    const response = await axios.get(url);

    const formattedData = response.data.map((item) => ({
      openTime: item[0],
      open: parseFloat(item[1]),
      high: parseFloat(item[2]),
      low: parseFloat(item[3]),
      close: parseFloat(item[4]),
      volume: parseFloat(item[5]),
      closeTime: item[6],
    }));

    res.status(200).json(formattedData);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
