import axios from "axios";

export default async function getBtcData(req, res) {
  const {
    symbol = "BTCUSDT",
    interval = "1d",
    limit = 24,
    endTime,
  } = req.query;

  try {
    console.log("req", req);

    console.log("getBtcData 호출");

    let url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;

    // endTime이 제공되면 해당 시간 이전의 데이터를 요청
    if (endTime) {
      url += `&endTime=${endTime}`;
    }
    const response = await axios.get(url);
    return response.data;
  } catch (error) {
    console.error("Error fetching data from Binance API:", error);
    throw error;
  }
}
