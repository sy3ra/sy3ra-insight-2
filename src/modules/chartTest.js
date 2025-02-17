import { Chart, registerables } from "chart.js";
import {
  CandlestickController,
  CandlestickElement,
} from "chartjs-chart-financial";
import "chartjs-adapter-date-fns";
import zoomPlugin from "chartjs-plugin-zoom";

// Chart.js에 필요한 요소 등록
Chart.register(
  ...registerables,
  CandlestickController,
  CandlestickElement,
  zoomPlugin
);

export class ChartTest {
  constructor(data, ctx) {
    this.data = this.candleData(data);
    this.ctx = ctx;

    this.chart = new Chart(this.ctx, {
      type: "candlestick",
      data: {
        datasets: [
          {
            label: "BTC/USDT",
            data: this.data,
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
        plugins: {
          zoom: {
            zoom: {
              wheel: {
                enabled: true,
                speed: 0.01, // 줌 민감도 조절 (값이 작을수록 덜 민감)
              },
              pinch: {
                enabled: true,
                speed: 0.01, // 줌 민감도 조절 (값이 작을수록 덜 민감)
              },
              mode: "xy",
              limits: {
                x: { min: "original", max: "original" }, // x축 줌 한계 설정
                y: { min: "original", max: "original" }, // y축 줌 한계 설정
              },
            },
            pan: {
              enabled: true,
              mode: "xy",
            },
          },
        },
      },
    });
  }

  candleData(data) {
    return data.map((item) => ({
      x: new Date(item.openTime), // x키로 시간 데이터를 지정
      o: item.open,
      h: item.high,
      l: item.low,
      c: item.close,
    }));
  }
}
