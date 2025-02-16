import { Chart, registerables } from "chart.js";
import {
  CandlestickController,
  CandlestickElement,
} from "chartjs-chart-financial";
import "chartjs-adapter-date-fns";

// Chart.js에 필요한 요소 등록
Chart.register(...registerables, CandlestickController, CandlestickElement);

export class ChartTest {
  constructor(data, ctx) {
    this.data = data;
    this.ctx = ctx;

    const candleData = data.map((item) => ({
      x: new Date(item.openTime), // x키로 시간 데이터를 지정
      o: item.open,
      h: item.high,
      l: item.low,
      c: item.close,
    }));

    new Chart(this.ctx, {
      type: "candlestick",
      data: {
        datasets: [
          {
            label: "BTC/USDT",
            data: candleData,
            borderColor: "rgba(0, 0, 0, 1)",
            borderWidth: 1,
            // 캔들 하나의 폭을 10픽셀로 고정 (필요에 따라 값 조정)
            barThickness: 20,
            // 또는 최대 폭을 제한하고 싶다면 다음 옵션도 사용 가능
            // maxBarThickness: 10,
          },
        ],
      },
      options: {
        responsive: true,
        scales: {
          x: {
            type: "time",
            time: {
              unit: "hour",
              tooltipFormat: "MM/dd HH:mm",
              displayFormats: {
                hour: "MM/dd HH:mm",
              },
            },
          },
          y: {
            beginAtZero: false,
          },
        },
      },
    });
  }
}
