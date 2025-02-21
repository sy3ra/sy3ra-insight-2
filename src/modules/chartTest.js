import { Chart, registerables } from "chart.js";
import {
  CandlestickController,
  CandlestickElement,
} from "chartjs-chart-financial";
import "chartjs-adapter-date-fns";
import zoomPlugin from "chartjs-plugin-zoom";
import { ChartCrosshair } from "./chartCrosshair";
import { chartColors } from "./theme";
import axios from "axios";
// Chart.js에 필요한 요소 등록
Chart.register(
  ...registerables,
  CandlestickController,
  CandlestickElement,
  zoomPlugin
);

export class ChartTest {
  constructor(chartCtx, crosshairCtx) {
    this.chartCtx = chartCtx;
    this.crosshairCtx = crosshairCtx;
    this.initialize();
  }

  async initialize() {
    try {
      // 데이터 가져오기
      const data = await this.handleFetchData();

      // 차트 초기화
      this.chart = new Chart(this.chartCtx, {
        type: "candlestick",
        data: data,
        options: {
          maintainAspectRatio: false,
          animation: {
            duration: 0,
          },
          responsive: false,
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
              ticks: {
                color: "#d4d4d4",
                autoSkip: true,
                source: "auto",
                display: true, // x축 레이블 표시
              },
              grid: {
                color: "rgba(255, 255, 255, 0.1)",
                display: true,
                drawOnChartArea: true,
              },
            },
            y: {
              position: "right", // y축을 오른쪽에 표시
              beginAtZero: false,
              ticks: {
                color: "#d4d4d4",
                callback: function (value) {
                  return value.toFixed(2); // 소수점 2자리까지 표시
                },
              },
              grid: {
                color: "rgba(255, 255, 255, 0.1)",
                display: true,
                drawOnChartArea: true,
              },
            },
          },
          plugins: {
            title: {
              display: false,
              fullSize: true,
            },
            legend: {
              display: false,
            },
            tooltip: {
              enabled: true,
              intersect: true,
              mode: "point",
            },
            zoom: {
              zoom: {
                wheel: {
                  enabled: true,
                  speed: 0.1, // 줌 민감도 조절 (값이 작을수록 덜 민감)
                },
                pinch: {
                  enabled: true,
                  speed: 0.1, // 줌 민감도 조절 (값이 작을수록 덜 민감)
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

      // 크로스헤어 초기화
      this.crosshair = new ChartCrosshair(this.crosshairCtx, this.chart);

      // 차트 렌더링
      this.render();
    } catch (error) {
      console.error("차트 초기화 중 오류 발생:", error);
    }
  }

  // 데이터 포맷팅 함수
  xohlcvFormatData(data) {
    return data.map((item) => ({
      x: item[0],
      o: item[1],
      h: item[2],
      l: item[3],
      c: item[4],
      v: item[5],
    }));
  }

  updateMousePosition(x, y) {
    if (this.crosshair && typeof this.crosshair.updatePosition === "function") {
      this.crosshair.updatePosition(x, y);
    }
  }

  mouseLeave() {
    this.crosshair.mouseLeave();
  }

  render() {
    if (this.chart) {
      this.chart.resize();
      this.chart.update();
    }
  }

  async handleFetchData() {
    try {
      const response = await axios.get("http://localhost:3000/api/getBtcData", {
        params: {
          symbol: "BTCUSDT",
          interval: "1h",
          limit: 100,
        },
      });

      const data = response.data;

      const formattedData = this.xohlcvFormatData(data);

      const chartData = {
        labels: formattedData.map((item) => item.x),
        datasets: [
          {
            label: "BTC/USDT Chart",
            data: formattedData,
            backgroundColors: {
              up: chartColors.upBody,
              down: chartColors.downBody,
            },
            borderColors: {
              up: chartColors.upBorder,
              down: chartColors.downBorder,
            },
          },
        ],
      };

      return chartData;
    } catch (error) {
      console.error("데이터를 가져오는 중 오류 발생:", error);
      return []; // 빈 배열 반환
    }
  }
}
