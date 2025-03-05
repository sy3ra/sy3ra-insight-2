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

// 객체 풀링을 위한 클래스 추가
class ObjectPool {
  constructor(objectFactory, resetFunction, initialSize = 20) {
    this.pool = [];
    this.objectFactory = objectFactory;
    this.resetFunction = resetFunction || ((obj) => obj);

    // 초기 객체 생성
    for (let i = 0; i < initialSize; i++) {
      this.pool.push(this.objectFactory());
    }
  }

  get() {
    return this.pool.length > 0 ? this.pool.pop() : this.objectFactory();
  }

  release(object) {
    if (object) {
      // 객체 상태 초기화 및 풀에 반환
      this.resetFunction(object);
      this.pool.push(object);
    }
  }
}

export class ChartTest {
  constructor(chartCtx, crosshairCtx, overlayCtx, volumeChartCtx) {
    this.chartCtx = chartCtx;
    this.crosshairCtx = crosshairCtx;
    this.overlayCtx = overlayCtx;
    this.volumeChartCtx = volumeChartCtx;

    // 볼륨 차트 컨텍스트 유효성 검사
    if (!this.volumeChartCtx) {
      console.warn(
        "volumeChartCtx가 제공되지 않았습니다. 볼륨 차트 기능이 비활성화됩니다."
      );
    }

    this.isLoading = false;
    this.earliestX = null;
    this.debounceTimer = null;
    this.spinner = null;
    this.labelsStack = [];
    this.dataStack = [];
    this.boundUpdateOverlayCanvas = this.updateOverlayCanvas.bind(this);
    this.boundUpdateCharts = this.updateCharts.bind(this);
    this.isOverlaySubscribed = false;
    this.isChartUpdateSubscribed = false;
    this.chartNeedsUpdate = false;
    this.wheelDebounceTimer = null;
    this.chartUpdateRefCount = 0;

    // 렌더링 최적화를 위한 변수 추가
    this.isRenderPending = false;
    this.lastRenderTimestamp = 0;
    this.frameIntervals = []; // 프레임 간격 추적용 배열 복원
    this.refreshRate = 60; // 기본값 복원

    // 기본 스로틀 딜레이 설정
    this.renderThrottleDelay = Math.floor((1000 / this.refreshRate) * 0.9);

    // 모니터 주사율 감지 메소드 호출 복원
    this.detectRefreshRate();

    // 객체 풀 초기화
    this.initObjectPools();

    this.initialize();
  }

  // 객체 풀 초기화 메서드 추가
  initObjectPools() {
    // 좌표 객체 풀 (x, y 좌표를 저장하는 객체)
    this.pointPool = new ObjectPool(
      () => ({ x: 0, y: 0 }),
      (obj) => {
        obj.x = 0;
        obj.y = 0;
        return obj;
      },
      50 // 초기 크기
    );

    // 라인 파라미터 객체 풀 (라인 그리기에 사용하는 파라미터 객체)
    this.lineParamPool = new ObjectPool(
      () => ({
        startX: 0,
        startY: 0,
        endX: 0,
        endY: 0,
        color: "red",
        width: 1,
      }),
      (obj) => {
        obj.startX = obj.startY = obj.endX = obj.endY = 0;
        obj.color = "red";
        obj.width = 1;
        return obj;
      },
      30
    );

    // 직사각형 파라미터 객체 풀 (영역 클리어링 등에 사용)
    this.rectPool = new ObjectPool(
      () => ({ x: 0, y: 0, width: 0, height: 0 }),
      (obj) => {
        obj.x = obj.y = obj.width = obj.height = 0;
        return obj;
      },
      10
    );

    // 이벤트 정보 객체 풀
    this.eventInfoPool = new ObjectPool(
      () => ({ x: 0, y: 0, deltaX: 0, deltaY: 0, type: "" }),
      (obj) => {
        obj.x = obj.y = obj.deltaX = obj.deltaY = 0;
        obj.type = "";
        return obj;
      },
      20
    );

    // 임시 배열 풀 (재사용 가능한 배열 객체)
    this.arrayPool = new ObjectPool(
      () => [],
      (arr) => {
        arr.length = 0;
        return arr;
      },
      10
    );
  }

  async initialize() {
    try {
      const data = await this.handleFetchData();
      if (!this.isValidData(data)) {
        console.error("차트 데이터가 유효하지 않습니다.");
        return;
      }
      console.log(data);

      // 데이터 시간 범위 설정
      this.setupTimeRange(data);

      // 차트 옵션 및 인스턴스 생성
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

    // 캔들 차트 인스턴스 생성
    this.chart = new Chart(this.chartCtx, {
      type: "candlestick",
      data: data,
      options: chartOptions,
    });

    console.log(this.chart.data);
    console.log("asdf", this.chart.options);

    // 볼륨 차트 생성 (volumeChartCtx가 존재할 경우에만)
    if (this.volumeChartCtx) {
      try {
        const volumeData = this.formatVolumeData(data);
        const volumeChartOptions = this.createVolumeChartOptions(
          this.earliestX,
          latestX
        );

        this.volumeChart = new Chart(this.volumeChartCtx, {
          type: "bar",
          data: volumeData,
          options: volumeChartOptions,
        });
        console.log("볼륨 차트 인스턴스가 생성되었습니다.");
      } catch (err) {
        console.error("볼륨 차트 생성 중 오류 발생:", err);
        this.volumeChart = null;
      }
    } else {
      console.warn(
        "볼륨 차트 컨텍스트가 없어 볼륨 차트가 생성되지 않았습니다."
      );
      this.volumeChart = null;
    }

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

    if (this.volumeChart) {
      this.volumeChart.options.animation = false;
    }
  }

  // afterFit 핸들러 설정 메서드 수정
  setupAfterFitHandlers() {
    // 메인 차트 X축 afterFit 핸들러
    this.chart.options.scales.x.afterFit = (scaleInstance) => {
      if (this.chartNeedsUpdate && !this.isUpdating) {
        this.isUpdating = true;

        // 오버레이 업데이트
        this.updateOverlayCanvas();

        // 상태 초기화
        this.isUpdating = false;
        this.chartNeedsUpdate = false;
      }
    };

    // 볼륨 차트 X축 afterFit 핸들러 - 캔들차트와 동기화하는 역할
    if (this.volumeChart) {
      this.volumeChart.options.scales.x.afterFit = (scaleInstance) => {
        // 캔들차트의 X축 레이아웃과 정확히 일치시킴
        if (this.chart && this.chart.scales && this.chart.scales.x) {
          scaleInstance.left = this.chart.scales.x.left;
          scaleInstance.right = this.chart.scales.x.right;
          scaleInstance.width = this.chart.scales.x.width;
        }
      };
    }
  }

  // 커스텀 휠 및 마우스 이벤트 핸들러 설정 - 객체 풀링 적용
  setupCustomControlsHandler() {
    const canvas = this.chartCtx.canvas;

    // 이벤트 처리를 위한 상태 변수들
    let isWheelActive = false;
    let isDragging = false;
    let lastMouseX = 0;
    let lastMouseY = 0;
    let lastWheelTime = 0;

    // 프레임 카운터 관련 변수 제거
    // let lastWheelFrameId = 0;
    // let lastMouseDownFrameId = 0;
    // let lastMouseLeaveFrameId = 0;
    // let currentFrame = 0;

    // 휠 이벤트 처리 함수 수정
    const handleWheel = (e) => {
      e.preventDefault();

      // 동일 프레임 중복 방지 로직 단순화
      // if (lastWheelFrameId === currentFrame) {
      //   this.accumulatedDeltaY = (this.accumulatedDeltaY || 0) + e.deltaY;
      //   return;
      // }

      // 시간 제한 (throttling)
      const now = Date.now();
      if (now - lastWheelTime < 8) {
        this.accumulatedDeltaY = (this.accumulatedDeltaY || 0) + e.deltaY;
        return;
      }

      lastWheelTime = now;
      // lastWheelFrameId = currentFrame; // 제거

      // 이벤트 처리 로직
      const eventInfo = this.eventInfoPool.get();
      const rect = canvas.getBoundingClientRect();
      eventInfo.x = e.clientX - rect.left;
      eventInfo.y = e.clientY - rect.top;
      eventInfo.type = "wheel";
      eventInfo.deltaY = this.accumulatedDeltaY || e.deltaY;
      this.accumulatedDeltaY = 0;

      // 차트 영역 확인
      const chartArea = this.chart.chartArea;
      if (
        eventInfo.x < chartArea.left ||
        eventInfo.x > chartArea.right ||
        eventInfo.y < chartArea.top ||
        eventInfo.y > chartArea.bottom
      ) {
        this.eventInfoPool.release(eventInfo);
        return;
      }

      // 수정자 키 확인 및 줌 속도/방향 설정
      const isModifierPressed = e.shiftKey || e.metaKey || e.ctrlKey;
      const speed = 0.1;
      const delta = eventInfo.deltaY > 0 ? 1 - speed : 1 + speed;
      const direction = isModifierPressed ? "y" : "x";

      // 차트 상태 업데이트 (렌더링은 따로 요청)
      this.updateChartState(eventInfo.x, eventInfo.y, delta, direction);

      // 통합된 렌더링 요청 메커니즘 사용
      // this.requestUnifiedRender(); // 렌더링은 ticker가 처리하도록 변경

      // 객체 풀에 반환
      this.eventInfoPool.release(eventInfo);

      // 구독 관련 코드는 유지
      if (!isWheelActive) {
        isWheelActive = true;
        this.subscribeChartUpdate("wheel");
      }

      // 디바운싱도 유지
      if (this.wheelDebounceTimer) {
        clearTimeout(this.wheelDebounceTimer);
      }

      this.wheelDebounceTimer = setTimeout(() => {
        isWheelActive = false;
        this.unsubscribeChartUpdate("wheel-timer");
        this.wheelDebounceTimer = null;
      }, 10);
    };

    // 마우스 다운 이벤트 핸들러 - 프레임 카운터 참조 제거
    const handleMouseDown = (e) => {
      // 오른쪽 마우스 클릭 무시
      if (e.button === 2) return;

      // if (lastMouseDownFrameId === currentFrame) {
      //   e.preventDefault();
      //   return;
      // }
      // lastMouseDownFrameId = currentFrame;

      // 객체 풀에서 이벤트 정보 객체 재사용
      const eventInfo = this.eventInfoPool.get();
      const rect = canvas.getBoundingClientRect();
      eventInfo.x = e.clientX - rect.left;
      eventInfo.y = e.clientY - rect.top;
      eventInfo.type = "mousedown";

      lastMouseX = eventInfo.x;
      lastMouseY = eventInfo.y;

      const pointToCheck = this.pointPool.get();
      pointToCheck.x = lastMouseX;
      pointToCheck.y = lastMouseY;

      if (!this.isPointInChartArea(pointToCheck)) {
        this.pointPool.release(pointToCheck);
        this.eventInfoPool.release(eventInfo);
        return;
      }
      this.pointPool.release(pointToCheck);

      isDragging = true;
      this.subscribeChartUpdate("mouse-down");
      this.eventInfoPool.release(eventInfo);

      e.preventDefault();
    };

    // 마우스 이동 이벤트 핸들러 최적화
    const handleMouseMove = (e) => {
      if (!isDragging || !this.chart) return;

      // 객체 풀에서 이벤트 정보 객체 재사용
      const eventInfo = this.eventInfoPool.get();
      const rect = canvas.getBoundingClientRect();
      eventInfo.x = e.clientX - rect.left;
      eventInfo.y = e.clientY - rect.top;
      eventInfo.deltaX = eventInfo.x - lastMouseX;
      eventInfo.deltaY = eventInfo.y - lastMouseY;
      eventInfo.type = "mousemove";

      // 직접 panChart 호출
      this.panChart(eventInfo.deltaX, eventInfo.deltaY);

      lastMouseX = eventInfo.x;
      lastMouseY = eventInfo.y;

      this.eventInfoPool.release(eventInfo);
    };

    // 마우스 업 이벤트 핸들러
    const handleMouseUp = () => {
      if (isDragging) {
        isDragging = false;
        this.unsubscribeChartUpdate("mouse-up");
      }
    };

    // mouseleave 이벤트 핸들러 - 프레임 카운터 참조 제거
    const handleMouseLeave = (e) => {
      // if (lastMouseLeaveFrameId === currentFrame) {
      //   return;
      // }
      // lastMouseLeaveFrameId = currentFrame;

      console.log("mouseleave 이벤트 발생");
      this.unsubscribeChartUpdate("mouse-leave");
    };

    // 이벤트 리스너 등록
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    canvas.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    canvas.addEventListener("mouseleave", handleMouseLeave);
  }

  // queueChartUpdate 메서드 수정 - 직접 렌더링하지 않고 상태만 업데이트
  queueChartUpdate(updateFn) {
    // 업데이트 함수 실행
    updateFn();

    // 업데이트 플래그 설정
    this.chartNeedsUpdate = true;

    // requestAnimationFrame 호출 제거하고 대신 구독 시스템 사용
    if (!this.isChartUpdateSubscribed) {
      this.subscribeChartUpdate("chart-render");
    }
  }

  // renderAllCharts 메서드에 로깅 추가
  renderAllCharts() {
    if (!this.chart) return;

    // 디버깅용 렌더링 타임스탬프 기록
    const now = performance.now();
    const timeSinceLastRender = now - this.lastRenderTimestamp;

    // 볼륨 차트 업데이트 전에 X축 동기화
    if (this.volumeChart && this.chart.scales && this.chart.scales.x) {
      // 캔들 차트의 X축 범위를 볼륨 차트와 동기화
      this.volumeChart.options.scales.x.min = this.chart.scales.x.min;
      this.volumeChart.options.scales.x.max = this.chart.scales.x.max;

      // Y축 볼륨 스케일도 함께 조정
      this.adjustVolumeChartYScale(
        this.chart.scales.x.min,
        this.chart.scales.x.max
      );
    }

    // Update main chart (without animation)
    this.chart.update("none");

    // Update volume chart if it exists
    if (
      this.volumeChart &&
      this.volumeChart.ctx &&
      this.volumeChart.ctx.canvas &&
      this.volumeChart.ctx.canvas.parentNode
    ) {
      this.volumeChart.update("none");
    }

    // Update overlay canvas
    this.updateOverlayCanvas();

    // Reset update flag
    this.chartNeedsUpdate = false;

    // 렌더링 타임스탬프 갱신
    this.lastRenderTimestamp = now;
  }

  // subscribeChartUpdate 메서드 수정 - 모든 차트 업데이트를 동일 eventType으로 통합
  subscribeChartUpdate(source = "unknown") {
    console.log(`차트 업데이트 구독 (소스: ${source})`);

    // 구독 참조 카운트만 증가시키고 실제 구독은 한 번만 유지
    this.chartUpdateRefCount++;

    if (!this.isChartUpdateSubscribed) {
      this.boundUpdateCharts = this.updateCharts.bind(this);
      // 동일한 이벤트 타입으로 모든 차트 업데이트 구독
      tickerInstance.subscribe(this.boundUpdateCharts, "chart-render");
      this.isChartUpdateSubscribed = true;
    }
  }

  // updateCharts 메서드 수정
  updateCharts(timestamp) {
    if (!this.chart) return;

    try {
      if (this.chartNeedsUpdate) {
        // 렌더링 성능 최적화를 위한 스로틀링 로직
        const timeSinceLastRender = timestamp - this.lastRenderTimestamp;

        // 특정 시간 간격보다 크면 렌더링 수행 (주사율 기반)
        if (
          timeSinceLastRender >= this.renderThrottleDelay ||
          timeSinceLastRender > 100
        ) {
          this.renderAllCharts();
        }
      }
    } catch (err) {
      console.error("차트 업데이트 중 오류 처리됨:", err);
    }
  }

  // 패닝 함수 수정
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

    if (xScale.options.min <= this.earliestX && !this.isLoading) {
      this.debouncedCheckLimitReached();
    }

    // 차트 상태 업데이트 플래그 설정
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
      this.chart,
      this.volumeChart
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
      elements: {
        candlestick: {
          colors: {
            up: chartColors.upBorder,
            down: chartColors.downBorder,
            unchanged: chartColors.upBorder,
          },
          borderColors: {
            up: chartColors.upBorder,
            down: chartColors.downBorder,
            unchanged: chartColors.upBorder,
          },
          backgroundColors: {
            up: chartColors.upBody,
            down: chartColors.downBody,
            unchanged: chartColors.upBody,
          },
          borderWidth: 0,
          barPercentage: 0.9,
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
            font: {
              family: "'Helvetica Neue', 'Helvetica', 'Arial', sans-serif",
              size: 12,
            },
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
            font: {
              family: "'Helvetica Neue', 'Helvetica', 'Arial', sans-serif",
              size: 12,
            },
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
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          enabled: false,
        },
        title: {
          display: false,
        },
      },
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
          min: 0, // 볼륨 차트는 항상 0에서 시작
          suggestedMax: 5, // 초기 기본값
          // suggestedMax 대신 동적으로 최대값 계산을 위해 adjustVolumeChartYScale 메서드 사용
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
        title: {
          display: false,
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
  updateVolumeChart() {
    if (this.chart && this.volumeChart) {
      // 캔들 차트의 X축 범위를 가져옴
      const xMin = this.chart.scales.x.min;
      const xMax = this.chart.scales.x.max;

      // 볼륨 차트의 X축 범위 업데이트
      this.volumeChart.options.scales.x.min = xMin;
      this.volumeChart.options.scales.x.max = xMax;

      // 볼륨 차트의 Y축 범위 업데이트
      this.adjustVolumeChartYScale(xMin, xMax);

      // 애니메이션 없이 즉시 업데이트
      this.volumeChart.update("none");
    }
  }

  // 데이터 포맷팅 함수
  xohlcvFormatData(data) {
    // 단일 순회로 labels와 데이터 배열을 동시에 구성
    const dataLength = data.length;
    const formattedData = new Array(dataLength);
    const labels = new Array(dataLength);

    for (let i = 0; i < dataLength; i++) {
      const item = data[i];
      labels[i] = item[0];
      formattedData[i] = {
        x: item[0],
        o: item[1],
        h: item[2],
        l: item[3],
        c: item[4],
        v: item[5],
      };
    }

    return {
      labels,
      datasets: [
        {
          label: "BTC/USDT Chart",
          data: formattedData,
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
      // 현재 차트 상태 저장 (줌 레벨 유지를 위해)
      const currentXMin = this.chart.scales.x.min;
      const currentXMax = this.chart.scales.x.max;
      const currentRange = currentXMax - currentXMin;

      // 추가 데이터 가져오기
      const formattedData = await this.handleFetchMoreData();

      // 새 데이터가 있을 경우만 처리
      if (formattedData.labels.length > 0) {
        // 캔들 차트 데이터 추가
        this.labelsStack = [...formattedData.labels, ...this.labelsStack];
        this.dataStack = [...formattedData.datasets[0].data, ...this.dataStack];

        // 차트 데이터 업데이트
        this.chart.data.labels = this.labelsStack;
        this.chart.data.datasets[0].data = this.dataStack;

        // 데이터 경계값 업데이트
        this.earliestX = this.labelsStack[0];

        // 가장 중요한 부분: 현재 보고 있는 뷰포트 유지
        // 기존 min/max 값 그대로 사용 (시점 변경 없음)
        this.chart.options.scales.x.min = currentXMin;
        this.chart.options.scales.x.max = currentXMax;

        // 볼륨 차트 데이터도 업데이트
        if (this.volumeChart) {
          // 전체 데이터를 기반으로 볼륨 차트 데이터 재생성
          const volumeData = this.formatVolumeData({
            labels: this.labelsStack,
            datasets: [{ data: this.dataStack }],
          });

          // 볼륨 차트 데이터 설정
          this.volumeChart.data.labels = volumeData.labels;
          this.volumeChart.data.datasets = volumeData.datasets;

          // 볼륨 차트의 X축 범위도 캔들차트와 동일하게 유지
          this.volumeChart.options.scales.x.min =
            this.chart.options.scales.x.min;
          this.volumeChart.options.scales.x.max =
            this.chart.options.scales.x.max;
        }

        // 차트 업데이트
        this.chart.update("none");
        if (this.volumeChart) {
          this.volumeChart.update("none");
        }

        // 오버레이 업데이트
        this.updateOverlayCanvas();
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

  appendNewData(formattedData) {
    // 배열 복사본을 여러 번 생성하는 방식 개선
    const newLabels = formattedData.labels;
    const newData = formattedData.datasets[0].data;

    // 기존 데이터의 앞부분에 새 데이터 추가 (spread 연산자 대신 직접 할당)
    const labelsLength = newLabels.length;
    const dataLength = newData.length;

    // 기존 배열 앞에 새 데이터를 추가할 충분한 공간 확보
    this.labelsStack.unshift(...newLabels);
    this.dataStack.unshift(...newData);

    // 참조로 차트 데이터 업데이트
    this.chart.data.labels = this.labelsStack;
    this.chart.data.datasets[0].data = this.dataStack;
  }

  updateChartLimits() {
    this.earliestX = this.labelsStack[0];
    if (this.volumeChart) {
      this.volumeChart.options.scales.x.min = this.earliestX;
    }
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
      if (this.volumeChart) {
        this.volumeChart.resize();
        this.volumeChart.update("none");
      }
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
    // 기존 배열을 재사용하기 위해 객체 풀에서 배열 가져오기
    const rawVolumeValues = this.arrayPool.get();
    const backgroundColor = this.arrayPool.get();
    const scaledVolumeData = this.arrayPool.get();

    // 데이터 구조가 초기화와 추가 로드 시 다를 수 있으므로 통일
    const candleData = data.datasets[0].data;
    const candleLength = candleData.length;

    // 특정 타임스탬프 검색 (로깅 코드 유지)
    const targetTimestamp = 1734566400000;
    let targetData;

    // 루프를 한 번만 돌면서 모든 배열을 동시에 처리
    let maxVolumeInData = 0;

    // 볼륨 값 추출 및 최대값 찾기를 단일 루프로 처리
    for (let i = 0; i < candleLength; i++) {
      const candle = candleData[i];

      // 타겟 타임스탬프 검사
      if (candle && candle.x === targetTimestamp) {
        targetData = candle;
      }

      // 볼륨 값 추출
      const volume = candle && candle.v ? candle.v : 0;
      rawVolumeValues[i] = volume;

      // 최대값 찾기 (한 번의 루프에서 처리)
      if (isFinite(volume) && volume > 0 && volume > maxVolumeInData) {
        maxVolumeInData = volume;
      }
    }

    // 로깅 코드 유지
    if (targetData) {
      console.log("===== 타임스탬프 1734566400 데이터 발견 =====");
      console.log("날짜:", new Date(targetTimestamp).toLocaleString());
      console.log("캔들 데이터:", targetData);
      console.log("시가:", targetData.o);
      console.log("고가:", targetData.h);
      console.log("저가:", targetData.l);
      console.log("종가:", targetData.c);
      console.log("거래량:", targetData.v);
      console.log("캔들 방향:", targetData.o < targetData.c ? "상승" : "하락");
      console.log("=====================================");
    }

    // 3. 최대 바 높이 설정 (조정 가능한 파라미터)
    const maxBarHeight = 100;

    // 4. 스케일링 계수 계산
    const scalingFactor =
      maxVolumeInData > 0 ? maxBarHeight / maxVolumeInData : 1;

    // 색상 및 스케일링된 볼륨 데이터를 동시에 계산
    for (let i = 0; i < candleLength; i++) {
      const candle = candleData[i];
      const volume = rawVolumeValues[i];

      // 색상 결정
      if (!candle || typeof candle !== "object") {
        backgroundColor[i] = this.applyTransparency(chartColors.upBody, 0.4);
      } else {
        // 캔들스틱 차트와 동일한 방식으로 색상 결정
        const isUp = Number(candle.o) <= Number(candle.c);
        backgroundColor[i] = this.applyTransparency(
          isUp ? chartColors.upBody : chartColors.downBody,
          0.4
        );
      }

      // 볼륨 값에 스케일링 적용 (최대값 제한)
      const scaledVolume = volume * scalingFactor;
      // 최소 바 길이 적용 (매우 작은 볼륨도 시각적으로 표시)
      scaledVolumeData[i] = Math.max(scaledVolume, volume > 0 ? 3 : 0);
    }

    // 볼륨 차트 데이터셋 객체를 재사용 가능한 구조로 변경
    const result = {
      labels: data.labels,
      datasets: [
        {
          data: scaledVolumeData,
          backgroundColor: backgroundColor,
          borderColor: backgroundColor,
          borderWidth: 0,
          minBarLength: 3,
        },
      ],
    };

    // 참고: 여기서는 result 객체를 반환해야 하므로
    // 내부 배열들은 객체 풀에 반환하지 않습니다.
    // 이 배열들은 차트 라이브러리가 참조하기 때문입니다.

    return result;
  }

  applyTransparency(color, alpha) {
    // 캐시 추가로 반복적인 계산 방지
    const cacheKey = `${color}_${alpha}`;
    if (!this._colorCache) this._colorCache = {};
    if (this._colorCache[cacheKey]) return this._colorCache[cacheKey];

    let result;

    // 문자열 연산을 최소화하기 위한 최적화
    if (color.startsWith("rgba")) {
      // 정규식 연산을 한 번만 수행
      result = color.replace(/,\s*[\d\.]+\)$/, `, ${alpha})`);
    } else if (color.startsWith("rgb")) {
      // 템플릿 리터럴을 사용하여 문자열 연산 최소화
      const rgbValues = color.substring(4, color.length - 1);
      result = `rgba(${rgbValues}, ${alpha})`;
    } else if (color.startsWith("#")) {
      // 정규식으로 한번에 파싱
      const hexMatch = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(color);
      if (hexMatch) {
        const r = parseInt(hexMatch[1], 16);
        const g = parseInt(hexMatch[2], 16);
        const b = parseInt(hexMatch[3], 16);
        result = `rgba(${r}, ${g}, ${b}, ${alpha})`;
      } else {
        result = color;
      }
    } else {
      result = color;
    }

    this._colorCache[cacheKey] = result;
    return result;
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
          if (this.volumeChart) {
            this.volumeChart.options.scales.x.min = xScale.options.min;
            this.volumeChart.options.scales.x.max = xScale.options.max;
          }
          if (this.chart) {
            this.chart.update("none");
          }
          if (this.volumeChart) {
            this.volumeChart.update("none");
          }
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

  // 볼륨 차트의 Y축 범위를 고정하여 모든 바가 표시되도록 조정
  adjustVolumeChartYScale(xMin, xMax) {
    if (!this.volumeChart) return;

    try {
      // 반복 계산 최소화
      const maxBarHeight = 100;
      const padding = maxBarHeight * 0.1;

      // 직접 값을 설정하여 중간 객체 생성 방지
      this.volumeChart.options.scales.y.suggestedMax = maxBarHeight + padding;
      this.volumeChart.options.scales.y.min = 0;
    } catch (error) {
      console.warn("볼륨 차트 Y축 범위 조정 중 오류:", error);
      // 오류 발생 시 기본값 설정
      this.volumeChart.options.scales.y.suggestedMax = 110;
    }
  }

  // 차트 상태 변경 함수 (렌더링 없음)
  updateChartState(x, y, scale, direction) {
    if (!this.chart || !this.chart.scales) return;

    const xScale = this.chart.scales.x;
    const yScale = this.chart.scales.y;

    try {
      // X축 스케일 변경 구현
      if (direction === "x" || direction === "xy") {
        const rangeWidth = xScale.max - xScale.min;
        const centerValue = xScale.getValueForPixel(x);
        const newRangeWidth = rangeWidth / scale;

        // 새 X축 범위 계산
        xScale.options.min =
          centerValue -
          (newRangeWidth * (centerValue - xScale.min)) / rangeWidth;
        xScale.options.max =
          centerValue +
          (newRangeWidth * (xScale.max - centerValue)) / rangeWidth;
      }

      // Y축 스케일 변경 구현
      if (direction === "y" || direction === "xy") {
        const rangeHeight = yScale.max - yScale.min;
        const centerValue = yScale.getValueForPixel(y);
        const newRangeHeight = rangeHeight / scale;

        // 새 Y축 범위 계산
        yScale.options.min =
          centerValue -
          (newRangeHeight * (centerValue - yScale.min)) / rangeHeight;
        yScale.options.max =
          centerValue +
          (newRangeHeight * (yScale.max - centerValue)) / rangeHeight;
      }

      // 데이터 로딩 체크
      if (xScale.options.min <= this.earliestX && !this.isLoading) {
        this.debouncedCheckLimitReached();
      }

      // 상태 변경 플래그 설정 (렌더링은 별도로 요청)
      this.chartNeedsUpdate = true;
    } catch (e) {
      console.error("차트 상태 업데이트 중 오류:", e);
    }
  }

  // 통합된 렌더링 요청 메서드 구현
  requestUnifiedRender() {
    // 플래그만 설정하고 ticker가 처리하도록 함
    this.chartNeedsUpdate = true;

    // ticker가 이미 구독되어 있지 않다면 구독
    if (!this.isChartUpdateSubscribed) {
      this.subscribeChartUpdate("chart-render");
    }
  }

  // _drawOverlays 메서드 추가 - 이 메서드가 누락되어 오류 발생
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

  // 로딩 스피너 표시 메서드
  showLoadingSpinner() {
    if (!this.spinner) {
      this.createSpinner();
    }
    this.spinner.style.display = "block";
  }

  // 로딩 스피너 생성 메서드
  createSpinner() {
    this.spinner = document.createElement("div");
    this.setupSpinnerStyles();
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

  // 스피너 스타일 설정
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

  // 로딩 스피너 숨기기
  hideLoadingSpinner() {
    if (this.spinner) {
      this.spinner.style.display = "none";
    }
  }

  // 모니터 주사율 감지 메소드 복원
  detectRefreshRate() {
    // Screen Refresh Rate API 지원 확인 (Chrome 98+)
    if ("screen" in window && "refresh" in window.screen) {
      // 모던 API 사용
      window.screen.refresh.addEventListener("change", () => {
        this.refreshRate = window.screen.refresh.rate || 60;
        console.log(`모니터 주사율 감지: ${this.refreshRate}Hz`);
        this.updateRenderThrottleDelay();
      });

      // 초기값 설정
      window.screen.refresh
        .getState()
        .then((state) => {
          this.refreshRate = state.rate || 60;
          console.log(`모니터 주사율 초기값: ${this.refreshRate}Hz`);
          this.updateRenderThrottleDelay();
        })
        .catch(() => {
          // API 오류 시 requestAnimationFrame 기반 측정 대체
          this.measureRefreshRateWithRAF();
        });
    } else {
      // 레거시 브라우저를 위한 대체 방법
      this.measureRefreshRateWithRAF();
    }
  }

  // requestAnimationFrame을 사용한 주사율 측정 복원
  measureRefreshRateWithRAF() {
    let lastTime = performance.now();
    let frameCount = 0;
    const framesToMeasure = 10; // 10프레임 동안 측정

    const measureFrame = (timestamp) => {
      const now = performance.now();
      const delta = now - lastTime;

      if (delta > 5) {
        // 노이즈 필터링
        this.frameIntervals.push(delta);
        lastTime = now;
        frameCount++;
      }

      if (frameCount < framesToMeasure) {
        requestAnimationFrame(measureFrame);
      } else {
        // 중간값을 사용하여 이상치 영향 감소
        this.frameIntervals.sort((a, b) => a - b);
        const medianInterval =
          this.frameIntervals[Math.floor(this.frameIntervals.length / 2)];
        this.refreshRate = Math.round(1000 / medianInterval);

        console.log(
          `측정된 모니터 주사율: ${
            this.refreshRate
          }Hz (${medianInterval.toFixed(2)}ms 간격)`
        );
        this.updateRenderThrottleDelay();

        // 배열 초기화
        this.frameIntervals = [];
      }
    };

    requestAnimationFrame(measureFrame);
  }

  // 렌더링 스로틀 딜레이 업데이트 복원
  updateRenderThrottleDelay() {
    // 주사율 기반 최적 지연시간 설정
    // 약간의 여유를 두기 위해 90%로 설정 (안정성 확보)
    this.renderThrottleDelay = Math.floor((1000 / this.refreshRate) * 0.9);
    console.log(`렌더링 스로틀 딜레이 업데이트: ${this.renderThrottleDelay}ms`);
  }
}
