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
    this.boundUpdateVolumeChart = this.updateVolumeChart.bind(this);
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

      const volumeData = this.formatVolumeData(data);

      // 데이터 시간 범위 설정
      this.setupTimeRange(data);

      // 차트 옵션 및 인스턴스 생성
      this.createCharts(data, volumeData);

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
  createCharts(data, volumeData) {
    const latestX = data.labels[data.labels.length - 1];
    const chartOptions = this.createChartOptions(this.earliestX, latestX);
    const volumeChartOptions = this.createVolumeChartOptions(
      this.earliestX,
      latestX
    );

    // 캔들 차트 인스턴스 생성
    this.chart = new Chart(this.chartCtx, {
      type: "candlestick",
      data: data,
      options: chartOptions,
    });
    // console.log("캔들 차트 인스턴스가 생성되었습니다.");

    // 볼륨 차트 인스턴스 생성
    this.volumeChart = new Chart(this.volumeChartCtx, {
      type: "bar",
      data: volumeData,
      options: volumeChartOptions,
    });
    // console.log("볼륨 차트 인스턴스가 생성되었습니다.");

    // X축에 afterFit 이벤트 핸들러 등록
    this.setupAfterFitHandlers();

    // 기존 코드를 대체하여 커스텀 컨트롤 핸들러 등록
    this.setupCustomControlsHandler();

    // 차트 렌더링 성능 개선
    this.chart.options.responsive = false; // 반응형 비활성화
    this.chart.options.maintainAspectRatio = false; // 종횡비 유지 비활성화
    this.chart.options.animation = false; // 애니메이션 비활성화
    this.chart.options.elements.line.tension = 0; // 곡선 텐션 제거
    this.chart.options.elements.point.radius = 0; // 점 제거
    this.volumeChart.options.animation = false;
  }

  // afterFit 핸들러 설정 메서드 수정
  setupAfterFitHandlers() {
    // 메인 차트 X축 afterFit 핸들러
    this.chart.options.scales.x.afterFit = (scaleInstance) => {
      if (this.chartNeedsUpdate && !this.isUpdating) {
        this.isUpdating = true;

        // 볼륨 차트 동기화 (철저하게)
        if (this.volumeChart) {
          this.volumeChart.options.scales.x.min = this.chart.scales.x.min;
          this.volumeChart.options.scales.x.max = this.chart.scales.x.max;
          this.volumeChart.scales.x.min = this.chart.scales.x.min;
          this.volumeChart.scales.x.max = this.chart.scales.x.max;

          // 캔들차트의 차트영역과 일치하도록 설정
          this.volumeChart.chartArea.left = this.chart.chartArea.left;
          this.volumeChart.chartArea.right = this.chart.chartArea.right;
        }

        // 렌더링 최적화
        if (this.volumeChart) {
          this.volumeChart.update("none");
        }

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

  // 커스텀 휠 이벤트 핸들러 메서드 수정
  setupCustomControlsHandler() {
    // 캔버스 요소 참조
    const canvas = this.chartCtx.canvas;

    // 상태 변수
    let isDragging = false;
    let lastX = 0;
    let lastY = 0;
    let isWheelActive = false;

    // 이벤트 제한을 위한 변수 추가
    let lastWheelFrameId = -1;
    let lastMouseMoveFrameId = -1;
    let lastMouseDownFrameId = -1;
    let lastMouseLeaveFrameId = -1;
    let currentFrameId = 0;

    // 스로틀링을 위한 시간 변수 추가
    let lastWheelTime = 0;
    const WHEEL_THROTTLE_MS = 6; // 3ms 스로틀링

    // 프레임 ID 업데이트 함수
    const updateFrameId = () => {
      currentFrameId++;
      requestAnimationFrame(updateFrameId);
    };
    // 프레임 ID 업데이트 시작
    requestAnimationFrame(updateFrameId);

    // 이벤트 핸들러 함수들을 미리 정의
    const handleWheel = (e) => {
      if (!this.chart) return;

      // 현재 시간
      const now = performance.now();

      // 시간 기반 스로틀링 - 마지막 처리 시간으로부터 3ms가 지났는지 확인
      if (now - lastWheelTime < WHEEL_THROTTLE_MS) {
        e.preventDefault();
        return;
      }

      // 같은 프레임에서 이미 휠 이벤트를 처리했다면 무시 (기존 프레임 제한 유지)
      if (lastWheelFrameId === currentFrameId) {
        e.preventDefault();
        return;
      }

      // 시간 및 프레임 ID 업데이트
      lastWheelTime = now;
      lastWheelFrameId = currentFrameId;

      // 나머지 휠 처리 로직은 그대로 유지
      // 확대/축소 속도 및 방향 계산
      const speed = 0.1;
      const delta = e.deltaY > 0 ? 1 - speed : 1 + speed;

      // 확대/축소 포인트 계산
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      // 차트 영역 검사
      if (!this.isPointInChartArea({ x, y })) return;

      // 맥의 커맨드키(metaKey) 또는 윈도우의 컨트롤키(ctrlKey)가 눌려있는지 확인
      const isModifierPressed = e.metaKey || e.ctrlKey;

      // 줌 방향 결정: 수정자 키가 눌린 경우 Y축, 그렇지 않으면 X축
      const direction = isModifierPressed ? "y" : "x";

      // 차트 줌 실행 및 즉시 업데이트 적용
      this.zoomChartImmediate(x, y, delta, direction);

      // 첫 번째 휠 이벤트에서만 구독 추가
      if (!isWheelActive) {
        isWheelActive = true;
        console.log("휠 이벤트 시작: 구독 시작");
        this.subscribeChartUpdate("wheel");
      }

      // 휠 이벤트 디바운싱
      if (this.wheelDebounceTimer) {
        clearTimeout(this.wheelDebounceTimer);
      }

      this.wheelDebounceTimer = setTimeout(() => {
        console.log("휠 타이머 종료: 구독 해제 시도");
        isWheelActive = false;
        this.unsubscribeChartUpdate("wheel-timer");
        this.wheelDebounceTimer = null;
      }, 150);
    };

    // 마우스 다운 이벤트 핸들러
    const handleMouseDown = (e) => {
      // 오른쪽 마우스 클릭 무시
      if (e.button === 2) return;

      // 같은 프레임에서 이미 mousedown 이벤트를 처리했다면 무시
      if (lastMouseDownFrameId === currentFrameId) {
        e.preventDefault();
        return;
      }

      // 현재 프레임 ID 기록
      lastMouseDownFrameId = currentFrameId;

      const rect = canvas.getBoundingClientRect();
      lastX = e.clientX - rect.left;
      lastY = e.clientY - rect.top;

      // 차트 영역 검사
      if (!this.isPointInChartArea({ x: lastX, y: lastY })) return;

      isDragging = true;
      // 패닝 시작 시 구독
      this.subscribeChartUpdate("mouse-down");

      // 기본 선택 동작 방지
      e.preventDefault();
    };

    // 마우스 이동 이벤트 핸들러
    const handleMouseMove = (e) => {
      if (!isDragging || !this.chart) return;

      // 같은 프레임에서 이미 mousemove 이벤트를 처리했다면 무시
      if (lastMouseMoveFrameId === currentFrameId) {
        return;
      }

      // 현재 프레임 ID 기록
      lastMouseMoveFrameId = currentFrameId;

      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const dx = x - lastX;
      const dy = y - lastY;

      this.panChart(dx, dy);

      lastX = x;
      lastY = y;
    };

    // 마우스 업 이벤트 핸들러 - 프레임 제한 필요 없음 (중요 이벤트)
    const handleMouseUp = () => {
      if (isDragging) {
        isDragging = false;
        // 패닝 종료 시 구독 해제
        this.unsubscribeChartUpdate("mouse-up");
      }
    };

    // mouseleave 이벤트 핸들러
    const handleMouseLeave = (e) => {
      // 같은 프레임에서 이미 mouseleave 이벤트를 처리했다면 무시
      if (lastMouseLeaveFrameId === currentFrameId) {
        return;
      }

      // 현재 프레임 ID 기록
      lastMouseLeaveFrameId = currentFrameId;

      console.log("mouseleave 이벤트 발생");
      // 기존 패닝 종료 처리 유지
      this.unsubscribeChartUpdate("mouse-leave");
    };

    // 이벤트 리스너 등록
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    canvas.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    canvas.addEventListener("mouseleave", handleMouseLeave);

    // 터치 이벤트 리스너 주석 처리
    /*
    canvas.addEventListener("touchstart", handleTouchStart, { passive: false });
    canvas.addEventListener("touchmove", handleTouchMove, { passive: false });
    canvas.addEventListener("touchend", handleTouchEnd);
    canvas.addEventListener("touchcancel", handleTouchEnd);
    */
  }

  // 새로운 즉시 업데이트 메서드 추가
  zoomChartImmediate(x, y, scale, direction = "x") {
    const scales = this.chart.scales;
    const xScale = scales.x;
    const yScale = scales.y;

    if (direction === "x") {
      const startX = xScale.min;
      const endX = xScale.max;
      const centerX = xScale.getValueForPixel(x);

      // 새 범위 계산
      const newStartX = centerX - (centerX - startX) / scale;
      const newEndX = centerX + (endX - centerX) / scale;

      // 범위 업데이트
      xScale.options.min = newStartX;
      xScale.options.max = newEndX;

      // 볼륨 차트 동기화
      if (this.volumeChart) {
        this.volumeChart.options.scales.x.min = xScale.options.min;
        this.volumeChart.options.scales.x.max = xScale.options.max;
      }
    } else if (direction === "y") {
      // Y축 줌 로직
      const startY = yScale.min;
      const endY = yScale.max;
      const centerY = yScale.getValueForPixel(y);

      // 새 범위 계산
      const newStartY = centerY - (centerY - startY) / scale;
      const newEndY = centerY + (endY - centerY) / scale;

      // 범위 업데이트
      yScale.options.min = newStartY;
      yScale.options.max = newEndY;
    }

    // 즉시 차트 업데이트 실행
    this.chart.update("none");

    // 볼륨 차트도 즉시 업데이트
    if (this.volumeChart) {
      this.volumeChart.update("none");
    }

    // 오버레이 즉시 업데이트
    this.updateOverlayCanvas();

    // 업데이트 플래그도 설정 (다른 시스템과의 호환성 유지)
    this.chartNeedsUpdate = false;

    // 데이터 범위 확인 (과거 데이터 로딩 필요한지)
    if (xScale.options.min <= this.earliestX && !this.isLoading) {
      this.debouncedCheckLimitReached();
    }
  }

  // 차트 패닝 메서드
  panChart(dx, dy) {
    const scales = this.chart.scales;
    const xScale = scales.x;
    const yScale = scales.y;

    // X축 패닝
    if (dx !== 0) {
      // 현재 픽셀당 데이터 값
      const pixelToDataRatio = (xScale.max - xScale.min) / xScale.width;

      // 이동할 데이터 양
      const dataDx = dx * pixelToDataRatio;

      // 새 범위 계산
      xScale.options.min = xScale.min - dataDx;
      xScale.options.max = xScale.max - dataDx;
    }

    // Y축 패닝
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

    // 볼륨 차트도 함께 업데이트
    if (this.volumeChart) {
      this.volumeChart.options.scales.x.min = xScale.options.min;
      this.volumeChart.options.scales.x.max = xScale.options.max;
    }

    // 데이터 범위 확인 (과거 데이터 로딩 필요한지)
    if (xScale.options.min <= this.earliestX && !this.isLoading) {
      this.debouncedCheckLimitReached();
    }

    // 업데이트 필요 플래그만 설정
    this.chartNeedsUpdate = true;
  }

  // 포인트가 차트 영역 내에 있는지 확인하는 헬퍼 메서드
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
          right: 8, // 오른쪽 패딩 추가
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
          offset: true, // 일관된 오프셋 적용
          alignToPixels: true, // 픽셀 정렬 추가
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
            maxTicksLimit: 8, // 최대 틱 수 제한
          },
          grid: {
            color: "rgba(255, 255, 255, 0.1)",
            display: true,
            drawOnChartArea: true,
          },
          // y축 영역 너비 고정을 위한 afterFit 설정
          afterFit: function (scaleInstance) {
            scaleInstance.width = 90; // 고정 너비 설정
          },
        },
      },
      plugins: this.createPluginsOptions(earliestX, latestX),
    };
  }

  createVolumeChartOptions(earliestX, latestX) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      layout: {
        padding: {
          right: 8, // 캔들차트와 동일한 패딩 적용
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
          offset: true, // 캔들차트와 동일하게 설정
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
          // 캔들차트와 동일한 y축 영역 너비 사용
          afterFit: function (scaleInstance) {
            scaleInstance.width = 90; // 고정 너비 설정
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

  // 추가 데이터 로딩 로직 분리
  async loadMoreData() {
    const formattedData = await this.handleFetchMoreData();

    if (formattedData.labels.length > 0) {
      // 데이터 추가
      this.appendNewData(formattedData);

      // 차트 범위 업데이트
      this.updateChartLimits();

      // 차트 업데이트
      this.updateCharts();
    }
  }

  // 새 데이터 추가
  appendNewData(formattedData) {
    this.labelsStack = [...formattedData.labels, ...this.labelsStack];
    this.dataStack = [...formattedData.datasets[0].data, ...this.dataStack];

    this.chart.data.labels = this.labelsStack;
    this.chart.data.datasets[0].data = this.dataStack;

    // 볼륨 차트 데이터 업데이트
    if (this.volumeChart) {
      const volumeData = this.formatVolumeData({
        labels: this.labelsStack,
        datasets: [{ data: this.dataStack }],
      });

      this.volumeChart.data.labels = volumeData.labels;
      this.volumeChart.data.datasets = volumeData.datasets;
    }
  }

  // 차트 범위 업데이트
  updateChartLimits() {
    this.earliestX = this.labelsStack[0];
    if (this.volumeChart) {
      this.volumeChart.options.scales.x.min = this.earliestX;
    }
  }

  // 차트 업데이트
  updateCharts(timestamp) {
    if (!this.chart) return;

    // 필요한 경우에만 업데이트 진행
    if (this.chartNeedsUpdate) {
      // 객체 생성 최소화 방식으로 차트 업데이트
      this.updateChart();

      // 볼륨 차트도 함께 업데이트
      if (this.volumeChart) {
        this.updateVolumeChart();
      }

      // 오버레이 업데이트
      this.updateOverlayCanvas();

      // 추가 데이터 로딩 필요 여부 확인
      if (this.chart.scales.x.min <= this.earliestX && !this.isLoading) {
        this.debouncedCheckLimitReached();
      }

      // 업데이트 완료 상태로 설정
      this.chartNeedsUpdate = false;
    }
  }

  // 메모리 효율적인 차트 업데이트 방법
  updateChart() {
    // 상태 변수로 캐시 사용
    if (!this._chartScalesCache) {
      this._chartScalesCache = {};
    }

    // 스케일 설정 재사용 (객체 생성 방지)
    const xScale = this.chart.scales.x;
    this._chartScalesCache.xMin = xScale.min;
    this._chartScalesCache.xMax = xScale.max;

    // 실제 데이터는 이미 this.chart.data.datasets[0].data에 있음
    // 새로운 배열/객체를 만들지 않고 차트만 업데이트

    // 애니메이션 없이 업데이트 (필수)
    this.chart.update("none");
  }

  // 볼륨 차트도 객체 생성 최소화 방식으로 업데이트
  updateVolumeChart() {
    if (!this.volumeChart) return;

    // 캐시된 스케일 값 사용 (불필요한 객체 생성 방지)
    if (this._chartScalesCache) {
      this.volumeChart.options.scales.x.min = this._chartScalesCache.xMin;
      this.volumeChart.options.scales.x.max = this._chartScalesCache.xMax;
    }

    // 애니메이션 없이 업데이트
    this.volumeChart.update("none");
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

  // 로딩스피너를 숨기는 메서드
  hideLoadingSpinner() {
    if (this.spinner) {
      this.spinner.style.display = "none";
    }
  }

  // 공통 코어 함수 추가
  _drawOverlays(overlays, fullClear = false) {
    // 오버레이 유효성 검사
    if (!this.isValidOverlaysArray(overlays)) return;

    // 캔버스 클리어
    this.clearOverlayCanvas(fullClear);

    // 각 오버레이 그리기
    overlays.forEach((overlay) => {
      if (!overlay) return;
      this.drawOverlayByType(overlay);
    });
  }

  // 오버레이 배열 유효성 검사
  isValidOverlaysArray(overlays) {
    return overlays && Array.isArray(overlays) && overlays.length > 0;
  }

  // 오버레이 캔버스 클리어
  clearOverlayCanvas(fullClear) {
    const width = fullClear
      ? this.overlayCtx.canvas.width
      : this.overlayCtx.canvas.width / 2;
    const height = fullClear
      ? this.overlayCtx.canvas.height
      : this.overlayCtx.canvas.height / 2;
    this.overlayCtx.clearRect(0, 0, width, height);
  }

  // 오버레이 타입에 따라 그리기
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

  // 수평선 그리기
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

  // 수직선 그리기
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

  // 확장된 선 그리기
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
      // ... (기존 계산 로직)
      const yAtLeft = startYPixel - slope * (startXPixel - chartArea.left);
      const yAtRight = startYPixel + slope * (chartArea.right - startXPixel);

      const xAtTop = startXPixel + (chartArea.top - startYPixel) / slope;
      const xAtBottom = startXPixel + (chartArea.bottom - startYPixel) / slope;

      // ... (기존 좌표 계산 로직)
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

  // 반직선(Ray) 그리기
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
      // 수직선인 경우 - 방향에 따라 위/아래로 확장
      endPx = {
        x: startXPixel,
        y: direction.y > 0 ? chartArea.bottom : chartArea.top,
      };
    } else if (slope === 0) {
      // 수평선인 경우 - 방향에 따라 좌/우로 확장
      endPx = {
        x: direction.x > 0 ? chartArea.right : chartArea.left,
        y: startYPixel,
      };
    } else {
      // 각 경계와의 교차점 계산
      const intersections = [];

      // 오른쪽 경계와의 교차점
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

      // 왼쪽 경계와의 교차점
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

      // 상단 경계와의 교차점
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

      // 하단 경계와의 교차점
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

      // 방향이 일치하는 교차점만 필터링
      const validIntersections = intersections.filter(
        (intersection) =>
          (intersection.direction.x === direction.x ||
            intersection.direction.x === 0) &&
          (intersection.direction.y === direction.y ||
            intersection.direction.y === 0)
      );

      if (validIntersections.length > 0) {
        // 가장 가까운 교차점 선택 (여러개일 경우)
        endPx = validIntersections.reduce((closest, current) =>
          current.distance < closest.distance ? current : closest
        );
      } else {
        // 유효한 교차점이 없으면 마우스 위치 사용
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

  // 일반 선 그리기
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
          radius: 0,
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

  // 엣지 케이스를 위한 안전장치 추가 메서드
  setupSafetyChecks() {
    // 1초마다 차트 상태 확인
    setInterval(() => {
      if (!this.chart) return;

      // 차트가 렌더링되지 않거나 범위가 잘못 설정된 경우 복구
      try {
        const xScale = this.chart.scales.x;

        // 유효하지 않은 범위 검사 (NaN, Infinity 등)
        if (
          !isFinite(xScale.min) ||
          !isFinite(xScale.max) ||
          xScale.min === xScale.max ||
          xScale.min > xScale.max
        ) {
          console.warn("차트 범위 복구 중...");

          // 마지막으로 알려진 유효한 범위로 복원
          if (this.lastValidMin && this.lastValidMax) {
            xScale.options.min = this.lastValidMin;
            xScale.options.max = this.lastValidMax;
          } else {
            // 알려진 유효한 범위가 없으면 전체 데이터 범위로 재설정
            const latestX =
              this.chart.data.labels[this.chart.data.labels.length - 1];
            xScale.options.min = this.earliestX;
            xScale.options.max = latestX;
          }

          // 볼륨 차트도 업데이트
          if (this.volumeChart) {
            this.volumeChart.options.scales.x.min = xScale.options.min;
            this.volumeChart.options.scales.x.max = xScale.options.max;
          }

          // 간소화된 업데이트 방식
          if (this.chart) {
            this.chart.update("none");
          }

          if (this.volumeChart) {
            this.volumeChart.update("none");
          }

          // 오버레이 업데이트
          this.updateOverlayCanvas();
        } else {
          // 현재 유효한 범위 저장
          this.lastValidMin = xScale.min;
          this.lastValidMax = xScale.max;
        }
      } catch (e) {
        console.error("차트 상태 확인 중 오류:", e);
      }
    }, 1000);
  }

  // 새로운 차트 업데이트 구독 메서드
  subscribeChartUpdate(source = "unknown") {
    // 참조 카운트 증가
    this.chartUpdateRefCount++;
    console.log(
      `차트 업데이트 구독 (소스: ${source}), 참조 수: ${this.chartUpdateRefCount}`
    );

    // 아직 구독되지 않은 경우에만 구독
    if (!this.isChartUpdateSubscribed) {
      tickerInstance.subscribe(this.boundUpdateCharts);
      this.isChartUpdateSubscribed = true;
    }
  }

  // 구독 해제 메서드 개선
  unsubscribeChartUpdate(source = "unknown") {
    console.log(`차트 업데이트 구독 해제 시도 (소스: ${source})`);

    // mouseleave 이벤트가 발생한 경우 강제로 모든 구독 해제
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

    // wheel-timer 소스인 경우 참조 카운트 직접 관리
    if (source === "wheel-timer") {
      // wheel 이벤트에 대한 참조 카운트 명시적 감소
      this.chartUpdateRefCount = Math.max(0, this.chartUpdateRefCount - 1);
      console.log(`휠 타이머 종료 후 참조 수: ${this.chartUpdateRefCount}`);

      // 참조 카운트가 0이면 구독 해제
      if (this.chartUpdateRefCount === 0 && this.isChartUpdateSubscribed) {
        tickerInstance.unsubscribe(this.boundUpdateCharts);
        this.isChartUpdateSubscribed = false;
        console.log("구독 완전히 해제됨 (wheel-timer)");
      }
      return;
    }

    // 일반적인 경우
    if (this.chartUpdateRefCount > 0) {
      this.chartUpdateRefCount--;
    }

    console.log(`구독 해제 후 참조 수: ${this.chartUpdateRefCount}`);

    // 모든 참조가 해제된 경우에만 실제로 구독 해제
    if (this.chartUpdateRefCount === 0 && this.isChartUpdateSubscribed) {
      tickerInstance.unsubscribe(this.boundUpdateCharts);
      this.isChartUpdateSubscribed = false;
      console.log("구독 완전히 해제됨 (일반 케이스)");
    }
  }

  // 데이터 서브샘플링
  subsampleData(data, maxPoints) {
    if (data.length <= maxPoints) return data;

    const step = Math.ceil(data.length / maxPoints);
    return data.filter((_, i) => i % step === 0);
  }
}
