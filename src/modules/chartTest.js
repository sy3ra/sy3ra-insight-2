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

// TypedArray 활용 데이터 관리 클래스 수정
class TypedDataManager {
  constructor(initialCapacity = 1000) {
    // 캔들스틱 데이터용 TypedArray 생성
    this.timestamps = new Float64Array(initialCapacity);
    this.opens = new Float32Array(initialCapacity);
    this.highs = new Float32Array(initialCapacity);
    this.lows = new Float32Array(initialCapacity);
    this.closes = new Float32Array(initialCapacity);
    this.volumes = new Float32Array(initialCapacity);

    // 좌표 변환용 캐시 배열
    this.xPixelCache = new Float32Array(initialCapacity);
    this.yPixelCache = new Float32Array(initialCapacity);

    // 인덱스 및 상태 관리
    this.size = 0;
    this.capacity = initialCapacity;
    this.modifiedFlag = false;
  }

  // 기존 메서드들...

  // Chart.js 호환 데이터 형식으로 변환 (필요한 범위만)
  getChartJsData(startIdx, endIdx) {
    if (this.size === 0) {
      return { labels: [], datasets: [{ label: "BTC/USDT Chart", data: [] }] };
    }

    if (startIdx === undefined) startIdx = 0;
    if (endIdx === undefined) endIdx = this.size;

    const count = endIdx - startIdx;
    const labels = new Array(count);
    const data = new Array(count);

    for (let i = startIdx, j = 0; i < endIdx; i++, j++) {
      labels[j] = this.timestamps[i];
      data[j] = {
        x: this.timestamps[i],
        o: this.opens[i],
        h: this.highs[i],
        l: this.lows[i],
        c: this.closes[i],
        v: this.volumes[i],
      };
    }

    return {
      labels,
      datasets: [
        {
          label: "BTC/USDT Chart",
          data: data,
        },
      ],
    };
  }

  // 가시 영역 데이터 계산 (뷰포트에 보이는 데이터만)
  getVisibleData(minTimestamp, maxTimestamp) {
    if (this.size === 0) {
      return { startIdx: 0, endIdx: 0, count: 0 };
    }

    // 이진 검색으로 시작/종료 인덱스 찾기
    const startIdx = this._binarySearchIndex(minTimestamp);
    const endIdx = this._binarySearchIndex(maxTimestamp, true);

    return {
      startIdx,
      endIdx,
      count: endIdx - startIdx,
    };
  }

  // 이진 검색으로 타임스탬프에 해당하는 인덱스 찾기
  _binarySearchIndex(timestamp, findUpper = false) {
    if (this.size === 0) return 0;

    let low = 0;
    let high = this.size - 1;

    // 경계 검사
    if (timestamp <= this.timestamps[0]) return 0;
    if (timestamp >= this.timestamps[high]) return this.size;

    // 이진 검색
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const midValue = this.timestamps[mid];

      if (midValue === timestamp) {
        return findUpper ? mid + 1 : mid;
      } else if (midValue < timestamp) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    return findUpper ? low : high;
  }

  addCandlesFromArray(candleArray) {
    if (
      !candleArray ||
      !Array.isArray(candleArray) ||
      candleArray.length === 0
    ) {
      return;
    }

    const count = candleArray.length;

    // 필요시 용량 확장
    if (this.size + count > this.capacity) {
      this._expandCapacity(Math.max(this.capacity * 2, this.size + count));
    }

    // 데이터 일괄 추가
    for (let i = 0; i < count; i++) {
      const candle = candleArray[i];
      if (!candle) continue;

      const index = this.size + i;

      this.timestamps[index] = candle.x;
      this.opens[index] = candle.o;
      this.highs[index] = candle.h;
      this.lows[index] = candle.l;
      this.closes[index] = candle.c;
      this.volumes[index] = candle.v || 0;

      this.xPixelCache[index] = -1;
      this.yPixelCache[index] = -1;
    }

    this.size += count;
    this.modifiedFlag = true;
  }

  _expandCapacity(newCapacity) {
    const oldCapacity = this.capacity;
    this.capacity = newCapacity;

    // 각 배열 확장
    const newTimestamps = new Float64Array(newCapacity);
    const newOpens = new Float32Array(newCapacity);
    const newHighs = new Float32Array(newCapacity);
    const newLows = new Float32Array(newCapacity);
    const newCloses = new Float32Array(newCapacity);
    const newVolumes = new Float32Array(newCapacity);
    const newXPixelCache = new Float32Array(newCapacity);
    const newYPixelCache = new Float32Array(newCapacity);

    // 기존 데이터 복사
    newTimestamps.set(this.timestamps.subarray(0, this.size));
    newOpens.set(this.opens.subarray(0, this.size));
    newHighs.set(this.highs.subarray(0, this.size));
    newLows.set(this.lows.subarray(0, this.size));
    newCloses.set(this.closes.subarray(0, this.size));
    newVolumes.set(this.volumes.subarray(0, this.size));

    // 기존 배열 대체
    this.timestamps = newTimestamps;
    this.opens = newOpens;
    this.highs = newHighs;
    this.lows = newLows;
    this.closes = newCloses;
    this.volumes = newVolumes;
    this.xPixelCache = newXPixelCache;
    this.yPixelCache = newYPixelCache;

    console.log(`배열 용량 확장: ${oldCapacity} → ${newCapacity}`);
  }

  getStats() {
    return {
      size: this.size,
      capacity: this.capacity,
      memoryUsage: {
        total: this._calculateMemoryUsage(),
        timestamps: this.timestamps.byteLength,
        priceData: this.opens.byteLength * 4, // opens, highs, lows, closes
        volumes: this.volumes.byteLength,
        cache: this.xPixelCache.byteLength * 2, // xPixelCache, yPixelCache
      },
    };
  }

  _calculateMemoryUsage() {
    return (
      this.timestamps.byteLength +
      this.opens.byteLength +
      this.highs.byteLength +
      this.lows.byteLength +
      this.closes.byteLength +
      this.volumes.byteLength +
      this.xPixelCache.byteLength +
      this.yPixelCache.byteLength
    );
  }
}

// 좌표 변환 최적화를 위한 클래스 추가
class TypedCoordinateTransformer {
  constructor(capacity = 1000) {
    this.xCoords = new Float32Array(capacity);
    this.yCoords = new Float32Array(capacity);
    this.capacity = capacity;
    this.size = 0;
  }

  // 용량 조정
  ensureCapacity(requiredCapacity) {
    if (requiredCapacity <= this.capacity) return;

    const newCapacity = Math.max(this.capacity * 2, requiredCapacity);
    const newXCoords = new Float32Array(newCapacity);
    const newYCoords = new Float32Array(newCapacity);

    newXCoords.set(this.xCoords.subarray(0, this.size));
    newYCoords.set(this.yCoords.subarray(0, this.size));

    this.xCoords = newXCoords;
    this.yCoords = newYCoords;
    this.capacity = newCapacity;
  }

  // 데이터 변환 및 저장
  transformPoints(xValues, yValues, xScale, yScale, count) {
    this.ensureCapacity(count);
    this.size = count;

    // 일괄 변환
    for (let i = 0; i < count; i++) {
      this.xCoords[i] = xScale.getPixelForValue(xValues[i]);
      this.yCoords[i] = yScale.getPixelForValue(yValues[i]);
    }
  }

  // 배열 전체 접근자
  getXCoords() {
    return this.xCoords.subarray(0, this.size);
  }

  getYCoords() {
    return this.yCoords.subarray(0, this.size);
  }

  // 특정 인덱스의 좌표 가져오기
  getCoord(index) {
    if (index < 0 || index >= this.size) return null;
    return { x: this.xCoords[index], y: this.yCoords[index] };
  }

  // 좌표 배열 초기화
  clear() {
    this.size = 0;
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

    // TypedArray 기반 데이터 관리자 추가
    this.dataManager = new TypedDataManager(1000);

    // 좌표 변환 도구 추가
    this.coordTransformer = new TypedCoordinateTransformer(1000);

    // 렌더링 버퍼 추가
    this.renderBuffer = {
      lineCoords: new Float32Array(10000),
      lineStyles: [],
      lineCount: 0,
      rectCoords: new Float32Array(1000),
      rectStyles: [],
      rectCount: 0,
    };

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

      // TypedArray 데이터 구조에 데이터 저장
      if (data.datasets && data.datasets[0] && data.datasets[0].data) {
        this.dataManager.addCandlesFromArray(data.datasets[0].data);
      }

      // 데이터 시간 범위 설정
      this.setupTimeRange(data);

      // 기존 데이터도 저장 (호환성 유지)
      this.labelsStack = data.labels.slice();
      this.dataStack = data.datasets[0].data.slice();

      // 차트 옵션 및 인스턴스 생성
      this.createCharts(data);

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
    // 첫 번째 데이터 시간에서 3일을 뺀 값을 최소 경계로 설정
    const firstTimestamp =
      data?.labels?.[0] ||
      (this.dataManager.size > 0 ? this.dataManager.timestamps[0] : Date.now());
    this.earliestX = firstTimestamp - 1000 * 60 * 60 * 24 * 3; // 3일 여유 마진
  }

  // 차트 생성
  createCharts(data) {
    // 첫 번째 및 마지막 타임스탬프 가져오기
    const earliestX =
      this.dataManager.timestamps && this.dataManager.size > 0
        ? this.dataManager.timestamps[0]
        : this.earliestX;
    const latestX =
      this.dataManager.timestamps && this.dataManager.size > 0
        ? this.dataManager.timestamps[this.dataManager.size - 1]
        : Date.now();

    // 차트 옵션 생성
    const chartOptions = this.createChartOptions(
      this.earliestX || earliestX,
      latestX
    );

    // Chart.js에 전달할 데이터 생성 (TypedArray 또는 기존 데이터)
    const chartData =
      this.dataManager.size > 0
        ? this.dataManager.getChartJsData()
        : { labels: this.labelsStack, datasets: [{ data: this.dataStack }] };

    // 캔들 차트 인스턴스 생성
    this.chart = new Chart(this.chartCtx, {
      type: "candlestick",
      data: chartData,
      options: chartOptions,
    });

    // 볼륨 차트 생성 (volumeChartCtx가 존재할 경우에만)
    if (this.volumeChartCtx) {
      try {
        // 기존 함수와 새 함수 모두 지원
        const volumeData =
          this.dataManager.size > 0 &&
          typeof this.dataManager.getVolumeChartData === "function"
            ? this.dataManager.getVolumeChartData(
                undefined,
                undefined,
                chartColors.upBody,
                chartColors.downBody,
                0.4
              )
            : this.formatVolumeData(chartData);

        const volumeChartOptions = this.createVolumeChartOptions(
          this.earliestX || earliestX,
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

    // 휠 이벤트 처리 함수 수정
    const handleWheel = (e) => {
      e.preventDefault();

      // 시간 제한 (throttling)
      const now = Date.now();
      if (now - lastWheelTime < 8) {
        this.accumulatedDeltaY = (this.accumulatedDeltaY || 0) + e.deltaY;
        return;
      }

      lastWheelTime = now;

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
    this.chart.resize();
    this.chart.update("none");

    // Update volume chart if it exists
    if (
      this.volumeChart &&
      this.volumeChart.ctx &&
      this.volumeChart.ctx.canvas &&
      this.volumeChart.ctx.canvas.parentNode
    ) {
      this.volumeChart.resize();
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
    console.log(`차트 업데이트 구독 시도 (소스: ${source})`);
    this.chartUpdateRefCount++;

    if (!this.isChartUpdateSubscribed) {
      tickerInstance.subscribe(this.boundUpdateCharts);
      this.isChartUpdateSubscribed = true;
      console.log("차트 업데이트 구독 시작");
    }

    console.log(`현재 구독 참조 수: ${this.chartUpdateRefCount}`);
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
    if (!this.chart || !this.chart.scales) return;

    const xScale = this.chart.scales.x;
    const yScale = this.chart.scales.y;

    try {
      // X축 패닝
      if (dx !== 0) {
        const xMin = xScale.min;
        const xMax = xScale.max;
        const pixelRatio = (xMax - xMin) / xScale.width;
        const offsetX = dx * pixelRatio;

        xScale.options.min = xMin - offsetX;
        xScale.options.max = xMax - offsetX;

        // 볼륨 차트 X축 동기화
        if (this.volumeChart) {
          this.volumeChart.options.scales.x.min = xScale.options.min;
          this.volumeChart.options.scales.x.max = xScale.options.max;
        }
      }

      // Y축 패닝
      if (dy !== 0) {
        const yMin = yScale.min;
        const yMax = yScale.max;

        // Y축은 위치가 반대이므로 변환 필요
        const startPixel = yScale.getPixelForValue(yMin);
        const endPixel = yScale.getPixelForValue(yMax);
        const newStartPixel = startPixel - dy;
        const newEndPixel = endPixel - dy;

        const newYMin = yScale.getValueForPixel(newStartPixel);
        const newYMax = yScale.getValueForPixel(newEndPixel);

        yScale.options.min = newYMin;
        yScale.options.max = newYMax;
      }

      // 과거 데이터 로딩 체크
      if (xScale.options.min <= this.earliestX && !this.isLoading) {
        this.debouncedCheckLimitReached();
      }

      this.chartNeedsUpdate = true;
    } catch (error) {
      console.error("차트 패닝 중 오류:", error);
    }
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

    // TypedArray를 이용한 오버레이 렌더링 최적화
    if (overlays && overlays.length > 0) {
      // 렌더링 버퍼 크기 확인 및 조정
      if (this.renderBuffer.lineCoords.length < overlays.length * 4) {
        this.renderBuffer.lineCoords = new Float32Array(
          overlays.length * 4 * 2
        );
      }

      // 오버레이 렌더링
      this._drawOverlays(overlays, true);
    } else {
      // 오버레이가 없을 경우 캔버스 클리어
      this.clearOverlayCanvas(true);
    }
  }

  // TypedArray를 활용한 효율적인 오버레이 렌더링
  _drawOverlays(overlays, fullClear = false) {
    if (!this.isValidOverlaysArray(overlays)) return;

    // 캔버스 클리어
    this.clearOverlayCanvas(fullClear);

    // 렌더링 버퍼 초기화
    let lineIndex = 0;

    // 차트 영역 정보
    const chartArea = this.chart.chartArea;

    // 단일 패스에서 모든 라인 좌표 계산
    for (let i = 0; i < overlays.length; i++) {
      const overlay = overlays[i];
      if (!overlay) continue;

      // 라인 타입별 좌표 계산
      switch (overlay.lineType) {
        case "HorizontalLine":
          // 수평선 좌표
          this.renderBuffer.lineCoords[lineIndex++] = chartArea.left;
          this.renderBuffer.lineCoords[lineIndex++] = overlay.startY;
          this.renderBuffer.lineCoords[lineIndex++] = chartArea.right;
          this.renderBuffer.lineCoords[lineIndex++] = overlay.startY;

          // 스타일 정보 저장
          this.renderBuffer.lineStyles.push({
            color: overlay.color || "red",
            width: overlay.width || 1,
          });
          break;

        case "VerticalLine":
          // 수직선 좌표
          this.renderBuffer.lineCoords[lineIndex++] = overlay.startX;
          this.renderBuffer.lineCoords[lineIndex++] = chartArea.top;
          this.renderBuffer.lineCoords[lineIndex++] = overlay.startX;
          this.renderBuffer.lineCoords[lineIndex++] = chartArea.bottom;

          // 스타일 정보 저장
          this.renderBuffer.lineStyles.push({
            color: overlay.color || "red",
            width: overlay.width || 1,
          });
          break;

        case "ExtendedLine":
        case "Ray":
        default:
          // 일반 라인 좌표
          this.renderBuffer.lineCoords[lineIndex++] = overlay.startX;
          this.renderBuffer.lineCoords[lineIndex++] = overlay.startY;
          this.renderBuffer.lineCoords[lineIndex++] = overlay.endX;
          this.renderBuffer.lineCoords[lineIndex++] = overlay.endY;

          // 스타일 정보 저장
          this.renderBuffer.lineStyles.push({
            color: overlay.color || "red",
            width: overlay.width || 1,
          });
          break;
      }
    }

    // 라인 개수 업데이트
    this.renderBuffer.lineCount = this.renderBuffer.lineStyles.length;

    // 단일 렌더링 패스에서 모든 라인 그리기
    this._batchRenderLines();

    // 스타일 배열 초기화
    this.renderBuffer.lineStyles = [];
  }

  // 일괄 라인 그리기 최적화
  _batchRenderLines() {
    const ctx = this.overlayCtx;
    const lineCount = this.renderBuffer.lineCount;

    if (lineCount === 0) return;

    // 단일 컨텍스트 저장/복원으로 성능 향상
    ctx.save();

    for (let i = 0; i < lineCount; i++) {
      const baseIndex = i * 4;
      const style = this.renderBuffer.lineStyles[i];

      // 스타일 설정
      ctx.lineWidth = style.width;
      ctx.strokeStyle = style.color;

      // 라인 그리기
      ctx.beginPath();
      ctx.moveTo(
        this.renderBuffer.lineCoords[baseIndex],
        this.renderBuffer.lineCoords[baseIndex + 1]
      );
      ctx.lineTo(
        this.renderBuffer.lineCoords[baseIndex + 2],
        this.renderBuffer.lineCoords[baseIndex + 3]
      );
      ctx.stroke();
    }

    ctx.restore();
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
    if ("screen" in window && "refresh" in window.screen) {
      // 모던 API 사용
      window.screen.refresh?.addEventListener("change", () => {
        this.refreshRate = window.screen.refresh?.rate || 60;
        console.log(`모니터 주사율 감지: ${this.refreshRate}Hz`);
        this.updateRenderThrottleDelay();
      });

      // 초기값 설정 최적화 (프라미스 체이닝)
      if (window.screen.refresh?.getState) {
        window.screen.refresh
          .getState()
          .then((state) => {
            this.refreshRate = state.rate || 60;
            this.updateRenderThrottleDelay();
          })
          .catch(() => this.measureRefreshRateWithRAF());
      } else {
        this.measureRefreshRateWithRAF();
      }
    } else {
      this.measureRefreshRateWithRAF();
    }
  }

  // 주사율 측정 최적화 (TypedArray 사용)
  measureRefreshRateWithRAF() {
    const frameIntervals = new Float32Array(20); // 더 큰 버퍼 사용
    let lastTime = performance.now();
    let frameCount = 0;
    const framesToMeasure = 10;
    let intervalIndex = 0;

    const measureFrame = (timestamp) => {
      const now = performance.now();
      const delta = now - lastTime;

      if (delta > 5) {
        // 노이즈 필터링
        frameIntervals[intervalIndex++] = delta;
        lastTime = now;
        frameCount++;

        // 버퍼 끝에 도달하면 처음부터 다시 시작
        if (intervalIndex >= frameIntervals.length) {
          intervalIndex = 0;
        }
      }

      if (frameCount < framesToMeasure) {
        requestAnimationFrame(measureFrame);
      } else {
        // 사용된 버퍼 부분만 복사
        const usedIntervals = frameIntervals.slice(0, intervalIndex);

        // Float32Array를 일반 배열로 변환하여 정렬
        const sortedIntervals = Array.from(usedIntervals).sort((a, b) => a - b);

        // 중간값 계산
        const medianInterval =
          sortedIntervals[Math.floor(sortedIntervals.length / 2)];
        this.refreshRate = Math.round(1000 / medianInterval);

        console.log(
          `측정된 모니터 주사율: ${
            this.refreshRate
          }Hz (${medianInterval.toFixed(2)}ms 간격)`
        );
        this.updateRenderThrottleDelay();
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

  // 볼륨 차트의 Y축 범위를 고정하여 모든 바가 표시되도록 조정
  adjustVolumeChartYScale(xMin, xMax) {
    if (!this.volumeChart) return;

    try {
      // 가시 영역 데이터 인덱스 찾기
      const visibleRegion = this.dataManager.getVisibleData(xMin, xMax);

      // 가시 영역의 최대 볼륨 찾기 (TypedArray 직접 접근)
      let maxVolume = 0;
      const volumes = this.dataManager.volumes;

      for (let i = visibleRegion.startIdx; i < visibleRegion.endIdx; i++) {
        const volume = volumes[i];
        if (volume > maxVolume) {
          maxVolume = volume;
        }
      }

      // 최대 바 높이 및 패딩 계산
      const maxBarHeight = 100;
      const padding = maxBarHeight * 0.1;

      // 스케일링 계수 적용
      const scalingFactor = maxVolume > 0 ? maxBarHeight / maxVolume : 1;
      const suggestedMax = maxVolume * scalingFactor + padding;

      // Y축 범위 설정
      this.volumeChart.options.scales.y.suggestedMax = suggestedMax;
      this.volumeChart.options.scales.y.min = 0;
    } catch (error) {
      console.warn("볼륨 차트 Y축 범위 조정 중 오류:", error);
      // 오류 발생 시 기본값 설정
      this.volumeChart.options.scales.y.suggestedMax = 110;
    }
  }

  // 차트 상태 변경 함수 (렌더링은 별도로 요청)
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

  // 렌더링 리소스 해제
  dispose() {
    // 차트 인스턴스 정리
    if (this.chart) {
      this.chart.destroy();
      this.chart = null;
    }

    if (this.volumeChart) {
      this.volumeChart.destroy();
      this.volumeChart = null;
    }

    // 이벤트 구독 해제
    this.unsubscribeChartUpdate("dispose");
    this.unsubscribeOverlayUpdate();

    // 렌더링 버퍼 정리
    this.renderBuffer.lineCoords = null;
    this.renderBuffer.lineStyles = null;
    this.renderBuffer.rectCoords = null;
    this.renderBuffer.rectStyles = null;

    // TypedArray 데이터 정리
    if (this.dataManager) {
      this.dataManager.timestamps = null;
      this.dataManager.opens = null;
      this.dataManager.highs = null;
      this.dataManager.lows = null;
      this.dataManager.closes = null;
      this.dataManager.volumes = null;
      this.dataManager.xPixelCache = null;
      this.dataManager.yPixelCache = null;
      this.dataManager = null;
    }

    // 좌표 변환기 정리
    if (this.coordTransformer) {
      this.coordTransformer.xCoords = null;
      this.coordTransformer.yCoords = null;
      this.coordTransformer = null;
    }

    console.log("차트 및 관련 리소스가 정리되었습니다.");
  }

  // 성능 통계 정보 수집
  getPerformanceStats() {
    return {
      dataStats: this.dataManager?.getStats() || { size: 0 },
      renderStats: {
        lastRenderTime: this.lastRenderTimestamp,
        throttleDelay: this.renderThrottleDelay,
        refreshRate: this.refreshRate,
      },
      chartState: this.chart
        ? {
            dataPoints: this.chart.data.datasets[0].data.length,
            visibleMin: this.chart.scales.x.min,
            visibleMax: this.chart.scales.x.max,
            visibleRange: this.chart.scales.x.max - this.chart.scales.x.min,
          }
        : null,
    };
  }

  // 볼륨 차트 데이터 포맷팅 함수 (누락됨)
  formatVolumeData(data) {
    // TypedArray 기반 구현이 아직 없는 경우를 위한 호환성 함수
    if (
      this.dataManager &&
      typeof this.dataManager.getVolumeChartData === "function"
    ) {
      return this.dataManager.getVolumeChartData(
        undefined,
        undefined,
        chartColors.upBody,
        chartColors.downBody,
        0.4
      );
    }

    // 기존 구현 복원 (임시 호환성)
    const rawVolumeValues = [];
    const backgroundColor = [];
    const scaledVolumeData = [];

    // 데이터 구조 확인
    const candleData = data.datasets[0].data;
    const candleLength = candleData.length;

    // 최대 볼륨 찾기
    let maxVolumeInData = 0;
    for (let i = 0; i < candleLength; i++) {
      const candle = candleData[i];
      const volume = candle && candle.v ? candle.v : 0;
      rawVolumeValues[i] = volume;

      if (isFinite(volume) && volume > 0 && volume > maxVolumeInData) {
        maxVolumeInData = volume;
      }
    }

    // 최대 바 높이 설정
    const maxBarHeight = 100;
    const scalingFactor =
      maxVolumeInData > 0 ? maxBarHeight / maxVolumeInData : 1;

    // 볼륨 데이터 생성
    for (let i = 0; i < candleLength; i++) {
      const candle = candleData[i];
      const volume = rawVolumeValues[i];

      // 색상 결정
      if (!candle || typeof candle !== "object") {
        backgroundColor[i] = this.applyTransparency(chartColors.upBody, 0.4);
      } else {
        const isUp = Number(candle.o) <= Number(candle.c);
        backgroundColor[i] = this.applyTransparency(
          isUp ? chartColors.upBody : chartColors.downBody,
          0.4
        );
      }

      // 스케일링된 볼륨
      const scaledVolume = volume * scalingFactor;
      scaledVolumeData[i] = Math.max(scaledVolume, volume > 0 ? 3 : 0);
    }

    return {
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
  }

  // 색상에 투명도 적용 (누락됨)
  applyTransparency(color, alpha) {
    if (!this._colorCache) this._colorCache = {};
    const cacheKey = `${color}_${alpha}`;

    if (this._colorCache[cacheKey]) {
      return this._colorCache[cacheKey];
    }

    let result;
    if (color.startsWith("rgba")) {
      result = color.replace(/,\s*[\d\.]+\)$/, `, ${alpha})`);
    } else if (color.startsWith("rgb")) {
      const rgbValues = color.substring(4, color.length - 1);
      result = `rgba(${rgbValues}, ${alpha})`;
    } else if (color.startsWith("#")) {
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

  // 안전장치 설정 함수 (누락됨)
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

  // 마우스 위치 업데이트 (누락됨)
  updateMousePosition(x, y) {
    if (this.crosshair && typeof this.crosshair.updatePosition === "function") {
      this.crosshair.updatePosition(x, y);
    }
  }

  // 마우스 이탈 처리 (누락됨)
  mouseLeave() {
    if (this.crosshair) {
      this.crosshair.mouseLeave();
    }
  }

  // 차트 업데이트 구독 해제 (누락됨)
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

  // 누락된 render 메서드 추가
  render() {
    if (!this.chart) return;

    // 차트 렌더링
    this.renderAllCharts();

    // 오버레이 캔버스 업데이트
    this.updateOverlayCanvas();

    // 첫 렌더링 후 차트 상태 플래그 설정
    this.chartNeedsUpdate = false;
    this.lastRenderTimestamp = performance.now();

    console.log("차트 초기 렌더링 완료");
  }

  // 누락된 updateCharts 메서드 추가
  updateCharts() {
    if (this.chartNeedsUpdate && !this.isRenderPending) {
      this.renderAllCharts();
    }
  }

  // 누락된 updateOverlayCanvas 메서드 추가
  updateOverlayCanvas() {
    try {
      const overlays = window.mainCanvas?.getOverlaysArray?.();

      if (overlays && overlays.length > 0) {
        this._drawOverlays(overlays, true);
      } else {
        this.clearOverlayCanvas(true);
      }
    } catch (error) {
      console.error("오버레이 캔버스 업데이트 중 오류:", error);
      this.clearOverlayCanvas(true);
    }
  }

  // 누락된 _drawOverlays 메서드 추가
  _drawOverlays(overlays, fullClear = false) {
    if (!this.isValidOverlaysArray(overlays)) return;

    // 캔버스 클리어
    this.clearOverlayCanvas(fullClear);

    // 오버레이 그리기
    for (const overlay of overlays) {
      if (!overlay) continue;
      this.drawOverlayByType(overlay);
    }
  }

  // 누락된 drawOverlayByType 메서드 추가
  drawOverlayByType(overlay) {
    if (!overlay || !this.overlayCtx || !this.chart?.chartArea) return;

    const { startX, startY, endX, endY, lineType, color, width } = overlay;
    const chartArea = this.chart.chartArea;

    this.overlayCtx.save();
    this.overlayCtx.strokeStyle = color || "red";
    this.overlayCtx.lineWidth = width || 1;

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
        this.drawSimpleLine(startX, startY, endX, endY);
        break;
    }

    this.overlayCtx.restore();
  }

  // 선 그리기 기본 메서드들
  drawHorizontalLine(y, chartArea) {
    this.overlayCtx.beginPath();
    this.overlayCtx.moveTo(chartArea.left, y);
    this.overlayCtx.lineTo(chartArea.right, y);
    this.overlayCtx.stroke();
  }

  drawVerticalLine(x, chartArea) {
    this.overlayCtx.beginPath();
    this.overlayCtx.moveTo(x, chartArea.top);
    this.overlayCtx.lineTo(x, chartArea.bottom);
    this.overlayCtx.stroke();
  }

  drawSimpleLine(startX, startY, endX, endY) {
    this.overlayCtx.beginPath();
    this.overlayCtx.moveTo(startX, startY);
    this.overlayCtx.lineTo(endX, endY);
    this.overlayCtx.stroke();
  }

  drawExtendedLine(startX, startY, endX, endY, chartArea) {
    // 기울기 계산
    const dx = endX - startX;
    const dy = endY - startY;

    if (Math.abs(dx) < 0.001) {
      // 수직선
      this.drawVerticalLine(startX, chartArea);
      return;
    }

    const slope = dy / dx;
    const yIntercept = startY - slope * startX;

    // 차트 영역 경계에서의 y 값 계산
    const leftY = slope * chartArea.left + yIntercept;
    const rightY = slope * chartArea.right + yIntercept;

    this.overlayCtx.beginPath();
    this.overlayCtx.moveTo(chartArea.left, leftY);
    this.overlayCtx.lineTo(chartArea.right, rightY);
    this.overlayCtx.stroke();
  }

  drawRay(startX, startY, endX, endY, chartArea) {
    const dx = endX - startX;
    const dy = endY - startY;

    if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return; // 점

    // 방향 벡터 단위화
    const magnitude = Math.sqrt(dx * dx + dy * dy);
    const dirX = dx / magnitude;
    const dirY = dy / magnitude;

    // 방향에 따라 차트 경계까지 연장
    let t;
    if (dirX > 0) {
      t = (chartArea.right - startX) / dirX;
    } else if (dirX < 0) {
      t = (chartArea.left - startX) / dirX;
    } else if (dirY > 0) {
      t = (chartArea.bottom - startY) / dirY;
    } else {
      t = (chartArea.top - startY) / dirY;
    }

    // 경계에서의 끝점 계산
    const endPointX = startX + dirX * t;
    const endPointY = startY + dirY * t;

    this.overlayCtx.beginPath();
    this.overlayCtx.moveTo(startX, startY);
    this.overlayCtx.lineTo(endPointX, endPointY);
    this.overlayCtx.stroke();
  }
}
