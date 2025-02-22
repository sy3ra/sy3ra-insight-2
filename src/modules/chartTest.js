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
    this.isLoading = false;
    this.earliestX = null;
    this.debounceTimer = null;
    this.spinner = null;
    this.labelsStack = [];
    this.dataStack = [];
    this.initialize();
  }

  async initialize() {
    try {
      // 초기 데이터 가져오기
      const data = await this.handleFetchData();

      // 데이터의 가장 초기 시간과 최신 시간 설정
      this.earliestX = data.labels[0] - 1000 * 60 * 60 * 24 * 3; // 1주일 정도의 여유 마진 추가
      const latestX = data.labels[data.labels.length - 1];

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
                tooltipFormat: "MM/dd",
                displayFormats: {
                  millisecond: "HH:mm:ss.SSS",
                  second: "HH:mm:ss",
                  minute: "HH:mm",
                  hour: "MM/dd",
                  day: "MM/dd",
                  week: "MM/dd",
                  month: "MM/dd",
                  quarter: "MM/dd",
                  year: "MM/dd",
                },
              },
              ticks: {
                color: "#d4d4d4",
                autoSkip: true,
                autoSkipPadding: 100,
                source: "auto",
                display: true,
              },
              grid: {
                color: "rgba(255, 255, 255, 0.1)",
                display: true,
                drawOnChartArea: true,
                drawTicks: false,
              },
              min: this.earliestX,
              max: latestX,
            },
            y: {
              position: "right",
              beginAtZero: false,
              ticks: {
                color: "#d4d4d4",
                callback: function (value) {
                  return value.toFixed(2);
                },
                padding: 8,
              },
              grid: {
                color: "rgba(255, 255, 255, 0.1)",
                display: true,
                drawOnChartArea: true,
              },
              afterFit: function (scaleInstance) {
                scaleInstance.width = 90; // y축 레이블 영역의 너비 고정
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
              limits: {
                x: {
                  min: this.earliestX,
                  max: latestX,
                },
              },
              pan: {
                enabled: true,
                mode: "xy",
                onPan: ({ chart }) => {
                  const xMin = chart.scales.x.min;
                  if (xMin <= this.earliestX && !this.isLoading) {
                    this.debouncedCheckLimitReached();
                  }
                },
              },
              zoom: {
                wheel: {
                  enabled: true,
                  speed: 0.1,
                },
                pinch: {
                  enabled: true,
                  speed: 0.1,
                },
                mode: "x",
                onZoomStart: ({ chart, event }) => {
                  const mode = event.ctrlKey || event.metaKey ? "y" : "x";
                  chart.options.plugins.zoom.zoom.mode = mode;
                },
                limits: {
                  x: { min: this.earliestX, max: latestX },
                  y: { min: "original", max: "original" },
                },
              },
            },
          },
        },
      });

      // 일반 배열로 초기 데이터 설정
      this.labelsStack = [...this.chart.data.labels];
      this.dataStack = [...this.chart.data.datasets[0].data];

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
    const formattedData = data.map((item) => ({
      x: item[0], //openTime
      o: item[1], //open
      h: item[2], //high
      l: item[3], //low
      c: item[4], //close
      v: item[5], //volume
    }));
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
  }

  async handleFetchData() {
    try {
      const response = await axios.get("http://localhost:3000/api/getBtcData", {
        params: {
          symbol: "BTCUSDT",
          interval: "1d",
          limit: 100,
        },
      });

      const data = response.data;
      const formattedData = this.xohlcvFormatData(data);
      return formattedData;
    } catch (error) {
      console.error("데이터를 가져오는 중 오류 발생:", error);
      return []; // 빈 배열 반환
    }
  }

  async handleFetchMoreData() {
    try {
      const response = await axios.get("http://localhost:3000/api/getBtcData", {
        params: {
          symbol: "BTCUSDT",
          interval: "1d",
          limit: 100,
          endTime: this.chart.data.labels[0] - 1000 * 60 * 60,
        },
      });
      const data = response.data;
      const formattedData = this.xohlcvFormatData(data);

      return formattedData;
    } catch (error) {
      console.error("데이터를 가져오는 중 오류 발생:", error);
      return [];
    }
  }

  // 디바운스된 버전의 checkLimitReached 함수
  async debouncedCheckLimitReached() {
    // 이전 타이머가 존재하면 취소
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    // 이미 로딩 중이라면 함수 종료
    if (this.isLoading) {
      return;
    }

    this.isLoading = true;
    this.showLoadingSpinner();

    // 데이터 가져오기 완료 후 500ms 후에 로직 실행 (디바운스)
    const formattedData = await this.handleFetchMoreData();
    // 일반 배열로 데이터 추가
    this.labelsStack = [...formattedData.labels, ...this.labelsStack];
    this.dataStack = [...formattedData.datasets[0].data, ...this.dataStack];

    this.chart.data.labels = this.labelsStack;
    this.chart.data.datasets[0].data = this.dataStack;

    this.earliestX = this.labelsStack[0];
    this.chart.options.plugins.zoom.limits.x.min = this.earliestX;
    this.chart.update("none");

    this.debounceTimer = setTimeout(() => {
      this.hideLoadingSpinner();
      this.isLoading = false; // 로딩 완료 후 플래그 해제
    }, 500);
  }

  // 로딩스피너를 생성 및 표시하는 메서드
  showLoadingSpinner() {
    if (!this.spinner) {
      this.spinner = document.createElement("div");
      this.spinner.style.position = "absolute";
      this.spinner.style.left = "20px"; // 좌측에서 약간의 여백
      this.spinner.style.top = "50%";
      this.spinner.style.transform = "translateY(-50%)";
      this.spinner.style.width = "40px";
      this.spinner.style.height = "40px";
      this.spinner.style.border = "4px solid rgba(255, 255, 255, 0.3)";
      this.spinner.style.borderTop = "4px solid #fff";
      this.spinner.style.borderRadius = "50%";
      this.spinner.style.animation = "spin 1s linear infinite";

      if (!document.getElementById("spinner-keyframes")) {
        const style = document.createElement("style");
        style.id = "spinner-keyframes";
        style.innerHTML = `
@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}`;
        document.head.appendChild(style);
      }

      this.chartCtx.canvas.parentElement.appendChild(this.spinner);
    }
    this.spinner.style.display = "block";
  }

  // 로딩스피너를 숨기는 메서드
  hideLoadingSpinner() {
    if (this.spinner) {
      this.spinner.style.display = "none";
    }
  }

  updateMousePosition(x, y) {
    if (this.crosshair && typeof this.crosshair.updatePosition === "function") {
      this.crosshair.updatePosition(x, y);
    }
  }

  mouseLeave() {
    if (this.crosshair) {
      this.crosshair.mouseLeave();
    }
  }

  render() {
    if (this.chart) {
      this.chart.resize();
      this.chart.update("none");
    }
  }
}
