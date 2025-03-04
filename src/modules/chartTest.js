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
    let lastWheelFrameId = 0;
    let lastMouseDownFrameId = 0;
    let lastMouseLeaveFrameId = 0;
    let currentFrame = 0;

    // 프레임 ID 업데이트 함수
    const updateFrameId = () => {
      currentFrame++;
      requestAnimationFrame(updateFrameId);
    };

    // 프레임 ID 업데이트 시작
    updateFrameId();

    // 휠 이벤트 처리 - 객체 풀링 적용
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

      // 객체 풀에서 이벤트 정보 객체 재사용
      const eventInfo = this.eventInfoPool.get();
      const rect = canvas.getBoundingClientRect();
      eventInfo.x = e.clientX - rect.left;
      eventInfo.y = e.clientY - rect.top;
      eventInfo.type = "wheel";
      eventInfo.deltaY = e.deltaY;

      // 차트 영역 확인
      const chartArea = this.chart.chartArea;
      if (
        eventInfo.x < chartArea.left ||
        eventInfo.x > chartArea.right ||
        eventInfo.y < chartArea.top ||
        eventInfo.y > chartArea.bottom
      ) {
        // 객체 반환 후 종료
        this.eventInfoPool.release(eventInfo);
        return;
      }

      // 수정자 키 확인 (Shift 키, Command 키(Mac), Control 키(Windows))
      const isModifierPressed = e.shiftKey || e.metaKey || e.ctrlKey;

      // 휠 처리 로직
      const speed = 0.1;
      const delta = eventInfo.deltaY > 0 ? 1 - speed : 1 + speed;

      // 줌 방향 결정
      const direction = isModifierPressed ? "y" : "x";

      // 차트 줌 실행 및 즉시 업데이트 적용
      this.zoomChartImmediate(eventInfo.x, eventInfo.y, delta, direction);

      // 객체 풀에 반환
      this.eventInfoPool.release(eventInfo);

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

    // 마우스 다운 이벤트 핸들러 - 객체 풀링 적용
    const handleMouseDown = (e) => {
      // 오른쪽 마우스 클릭 무시
      if (e.button === 2) return;

      if (lastMouseDownFrameId === currentFrame) {
        e.preventDefault();
        return;
      }
      lastMouseDownFrameId = currentFrame;

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

    // 마우스 이동 이벤트 핸들러 - 객체 풀링 적용
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

  // 객체 풀링을 적용한 줌 메서드
  zoomChartImmediate(x, y, scale, direction = "x") {
    if (
      !this.chart ||
      !this.chart.scales ||
      !this.chart.scales.x ||
      !this.chart.scales.y
    )
      return;

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

      // 즉시 차트 업데이트 실행
      if (!this.chart.options.scales.x.ticks) {
        this.chart.options.scales.x.ticks = {};
      }
      if (!this.chart.options.scales.x.ticks.font) {
        this.chart.options.scales.x.ticks.font = {
          family: "'Helvetica Neue', 'Helvetica', 'Arial', sans-serif",
          size: 12,
        };
      }

      this.chart.update("none");

      // 볼륨 차트 업데이트 추가
      if (this.volumeChart) {
        this.updateVolumeChart();
      }

      // 오버레이 즉시 업데이트
      this.updateOverlayCanvas();

      // 업데이트 플래그도 설정 (다른 시스템과의 호환성 유지)
      this.chartNeedsUpdate = false;

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
        this.chart.options.scales.x.min = this.earliestX;

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

          // 볼륨 차트 X축 범위도 업데이트
          this.volumeChart.options.scales.x.min = this.earliestX;
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

  updateCharts(timestamp) {
    if (!this.chart) return;

    try {
      if (this.chartNeedsUpdate) {
        this.updateChart();
        this.updateOverlayCanvas();

        // 볼륨 차트 업데이트 안전 로직 추가
        if (
          this.volumeChart &&
          this.volumeChart.ctx &&
          this.volumeChart.ctx.canvas &&
          this.volumeChart.ctx.canvas.parentNode
        ) {
          this.updateVolumeChart();
        }

        if (this.chart.scales.x.min <= this.earliestX && !this.isLoading) {
          this.debouncedCheckLimitReached();
        }
        this.chartNeedsUpdate = false;
      }
    } catch (err) {
      console.error("차트 업데이트 중 오류 처리됨:", err);
    }
  }

  updateChart() {
    if (!this.chart || !this.chart.scales || !this.chart.scales.x) return;

    try {
      if (!this._chartScalesCache) {
        this._chartScalesCache = {};
      }
      const xScale = this.chart.scales.x;
      this._chartScalesCache.xMin = xScale.min;
      this._chartScalesCache.xMax = xScale.max;

      // 메인 차트의 폰트 설정 확인
      if (!this.chart.options.scales.x.ticks) {
        this.chart.options.scales.x.ticks = {};
      }
      if (!this.chart.options.scales.x.ticks.font) {
        this.chart.options.scales.x.ticks.font = {
          family: "'Helvetica Neue', 'Helvetica', 'Arial', sans-serif",
          size: 12,
        };
      }
      if (!this.chart.options.scales.y.ticks) {
        this.chart.options.scales.y.ticks = {};
      }
      if (!this.chart.options.scales.y.ticks.font) {
        this.chart.options.scales.y.ticks.font = {
          family: "'Helvetica Neue', 'Helvetica', 'Arial', sans-serif",
          size: 12,
        };
      }

      this.chart.update("none");
    } catch (err) {
      console.error("차트 업데이트 실패:", err);
    }
  }

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
    // 객체 풀에서 좌표 객체 가져오기
    const startPoint = this.pointPool.get();
    const endPoint = this.pointPool.get();

    startPoint.x = this.chart.scales.x.getPixelForValue(startX);
    startPoint.y = this.chart.scales.y.getValueForPixel(startY);
    endPoint.x = this.chart.scales.x.getPixelForValue(endX);
    endPoint.y = this.chart.scales.y.getValueForPixel(endY);

    const slope = calculateSlope(
      startPoint.x,
      startPoint.y,
      endPoint.x,
      endPoint.y
    );

    // 라인 파라미터 객체 풀에서 가져오기
    const lineParams = this.lineParamPool.get();

    if (slope === Infinity || slope === -Infinity) {
      lineParams.startX = startPoint.x;
      lineParams.startY = chartArea.top;
      lineParams.endX = startPoint.x;
      lineParams.endY = chartArea.bottom;
    } else if (slope === 0) {
      lineParams.startX = chartArea.left;
      lineParams.startY = startPoint.y;
      lineParams.endX = chartArea.right;
      lineParams.endY = startPoint.y;
    } else {
      const yAtLeft = startPoint.y - slope * (startPoint.x - chartArea.left);
      const yAtRight = startPoint.y + slope * (chartArea.right - startPoint.x);

      const xAtTop = startPoint.x + (chartArea.top - startPoint.y) / slope;
      const xAtBottom =
        startPoint.x + (chartArea.bottom - startPoint.y) / slope;

      if (yAtLeft >= chartArea.top && yAtLeft <= chartArea.bottom) {
        lineParams.startX = chartArea.left;
        lineParams.startY = yAtLeft;
      } else if (xAtTop >= chartArea.left && xAtTop <= chartArea.right) {
        lineParams.startX = xAtTop;
        lineParams.startY = chartArea.top;
      } else {
        lineParams.startX = chartArea.left;
        lineParams.startY = yAtLeft;
      }

      if (yAtRight >= chartArea.top && yAtRight <= chartArea.bottom) {
        lineParams.endX = chartArea.right;
        lineParams.endY = yAtRight;
      } else if (xAtBottom >= chartArea.left && xAtBottom <= chartArea.right) {
        lineParams.endX = xAtBottom;
        lineParams.endY = chartArea.bottom;
      } else {
        lineParams.endX = chartArea.right;
        lineParams.endY = yAtRight;
      }
    }

    lineParams.color = "red";
    lineParams.width = 1;

    drawLine(
      this.overlayCtx,
      lineParams.startX,
      lineParams.startY,
      lineParams.endX,
      lineParams.endY,
      lineParams.color,
      lineParams.width,
      chartArea
    );

    // 사용 완료 후 객체 풀에 반환
    this.lineParamPool.release(lineParams);
    this.pointPool.release(startPoint);
    this.pointPool.release(endPoint);
  }

  drawRay(startX, startY, endX, endY, chartArea) {
    // 객체 풀에서 좌표 객체 가져오기
    const startPoint = this.pointPool.get();
    const endPoint = this.pointPool.get();

    startPoint.x = this.chart.scales.x.getPixelForValue(startX);
    startPoint.y = this.chart.scales.y.getValueForPixel(startY);
    endPoint.x = this.chart.scales.x.getPixelForValue(endX);
    endPoint.y = this.chart.scales.y.getValueForPixel(endY);

    const slope = calculateSlope(
      startPoint.x,
      startPoint.y,
      endPoint.x,
      endPoint.y
    );

    const direction = calculateDirection(
      startPoint.x,
      startPoint.y,
      endPoint.x,
      endPoint.y
    );

    // 라인 파라미터 객체 풀에서 가져오기
    const lineParams = this.lineParamPool.get();
    lineParams.startX = startPoint.x;
    lineParams.startY = startPoint.y;

    if (slope === Infinity || slope === -Infinity) {
      lineParams.endX = startPoint.x;
      lineParams.endY = direction.y > 0 ? chartArea.bottom : chartArea.top;
    } else if (slope === 0) {
      lineParams.endX = direction.x > 0 ? chartArea.right : chartArea.left;
      lineParams.endY = startPoint.y;
    } else {
      // 교차점을 찾는 로직
      let minDistance = Number.MAX_VALUE;
      let bestX = endPoint.x;
      let bestY = endPoint.y;

      // 오른쪽 경계와의 교차점 확인
      const yAtRight = startPoint.y + slope * (chartArea.right - startPoint.x);
      if (yAtRight >= chartArea.top && yAtRight <= chartArea.bottom) {
        const distRight =
          Math.pow(chartArea.right - startPoint.x, 2) +
          Math.pow(yAtRight - startPoint.y, 2);
        const dirMatchX = direction.x > 0;
        const dirMatchY = yAtRight > startPoint.y === direction.y > 0;

        if (
          (dirMatchX || direction.x === 0) &&
          (dirMatchY || direction.y === 0) &&
          distRight < minDistance
        ) {
          minDistance = distRight;
          bestX = chartArea.right;
          bestY = yAtRight;
        }
      }

      // 왼쪽 경계와의 교차점 확인
      const yAtLeft = startPoint.y + slope * (chartArea.left - startPoint.x);
      if (yAtLeft >= chartArea.top && yAtLeft <= chartArea.bottom) {
        const distLeft =
          Math.pow(chartArea.left - startPoint.x, 2) +
          Math.pow(yAtLeft - startPoint.y, 2);
        const dirMatchX = direction.x < 0;
        const dirMatchY = yAtLeft > startPoint.y === direction.y > 0;

        if (
          (dirMatchX || direction.x === 0) &&
          (dirMatchY || direction.y === 0) &&
          distLeft < minDistance
        ) {
          minDistance = distLeft;
          bestX = chartArea.left;
          bestY = yAtLeft;
        }
      }

      // 상단 경계와의 교차점 확인
      const xAtTop = startPoint.x + (chartArea.top - startPoint.y) / slope;
      if (xAtTop >= chartArea.left && xAtTop <= chartArea.right) {
        const distTop =
          Math.pow(xAtTop - startPoint.x, 2) +
          Math.pow(chartArea.top - startPoint.y, 2);
        const dirMatchX = xAtTop > startPoint.x === direction.x > 0;
        const dirMatchY = direction.y < 0;

        if (
          (dirMatchX || direction.x === 0) &&
          (dirMatchY || direction.y === 0) &&
          distTop < minDistance
        ) {
          minDistance = distTop;
          bestX = xAtTop;
          bestY = chartArea.top;
        }
      }

      // 하단 경계와의 교차점 확인
      const xAtBottom =
        startPoint.x + (chartArea.bottom - startPoint.y) / slope;
      if (xAtBottom >= chartArea.left && xAtBottom <= chartArea.right) {
        const distBottom =
          Math.pow(xAtBottom - startPoint.x, 2) +
          Math.pow(chartArea.bottom - startPoint.y, 2);
        const dirMatchX = xAtBottom > startPoint.x === direction.x > 0;
        const dirMatchY = direction.y > 0;

        if (
          (dirMatchX || direction.x === 0) &&
          (dirMatchY || direction.y === 0) &&
          distBottom < minDistance
        ) {
          minDistance = distBottom;
          bestX = xAtBottom;
          bestY = chartArea.bottom;
        }
      }

      lineParams.endX = bestX;
      lineParams.endY = bestY;
    }

    lineParams.color = "red";
    lineParams.width = 1;

    drawLine(
      this.overlayCtx,
      lineParams.startX,
      lineParams.startY,
      lineParams.endX,
      lineParams.endY,
      lineParams.color,
      lineParams.width,
      chartArea
    );

    // 사용 완료 후 객체 풀에 반환
    this.lineParamPool.release(lineParams);
    this.pointPool.release(startPoint);
    this.pointPool.release(endPoint);
  }

  // 객체 풀링을 적용하여 단순 라인 그리기 메서드 최적화
  drawSimpleLine(startX, startY, endX, endY, chartArea) {
    // 라인 파라미터 객체 풀에서 가져오기
    const lineParams = this.lineParamPool.get();

    lineParams.startX = this.chart.scales.x.getPixelForValue(startX);
    lineParams.startY = this.chart.scales.y.getPixelForValue(startY);
    lineParams.endX = this.chart.scales.x.getPixelForValue(endX);
    lineParams.endY = this.chart.scales.y.getPixelForValue(endY);
    lineParams.color = "red";
    lineParams.width = 1;

    drawLine(
      this.overlayCtx,
      lineParams.startX,
      lineParams.startY,
      lineParams.endX,
      lineParams.endY,
      lineParams.color,
      lineParams.width,
      chartArea
    );

    // 사용 완료 후 객체 풀에 반환
    this.lineParamPool.release(lineParams);
  }

  // 객체 풀링을 적용하여 수평선 그리기 메서드 최적화
  drawHorizontalLine(yValue, chartArea) {
    const yPixel = this.chart.scales.y.getPixelForValue(yValue);

    // 라인 파라미터 객체 풀에서 가져오기
    const lineParams = this.lineParamPool.get();

    lineParams.startX = chartArea.left;
    lineParams.startY = yPixel;
    lineParams.endX = chartArea.right;
    lineParams.endY = yPixel;
    lineParams.color = "red";
    lineParams.width = 1;

    drawLine(
      this.overlayCtx,
      lineParams.startX,
      lineParams.startY,
      lineParams.endX,
      lineParams.endY,
      lineParams.color,
      lineParams.width,
      chartArea
    );

    // 사용 완료 후 객체 풀에 반환
    this.lineParamPool.release(lineParams);
  }

  // 객체 풀링을 적용하여 수직선 그리기 메서드 최적화
  drawVerticalLine(xValue, chartArea) {
    const xPixel = this.chart.scales.x.getPixelForValue(xValue);

    // 라인 파라미터 객체 풀에서 가져오기
    const lineParams = this.lineParamPool.get();

    lineParams.startX = xPixel;
    lineParams.startY = chartArea.top;
    lineParams.endX = xPixel;
    lineParams.endY = chartArea.bottom;
    lineParams.color = "red";
    lineParams.width = 1;

    drawLine(
      this.overlayCtx,
      lineParams.startX,
      lineParams.startY,
      lineParams.endX,
      lineParams.endY,
      lineParams.color,
      lineParams.width,
      chartArea
    );

    // 사용 완료 후 객체 풀에 반환
    this.lineParamPool.release(lineParams);
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
    // 데이터 구조가 초기화와 추가 로드 시 다를 수 있으므로 통일
    const candleData = data.datasets[0].data;

    // 특정 타임스탬프 검색 (로깅 코드 유지)
    const targetTimestamp = 1734566400000;
    const targetData = candleData.find(
      (candle) => candle.x === targetTimestamp
    );

    if (targetData) {
      // 기존 로깅 코드 유지
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

    // 볼륨 데이터 전처리
    // 1. 볼륨 값 추출
    const rawVolumeValues = candleData.map((item) =>
      item && item.v ? item.v : 0
    );

    // 2. 전체 데이터에서 볼륨 최대값 찾기
    const maxVolumeInData = Math.max(
      ...rawVolumeValues.filter((v) => isFinite(v) && v > 0)
    );

    // 3. 최대 바 높이 설정 (조정 가능한 파라미터)
    const maxBarHeight = 100; // 바의 최대 높이 (픽셀 단위로 생각할 수 있음)

    // 4. 스케일링 계수 계산 (모든 데이터가 maxBarHeight 이하로 스케일링되도록)
    const scalingFactor =
      maxVolumeInData > 0 ? maxBarHeight / maxVolumeInData : 1;

    // 각 바 색상 결정 (기존 코드 유지)
    const backgroundColor = candleData.map((candle) => {
      // 캔들 데이터가 올바른 형식인지 확인
      if (!candle || typeof candle !== "object") {
        console.error("Invalid candle data:", candle);
        return this.applyTransparency(chartColors.upBody, 0.4);
      }

      // 캔들스틱 차트와 동일한 방식으로 색상 결정
      const openPrice = Number(candle.o);
      const closePrice = Number(candle.c);
      const isUp = openPrice <= closePrice;

      // 특정 타임스탬프인 경우 추가 로깅 (기존 코드 유지)
      if (candle.x === targetTimestamp) {
        // ... existing logging code ...
      }

      // chartColors와 정확히 동일한 색상 사용 (캔들차트와 일치)
      return isUp
        ? this.applyTransparency(chartColors.upBody, 0.4)
        : this.applyTransparency(chartColors.downBody, 0.4);
    });

    // 볼륨 데이터 생성 (각 바의 최대 높이 제한 적용)
    const scaledVolumeData = rawVolumeValues.map((volume) => {
      // 볼륨 값에 스케일링 적용 (최대값 제한)
      const scaledVolume = volume * scalingFactor;

      // 최소 바 길이 적용 (매우 작은 볼륨도 시각적으로 표시)
      return Math.max(scaledVolume, volume > 0 ? 3 : 0);
    });

    return {
      labels: data.labels,
      datasets: [
        {
          data: scaledVolumeData,
          backgroundColor: backgroundColor,
          borderColor: backgroundColor,
          borderWidth: 0,
          minBarLength: 3, // 최소 바 길이 설정 (작은 값도 시각적으로 보이도록)
        },
      ],
    };
  }

  applyTransparency(color, alpha) {
    // 캐시 추가로 반복적인 계산 방지
    const cacheKey = `${color}_${alpha}`;
    if (!this._colorCache) this._colorCache = {};
    if (this._colorCache[cacheKey]) return this._colorCache[cacheKey];

    let result;

    if (color.startsWith("rgba")) {
      result = color.replace(/,\s*[\d\.]+\)$/, `, ${alpha})`);
    } else if (color.startsWith("rgb")) {
      result = color.replace("rgb", "rgba").replace(")", `, ${alpha})`);
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

  // 볼륨 차트의 Y축 범위를 고정하여 모든 바가 표시되도록 조정
  adjustVolumeChartYScale(xMin, xMax) {
    if (!this.volumeChart) return;

    try {
      // 볼륨 바 최대 높이에 맞춰 Y축 범위 설정
      // formatVolumeData에서 설정한 maxBarHeight와 일치시킴
      const maxBarHeight = 100;

      // 여유 공간 추가 (10% 정도)
      const padding = maxBarHeight * 0.1;
      const suggestedMax = maxBarHeight + padding;

      // Y축 설정
      this.volumeChart.options.scales.y.suggestedMax = suggestedMax;
      this.volumeChart.options.scales.y.min = 0;
    } catch (error) {
      console.warn("볼륨 차트 Y축 범위 조정 중 오류:", error);
      // 오류 발생 시 기본값 설정
      this.volumeChart.options.scales.y.suggestedMax = 110;
    }
  }
}
