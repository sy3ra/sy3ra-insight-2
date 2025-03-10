import { Chart } from "chart.js/auto";
import axios from "axios";

console.log("워커 스크립트 로드됨");
postMessage({ log: "워커 초기화됨" });

let chart = null;

onmessage = async function (event) {
  // 핑 테스트 처리
  if (event.data.type === "ping") {
    console.log("워커: ping 메시지 받음");
    postMessage({ type: "pong", time: Date.now() });
    return;
  }

  const { canvas, config } = event.data;

  if (!(canvas instanceof OffscreenCanvas)) {
    postMessage({ error: "캔버스가 OffscreenCanvas 타입이 아닙니다" });
    return;
  }

  try {
    // 이전 차트가 있으면 파괴
    if (chart) {
      chart.destroy();
    }

    // 새로운 차트 생성
    const ctx = canvas.getContext("2d");
    canvas.width = 1000;
    canvas.height = 1000;

    chart = new Chart(ctx, config);
    chart.resize();

    // 데이터 가져오기
    const chartData = await fetchChartData();
    postMessage({ log: `데이터 로드됨: ${chartData.length}개 항목` });

    if (Array.isArray(chartData) && chartData.length > 0) {
      const labels = chartData.map((item, index) => `Data ${index}`);
      chart.data.labels = labels;
      chart.data.datasets[0].data = chartData;
      chart.update();
    }

    postMessage({ status: "success" });
  } catch (error) {
    console.error("워커에서 오류 발생:", error);
    postMessage({ error: error.message });
  }
};

// 데이터 가져오기 함수
async function fetchChartData() {
  try {
    const response = await axios.get("http://localhost:3000/api/getBtcData", {
      params: {
        symbol: "BTCUSDT",
        interval: "1d",
        limit: 1000,
      },
    });
    return response.data;
  } catch (error) {
    console.error("데이터를 가져오는 중 오류 발생:", error);
    return [];
  }
}
