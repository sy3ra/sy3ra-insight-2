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

// 모듈화된 컴포넌트 임포트
import { TypedDataManager } from "./chart/TypedDataManager.js";
import { TypedCoordinateTransformer } from "./chart/utils/CoordinateTransformer.js";
import {
  createPointPool,
  createEventInfoPool,
  createLineParamPool,
  createRectPool,
  createArrayPool,
} from "./chart/utils/ObjectPool.js";
import { createCandleChartOptions } from "./chart/ChartOptions.js";
import { ChartEventHandler } from "./chart/ChartEventHandler.js";
import { ChartOverlayManager } from "./chart/ChartOverlayManager.js";
import { ChartPerformance } from "./chart/ChartPerformance.js";
import { VolumeChartManager } from "./chart/VolumeChartManager.js";
import { ChartUIHelper } from "./chart/utils/ChartUIHelper.js";

// Chart.js에 필요한 요소 등록
Chart.register(...registerables, CandlestickController, CandlestickElement);

export class ChartTest {
  constructor(chartCtx, crosshairCtx, overlayCtx, volumeChartCtx) {
    // 캔버스 컨텍스트 저장
    this.chartCtx = chartCtx;
    this.crosshairCtx = crosshairCtx;
    this.overlayCtx = overlayCtx;
    this.volumeChartCtx = volumeChartCtx;

    // 차트 인스턴스
    this.chart = null;
    this.volumeChart = null;

    // 상태 변수
    this.isLoading = false;
    this.earliestX = null;
    this.latestX = null;
    this.chartNeedsUpdate = false;
    this.isUpdating = false;
    this.lastValidMin = null;
    this.lastValidMax = null;

    // 모듈 초기화
    this.dataManager = new TypedDataManager(1000);
    this.coordTransformer = new TypedCoordinateTransformer(1000);
    this.performance = new ChartPerformance();
    this.uiHelper = new ChartUIHelper();

    // 객체 풀 초기화
    this.pointPool = createPointPool();
    this.lineParamPool = createLineParamPool();
    this.rectPool = createRectPool();
    this.eventInfoPool = createEventInfoPool();
    this.arrayPool = createArrayPool();

    // 성능 관련 속성 참조
    this.renderThrottleDelay = this.performance.renderThrottleDelay;
    this.lastRenderTimestamp = this.performance.lastRenderTimestamp;

    // 차트 초기화
    this.initialize();
  }

  async initialize() {
    try {
      // 데이터 가져오기
      await this.fetchData();

      if (this.dataManager.size === 0) {
        console.error("데이터가 없습니다.");
        return;
      }

      // 시간 범위 설정
      this.earliestX = this.dataManager.timestamps[0];
      this.latestX = this.dataManager.timestamps[this.dataManager.size - 1];

      // 메인 차트 생성
      this.createChart();

      // 크로스헤어 생성
      this.crosshair = new ChartCrosshair(
        this.crosshairCtx,
        this.chart,
        this.volumeChart
      );

      // 오버레이 관리자 생성
      this.overlayManager = new ChartOverlayManager(
        this.overlayCtx,
        this.chart
      );
      this.overlayManager.subscribeOverlayUpdate();

      // 볼륨 차트 매니저 생성
      this.volumeChartManager = new VolumeChartManager(
        this.volumeChartCtx,
        this.dataManager
      );
      this.volumeChart = this.volumeChartManager.createVolumeChart(
        this.earliestX,
        this.latestX,
        { Chart }
      );

      // 이벤트 핸들러 생성
      this.eventHandler = new ChartEventHandler(
        this.chart,
        this.volumeChart,
        this
      );
      this.eventHandler.setupEventHandlers(this.chart.canvas);

      // 차트 상태 감시 타이머 설정
      this.startChartMonitoring();

      // 리사이징 이벤트 리스너 설정
      this.setupResizeListener();

      // 추가 데이터 로드 트리거 설정
      this.setupScrollLoadTrigger();

      // 실시간 데이터 업데이트 설정 (옵션)
      // this.setupLiveDataUpdate();

      // 초기 리사이즈 실행
      this.updateCanvasSizes();
      this.renderAllCharts();

      // 초기 스크롤 체크 실행
      if (this.afterUpdateCallbacks && this.afterUpdateCallbacks.length > 0) {
        for (const callback of this.afterUpdateCallbacks) {
          callback();
        }
      }

      console.log("차트 초기화 완료");
    } catch (error) {
      console.error("차트 초기화 중 오류 발생:", error);
    }
  }

  async fetchData() {
    this.isLoading = true;

    if (this.chartCtx && this.chartCtx.canvas) {
      this.uiHelper.showLoadingSpinner(this.chartCtx.canvas.parentNode);
    }

    try {
      // API에서 데이터 가져오기
      const response = await axios.get(
        "https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=365"
      );

      if (!response.data || !Array.isArray(response.data)) {
        throw new Error("API 응답이 유효하지 않습니다.");
      }

      // 데이터 포맷 변환
      const formattedData = response.data.map((item) => {
        const timestamp = item[0];
        const open = parseFloat(item[1]);
        const high = parseFloat(item[2]);
        const low = parseFloat(item[3]);
        const close = parseFloat(item[4]);
        const volume = parseFloat(item[5]);

        return {
          t: timestamp,
          x: timestamp,
          o: open,
          h: high,
          l: low,
          c: close,
          v: volume,
        };
      });

      // 데이터 관리자에 추가
      this.dataManager.addCandlesFromArray(formattedData);
      console.log(`${formattedData.length}개의 데이터 포인트를 불러왔습니다.`);

      return formattedData;
    } catch (error) {
      console.error("데이터 불러오기 중 오류:", error);
      throw error;
    } finally {
      this.isLoading = false;
      this.uiHelper.hideLoadingSpinner();
    }
  }

  createChart() {
    try {
      // 현재 차트가 있으면 제거
      if (this.chart) {
        this.chart.destroy();
      }

      // 차트 데이터 준비
      const chartData = this.dataManager.getChartJsData();
      const options = createCandleChartOptions(this.earliestX, this.latestX);

      // 차트 생성
      this.chart = new Chart(this.chartCtx, {
        type: "candlestick",
        data: chartData,
        options: options,
      });

      console.log("메인 차트 인스턴스가 생성되었습니다.");
      return this.chart;
    } catch (err) {
      console.error("차트 생성 중 오류:", err);
      return null;
    }
  }

  updateChartState(cursorX, cursorY, zoomFactor, zoomDirection = "x") {
    if (!this.chart || !this.chart.scales) return;

    const xScale = this.chart.scales.x;
    const yScale = this.chart.scales.y;

    // 현재 차트 범위
    const currentXMin = xScale.min;
    const currentXMax = xScale.max;
    const currentYMin = yScale.min;
    const currentYMax = yScale.max;

    // 커서 위치의 값
    const cursorXValue = xScale.getValueForPixel(cursorX);
    const cursorYValue = yScale.getValueForPixel(cursorY);

    if (zoomDirection === "x" || zoomDirection === "both") {
      // X축 줌 계산
      const xDeltaLeft = cursorXValue - currentXMin;
      const xDeltaRight = currentXMax - cursorXValue;

      // 새 범위 계산 (커서 위치 기준 줌)
      const newXMin = cursorXValue - xDeltaLeft * zoomFactor;
      const newXMax = cursorXValue + xDeltaRight * zoomFactor;

      // 제한 적용
      const minAllowed = this.earliestX;
      const maxAllowed = this.latestX;

      xScale.options.min = Math.max(minAllowed, newXMin);
      xScale.options.max = Math.min(maxAllowed, newXMax);

      // 볼륨 차트 동기화
      if (this.volumeChart) {
        this.volumeChart.options.scales.x.min = xScale.options.min;
        this.volumeChart.options.scales.x.max = xScale.options.max;
      }
    }

    if (zoomDirection === "y" || zoomDirection === "both") {
      // Y축 줌 계산
      const yDeltaBottom = cursorYValue - currentYMin;
      const yDeltaTop = currentYMax - cursorYValue;

      const newYMin = cursorYValue - yDeltaBottom * zoomFactor;
      const newYMax = cursorYValue + yDeltaTop * zoomFactor;

      // 실제 데이터 범위 내로 제한
      yScale.options.min = newYMin;
      yScale.options.max = newYMax;
    }

    // 차트 업데이트 예약
    this.chartNeedsUpdate = true;
  }

  panChart(deltaX, deltaY) {
    if (!this.chart || !this.chart.scales) return;

    const xScale = this.chart.scales.x;
    const yScale = this.chart.scales.y;

    // 현재 픽셀당 값 계산 (패닝 속도 조정)
    const xPixelRange = xScale.right - xScale.left;
    const yPixelRange = yScale.bottom - yScale.top;
    const xValueRange = xScale.max - xScale.min;
    const yValueRange = yScale.max - yScale.min;

    // 패닝 속도를 1:1로 설정 (자연스러운 패닝을 위해)
    const speedMultiplier = 1.0;
    const xValuePerPixel = (xValueRange / xPixelRange) * speedMultiplier;
    const yValuePerPixel = (yValueRange / yPixelRange) * speedMultiplier;

    // 값 변화량 계산 - 패닝 방향 수정
    const xDelta = deltaX * xValuePerPixel;
    const yDelta = deltaY * yValuePerPixel;

    // 새 X 값 범위
    const newXMin = xScale.min - xDelta;
    const newXMax = xScale.max - xDelta;

    // 새 Y 값 범위
    const newYMin = yScale.min + yDelta;
    const newYMax = yScale.max + yDelta;

    // X축 범위 업데이트 - 경계 제한 제거하여 무제한 패닝 허용
    xScale.options.min = newXMin;
    xScale.options.max = newXMax;

    // 볼륨 차트 동기화
    if (this.volumeChart) {
      this.volumeChart.options.scales.x.min = newXMin;
      this.volumeChart.options.scales.x.max = newXMax;
    }

    // Y축 업데이트
    yScale.options.min = newYMin;
    yScale.options.max = newYMax;

    // 업데이트 예약
    this.chartNeedsUpdate = true;

    // 유효 범위 저장 (안전장치용)
    this.lastValidMin = xScale.options.min;
    this.lastValidMax = xScale.options.max;
  }

  renderAllCharts() {
    if (!this.chart) return;

    // 차트 업데이트 시작 전 상태
    const xMin = this.chart.scales.x.min;
    const xMax = this.chart.scales.x.max;

    // 메인 차트 업데이트
    this.chart.resize();
    this.chart.update("none");

    // 메인 차트 업데이트 후 X축이 변경될 수 있으므로 다시 읽기
    const newXMin = this.chart.scales.x.min;
    const newXMax = this.chart.scales.x.max;

    // 볼륨 차트의 X축 범위를 메인 차트와 정확히 동일하게 설정
    if (this.volumeChart) {
      // 볼륨 차트 매니저의 정밀 동기화 메서드 호출
      this.volumeChartManager.exactSyncWithMainChart(this.chart);

      // 볼륨 차트 업데이트
      this.volumeChart.resize();
      this.volumeChart.update("none");
    }

    // 렌더링 타임스탬프 업데이트
    this.performance.updateRenderTimestamp();
    this.lastRenderTimestamp = this.performance.lastRenderTimestamp;

    // 차트 업데이트 상태 리셋
    this.chartNeedsUpdate = false;

    // 스크롤 트리거 콜백 실행
    if (this.afterUpdateCallbacks && this.afterUpdateCallbacks.length > 0) {
      for (const callback of this.afterUpdateCallbacks) {
        try {
          callback();
        } catch (error) {
          console.error("차트 업데이트 콜백 실행 중 오류:", error);
        }
      }
    }
  }

  // 차트 업데이트 최적화
  startChartMonitoring() {
    // 차트 상태 감시 타이머
    setInterval(() => {
      try {
        // 차트 있는지 확인
        if (!this.chart || !this.chart.scales || !this.chart.scales.x) return;

        const xScale = this.chart.scales.x;

        // 무효한 범위 감지 및 복구
        if (
          isNaN(xScale.min) ||
          isNaN(xScale.max) ||
          xScale.min >= xScale.max
        ) {
          console.warn("차트 범위 복구 중...");
          if (this.lastValidMin && this.lastValidMax) {
            xScale.options.min = this.lastValidMin;
            xScale.options.max = this.lastValidMax;
          } else {
            const latestX =
              this.dataManager.size > 0
                ? this.dataManager.timestamps[this.dataManager.size - 1]
                : this.chart.data.labels[this.chart.data.labels.length - 1];
            xScale.options.min = this.earliestX;
            xScale.options.max = latestX;
          }
          if (this.volumeChart) {
            this.volumeChart.options.scales.x.min = xScale.options.min;
            this.volumeChart.options.scales.x.max = xScale.options.max;
          }

          // 즉시 렌더링
          this.chartNeedsUpdate = true;
          this.renderAllCharts();
        } else {
          // 최종 유효 범위 저장
          this.lastValidMin = xScale.min;
          this.lastValidMax = xScale.max;
        }
      } catch (e) {
        console.error("차트 상태 확인 중 오류:", e);
      }
    }, 1000);
  }

  // 데이터 추가 및 차트 업데이트
  addNewData(newData) {
    if (!newData || !Array.isArray(newData)) return;

    // 데이터 관리자에 추가
    this.dataManager.addCandlesFromArray(newData);

    // 차트 데이터 업데이트
    if (this.chart) {
      const chartData = this.dataManager.getChartJsData();
      this.chart.data = chartData;
      this.latestX = this.dataManager.timestamps[this.dataManager.size - 1];

      // 차트의 기본 범위 업데이트
      if (this.chart.options.scales.x) {
        this.chart.options.scales.x.max = this.latestX;
      }
    }

    // 볼륨 차트 업데이트
    if (this.volumeChart) {
      const volumeData = this.dataManager.getVolumeChartData(
        undefined,
        undefined,
        chartColors.upBody,
        chartColors.downBody,
        0.4
      );
      this.volumeChart.data = volumeData;
    }

    // 업데이트 예약
    this.chartNeedsUpdate = true;
  }

  // 좌표 변환 메서드
  pixelToValue(x, y) {
    if (!this.chart || !this.chart.scales) {
      return { x: 0, y: 0 };
    }

    const xValue = this.chart.scales.x.getValueForPixel(x);
    const yValue = this.chart.scales.y.getValueForPixel(y);

    return { x: xValue, y: yValue };
  }

  valueToPixel(x, y) {
    if (!this.chart || !this.chart.scales) {
      return { x: 0, y: 0 };
    }

    const xPixel = this.chart.scales.x.getPixelForValue(x);
    const yPixel = this.chart.scales.y.getPixelForValue(y);

    return { x: xPixel, y: yPixel };
  }

  // 성능 통계 정보 가져오기
  getPerformanceStats() {
    return this.performance.getPerformanceStats(this.dataManager, this.chart);
  }

  // 리사이징 이벤트 리스너 설정
  setupResizeListener() {
    // 이미 설정된 리스너가 있으면 제거
    if (this.resizeListener) {
      window.removeEventListener("resize", this.resizeListener);
    }

    // 리사이징 핸들러 함수 바인딩
    this.resizeListener = this.handleResize.bind(this);

    // 리사이징 이벤트 리스너 등록
    window.addEventListener("resize", this.resizeListener);

    console.log("차트 리사이징 리스너 설정 완료");
  }

  // 리사이징 처리 함수
  handleResize() {
    if (!this.chart || !this.volumeChart) return;

    // 디바운싱 처리
    if (this.resizeDebounceTimer) {
      clearTimeout(this.resizeDebounceTimer);
    }

    this.resizeDebounceTimer = setTimeout(() => {
      try {
        // 부모 요소의 크기에 맞게 캔버스 크기 업데이트
        this.updateCanvasSizes();

        // 차트 업데이트
        this.renderAllCharts();

        // 오버레이 업데이트
        if (this.overlayManager) {
          this.overlayManager.updateOverlayCanvas();
        }
      } catch (error) {
        console.error("차트 리사이징 중 오류:", error);
      }
    }, 100); // 100ms 디바운스
  }

  // 캔버스 크기 업데이트
  updateCanvasSizes() {
    if (!this.chart || !this.chart.canvas) return;

    const parentElement = this.chart.canvas.parentElement;
    if (!parentElement) return;

    // 컨테이너 크기 가져오기
    const containerWidth = parentElement.clientWidth;
    const containerHeight = parentElement.clientHeight;

    // 메인 차트 캔버스 크기 업데이트 (2배 크기로 설정)
    if (this.chartCtx && this.chartCtx.canvas) {
      const mainChartHeight = containerHeight * 0.8; // 전체 높이의 80%
      const canvas = this.chartCtx.canvas;
      canvas.width = containerWidth * 2;
      canvas.height = mainChartHeight * 2;
      // 스타일로 실제 표시 크기 설정
      canvas.style.width = `${containerWidth}px`;
      canvas.style.height = `${mainChartHeight}px`;
      // 컨텍스트 스케일링 적용
      this.chartCtx.scale(2, 2);
    }

    // 볼륨 차트 캔버스 크기 업데이트 (2배 크기로 설정)
    if (this.volumeChartCtx && this.volumeChartCtx.canvas) {
      const volumeChartHeight = containerHeight * 0.2; // 전체 높이의 20%
      const canvas = this.volumeChartCtx.canvas;
      canvas.width = containerWidth * 2;
      canvas.height = volumeChartHeight * 2;
      // 스타일로 실제 표시 크기 설정
      canvas.style.width = `${containerWidth}px`;
      canvas.style.height = `${volumeChartHeight}px`;
      // 컨텍스트 스케일링 적용
      this.volumeChartCtx.scale(2, 2);
    }

    // 크로스헤어 캔버스 크기 업데이트 (2배 크기로 설정)
    if (this.crosshairCtx && this.crosshairCtx.canvas) {
      const canvas = this.crosshairCtx.canvas;
      canvas.width = containerWidth * 2;
      canvas.height = containerHeight * 2;
      // 스타일로 실제 표시 크기 설정
      canvas.style.width = `${containerWidth}px`;
      canvas.style.height = `${containerHeight}px`;
      // 컨텍스트 스케일링 적용
      this.crosshairCtx.scale(2, 2);
    }

    // 오버레이 캔버스 크기 업데이트 (2배 크기로 설정)
    if (this.overlayCtx && this.overlayCtx.canvas) {
      const canvas = this.overlayCtx.canvas;
      canvas.width = containerWidth * 2;
      canvas.height = containerHeight * 2;
      // 스타일로 실제 표시 크기 설정
      canvas.style.width = `${containerWidth}px`;
      canvas.style.height = `${containerHeight}px`;
      // 컨텍스트 스케일링 적용
      this.overlayCtx.scale(2, 2);
    }

    console.log(
      `캔버스 크기 업데이트: ${containerWidth}x${containerHeight} (물리적 크기: ${
        containerWidth * 2
      }x${containerHeight * 2})`
    );
  }

  // 리소스 해제
  dispose() {
    // 실시간 업데이트 타이머 정리
    if (this.liveUpdateTimer) {
      clearInterval(this.liveUpdateTimer);
      this.liveUpdateTimer = null;
    }

    // 리사이징 이벤트 리스너 제거
    if (this.resizeListener) {
      window.removeEventListener("resize", this.resizeListener);
      this.resizeListener = null;
    }

    // 타이머 정리
    if (this.resizeDebounceTimer) {
      clearTimeout(this.resizeDebounceTimer);
    }

    // 차트 인스턴스 해제
    if (this.chart) {
      this.chart.destroy();
      this.chart = null;
    }

    // 이벤트 핸들러 해제
    if (this.eventHandler) {
      this.eventHandler.dispose();
    }

    // 오버레이 매니저 해제
    if (this.overlayManager) {
      this.overlayManager.dispose();
    }

    // 볼륨 차트 매니저 해제
    if (this.volumeChartManager) {
      this.volumeChartManager.dispose();
    }

    // UI 헬퍼 해제
    if (this.uiHelper) {
      this.uiHelper.dispose();
    }

    // 크로스헤어 해제
    if (this.crosshair) {
      this.crosshair.dispose();
    }

    // 객체 참조 제거
    this.dataManager = null;
    this.coordTransformer = null;
    this.pointPool = null;
    this.lineParamPool = null;
    this.rectPool = null;
    this.eventInfoPool = null;
    this.arrayPool = null;
  }

  // EventManager에서 호출되는 마우스 위치 업데이트 메서드
  updateMousePosition(x, y) {
    if (!this.chart || !this.crosshair) return;

    // 마우스 좌표 저장
    const mousePos = { x, y };

    // 크로스헤어 업데이트 - 정확한 메서드 호출
    this.crosshair.updatePosition(x, y);

    // 차트 영역 확인
    const chartArea = this.chart.chartArea;
    if (
      chartArea &&
      x >= chartArea.left &&
      x <= chartArea.right &&
      y >= chartArea.top &&
      y <= chartArea.bottom
    ) {
      // 가격 및 시간 값 계산
      const xValue = this.chart.scales.x.getValueForPixel(x);
      const yValue = this.chart.scales.y.getValueForPixel(y);

      // 추가 작업이 필요한 경우 여기에 구현
    }
  }

  // 마우스가 차트 영역을 떠날 때 호출되는 메서드
  mouseLeave() {
    if (this.crosshair) {
      // 정확한 mouseLeave 메서드 호출
      this.crosshair.mouseLeave();
    }

    // 이벤트 핸들러 구독 해제
    if (this.eventHandler) {
      this.eventHandler.unsubscribeChartUpdate("mouse-leave");
    }
  }

  // 마우스가 차트 위에 있는지 확인하는 헬퍼 메서드
  isPointInChartArea(point) {
    if (!this.chart || !this.chart.chartArea) return false;

    const { x, y } = point;
    const { left, right, top, bottom } = this.chart.chartArea;

    return x >= left && x <= right && y >= top && y <= bottom;
  }

  // 마우스 이벤트 시 차트 상태 업데이트
  updateChartState(mouseX, mouseY, zoomFactor, zoomDirection) {
    if (!this.chart || !this.chart.scales) return;

    const scales = this.chart.scales;
    const xScale = scales.x;
    const yScale = scales.y;

    // 최소 및 최대 x 값 저장
    const min = xScale.min;
    const max = xScale.max;
    const range = max - min;

    // 마우스 위치에 따른 중심점 계산
    const centerX = xScale.getValueForPixel(mouseX);

    // Y축 확대/축소인 경우
    if (zoomDirection === "y") {
      const centerY = yScale.getValueForPixel(mouseY);
      const yMin = yScale.min;
      const yMax = yScale.max;
      const yRange = yMax - yMin;

      // Y축 스케일 업데이트
      const newYMin = centerY - (centerY - yMin) * zoomFactor;
      const newYMax = centerY + (yMax - centerY) * zoomFactor;

      // Y축 범위 적용
      yScale.options.min = newYMin;
      yScale.options.max = newYMax;
    } else {
      // X축 또는 양방향 확대/축소인 경우 X축 업데이트
      const leftRatio = (centerX - min) / range;
      const rightRatio = (max - centerX) / range;

      // 새 X축 범위 계산
      const newMin = centerX - leftRatio * range * zoomFactor;
      const newMax = centerX + rightRatio * range * zoomFactor;

      // X축 범위 적용
      xScale.options.min = newMin;
      xScale.options.max = newMax;
    }

    // 차트 업데이트 상태 설정
    this.chartNeedsUpdate = true;

    // 최종 유효 범위 저장
    this.lastValidMin = xScale.options.min;
    this.lastValidMax = xScale.options.max;
  }

  // 더 많은 데이터 로드 메서드 추가
  async loadMoreData(count = 500) {
    if (this.isLoading) return;

    this.isLoading = true;

    if (this.chartCtx && this.chartCtx.canvas) {
      this.uiHelper.showLoadingSpinner(this.chartCtx.canvas.parentNode);
    }

    try {
      console.log("추가 데이터 로드 중...");

      // 가장 오래된 데이터의 타임스탬프 가져오기
      const oldestTimestamp =
        this.dataManager.size > 0 ? this.dataManager.timestamps[0] : Date.now();

      // endTime 파라미터를 사용하여 이전 데이터 요청
      const endTime = oldestTimestamp - 1; // 1ms 이전 데이터부터 요청

      // API에서 이전 데이터 가져오기
      const response = await axios.get(
        `https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=${count}&endTime=${endTime}`
      );

      if (
        !response.data ||
        !Array.isArray(response.data) ||
        response.data.length === 0
      ) {
        console.log("더 이상 로드할 데이터가 없습니다.");
        return;
      }

      // 데이터 포맷 변환
      const formattedData = response.data.map((item) => {
        const timestamp = item[0];
        const open = parseFloat(item[1]);
        const high = parseFloat(item[2]);
        const low = parseFloat(item[3]);
        const close = parseFloat(item[4]);
        const volume = parseFloat(item[5]);

        return {
          t: timestamp,
          x: timestamp,
          o: open,
          h: high,
          l: low,
          c: close,
          v: volume,
        };
      });

      // 시간순으로 정렬 (오래된 데이터부터)
      formattedData.sort((a, b) => a.t - b.t);

      // 이전 데이터이므로 앞부분에 추가
      this.dataManager.prependCandles(formattedData);

      // earliestX 업데이트
      if (formattedData.length > 0) {
        this.earliestX = Math.min(this.earliestX, formattedData[0].t);
      }

      console.log(`${formattedData.length}개의 추가 데이터를 로드했습니다.`);

      // 차트 데이터 업데이트
      if (this.chart) {
        const chartData = this.dataManager.getChartJsData();
        this.chart.data = chartData;

        // X축 범위 업데이트
        if (this.chart.options.scales.x) {
          this.chart.options.scales.x.min = this.earliestX;
        }
      }

      // 볼륨 차트 업데이트
      if (this.volumeChart) {
        const volumeData = this.dataManager.getVolumeChartData(
          undefined,
          undefined,
          chartColors.upBody,
          chartColors.downBody,
          0.4
        );
        this.volumeChart.data = volumeData;
      }

      // 차트 업데이트
      this.chartNeedsUpdate = true;

      return formattedData;
    } catch (error) {
      console.error("추가 데이터 로드 중 오류:", error);
      return null;
    } finally {
      this.isLoading = false;
      this.uiHelper.hideLoadingSpinner();
    }
  }

  // 이전 데이터 로드를 위한 스크롤 감지 메서드 개선
  setupScrollLoadTrigger() {
    if (!this.chart || !this.chart.scales || !this.chart.scales.x) return;

    const xScale = this.chart.scales.x;

    // 이전 값 저장을 위한 속성 추가
    this._previousMin = xScale.min;

    // 스크롤 감지 함수
    const checkForDataLoad = () => {
      if (!this.chart || !this.chart.scales || !this.chart.scales.x) return;

      const currentMin = this.chart.scales.x.min;

      console.log("스크롤 감지:", {
        previousMin: this._previousMin,
        currentMin,
        earliestX: this.earliestX,
        threshold: (this.latestX - this.earliestX) * 0.1,
      });

      // 사용자가 왼쪽으로 스크롤하여 가장 오래된 데이터에 가까워지면 더 많은 데이터 로드
      if (
        currentMin < this._previousMin && // 왼쪽으로 스크롤 중
        Math.abs(currentMin - this.earliestX) <
          (this.latestX - this.earliestX) * 0.2 // 남은 표시 영역이 20% 미만
      ) {
        console.log("추가 데이터 로드 트리거됨");
        // 추가 데이터 로드
        this.loadMoreData();
      }

      // 현재 값을 이전 값으로 저장
      this._previousMin = currentMin;
    };

    // 차트 업데이트 후 실행할 콜백 추가
    this.afterUpdateCallbacks = this.afterUpdateCallbacks || [];

    // 이미 등록된 콜백이 있으면 제거 (중복 방지)
    this.afterUpdateCallbacks = this.afterUpdateCallbacks.filter(
      (cb) => cb !== checkForDataLoad
    );

    // 새 콜백 등록
    this.afterUpdateCallbacks.push(checkForDataLoad);

    console.log("스크롤 로드 트리거 설정 완료");
  }

  // 실시간 데이터 업데이트 메서드
  setupLiveDataUpdate(interval = 60000) {
    // 기본 1분 간격
    // 기존 타이머가 있으면 제거
    if (this.liveUpdateTimer) {
      clearInterval(this.liveUpdateTimer);
    }

    // 실시간 데이터 가져오기 함수
    const fetchLiveData = async () => {
      try {
        // 새로운 데이터만 가져오기 위해 마지막 타임스탬프 이후의 데이터 요청
        const startTime = this.latestX + 1; // 마지막 데이터 이후

        const response = await axios.get(
          `https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&startTime=${startTime}&limit=10`
        );

        if (
          !response.data ||
          !Array.isArray(response.data) ||
          response.data.length === 0
        ) {
          console.log("새로운 데이터가 없습니다.");
          return;
        }

        // 데이터 포맷 변환
        const formattedData = response.data.map((item) => {
          const timestamp = item[0];
          const open = parseFloat(item[1]);
          const high = parseFloat(item[2]);
          const low = parseFloat(item[3]);
          const close = parseFloat(item[4]);
          const volume = parseFloat(item[5]);

          return {
            t: timestamp,
            x: timestamp,
            o: open,
            h: high,
            l: low,
            c: close,
            v: volume,
          };
        });

        // 새로운 데이터 추가
        this.addNewData(formattedData);

        console.log(
          `${formattedData.length}개의 실시간 데이터를 업데이트했습니다.`
        );
      } catch (error) {
        console.error("실시간 데이터 업데이트 중 오류:", error);
      }
    };

    // 타이머 설정
    this.liveUpdateTimer = setInterval(fetchLiveData, interval);

    // 페이지 언로드 시 타이머 정리
    window.addEventListener("beforeunload", () => {
      if (this.liveUpdateTimer) {
        clearInterval(this.liveUpdateTimer);
      }
    });

    // 즉시 첫 번째 실행
    fetchLiveData();

    console.log(
      `실시간 데이터 업데이트가 설정되었습니다 (${interval}ms 간격).`
    );
  }
}
