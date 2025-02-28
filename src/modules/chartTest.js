import { Chart, registerables } from "chart.js";
import {
  CandlestickController,
  CandlestickElement,
} from "chartjs-chart-financial";
import "chartjs-adapter-date-fns";
import { ChartCrosshair } from "./chartCrosshair";
import { chartColors } from "./theme";
import axios from "axios";
import { tickerInstance } from "./ticker";
import {
  calculateSlope,
  calculateDirection,
  drawLine,
} from "../utilities/lineUtils.js";
// Chart.js 유틸리티 함수 import 추가
import { _isPointInArea } from "chart.js/helpers";
// Chart.js에 필요한 요소 등록
Chart.register(...registerables, CandlestickController, CandlestickElement);

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
    // this.boundUpdateVolumeChart = this.updateVolumeChart.bind(this);
    this.boundUpdateCharts = this.updateCharts.bind(this);
    this.isOverlaySubscribed = false;
    this.isVolumeChartSubscribed = false;
    this.isChartUpdateSubscribed = false;
    this.chartNeedsUpdate = false;
    this.wheelDebounceTimer = null;
    this.chartUpdateRefCount = 0;

    this.initialize();
  }

  async initialize() {
    try {
      const data = await this.handleFetchData();
      if (!this.isValidData(data)) {
        console.error("차트 데이터가 유효하지 않습니다.");
        return;
      }
      console.log(data);

      // const volumeData = this.formatVolumeData(data);

      // 데이터 시간 범위 설정
      this.setupTimeRange(data);

      // 차트 옵션 및 인스턴스 생성
      // this.createCharts(data, volumeData);
      this.createCharts(data);

      // 초기 데이터 설정
      this.labelsStack = [...this.chart.data.labels];
      this.dataStack = [...this.chart.data.datasets[0].data];

      // 크로스헤어 초기화
      this.initializeCrosshair();

      // 안전장치 설정
      this.setupSafetyChecks();

      // 차트 렌더링
      this.render();
    } catch (error) {
      console.error("차트 초기화 중 오류 발생:", error);
    }
  }

  // 데이터 유효성 검증
  isValidData(data) {
    return data && data.labels && data.labels.length > 0;
  }

  // 시간 범위 설정
  setupTimeRange(data) {
    this.earliestX = data.labels[0] - 1000 * 60 * 60 * 24 * 3; // 3일 여유 마진
  }

  // 차트 생성
  createCharts(data /*, volumeData*/) {
    const latestX = data.labels[data.labels.length - 1];
    const chartOptions = this.createChartOptions(this.earliestX, latestX);
    // const volumeChartOptions = this.createVolumeChartOptions(
    //   this.earliestX,
    //   latestX
    // );

    // 캔들 차트 인스턴스 생성
    this.chart = new Chart(this.chartCtx, {
      type: "candlestick",
      data: data,
      options: chartOptions,
    });
    // console.log("캔들 차트 인스턴스가 생성되었습니다.");
    console.log(this.chart.data);

    // 볼륨 차트 인스턴스 생성
    // this.volumeChart = new Chart(this.volumeChartCtx, {
    //   type: "bar",
    //   data: volumeData,
    //   options: volumeChartOptions,
    // });
    // console.log("볼륨 차트 인스턴스가 생성되었습니다.");

    // chart 인스턴스 생성 후에 아래 코드를 실행합니다.
    this.chart.getDatasetMeta = (datasetIndex) => {
      const dataset = this.chart.data.datasets[datasetIndex];
      const metasets = this.chart["_metasets"];
      let meta = metasets[datasetIndex];
      if (!meta) {
        meta = {
          type: null,
          data: [],
          dataset: null,
          controller: null,
          hidden: null,
          xAxisID: null,
          yAxisID: null,
          order: (dataset && dataset.order) || 0,
          index: datasetIndex,
          _dataset: dataset,
          _parsed: [],
          _sorted: false,
        };
        metasets[datasetIndex] = meta;
      }
      return meta;
    };

    this.chart.notifyPlugins = (plugins) => {
      return;
    };

    // X축에 afterFit 이벤트 핸들러 등록
    this.setupAfterFitHandlers();

    // 기존 코드를 대체하여 커스텀 컨트롤 핸들러 등록
    this.setupCustomControlsHandler();

    console.log(this.chart);

    // 차트 렌더링 성능 개선
    this.chart.options.responsive = false; // 반응형 비활성화
    this.chart.options.maintainAspectRatio = false; // 종횡비 유지 비활성화
    this.chart.options.animation = false; // 애니메이션 비활성화
    this.chart.options.elements.line.tension = 0; // 곡선 텐션 제거
    this.chart.options.elements.point.radius = 0; // 점 제거
    // this.volumeChart.options.animation = false;

    // 캔들스틱 컨트롤러의 calculateElementProperties 메서드 오버라이드
    const candlestickController =
      this.chart.registry.controllers.get("candlestick");
    if (candlestickController && candlestickController.prototype) {
      // calculateElementProperties 메서드 오버라이드 (기존 코드)
      const originalCalculateElementProperties =
        candlestickController.prototype.calculateElementProperties;

      candlestickController.prototype.calculateElementProperties = function (
        mode,
        reset
      ) {
        // 캐시 메커니즘 완화
        if (
          this._cachedProperties &&
          !reset &&
          mode === "default" &&
          !this._forcePropertiesUpdate
        ) {
          return this._cachedProperties;
        }

        // 원래 메서드 호출
        const result = originalCalculateElementProperties.call(
          this,
          mode,
          reset
        );

        // 결과 캐싱
        if (mode === "default") {
          this._cachedProperties = result;
          this._forcePropertiesUpdate = false;
        }

        return result;
      };

      // _getRuler 메서드 최적화
      const originalGetRuler = candlestickController.prototype._getRuler;

      // 룰러 캐시 객체
      const rulerCache = {
        cache: {},
        lastMin: null,
        lastMax: null,
      };

      candlestickController.prototype._getRuler = function () {
        const me = this;
        const meta = me._cachedMeta;
        const xScale = meta.xScale;

        // 캐싱 조건 완화 - 강제 업데이트 플래그 추가
        if (
          !this._forceRulerUpdate &&
          rulerCache.lastMin === xScale.min &&
          rulerCache.lastMax === xScale.max &&
          rulerCache.cache[meta.type]
        ) {
          return rulerCache.cache[meta.type];
        }

        // 원래 메서드 호출
        const ruler = originalGetRuler.call(this);

        // 결과 캐싱
        rulerCache.cache[meta.type] = ruler;
        rulerCache.lastMin = xScale.min;
        rulerCache.lastMax = xScale.max;
        this._forceRulerUpdate = false;

        return ruler;
      };

      // updateElements 메서드 최적화
      const originalUpdateElements =
        candlestickController.prototype.updateElements;

      candlestickController.prototype.updateElements = function (
        elements,
        start,
        count,
        mode
      ) {
        // 이전 업데이트와 동일한 범위면 건너뛰기 - 조건 완화
        if (
          mode !== "reset" && // reset 모드는 항상 업데이트
          this._lastUpdateStart === start &&
          this._lastUpdateCount === count &&
          this._lastUpdateMode === mode &&
          !this._forceUpdate
        ) {
          return;
        }

        // 메타데이터 캐싱
        if (!this._cachedMeta) {
          this._cachedMeta = this._getMeta();
        }

        // 원래 메서드 호출
        originalUpdateElements.call(this, elements, start, count, mode);

        // 업데이트 정보 저장
        this._lastUpdateStart = start;
        this._lastUpdateCount = count;
        this._lastUpdateMode = mode;
        this._forceUpdate = false;
      };

      // 데이터 파싱 최적화 (기존 코드)
      const originalParseObjectData =
        candlestickController.prototype.parseObjectData;
      if (originalParseObjectData) {
        candlestickController.prototype.parseObjectData = function (
          meta,
          data,
          start,
          count
        ) {
          // 이미 파싱된 데이터가 있고 동일한 데이터 범위라면 재사용
          if (
            this._parsedData &&
            this._parsedDataStart === start &&
            this._parsedDataCount === count
          ) {
            return this._parsedData;
          }

          const result = originalParseObjectData.call(
            this,
            meta,
            data,
            start,
            count
          );

          // 파싱 결과 캐싱
          this._parsedData = result;
          this._parsedDataStart = start;
          this._parsedDataCount = count;

          return result;
        };
      }
    }
  }

  // afterFit 핸들러 설정 메서드 수정
  setupAfterFitHandlers() {
    // 메인 차트 X축 afterFit 핸들러
    this.chart.options.scales.x.afterFit = (scaleInstance) => {
      if (
        this.chartNeedsUpdate &&
        !this.isUpdating &&
        !this.isUpdatingImmediately
      ) {
        this.isUpdating = true;

        // 볼륨 차트 동기화 (철저하게)
        // if (this.volumeChart) {
        //   this.volumeChart.options.scales.x.min = this.chart.scales.x.min;
        //   this.volumeChart.options.scales.x.max = this.chart.scales.x.max;
        //   this.volumeChart.scales.x.min = this.chart.scales.x.min;
        //   this.volumeChart.scales.x.max = this.chart.scales.x.max;

        //   // 캔들차트의 차트영역과 일치하도록 설정
        //   this.volumeChart.chartArea.left = this.chart.chartArea.left;
        //   this.volumeChart.chartArea.right = this.chart.chartArea.right;
        // }

        // 렌더링 최적화
        // if (this.volumeChart) {
        //   this.volumeChart.update("none");
        // }

        // 오버레이 업데이트
        this.updateOverlayCanvas();

        // 상태 초기화
        this.isUpdating = false;
        this.chartNeedsUpdate = false;
      }
    };

    // 볼륨 차트 X축 afterFit 핸들러 - 캔들차트와 동기화하는 역할
    // if (this.volumeChart) {
    //   this.volumeChart.options.scales.x.afterFit = (scaleInstance) => {
    //     // 캔들차트의 X축 레이아웃과 정확히 일치시킴
    //     if (this.chart && this.chart.scales && this.chart.scales.x) {
    //       scaleInstance.left = this.chart.scales.x.left;
    //       scaleInstance.right = this.chart.scales.x.right;
    //       scaleInstance.width = this.chart.scales.x.width;
    //     }
    //   };
    // }
  }

  // 커스텀 휠 및 마우스 이벤트 핸들러 설정
  setupCustomControlsHandler() {
    const canvas = this.chartCtx.canvas;

    // 이벤트 처리를 위한 상태 변수들
    let isWheelActive = false;
    let isDragging = false;
    let lastMouseX = 0;
    let lastMouseY = 0;
    let lastWheelTime = 0;
    let lastWheelFrameId = 0;
    let lastMouseDownFrameId = 0;
    let currentFrame = 0;

    // 프레임 ID 업데이트 함수
    const updateFrameId = () => {
      currentFrame++;
      requestAnimationFrame(updateFrameId);
    };

    // 프레임 ID 업데이트 시작
    updateFrameId();

    // 휠 이벤트 처리
    const handleWheel = (e) => {
      // 이벤트 기본 동작 방지
      e.preventDefault();

      // 현재 시간 및 프레임 확인
      const now = Date.now();

      // 같은 프레임에서 이미 휠 이벤트를 처리했다면 무시 (기존 프레임 제한 유지)
      if (lastWheelFrameId === currentFrame) {
        e.preventDefault();
        return;
      }

      // 시간 제한 (throttling)
      if (now - lastWheelTime < 8) {
        // 약 60fps
        e.preventDefault();
        return;
      }

      // 시간 및 프레임 ID 업데이트
      lastWheelTime = now;
      lastWheelFrameId = currentFrame;

      // 나머지 휠 처리 로직은 그대로 유지
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      // 차트 영역 확인
      const chartArea = this.chart.chartArea;
      if (
        x < chartArea.left ||
        x > chartArea.right ||
        y < chartArea.top ||
        y > chartArea.bottom
      ) {
        return;
      }

      // 수정자 키 확인 (Shift 키)
      const isModifierPressed = e.shiftKey;

      // 휠 처리 로직
      const speed = 0.1;
      const delta = e.deltaY > 0 ? 1 - speed : 1 + speed;

      // 줌 방향 결정
      const direction = isModifierPressed ? "y" : "x";

      // 차트 줌 실행 및 즉시 업데이트 적용
      this.zoomChartImmediate(x, y, delta, direction);

      // 구독 관련 코드 복원
      if (!isWheelActive) {
        isWheelActive = true;
        console.log("휠 이벤트 시작: 구독 시작");
        this.subscribeChartUpdate("wheel");
      }

      // 디바운싱은 유지
      if (this.wheelDebounceTimer) {
        clearTimeout(this.wheelDebounceTimer);
      }

      this.wheelDebounceTimer = setTimeout(() => {
        console.log("휠 타이머 종료");
        isWheelActive = false;
        this.unsubscribeChartUpdate("wheel-timer");
        this.wheelDebounceTimer = null;
      }, 10);
    };

    // 마우스 다운 이벤트 핸들러
    const handleMouseDown = (e) => {
      // 오른쪽 마우스 클릭 무시
      if (e.button === 2) return;

      if (lastMouseDownFrameId === currentFrame) {
        e.preventDefault();
        return;
      }
      lastMouseDownFrameId = currentFrame;

      const rect = canvas.getBoundingClientRect();
      lastMouseX = e.clientX - rect.left;
      lastMouseY = e.clientY - rect.top;

      if (!this.isPointInChartArea({ x: lastMouseX, y: lastMouseY })) return;

      isDragging = true;
      this.subscribeChartUpdate("mouse-down");

      e.preventDefault();
    };

    // 마우스 이동 이벤트 핸들러
    const handleMouseMove = (e) => {
      if (!isDragging || !this.chart) return;

      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const dx = x - lastMouseX;
      const dy = y - lastMouseY;

      this.panChart(dx, dy);

      lastMouseX = x;
      lastMouseY = y;
    };

    // 마우스 업 이벤트 핸들러
    const handleMouseUp = () => {
      if (isDragging) {
        isDragging = false;
        this.unsubscribeChartUpdate("mouse-up");
      }
    };

    // mouseleave 이벤트 핸들러
    const handleMouseLeave = (e) => {
      if (lastMouseLeaveFrameId === currentFrame) {
        return;
      }
      lastMouseLeaveFrameId = currentFrame;

      console.log("mouseleave 이벤트 발생");
      this.unsubscribeChartUpdate("mouse-leave");
    };

    // 이벤트 리스너 등록
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    canvas.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    canvas.addEventListener("mouseleave", handleMouseLeave);

    // 터치 이벤트 리스너는 필요에 따라 추가
    /*
    canvas.addEventListener("touchstart", handleTouchStart, { passive: false });
    canvas.addEventListener("touchmove", handleTouchMove, { passive: false });
    canvas.addEventListener("touchend", handleTouchEnd);
    canvas.addEventListener("touchcancel", handleTouchEnd);
    */
  }

  // 새로운 즉시 업데이트 메서드 추가
  zoomChartImmediate(x, y, scale, direction = "x") {
    if (!this.chart) return;

    try {
      const xScale = this.chart.scales.x;
      const yScale = this.chart.scales.y;

      // 스케일 범위 계산
      if (direction === "x" || direction === "xy") {
        const rangeWidth = xScale.max - xScale.min;
        const centerValue = xScale.getValueForPixel(x);
        const newRangeWidth = rangeWidth / scale;
        const newMin =
          centerValue -
          (newRangeWidth * (centerValue - xScale.min)) / rangeWidth;
        const newMax =
          centerValue +
          (newRangeWidth * (xScale.max - centerValue)) / rangeWidth;

        xScale.options.min = newMin;
        xScale.options.max = newMax;
      }

      if (direction === "y" || direction === "xy") {
        const rangeHeight = yScale.max - yScale.min;
        const centerValue = yScale.getValueForPixel(y);
        const newRangeHeight = rangeHeight / scale;
        const newMin =
          centerValue -
          (newRangeHeight * (centerValue - yScale.min)) / rangeHeight;
        const newMax =
          centerValue +
          (newRangeHeight * (yScale.max - centerValue)) / rangeHeight;

        yScale.options.min = newMin;
        yScale.options.max = newMax;
      }

      // 캔들스틱 컨트롤러에 강제 업데이트 플래그 설정
      const candlestickController = this.chart.getDatasetMeta(0).controller;
      if (candlestickController) {
        candlestickController._forceUpdate = true;
        candlestickController._forceRulerUpdate = true;
        candlestickController._forcePropertiesUpdate = true;
      }

      // 즉시 차트 업데이트 실행
      this.chart.update("none");

      // 오버레이 즉시 업데이트
      this.updateOverlayCanvas();

      // 업데이트 플래그도 설정 (다른 시스템과의 호환성 유지)
      this.chartNeedsUpdate = false;
      this.isUpdatingImmediately = false;

      // 데이터 범위 확인 (과거 데이터 로딩 필요한지)
      if (xScale.options.min <= this.earliestX && !this.isLoading) {
        this.debouncedCheckLimitReached();
      }
    } catch (e) {
      console.error("줌 처리 중 오류:", e);
    }
  }

  // 차트 패닝 메서드
  panChart(dx, dy) {
    const scales = this.chart.scales;
    const xScale = scales.x;
    const yScale = scales.y;

    if (dx !== 0) {
      const pixelToDataRatio = (xScale.max - xScale.min) / xScale.width;
      const dataDx = dx * pixelToDataRatio;
      xScale.options.min = xScale.min - dataDx;
      xScale.options.max = xScale.max - dataDx;
    }

    if (dy !== 0) {
      const yMin = yScale.min;
      const yMax = yScale.max;
      const yStartPixel = yScale.getPixelForValue(yMin);
      const yEndPixel = yScale.getPixelForValue(yMax);
      const newYMin = yScale.getValueForPixel(yStartPixel - dy);
      const newYMax = yScale.getValueForPixel(yEndPixel - dy);
      yScale.options.min = newYMin;
      yScale.options.max = newYMax;
    }

    // if (this.volumeChart) {
    //   this.volumeChart.options.scales.x.min = xScale.options.min;
    //   this.volumeChart.options.scales.x.max = xScale.options.max;
    // }

    if (xScale.options.min <= this.earliestX && !this.isLoading) {
      this.debouncedCheckLimitReached();
    }

    this.chartNeedsUpdate = true;
  }

  // 포인트가 차트 영역 내에 있는지 확인
  isPointInChartArea(point) {
    const chartArea = this.chart.chartArea;
    return (
      point.x >= chartArea.left &&
      point.x <= chartArea.right &&
      point.y >= chartArea.top &&
      point.y <= chartArea.bottom
    );
  }

  // 크로스헤어 초기화
  initializeCrosshair() {
    this.crosshair = new ChartCrosshair(
      this.crosshairCtx,
      this.chart
      // this.volumeChart
    );
  }

  // 차트 옵션 생성 메서드
  createChartOptions(earliestX, latestX) {
    return {
      maintainAspectRatio: false,
      animation: false,
      responsive: false,
      layout: {
        padding: {
          right: 8,
        },
      },
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
            autoSkip: false,
            // autoSkipPadding: 100,
            source: "auto",
            // display: true,
          },
          grid: {
            color: "rgba(255, 255, 255, 0.1)",
            display: true,
            drawOnChartArea: true,
            drawTicks: false,
          },
          min: earliestX,
          max: latestX,
          offset: true,
          alignToPixels: true,
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
            maxTicksLimit: 8,
          },
          grid: {
            color: "rgba(255, 255, 255, 0.1)",
            display: true,
            drawOnChartArea: true,
          },
          afterFit: function (scaleInstance) {
            scaleInstance.width = 90;
          },
        },
      },
      // plugins: this.createPluginsOptions(earliestX, latestX),
    };
  }

  createVolumeChartOptions(earliestX, latestX) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      layout: {
        padding: {
          right: 8,
        },
      },
      scales: {
        x: {
          type: "time",
          time: {
            unit: "day",
          },
          min: earliestX,
          max: latestX,
          offset: true,
          ticks: {
            source: "auto",
            autoSkip: true,
            maxRotation: 0,
            display: false,
          },
          grid: {
            display: false,
          },
          bounds: "data",
          alignToPixels: true,
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
        decimation: {
          enabled: true,
          algorithm: "lttb", // 'lttb' (Largest Triangle Three Buckets) 또는 'min-max' 선택 가능
          samples: 100, // 최종적으로 렌더링할 데이터 포인트 수
        },
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
      // decimation: {
      //   enabled: true,
      //   algorithm: "lttb", // 'lttb' (Largest Triangle Three Buckets) 또는 'min-max' 선택 가능
      //   samples: 100, // 최종적으로 렌더링할 데이터 포인트 수
      // },
      // title: { display: false, fullSize: true },
      // legend: { display: false },
      // tooltip: {
      //   enabled: false,
      //   intersect: true,
      //   mode: "point",
      // },
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

  // 볼륨 차트 업데이트 콜백
  // updateVolumeChart() {
  //   if (this.chart && this.volumeChart) {
  //     const xMin = this.chart.scales.x.min;
  //     const xMax = this.chart.scales.x.max;

  //     this.volumeChart.options.scales.x.min = xMin;
  //     this.volumeChart.options.scales.x.max = xMax;

  //     this.volumeChart.update("none");
  //   }
  // }

  // 데이터 포맷팅 함수
  xohlcvFormatData(data) {
    const formattedData = data.map((item) => ({
      x: item[0],
      o: item[1],
      h: item[2],
      l: item[3],
      c: item[4],
      v: item[5],
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
          radius: 0,
          borderWidth: 0,
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
      return { labels: [], datasets: [{ data: [] }] };
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

  async debouncedCheckLimitReached() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    if (this.isLoading) return;

    this.isLoading = true;
    this.showLoadingSpinner();

    try {
      await this.loadMoreData();
    } catch (error) {
      console.error("추가 데이터 로딩 중 오류:", error);
    } finally {
      this.debounceTimer = setTimeout(() => {
        this.hideLoadingSpinner();
        this.isLoading = false;
      }, 500);
    }
  }

  async loadMoreData() {
    const formattedData = await this.handleFetchMoreData();
    if (formattedData.labels.length > 0) {
      this.appendNewData(formattedData);
      this.updateChartLimits();
      this.updateCharts();
    }
  }

  appendNewData(formattedData) {
    this.labelsStack = [...formattedData.labels, ...this.labelsStack];
    this.dataStack = [...formattedData.datasets[0].data, ...this.dataStack];

    this.chart.data.labels = this.labelsStack;
    this.chart.data.datasets[0].data = this.dataStack;

    // if (this.volumeChart) {
    //   const volumeData = this.formatVolumeData({
    //     labels: this.labelsStack,
    //     datasets: [{ data: this.dataStack }],
    //   });
    //   this.volumeChart.data.labels = volumeData.labels;
    //   this.volumeChart.data.datasets = volumeData.datasets;
    // }
  }

  updateChartLimits() {
    this.earliestX = this.labelsStack[0];
    // if (this.volumeChart) {
    //   this.volumeChart.options.scales.x.min = this.earliestX;
    // }
  }

  updateCharts(timestamp) {
    if (!this.chart) return;

    if (this.chartNeedsUpdate) {
      // 캔들스틱 컨트롤러에 강제 업데이트 플래그 설정
      const candlestickController = this.chart.getDatasetMeta(0).controller;
      if (candlestickController) {
        candlestickController._forceUpdate = true;
        candlestickController._forceRulerUpdate = true;
        candlestickController._forcePropertiesUpdate = true;
      }

      this.updateChart();
      this.updateOverlayCanvas();

      if (this.chart.scales.x.min <= this.earliestX && !this.isLoading) {
        this.debouncedCheckLimitReached();
      }
      this.chartNeedsUpdate = false;
    }
  }

  updateChart() {
    if (!this._chartScalesCache) {
      this._chartScalesCache = {};
    }
    const xScale = this.chart.scales.x;
    this._chartScalesCache.xMin = xScale.min;
    this._chartScalesCache.xMax = xScale.max;
    this.chart.update("none");
  }

  // updateVolumeChart() {
  //   if (!this.volumeChart) return;
  //   if (this._chartScalesCache) {
  //     this.volumeChart.options.scales.x.min = this._chartScalesCache.xMin;
  //     this.volumeChart.options.scales.x.max = this._chartScalesCache.xMax;
  //   }
  //   this.volumeChart.update("none");
  // }

  showLoadingSpinner() {
    if (!this.spinner) {
      this.createSpinner();
    }
    this.spinner.style.display = "block";
  }

  createSpinner() {
    this.spinner = document.createElement("div");
    this.setupSpinnerStyles();
    this.createSpinnerKeyframes();
    this.chartCtx.canvas.parentElement.appendChild(this.spinner);
  }

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

  setupSpinnerStyles() {
    const styles = {
      position: "absolute",
      left: "20px",
      top: "50%",
      transform: "translateY(-50%)",
      width: "40px",
      height: "40px",
      border: "4px solid rgba(255, 255, 255, 0.3)",
      borderTop: "4px solid #fff",
      borderRadius: "50%",
      animation: "spin 1s linear infinite",
    };
    Object.assign(this.spinner.style, styles);
  }

  hideLoadingSpinner() {
    if (this.spinner) {
      this.spinner.style.display = "none";
    }
  }

  _drawOverlays(overlays, fullClear = false) {
    if (!this.isValidOverlaysArray(overlays)) return;
    this.clearOverlayCanvas(fullClear);
    overlays.forEach((overlay) => {
      if (!overlay) return;
      this.drawOverlayByType(overlay);
    });
  }

  isValidOverlaysArray(overlays) {
    return overlays && Array.isArray(overlays) && overlays.length > 0;
  }

  clearOverlayCanvas(fullClear) {
    const width = fullClear
      ? this.overlayCtx.canvas.width
      : this.overlayCtx.canvas.width / 2;
    const height = fullClear
      ? this.overlayCtx.canvas.height
      : this.overlayCtx.canvas.height / 2;
    this.overlayCtx.clearRect(0, 0, width, height);
  }

  drawOverlayByType(overlay) {
    const { startX, startY, endX, endY, lineType } = overlay;
    const chartArea = this.chart.chartArea;

    switch (lineType) {
      case "HorizontalLine":
        this.drawHorizontalLine(startY, chartArea);
        break;
      case "VerticalLine":
        this.drawVerticalLine(startX, chartArea);
        break;
      case "ExtendedLine":
        this.drawExtendedLine(startX, startY, endX, endY, chartArea);
        break;
      case "Ray":
        this.drawRay(startX, startY, endX, endY, chartArea);
        break;
      default:
        this.drawSimpleLine(startX, startY, endX, endY, chartArea);
        break;
    }
  }

  drawHorizontalLine(yValue, chartArea) {
    const yPixel = this.chart.scales.y.getPixelForValue(yValue);
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
  }

  drawVerticalLine(xValue, chartArea) {
    const xPixel = this.chart.scales.x.getPixelForValue(xValue);
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
  }

  drawExtendedLine(startX, startY, endX, endY, chartArea) {
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
      const yAtRight = startYPixel + slope * (chartArea.right - startXPixel);

      const xAtTop = startXPixel + (chartArea.top - startYPixel) / slope;
      const xAtBottom = startXPixel + (chartArea.bottom - startYPixel) / slope;

      if (yAtLeft >= chartArea.top && yAtLeft <= chartArea.bottom) {
        startPx = { x: chartArea.left, y: yAtLeft };
      } else if (xAtTop >= chartArea.left && xAtTop <= chartArea.right) {
        startPx = { x: xAtTop, y: chartArea.top };
      } else {
        startPx = { x: chartArea.left, y: yAtLeft };
      }

      if (yAtRight >= chartArea.top && yAtRight <= chartArea.bottom) {
        endPx = { x: chartArea.right, y: yAtRight };
      } else if (xAtBottom >= chartArea.left && xAtBottom <= chartArea.right) {
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
  }

  drawRay(startX, startY, endX, endY, chartArea) {
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

      const yAtRight = startYPixel + slope * (chartArea.right - startXPixel);
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

      const xAtBottom = startXPixel + (chartArea.bottom - startYPixel) / slope;
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
        endPx = { x: endXPixel, y: endYPixel };
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
  }

  drawSimpleLine(startX, startY, endX, endY, chartArea) {
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

  updateOverlayCanvas() {
    const overlays = window.mainCanvas?.getOverlaysArray();
    this._drawOverlays(overlays, true);
  }

  renderOverlays() {
    if (!window.mainCanvas) return;
    const overlays =
      window.mainCanvas.getOverlaysArray &&
      window.mainCanvas.getOverlaysArray();
    this._drawOverlays(overlays, false);
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
      // this.volumeChart.resize();
      // this.volumeChart.update("none");
    }
    this.renderOverlays();
  }

  drawLine(startX, startY, endX, endY, color = "red", width = 1) {
    this.overlayCtx.beginPath();
    this.overlayCtx.moveTo(startX, startY);
    this.overlayCtx.lineTo(endX, endY);
    this.overlayCtx.lineWidth = width;
    this.overlayCtx.strokeStyle = color;
    this.overlayCtx.stroke();
  }

  formatVolumeData(data) {
    const candleData = data.datasets[0].data;
    const backgroundColor = candleData.map((candle) => {
      if (!candle || typeof candle !== "object") {
        console.error("Invalid candle data:", candle);
        return this.applyTransparency(chartColors.upBody, 0.4);
      }
      const openPrice = Number(candle.o);
      const closePrice = Number(candle.c);
      const isUp = openPrice <= closePrice;
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
          radius: 0,
          // indexAxis: "x",
          // parsing: false,
          minBarLength: 10,
        },
      ],
    };
  }

  applyTransparency(color, alpha) {
    if (color.startsWith("rgba")) {
      return color.replace(/,\s*[\d\.]+\)$/, `, ${alpha})`);
    } else if (color.startsWith("rgb")) {
      return color.replace("rgb", "rgba").replace(")", `, ${alpha})`);
    } else if (color.startsWith("#")) {
      const r = parseInt(color.substring(1, 3), 16);
      const g = parseInt(color.substring(3, 5), 16);
      const b = parseInt(color.substring(5, 7), 16);
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    return color;
  }

  setupSafetyChecks() {
    setInterval(() => {
      if (!this.chart) return;
      try {
        const xScale = this.chart.scales.x;
        if (
          !isFinite(xScale.min) ||
          !isFinite(xScale.max) ||
          xScale.min === xScale.max ||
          xScale.min > xScale.max
        ) {
          console.warn("차트 범위 복구 중...");
          if (this.lastValidMin && this.lastValidMax) {
            xScale.options.min = this.lastValidMin;
            xScale.options.max = this.lastValidMax;
          } else {
            const latestX =
              this.chart.data.labels[this.chart.data.labels.length - 1];
            xScale.options.min = this.earliestX;
            xScale.options.max = latestX;
          }
          // if (this.volumeChart) {
          //   this.volumeChart.options.scales.x.min = xScale.options.min;
          //   this.volumeChart.options.scales.x.max = xScale.options.max;
          // }
          if (this.chart) {
            this.chart.update("none");
          }
          // if (this.volumeChart) {
          //   this.volumeChart.update("none");
          // }
          this.updateOverlayCanvas();
        } else {
          this.lastValidMin = xScale.min;
          this.lastValidMax = xScale.max;
        }
      } catch (e) {
        console.error("차트 상태 확인 중 오류:", e);
      }
    }, 1000);
  }

  subscribeChartUpdate(source = "unknown") {
    this.chartUpdateRefCount++;
    console.log(
      `차트 업데이트 구독 (소스: ${source}), 참조 수: ${this.chartUpdateRefCount}`
    );
    if (!this.isChartUpdateSubscribed) {
      tickerInstance.subscribe(this.boundUpdateCharts);
      this.isChartUpdateSubscribed = true;
    }
  }

  unsubscribeChartUpdate(source = "unknown") {
    console.log(`차트 업데이트 구독 해제 시도 (소스: ${source})`);
    if (source === "mouse-leave") {
      console.log("마우스가 차트 영역을 벗어남: 모든 구독 강제 해제");
      this.chartUpdateRefCount = 0;
      if (this.isChartUpdateSubscribed) {
        tickerInstance.unsubscribe(this.boundUpdateCharts);
        this.isChartUpdateSubscribed = false;
        console.log("구독 완전히 해제됨 (mouse-leave)");
      }
      return;
    }
    if (source === "wheel-timer") {
      this.chartUpdateRefCount = Math.max(0, this.chartUpdateRefCount - 1);
      console.log(`휠 타이머 종료 후 참조 수: ${this.chartUpdateRefCount}`);
      if (this.chartUpdateRefCount === 0 && this.isChartUpdateSubscribed) {
        tickerInstance.unsubscribe(this.boundUpdateCharts);
        this.isChartUpdateSubscribed = false;
        console.log("구독 완전히 해제됨 (wheel-timer)");
      }
      return;
    }
    if (this.chartUpdateRefCount > 0) {
      this.chartUpdateRefCount--;
    }
    console.log(`구독 해제 후 참조 수: ${this.chartUpdateRefCount}`);
    if (this.chartUpdateRefCount === 0 && this.isChartUpdateSubscribed) {
      tickerInstance.unsubscribe(this.boundUpdateCharts);
      this.isChartUpdateSubscribed = false;
      console.log("구독 완전히 해제됨 (일반 케이스)");
    }
  }

  subsampleData(data, maxPoints) {
    if (data.length <= maxPoints) return data;
    const step = Math.ceil(data.length / maxPoints);
    return data.filter((_, i) => i % step === 0);
  }
}
