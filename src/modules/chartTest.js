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

    // 스로틀링 없이 바로 바인딩
    this.updateMousePositionBound = this.updateMousePosition.bind(this);

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

      // 차트 캔버스에 이벤트 리스너 추가
      this.chartCtx.canvas.addEventListener(
        "wheel",
        this.handleWheel.bind(this),
        { passive: true }
      );
      this.chartCtx.canvas.addEventListener(
        "touchstart",
        this.handleTouchStart.bind(this),
        { passive: true }
      );
      this.chartCtx.canvas.addEventListener(
        "touchmove",
        this.handleTouchMove.bind(this),
        { passive: true }
      );

      // 마우스 이벤트 리스너 추가
      this.chartCtx.canvas.addEventListener(
        "mousemove",
        this.handleMouseMove.bind(this),
        { passive: true }
      );
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
          y: { min: "original", max: "original" },
        },
        eventOptions: {
          passive: true,
        },
        pan: {
          enabled: true,
          mode: "xy",
          threshold: 10,
          eventOptions: {
            passive: true,
          },
          onPanStart: ({ chart }) => {
            chart._performanceMode = true;
          },
          onPan: ({ chart }) => {
            const xMin = chart.scales.x.min;
            if (xMin <= this.earliestX && !this.isLoading) {
              this.debouncedCheckLimitReached();
            }

            if (!this._panAnimFrame) {
              this._panAnimFrame = requestAnimationFrame(() => {
                this.updateOverlayCanvas();
                this._panAnimFrame = null;
              });
            }
          },
          onPanComplete: ({ chart }) => {
            chart._performanceMode = false;
            this.unsubscribeOverlayUpdate();
          },
        },
        zoom: {
          wheel: {
            enabled: true,
            speed: 0.1,
            threshold: 2,
            eventOptions: {
              passive: true,
            },
          },
          pinch: {
            enabled: true,
            eventOptions: {
              passive: true,
            },
          },
          mode: "xy",
          onZoomStart: ({ chart }) => {
            chart._performanceMode = true;
          },
          onZoom: () => {
            if (!this._zoomAnimFrame) {
              this._zoomAnimFrame = requestAnimationFrame(() => {
                this.updateOverlayCanvas();
                this._zoomAnimFrame = null;
              });
            }
          },
          onZoomComplete: ({ chart }) => {
            chart._performanceMode = false;

            this.unsubscribeOverlayUpdate();
            this.updateOverlayCanvas();
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
          limit: 1000,
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
          limit: 1000,
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
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    if (this.isLoading) {
      return;
    }

    this.isLoading = true;
    this.showLoadingSpinner();

    try {
      const formattedData = await this.handleFetchMoreData();

      if (formattedData.labels.length > 0) {
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

  // 공통 코어 함수 추가
  _drawOverlays(overlays, fullClear = false) {
    if (!overlays || !Array.isArray(overlays) || overlays.length === 0) return;

    const width = fullClear
      ? this.overlayCtx.canvas.width
      : this.overlayCtx.canvas.width / 2;
    const height = fullClear
      ? this.overlayCtx.canvas.height
      : this.overlayCtx.canvas.height / 2;

    this.overlayCtx.clearRect(0, 0, width, height);

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

  // 오버레이 렌더링 최적화
  updateOverlayCanvas() {
    if (this._updateRaf) {
      cancelAnimationFrame(this._updateRaf);
      this._updateRaf = null;
    }

    this._updateRaf = requestAnimationFrame(() => {
      const overlays = window.mainCanvas?.getOverlaysArray();
      if (overlays && overlays.length) {
        const chartArea = this.chart.chartArea;

        if (this.chart._performanceMode) {
          this.overlayCtx.clearRect(
            0,
            0,
            this.overlayCtx.canvas.width,
            this.overlayCtx.canvas.height
          );
          this.overlayCtx.globalAlpha = 0.7;
          this._drawOverlays(overlays, true);
          this.overlayCtx.globalAlpha = 1.0;
        } else {
          this._drawOverlays(overlays, true);
        }
      }
      this._updateRaf = null;
    });
  }

  // 오버레이 갱신이 필요한지 확인하는 플래그 추가
  setNeedsOverlayUpdate() {
    this.needsOverlayUpdate = true;
  }

  renderOverlays() {
    if (!window.mainCanvas) return;

    const overlays =
      window.mainCanvas.getOverlaysArray &&
      window.mainCanvas.getOverlaysArray();
    if (!overlays || !overlays.length) return;

    if (!this._renderRaf) {
      this._renderRaf = requestAnimationFrame(() => {
        this._drawOverlays(overlays, false);
        this._renderRaf = null;
      });
    }
  }

  // 마우스 위치 업데이트 메서드 최적화
  updateMousePosition(x, y) {
    if (!this.crosshair || typeof this.crosshair.updatePosition !== "function")
      return;

    if (!this._crosshairRaf) {
      this._crosshairRaf = requestAnimationFrame(() => {
        this.crosshair.updatePosition(x, y);
        this._crosshairRaf = null;
      });
    }
  }

  // handleMouseMove 메서드 추가 - 캔버스에 마우스 이벤트 리스너로 사용
  handleMouseMove(event) {
    const rect = this.chartCtx.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    // 스로틀 없이 직접 호출
    this.updateMousePosition(x, y);
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

  handleWheel(event) {
    // 구현 필요
  }

  handleTouchStart(event) {
    // 구현 필요
  }

  handleTouchMove(event) {
    // 구현 필요
  }

  // 화면 크기 조정 이벤트에 debounce 적용
  handleResize() {
    if (this._resizeTimer) {
      clearTimeout(this._resizeTimer);
    }

    this._resizeTimer = setTimeout(() => {
      this.render();
      this._resizeTimer = null;
    }, 150);
  }
}
