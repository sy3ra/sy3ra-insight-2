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
import { tickerInstance } from "./ticker";
// Chart.js에 필요한 요소 등록
Chart.register(
  ...registerables,
  CandlestickController,
  CandlestickElement,
  zoomPlugin
);

export class ChartTest {
  constructor(chartCtx, crosshairCtx, overlayCtx) {
    this.chartCtx = chartCtx;
    this.crosshairCtx = crosshairCtx;
    this.overlayCtx = overlayCtx;
    this.isLoading = false;
    this.earliestX = null;
    this.debounceTimer = null;
    this.spinner = null;
    this.labelsStack = [];
    this.dataStack = [];
    this.boundUpdateOverlayCanvas = this.updateOverlayCanvas.bind(this);
    this.isOverlaySubscribed = false;

    this.initialize();
  }

  async initialize() {
    try {
      // 초기 데이터 가져오기
      const data = await this.handleFetchData();
      if (!data || !data.labels || !data.labels.length) {
        console.error("차트 데이터가 유효하지 않습니다.");
        return;
      }

      // 데이터의 가장 초기 시간과 최신 시간 설정
      this.earliestX = data.labels[0] - 1000 * 60 * 60 * 24 * 3; // 3일의 여유 마진 추가
      const latestX = data.labels[data.labels.length - 1];

      // 차트 옵션 설정
      const chartOptions = this.createChartOptions(this.earliestX, latestX);

      // 차트 초기화
      this.chart = new Chart(this.chartCtx, {
        type: "candlestick",
        data: data,
        options: chartOptions,
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

  // 차트 옵션 생성 메서드
  createChartOptions(earliestX, latestX) {
    return {
      maintainAspectRatio: false,
      animation: { duration: 0 },
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
          min: earliestX,
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
      plugins: this.createPluginsOptions(earliestX, latestX),
    };
  }

  // 플러그인 옵션 생성 메서드
  createPluginsOptions(earliestX, latestX) {
    return {
      title: { display: false, fullSize: true },
      legend: { display: false },
      tooltip: {
        enabled: false,
        intersect: true,
        mode: "point",
      },
      zoom: {
        limits: {
          x: { min: earliestX, max: latestX },
        },
        pan: {
          enabled: true,
          mode: "xy",
          onPan: ({ chart }) => {
            const xMin = chart.scales.x.min;
            if (xMin <= this.earliestX && !this.isLoading) {
              this.debouncedCheckLimitReached();
            }
            this.subscribeOverlayUpdate();
          },
          onPanComplete: () => {
            this.unsubscribeOverlayUpdate();
          },
        },
        zoom: {
          wheel: { enabled: true, speed: 0.1 },
          pinch: { enabled: true, speed: 0.1 },
          mode: "x",
          onZoomStart: ({ chart, event }) => {
            const mode = event.ctrlKey || event.metaKey ? "y" : "x";
            chart.options.plugins.zoom.zoom.mode = mode;
          },
          onZoom: () => {
            this.subscribeOverlayUpdate();
          },
          onZoomComplete: () => {
            this.unsubscribeOverlayUpdate();
          },
          limits: {
            x: { min: earliestX, max: latestX },
            y: { min: "original", max: "original" },
          },
        },
      },
    };
  }

  // 오버레이 업데이트 구독 처리
  subscribeOverlayUpdate() {
    if (!this.isOverlaySubscribed) {
      tickerInstance.subscribe(this.boundUpdateOverlayCanvas);
      this.isOverlaySubscribed = true;
    }
  }

  // 오버레이 업데이트 구독 해제
  unsubscribeOverlayUpdate() {
    if (this.isOverlaySubscribed) {
      tickerInstance.unsubscribe(this.boundUpdateOverlayCanvas);
      this.isOverlaySubscribed = false;
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

    return {
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

      return this.xohlcvFormatData(response.data);
    } catch (error) {
      console.error("데이터를 가져오는 중 오류 발생:", error);
      return { labels: [], datasets: [{ data: [] }] }; // 빈 데이터 반환
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

      return this.xohlcvFormatData(response.data);
    } catch (error) {
      console.error("데이터를 가져오는 중 오류 발생:", error);
      return { labels: [], datasets: [{ data: [] }] };
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

    try {
      // 데이터 가져오기
      const formattedData = await this.handleFetchMoreData();

      // 새 데이터가 있을 경우만 처리
      if (formattedData.labels.length > 0) {
        // 일반 배열로 데이터 추가
        this.labelsStack = [...formattedData.labels, ...this.labelsStack];
        this.dataStack = [...formattedData.datasets[0].data, ...this.dataStack];

        this.chart.data.labels = this.labelsStack;
        this.chart.data.datasets[0].data = this.dataStack;

        this.earliestX = this.labelsStack[0];
        this.chart.options.plugins.zoom.limits.x.min = this.earliestX;
        this.chart.update("none");
      }
    } catch (error) {
      console.error("추가 데이터 로딩 중 오류:", error);
    } finally {
      this.debounceTimer = setTimeout(() => {
        this.hideLoadingSpinner();
        this.isLoading = false;
      }, 500);
    }
  }

  // 로딩스피너를 생성 및 표시하는 메서드
  showLoadingSpinner() {
    if (!this.spinner) {
      this.createSpinner();
    }
    this.spinner.style.display = "block";
  }

  // 스피너 생성 메서드
  createSpinner() {
    this.spinner = document.createElement("div");
    this.spinner.style.position = "absolute";
    this.spinner.style.left = "20px";
    this.spinner.style.top = "50%";
    this.spinner.style.transform = "translateY(-50%)";
    this.spinner.style.width = "40px";
    this.spinner.style.height = "40px";
    this.spinner.style.border = "4px solid rgba(255, 255, 255, 0.3)";
    this.spinner.style.borderTop = "4px solid #fff";
    this.spinner.style.borderRadius = "50%";
    this.spinner.style.animation = "spin 1s linear infinite";

    this.createSpinnerKeyframes();
    this.chartCtx.canvas.parentElement.appendChild(this.spinner);
  }

  // 스피너 애니메이션 키프레임 생성
  createSpinnerKeyframes() {
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
  }

  // 로딩스피너를 숨기는 메서드
  hideLoadingSpinner() {
    if (this.spinner) {
      this.spinner.style.display = "none";
    }
  }

  updateOverlayCanvas() {
    const chart = this.chart;
    const overlays = window.mainCanvas.getOverlaysArray();

    if (overlays.length === 0) return;

    // 오버레이 캔버스 초기화
    this.overlayCtx.clearRect(
      0,
      0,
      this.overlayCtx.canvas.width,
      this.overlayCtx.canvas.height
    );

    // 모든 오버레이 요소들을 순회하며 렌더링
    overlays.forEach((overlay) => {
      const { startX, startY, endX, endY } = overlay;

      // 데이터 값을 픽셀 좌표로 변환
      const startXPixel = chart.scales.x.getPixelForValue(startX);
      const endXPixel = chart.scales.x.getPixelForValue(endX);
      const startYPixel = chart.scales.y.getPixelForValue(startY);
      const endYPixel = chart.scales.y.getPixelForValue(endY);

      // 선 그리기
      this.drawLine(startXPixel, startYPixel, endXPixel, endYPixel, "red", 1);
    });
  }

  // 선 그리기 유틸리티 메서드
  drawLine(startX, startY, endX, endY, color = "red", width = 1) {
    this.overlayCtx.beginPath();
    this.overlayCtx.moveTo(startX, startY);
    this.overlayCtx.lineTo(endX, endY);
    this.overlayCtx.lineWidth = width;
    this.overlayCtx.strokeStyle = color;
    this.overlayCtx.stroke();
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
