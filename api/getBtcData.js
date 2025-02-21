import axios from "axios";

async function getBtcData(symbol, interval, limit) {
  try {
    console.log("getBtcData 호출");

    const response = await axios.get("https://api.binance.com/api/v3/klines", {
      params: {
        symbol,
        interval,
        limit,
      },
    });

    return response.data;
  } catch (error) {
    console.error("Error fetching data from Binance API:", error);
    throw new Error("Failed to fetch data from Binance API");
  }
}

export default getBtcData;
