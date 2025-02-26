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
import {
  calculateSlope,
  calculateDirection,
  calculateExtendedLineIntersections,
  calculateRayIntersection,
  drawLine,
} from "../utilities/lineUtils.js";
// Chart.js에 필요한 요소 등록
Chart.register(
  ...registerables,
  CandlestickController,
  CandlestickElement,
  zoomPlugin
);

export class ChartTest {
  constructor(chartCtx, crosshairCtx, overlayCtx, volumeChartCtx) {
    this.chartCtx = chartCtx;
    this.crosshairCtx = crosshairCtx;
    this.overlayCtx = overlayCtx;
    this.volumeChartCtx = volumeChartCtx;
    this.isLoading = false;
    this.earliestX = null;
    this.debounceTimer = null;
    this.spinner = null;
    this.labelsStack = [];
    this.dataStack = [];
    this.boundUpdateOverlayCanvas = this.updateOverlayCanvas.bind(this);
    this.boundUpdateVolumeChart = this.updateVolumeChart.bind(this);
    this.isOverlaySubscribed = false;
    this.isVolumeChartSubscribed = false;

    this.initialize();
  }

  async initialize() {
    try {
      // 초기 데이터 가져오기
      const data = await this.handleFetchData();
      const volumeData = this.formatVolumeData(data);
      if (!data || !data.labels || !data.labels.length) {
        console.error("차트 데이터가 유효하지 않습니다.");
        return;
      }

      // 데이터의 가장 초기 시간과 최신 시간 설정
      this.earliestX = data.labels[0] - 1000 * 60 * 60 * 24 * 3; // 3일의 여유 마진 추가
      const latestX = data.labels[data.labels.length - 1];

      // 차트 옵션 설정
      const chartOptions = this.createChartOptions(this.earliestX, latestX);
      const volumeChartOptions = this.createVolumeChartOptions(
        this.earliestX,
        latestX
      );

      // 차트 초기화
      this.chart = new Chart(this.chartCtx, {
        type: "candlestick",
        data: data,
        options: chartOptions,
      });

      // 볼륨 차트 초기화
      this.volumeChart = new Chart(this.volumeChartCtx, {
        type: "bar",
        data: volumeData,
        options: volumeChartOptions,
      });
      // 일반 배열로 초기 데이터 설정
      this.labelsStack = [...this.chart.data.labels];
      this.dataStack = [...this.chart.data.datasets[0].data];

      // 크로스헤어 초기화
      this.crosshair = new ChartCrosshair(
        this.crosshairCtx,
        this.chart,
        this.volumeChart
      );

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
          afterFit: function (scaleInstance) {
            scaleInstance.height = 30;
          },
        },
        y: {
          position: "right",
          beginAtZero: false,
          ticks: {
            color: "#d4d4d4",
            callback: function (value) {
              return value.toLocaleString("ko-KR", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              });
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

  createVolumeChartOptions(earliestX, latestX) {
    return {
      maintainAspectRatio: false,
      animation: { duration: 0 },
      responsive: false,
      layout: {
        padding: {
          top: 10,
        },
      },
      scales: {
        x: {
          type: "time",
          time: {
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
          display: false,
          min: earliestX,
          max: latestX,
          grid: {
            display: false,
          },
          offset: true,
          afterFit: function (scaleInstance) {
            scaleInstance.height = 30;
          },
        },
        y: {
          position: "right",
          display: false,
          beginAtZero: true,
          suggestedMax: function (context) {
            const maxVolume = context.chart.data.datasets[0].data.reduce(
              (max, current) => (current > max ? current : max),
              0
            );
            return maxVolume * 5;
          },
          grid: {
            display: false,
          },
          afterFit: function (scaleInstance) {
            scaleInstance.width = 90;
          },
        },
      },
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          enabled: false,
        },
      },
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
          onPanStart: () => {
            this.subscribeVolumeChartUpdate();
          },
          onPan: ({ chart }) => {
            const xMin = chart.scales.x.min;
            if (xMin <= this.earliestX && !this.isLoading) {
              this.debouncedCheckLimitReached();
            }
            this.subscribeOverlayUpdate();
          },
          onPanComplete: () => {
            this.unsubscribeVolumeChartUpdate();
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
          onZoom: ({ chart }) => {
            // 캔들 차트 줌 시 볼륨 차트도 함께 확대/축소
            if (
              this.volumeChart &&
              chart.options.plugins.zoom.zoom.mode === "x"
            ) {
              this.volumeChart.options.scales.x.min = chart.scales.x.min;
              this.volumeChart.options.scales.x.max = chart.scales.x.max;
              this.volumeChart.update("none");
            }

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

  // 볼륨 차트 업데이트 구독 메서드
  subscribeVolumeChartUpdate() {
    if (!this.isVolumeChartSubscribed) {
      tickerInstance.subscribe(this.boundUpdateVolumeChart);
      this.isVolumeChartSubscribed = true;
    }
  }

  // 볼륨 차트 업데이트 구독 취소 메서드
  unsubscribeVolumeChartUpdate() {
    if (this.isVolumeChartSubscribed) {
      tickerInstance.unsubscribe(this.boundUpdateVolumeChart);
      this.isVolumeChartSubscribed = false;
    }
  }

  // 볼륨 차트 업데이트 콜백 (티커에서 호출됨)
  updateVolumeChart() {
    if (this.chart && this.volumeChart) {
      // 캔들 차트의 X축 범위를 가져옴
      const xMin = this.chart.scales.x.min;
      const xMax = this.chart.scales.x.max;

      // 볼륨 차트의 X축 범위 업데이트
      this.volumeChart.options.scales.x.min = xMin;
      this.volumeChart.options.scales.x.max = xMax;

      // 애니메이션 없이 즉시 업데이트
      this.volumeChart.update("none");
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

        // 볼륨 차트 데이터도 업데이트
        if (this.volumeChart) {
          const volumeData = this.formatVolumeData({
            labels: this.labelsStack,
            datasets: [{ data: this.dataStack }],
          });

          this.volumeChart.data.labels = volumeData.labels;
          this.volumeChart.data.datasets = volumeData.datasets;
        }

        this.earliestX = this.labelsStack[0];
        this.chart.options.plugins.zoom.limits.x.min = this.earliestX;

        // 볼륨 차트의 스케일도 업데이트
        if (this.volumeChart) {
          this.volumeChart.options.scales.x.min = this.earliestX;
        }

        this.chart.update("none");
        if (this.volumeChart) {
          this.volumeChart.update("none");
        }
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

  // 공통 코어 함수 추가
  _drawOverlays(overlays, fullClear = false) {
    // console.log("overlays", overlays);
    // 오버레이 유효성 검사
    if (!overlays || !Array.isArray(overlays) || overlays.length === 0) return;

    // 오버레이 캔버스 초기화 (fullClear 파라미터에 따라 전체 또는 절반 크기로 초기화)
    const width = fullClear
      ? this.overlayCtx.canvas.width
      : this.overlayCtx.canvas.width / 2;
    const height = fullClear
      ? this.overlayCtx.canvas.height
      : this.overlayCtx.canvas.height / 2;

    this.overlayCtx.clearRect(0, 0, width, height);

    // 저장된 모든 오버레이 다시 그리기
    overlays.forEach((overlay) => {
      if (!overlay) return;

      const { startX, startY, endX, endY, lineType } = overlay;
      const chartArea = this.chart.chartArea;

      if (lineType === "HorizontalLine") {
        const yPixel = this.chart.scales.y.getPixelForValue(startY);
        drawLine(
          this.overlayCtx,
          chartArea.left,
          yPixel,
          chartArea.right,
          yPixel,
          "red",
          1,
          chartArea
        );
      } else if (lineType === "VerticalLine") {
        const xPixel = this.chart.scales.x.getPixelForValue(startX);
        drawLine(
          this.overlayCtx,
          xPixel,
          chartArea.top,
          xPixel,
          chartArea.bottom,
          "red",
          1,
          chartArea
        );
      } else if (lineType === "ExtendedLine") {
        const startXPixel = this.chart.scales.x.getPixelForValue(startX);
        const endXPixel = this.chart.scales.x.getPixelForValue(endX);
        const startYPixel = this.chart.scales.y.getPixelForValue(startY);
        const endYPixel = this.chart.scales.y.getPixelForValue(endY);

        const slope = calculateSlope(
          startXPixel,
          startYPixel,
          endXPixel,
          endYPixel
        );

        let startPx, endPx;

        if (slope === Infinity || slope === -Infinity) {
          startPx = { x: startXPixel, y: chartArea.top };
          endPx = { x: startXPixel, y: chartArea.bottom };
        } else if (slope === 0) {
          startPx = { x: chartArea.left, y: startYPixel };
          endPx = { x: chartArea.right, y: startYPixel };
        } else {
          const yAtLeft = startYPixel - slope * (startXPixel - chartArea.left);
          const yAtRight =
            startYPixel + slope * (chartArea.right - startXPixel);

          const xAtTop = startXPixel + (chartArea.top - startYPixel) / slope;
          const xAtBottom =
            startXPixel + (chartArea.bottom - startYPixel) / slope;

          if (yAtLeft >= chartArea.top && yAtLeft <= chartArea.bottom) {
            startPx = { x: chartArea.left, y: yAtLeft };
          } else if (xAtTop >= chartArea.left && xAtTop <= chartArea.right) {
            startPx = { x: xAtTop, y: chartArea.top };
          } else {
            startPx = { x: chartArea.left, y: yAtLeft };
          }

          if (yAtRight >= chartArea.top && yAtRight <= chartArea.bottom) {
            endPx = { x: chartArea.right, y: yAtRight };
          } else if (
            xAtBottom >= chartArea.left &&
            xAtBottom <= chartArea.right
          ) {
            endPx = { x: xAtBottom, y: chartArea.bottom };
          } else {
            endPx = { x: chartArea.right, y: yAtRight };
          }
        }

        drawLine(
          this.overlayCtx,
          startPx.x,
          startPx.y,
          endPx.x,
          endPx.y,
          "red",
          1,
          chartArea
        );
      } else if (lineType === "Ray") {
        const startXPixel = this.chart.scales.x.getPixelForValue(startX);
        const endXPixel = this.chart.scales.x.getPixelForValue(endX);
        const startYPixel = this.chart.scales.y.getPixelForValue(startY);
        const endYPixel = this.chart.scales.y.getPixelForValue(endY);

        const slope = calculateSlope(
          startXPixel,
          startYPixel,
          endXPixel,
          endYPixel
        );

        const direction = calculateDirection(
          startXPixel,
          startYPixel,
          endXPixel,
          endYPixel
        );

        let endPx;

        if (slope === Infinity || slope === -Infinity) {
          endPx = {
            x: startXPixel,
            y: direction.y > 0 ? chartArea.bottom : chartArea.top,
          };
        } else if (slope === 0) {
          endPx = {
            x: direction.x > 0 ? chartArea.right : chartArea.left,
            y: startYPixel,
          };
        } else {
          const intersections = [];

          const yAtRight =
            startYPixel + slope * (chartArea.right - startXPixel);
          if (yAtRight >= chartArea.top && yAtRight <= chartArea.bottom) {
            intersections.push({
              x: chartArea.right,
              y: yAtRight,
              distance:
                Math.pow(chartArea.right - startXPixel, 2) +
                Math.pow(yAtRight - startYPixel, 2),
              direction: { x: 1, y: yAtRight > startYPixel ? 1 : -1 },
            });
          }

          const yAtLeft = startYPixel + slope * (chartArea.left - startXPixel);
          if (yAtLeft >= chartArea.top && yAtLeft <= chartArea.bottom) {
            intersections.push({
              x: chartArea.left,
              y: yAtLeft,
              distance:
                Math.pow(chartArea.left - startXPixel, 2) +
                Math.pow(yAtLeft - startYPixel, 2),
              direction: { x: -1, y: yAtLeft > startYPixel ? 1 : -1 },
            });
          }

          const xAtTop = startXPixel + (chartArea.top - startYPixel) / slope;
          if (xAtTop >= chartArea.left && xAtTop <= chartArea.right) {
            intersections.push({
              x: xAtTop,
              y: chartArea.top,
              distance:
                Math.pow(xAtTop - startXPixel, 2) +
                Math.pow(chartArea.top - startYPixel, 2),
              direction: { x: xAtTop > startXPixel ? 1 : -1, y: -1 },
            });
          }

          const xAtBottom =
            startXPixel + (chartArea.bottom - startYPixel) / slope;
          if (xAtBottom >= chartArea.left && xAtBottom <= chartArea.right) {
            intersections.push({
              x: xAtBottom,
              y: chartArea.bottom,
              distance:
                Math.pow(xAtBottom - startXPixel, 2) +
                Math.pow(chartArea.bottom - startYPixel, 2),
              direction: { x: xAtBottom > startXPixel ? 1 : -1, y: 1 },
            });
          }

          const validIntersections = intersections.filter(
            (intersection) =>
              (intersection.direction.x === direction.x ||
                intersection.direction.x === 0) &&
              (intersection.direction.y === direction.y ||
                intersection.direction.y === 0)
          );

          if (validIntersections.length > 0) {
            endPx = validIntersections.reduce((closest, current) =>
              current.distance < closest.distance ? current : closest
            );
          } else {
            endPx = { x: endX, y: endY };
          }
        }

        drawLine(
          this.overlayCtx,
          startXPixel,
          startYPixel,
          endPx.x,
          endPx.y,
          "red",
          1,
          chartArea
        );
      } else {
        const startXPixel = this.chart.scales.x.getPixelForValue(startX);
        const endXPixel = this.chart.scales.x.getPixelForValue(endX);
        const startYPixel = this.chart.scales.y.getPixelForValue(startY);
        const endYPixel = this.chart.scales.y.getPixelForValue(endY);

        drawLine(
          this.overlayCtx,
          startXPixel,
          startYPixel,
          endXPixel,
          endYPixel,
          "red",
          1,
          chartArea
        );
      }
    });
  }

  // 메서드 수정
  updateOverlayCanvas() {
    // 줌/패닝 중 호출되는 메서드
    const overlays = window.mainCanvas?.getOverlaysArray();
    this._drawOverlays(overlays, true); // 전체 캔버스를 지우도록 true 전달
  }

  renderOverlays() {
    // 차트 렌더링 시 호출되는 메서드
    // window.mainCanvas 자체가 초기화되었는지 확인
    if (!window.mainCanvas) return;

    // getOverlaysArray 메서드가 존재하는지 확인
    const overlays =
      window.mainCanvas.getOverlaysArray &&
      window.mainCanvas.getOverlaysArray();

    this._drawOverlays(overlays, false); // 절반 크기만 지우도록 false 전달
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
      this.volumeChart.resize();
      this.volumeChart.update("none");
    }

    // 오버레이 다시 그리기
    this.renderOverlays();
  }

  // 선 그리기 유틸리티 메서드 추가
  drawLine(startX, startY, endX, endY, color = "red", width = 1) {
    this.overlayCtx.beginPath();
    this.overlayCtx.moveTo(startX, startY);
    this.overlayCtx.lineTo(endX, endY);
    this.overlayCtx.lineWidth = width;
    this.overlayCtx.strokeStyle = color;
    this.overlayCtx.stroke();
  }

  formatVolumeData(data) {
    // 데이터 구조가 초기화와 추가 로드 시 다를 수 있으므로 통일
    const candleData = data.datasets[0].data;

    // 각 바 색상 결정
    const backgroundColor = candleData.map((candle) => {
      // 캔들 데이터가 올바른 형식인지 확인
      if (!candle || typeof candle !== "object") {
        console.error("Invalid candle data:", candle);
        return this.applyTransparency(chartColors.upBody, 0.4);
      }

      // 캔들스틱 차트와 동일한 방식으로 색상 결정
      // chartjs-chart-financial 라이브러리의 내부 구현 방식과 일치
      const openPrice = Number(candle.o);
      const closePrice = Number(candle.c);
      const isUp = openPrice <= closePrice;

      // chartColors와 정확히 동일한 색상 사용 (캔들차트와 일치)
      return isUp
        ? this.applyTransparency(chartColors.upBody, 0.4)
        : this.applyTransparency(chartColors.downBody, 0.4);
    });

    return {
      labels: data.labels,
      datasets: [
        {
          data: candleData.map((item) => item.v / 10),
          backgroundColor: backgroundColor,
          borderColor: backgroundColor,
          borderWidth: 0,
          minBarLength: 10,
        },
      ],
    };
  }

  // 색상에 투명도를 적용하는 헬퍼 메서드 추가
  applyTransparency(color, alpha) {
    // rgba 색상인 경우
    if (color.startsWith("rgba")) {
      // 마지막 닫는 괄호 직전의 알파 값을 대체
      return color.replace(/,\s*[\d\.]+\)$/, `, ${alpha})`);
    }
    // rgb 색상인 경우
    else if (color.startsWith("rgb")) {
      // rgb를 rgba로 변환
      return color.replace("rgb", "rgba").replace(")", `, ${alpha})`);
    }
    // 헥스 코드인 경우 (#ffffff 형식)
    else if (color.startsWith("#")) {
      // hex를 rgb 값으로 변환
      const r = parseInt(color.substring(1, 3), 16);
      const g = parseInt(color.substring(3, 5), 16);
      const b = parseInt(color.substring(5, 7), 16);
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    // 다른 형식이라면 기본값 반환
    return color;
  }
}
