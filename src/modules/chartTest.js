import { Chart, registerables } from "chart.js";
import {
  CandlestickController,
  CandlestickElement,
} from "chartjs-chart-financial";
import "chartjs-adapter-date-fns";
import { ChartCrosshair } from "./chartCrosshair";
import { chartColors } from "./theme.js";
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
import { ChartEventHandler } from "./chart/ChartEventHandler.js";
import { ChartOverlayManager } from "./chart/ChartOverlayManager.js";
import { ChartPerformance } from "./chart/ChartPerformance.js";
import { ChartUIHelper } from "./chart/utils/ChartUIHelper.js";

// Chart.js에 필요한 요소 등록
Chart.register(...registerables, CandlestickController, CandlestickElement);

export class ChartTest {
  constructor(chartCtx, crosshairCtx, overlayCtx) {
    this.maxVolume = 0;
    // 캔버스 컨텍스트 저장
    this.chartCtx = chartCtx;
    this.crosshairCtx = crosshairCtx;
    this.overlayCtx = overlayCtx;

    // 차트 인스턴스
    this.chart = null;

    // 상태 변수
    this.isLoading = false;
    this.earliestX = null;
    this.latestX = null;
    this.chartNeedsUpdate = false;
    this.isUpdating = false; //불필요할 수 있음
    this.lastValidMin = null;
    this.lastValidMax = null;

    // 캔버스 크기 캐싱 추가
    this._canvasSizeCache = { width: 0, height: 0 };
    this._devicePixelRatio = window.devicePixelRatio || 1;

    // API 데이터 한계 도달 여부
    this.reachedApiLimit = false;

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

    // // 성능 관련 속성 참조
    // this.renderThrottleDelay = this.performance.renderThrottleDelay;
    // this.lastRenderTimestamp = this.performance.lastRenderTimestamp;

    // 재사용 가능한 객체들 초기화
    this._tempPoint = { x: 0, y: 0 };
    this._tempCandle = { x: 0, o: 0, h: 0, l: 0, c: 0 };
    this._tempDataArray = [];
    this._tempVolumePoint = { x: 0, y: 0 };
    // *** 추가: 현재 차트에 표시되는 데이터 범위 저장용 ***
    this._visibleDataCache = {
      candles: [],
      volumes: [],
      startIndex: -1,
      endIndex: -1,
    };
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

      // 통합 차트 생성
      this.createChart([], []);

      // 크로스헤어 생성
      this.crosshair = new ChartCrosshair(this.crosshairCtx, this.chart);

      // 오버레이 관리자 생성
      this.overlayManager = new ChartOverlayManager(
        this.overlayCtx,
        this.chart
      );
      // this.overlayManager.subscribeOverlayUpdate();

      // 이벤트 핸들러 생성
      this.eventHandler = new ChartEventHandler(this.chart, this);
      this.eventHandler.setupEventHandlers(this.chart.canvas);

      // 차트 상태 감시 타이머 설정
      // this.startChartMonitoring();

      // 리사이징 이벤트 리스너 설정
      this.setupResizeListener();

      // 추가 데이터 로드 트리거 설정
      // this.setupScrollLoadTrigger();

      // 초기 리사이즈 실행
      this.updateCanvasSizes();
      // this.renderAllCharts();
      //초기 렌더링 요청
      this.chartNeedsUpdate = true;
      this.eventHandler.subscribeChartUpdate("initialize");

      console.log("통합 차트 인스턴스가 생성되었습니다.");
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

      // 임시 객체 생성하여 재사용
      const tempCandle = { x: 0, o: 0, h: 0, l: 0, c: 0, v: 0 };

      // 임시 배열 생성 (또는 재사용)
      if (!this._tempCandleArray) {
        this._tempCandleArray = [];
      }

      // 배열 초기화
      const formattedData = this._tempCandleArray;
      formattedData.length = 0;

      // API 데이터 처리
      const responseData = response.data;
      const length = responseData.length;

      for (let i = 0; i < length; i++) {
        const item = responseData[i];

        // 임시 객체 속성 업데이트
        tempCandle.x = item[0];
        tempCandle.o = parseFloat(item[1]);
        tempCandle.h = parseFloat(item[2]);
        tempCandle.l = parseFloat(item[3]);
        tempCandle.c = parseFloat(item[4]);
        tempCandle.v = parseFloat(item[5]);

        // 객체 복사하여 배열에 추가 (얕은 복사만으로도 충분)
        formattedData.push({ ...tempCandle });
      }

      // 데이터 관리자에 추가
      this.dataManager.addCandlesFromArray(formattedData);
      return formattedData;
    } catch (error) {
      console.error("데이터 불러오기 중 오류:", error);
      throw error;
    } finally {
      this.isLoading = false;
      this.uiHelper.hideLoadingSpinner();
    }
  }

  // *** 데이터 집계/필터링 함수 추가 ***
  // OHLC 집계 대신 보이는 범위 필터링 구현 (메모리 효율 향상 목적)
  // ChartTest.js 내의 _getVisibleData 수정
  _getVisibleData(minVisibleTime, maxVisibleTime) {
    if (this.dataManager.size === 0) {
      return { candles: [], volumes: [], startIndex: -1, endIndex: -1 };
    }

    // *** 효율적인 인덱스 검색 메서드 사용 ***
    const { startIndex, endIndex } = this.dataManager.getVisibleIndices(
      minVisibleTime,
      maxVisibleTime
    );

    // 유효하지 않은 범위 처리
    if (startIndex === -1 || endIndex === -1) {
      // 캐시 초기화 및 빈 배열 반환
      this._visibleDataCache = {
        candles: [],
        volumes: [],
        startIndex: -1,
        endIndex: -1,
      };
      return this._visibleDataCache;
    }

    // 이전 캐시와 범위가 같으면 캐시 재사용 (수정: endIndex 포함하여 비교)
    if (
      this._visibleDataCache.startIndex === startIndex &&
      this._visibleDataCache.endIndex === endIndex &&
      this._visibleDataCache.candles.length === endIndex - startIndex + 1 // 정확한 개수 비교
    ) {
      return this._visibleDataCache;
    }

    const visibleCandles = [];
    const visibleVolumes = [];
    // *** endIndex 포함하여 루프 수정 ***
    for (let i = startIndex; i <= endIndex; i++) {
      visibleCandles.push({
        x: this.dataManager.timestamps[i],
        o: this.dataManager.opens[i],
        h: this.dataManager.highs[i],
        l: this.dataManager.lows[i],
        c: this.dataManager.closes[i],
      });
      visibleVolumes.push({
        x: this.dataManager.timestamps[i],
        y: this.dataManager.volumes[i],
      });
    }

    // 새로운 데이터 캐시 (수정: endIndex 포함)
    this._visibleDataCache = {
      candles: visibleCandles,
      volumes: visibleVolumes,
      startIndex,
      endIndex,
    };

    return this._visibleDataCache;
  }

  createChart(initialCandles = [], initialVolumes = []) {
    try {
      // 현재 차트가 있으면 제거
      if (this.chart) {
        this.chart.destroy();
      }

      // 캔들스틱과 볼륨 데이터 준비
      // TypedDataManager에서 기존 데이터 재사용하여 가져오기
      // const candleData = this.getCandleData();
      // const volumeData = this.getVolumeData();

      // 통합 차트 옵션 직접 정의
      const options = {
        maintainAspectRatio: false,
        parsing: false,
        animation: false,
        responsive: false,
        layout: {
          padding: {
            top: 20,
            right: 20,
            bottom: 20,
            left: 10,
          },
        },
        elements: {
          candlestick: {
            color: {
              up: chartColors.upBody,
              down: chartColors.downBody,
              unchanged: chartColors.upBody,
            },
            borderColors: {
              up: "transparent",
              down: "transparent",
              unchanged: "transparent",
            },
            backgroundColors: {
              up: chartColors.upBody,
              down: chartColors.downBody,
              unchanged: chartColors.upBody,
            },
            borderWidth: 0,
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
              autoSkip: true,
              maxTicksLimit: 15,
              color: "#d4d4d4",
              source: "auto",
              font: {
                family: "'Helvetica Neue', 'Helvetica', 'Arial', sans-serif",
                size: 12,
              },
            },
            grid: {
              color: "rgba(255, 255, 255, 0.1)",
              display: false,
              drawOnChartArea: false,
              drawTicks: false,
            },
            min: this.earliestX,
            max: this.latestX,
            offset: true,
            alignToPixels: true,
          },
          y: {
            position: "right",
            beginAtZero: false,
            // weight: 80, // 캔들 차트의 높이를 전체 차트의 80%로 설정
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
            // afterFit: function (scaleInstance) {
            //   scaleInstance.width = 90;
            // },
          },
          // 볼륨 차트를 위한 Y축 추가
          volume: {
            type: "linear",
            position: "right",
            display: true,
            beginAtZero: true,
            min: 0,
            // 볼륨 차트의 최대값 설정
            suggestedMax: this.getMaxVolume() * 5,
            grid: {
              display: false,
            },
            ticks: {
              display: false,
              color: "#d4d4d4",
              // callback: function (value) {
              //   if (value >= 1000000) {
              //     return (value / 1000000).toFixed(1) + "M";
              //   } else if (value >= 1000) {
              //     return (value / 1000).toFixed(1) + "K";
              //   }
              //   return value;
              // },
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
          // 캔들스틱 플러그인 설정 추가
          candlestick: {
            color: {
              up: chartColors.upBody,
              down: chartColors.downBody,
              unchanged: chartColors.upBody,
            },
            borderColor: {
              up: "transparent",
              down: "transparent",
              unchanged: "transparent",
            },
            backgroundColors: {
              up: chartColors.upBody,
              down: chartColors.downBody,
              unchanged: chartColors.upBody,
            },
            borderWidth: 0,
          },
        },
        datasets: {
          bar: {},
        },
      };

      // Chart.js에서는 데이터셋 순서가 중요함
      this.chart = new Chart(this.chartCtx, {
        type: "candlestick", // 기본 타입을 candlestick으로 유지
        data: {
          datasets: [
            {
              // 캔들스틱 데이터셋
              type: "candlestick",
              label: "BTC/USDT",
              data: initialCandles,
              yAxisID: "y",
              order: 0,
              // 캔들스틱 색상 설정
              color: {
                up: chartColors.upBody,
                down: chartColors.downBody,
                unchanged: chartColors.upBody,
              },
              backgroundColor: {
                up: chartColors.upBody,
                down: chartColors.downBody,
                unchanged: chartColors.upBody,
              },
              borderColor: {
                up: "transparent",
                down: "transparent",
                unchanged: "transparent",
              },
            },
            {
              // 볼륨 데이터셋
              type: "bar",
              label: "Volume",
              data: initialVolumes,
              backgroundColor: (ctx) => {
                if (!ctx || !ctx.raw || ctx.raw.y === 0) return "transparent";
                // *** 중요: 여기서는 현재 Chart.js 데이터셋의 데이터를 참조해야 함 ***
                // this.getCandleDataAtIndex 대신 ctx.chart.data.datasets[0].data 사용
                const candleIndex = ctx.dataIndex;
                const candleData = ctx.chart.data.datasets[0].data[candleIndex]; // 현재 차트에 있는 데이터 참조
                if (!candleData)
                  return this._applyTransparency(chartColors.downBody, 0.6);

                const isUp = candleData.o <= candleData.c;
                return this._applyTransparency(
                  isUp ? chartColors.upBody : chartColors.downBody,
                  0.6
                );
              },
              borderColor: "transparent",
              borderWidth: 0,
              yAxisID: "volume",
              order: 1,
            },
          ],
        },
        options: options,
      });

      // getDatasetMeta 메서드 최적화
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

      return this.chart;
    } catch (err) {
      console.error("차트 생성 중 오류:", err);
      return null;
    }
  }

  // 캔들 데이터 가져오기 - 매번 새 객체 생성 방식으로 변경
  // getCandleData() {
  //   const data = [];

  //   for (let i = 0; i < this.dataManager.size; i++) {
  //     data.push({
  //       x: this.dataManager.timestamps[i],
  //       o: this.dataManager.opens[i],
  //       h: this.dataManager.highs[i],
  //       l: this.dataManager.lows[i],
  //       c: this.dataManager.closes[i],
  //     });
  //   }

  //   return data;
  // }

  // 볼륨 데이터 가져오기 - 매번 새 객체 생성 방식으로 변경
  // getVolumeData() {
  //   const data = [];

  //   // 볼륨 데이터가 모두 0인지 확인
  //   let allZero = true;
  //   for (let i = 0; i < this.dataManager.size; i++) {
  //     if (this.dataManager.volumes[i] > 0) {
  //       allZero = false;
  //       break;
  //     }
  //   }

  //   // 모든 볼륨이 0이면 경고 메시지 출력
  //   if (allZero) {
  //     console.warn(
  //       "모든 볼륨 값이 0입니다. 볼륨 차트가 표시되지 않을 수 있습니다."
  //     );
  //     // 테스트용 더미 데이터 생성 (실제 환경에서는 제거)
  //     for (let i = 0; i < this.dataManager.size; i++) {
  //       data.push({
  //         x: this.dataManager.timestamps[i],
  //         y: Math.random() * 1000,
  //       });
  //     }
  //     return data;
  //   }

  //   for (let i = 0; i < this.dataManager.size; i++) {
  //     data.push({
  //       x: this.dataManager.timestamps[i],
  //       y: this.dataManager.volumes[i],
  //     });
  //   }

  //   return data;
  // }

  // 인덱스의 캔들 데이터 가져오기 - 새 객체 생성 방식으로 변경
  // getCandleDataAtIndex(index) {
  //   if (index < 0 || index >= this.dataManager.size) return null;

  //   return {
  //     x: this.dataManager.timestamps[index],
  //     o: this.dataManager.opens[index],
  //     h: this.dataManager.highs[index],
  //     l: this.dataManager.lows[index],
  //     c: this.dataManager.closes[index],
  //   };
  // }

  updateChartState(mouseX, mouseY, zoomFactor, zoomDirection) {
    if (!this.chart || !this.chart.scales) return;

    try {
      // 데이터셋 유효성 검사
      if (
        !this.chart.data ||
        !this.chart.data.datasets ||
        !this.chart.data.datasets[0] ||
        !this.chart.data.datasets[0].data
      ) {
        console.warn(
          "차트 데이터셋이 유효하지 않습니다. 차트 상태 업데이트를 건너뜁니다."
        );
        return;
      }

      // 줌 팩터 제한 (과도한 줌 아웃 방지)
      const minZoomFactor = 0.1; // 최소 줌 팩터 (줌 아웃 제한)
      const maxZoomFactor = 10; // 최대 줌 팩터 (줌 인 제한)
      zoomFactor = Math.max(minZoomFactor, Math.min(maxZoomFactor, zoomFactor));

      const scales = this.chart.scales;
      const xScale = scales.x;
      const yScale = scales.y;

      // 최소 및 최대 x 값 저장
      const min = xScale.min;
      const max = xScale.max;
      const range = max - min;

      // 최소 범위 확인 (너무 좁은 범위 방지)
      if (range <= 0) {
        console.warn(
          "차트 범위가 유효하지 않습니다. 차트 상태 업데이트를 건너뜁니다."
        );
        return;
      }

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

        // 최소 표시 범위 확인 (데이터 포인트 최소 10개 이상 표시)
        const minDisplayRange =
          10 *
          (this.chart.data.datasets[0].data[1].x -
            this.chart.data.datasets[0].data[0].x);
        const calculatedRange = newMax - newMin;

        if (calculatedRange < minDisplayRange) {
          console.warn(
            "줌 아웃 범위가 너무 좁습니다. 최소 표시 범위로 제한합니다."
          );
          // 중심점 기준으로 최소 범위 적용
          const adjustedRange = minDisplayRange;
          const adjustedMin = centerX - adjustedRange * leftRatio;
          const adjustedMax = centerX + adjustedRange * rightRatio;

          xScale.options.min = adjustedMin;
          xScale.options.max = adjustedMax;
        } else {
          // X축 범위 적용
          xScale.options.min = newMin;
          xScale.options.max = newMax;
        }
      }

      // 차트 업데이트 상태 설정
      this.chartNeedsUpdate = true;

      // 최종 유효 범위 저장
      this.lastValidMin = xScale.options.min;
      this.lastValidMax = xScale.options.max;

      // 줌 작업 후 이벤트 핸들러 참조 갱신
      // 줌아웃 후 canvas 참조가 null이 되는 문제 방지
      if (this.eventHandler && this.chart) {
        // 이벤트 핸들러에 최신 차트 참조 전달
        this.eventHandler.chart = this.chart;
      }
    } catch (error) {
      console.error("차트 상태 업데이트 중 오류 발생:", error);
    }
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

    // 과거 방향(-x)으로 패닝 시도 시 한계점 확인
    if (deltaX > 0 && xScale.min <= this.earliestX) {
      // 한계점에 도달했으므로 X축 패닝을 완전히 무시
      // 패닝 시도 자체를 막음 (벽에 부딪히는 효과)
      // 추가 데이터 로드 시도 (API 한계에 도달하지 않은 경우)
      if (!this.isLoading && !this.reachedApiLimit) {
        this.loadMoreData().then(() => {
          // 데이터 로딩 후 차트 업데이트
          this.chartNeedsUpdate = true;
          // 로딩 후 즉시 반영 원하면 Ticker 구독 요청
          this.eventHandler.subscribeChartUpdate("data-loaded");
        });
      }
      // Y축 패닝만 허용
      yScale.options.min = yScale.min + yDelta;
      yScale.options.max = yScale.max + yDelta;

      // 차트 업데이트 예약
      this.chartNeedsUpdate = true;

      // 유효 범위 저장 (안전장치용)
      this.lastValidMin = xScale.options.min;
      this.lastValidMax = xScale.options.max;
      return; // 여기서 함수 종료 - X축 패닝은 무시
    }

    // 일반적인 패닝 처리 (과거 한계에 도달하지 않았거나 다른 방향으로 패닝하는 경우)
    // X축 패닝
    xScale.options.min = xScale.min - xDelta;
    xScale.options.max = xScale.max - xDelta;

    // Y축 패닝
    yScale.options.min = yScale.min + yDelta;
    yScale.options.max = yScale.max + yDelta;

    // 업데이트 예약
    this.chartNeedsUpdate = true;

    // 유효 범위 저장 (안전장치용)
    this.lastValidMin = xScale.options.min;
    this.lastValidMax = xScale.options.max;
  }

  renderAllCharts() {
    if (!this.chart || !this.chart.scales?.x) return; // 유효성 검사 강화

    try {
      const xScale = this.chart.scales.x;
      const minVisibleTime = xScale.min;
      const maxVisibleTime = xScale.max;

      // const debugBefore_GET_VISIBLE_DATA = performance.now();

      // 성능 측정 주석 제거하고 코드 정리
      const { candles: visibleCandles, volumes: visibleVolumes } =
        this._getVisibleData(minVisibleTime, maxVisibleTime);

      // const debugAfter_GET_VISIBLE_DATA = performance.now();

      // 기존 객체를 직접 수정하는 것이 더 효율적일 수 있으나,
      // Chart.js는 데이터 배열 참조가 바뀌어야 변경을 감지하는 경우가 많음
      this.chart.data.datasets[0].data = visibleCandles;
      this.chart.data.datasets[1].data = visibleVolumes;

      // const debugAfter_SET_VISIBLE_DATA = performance.now();

      // *** 3. 메인 차트 업데이트 (resize + update) ***
      // 리사이즈는 실제 크기 변경 시에만 호출하는 것이 더 효율적 (handleResize에서 처리)
      this.chart.resize(); // 필요시에만 호출하도록 이동 고려

      // const debugAfter_RESIZE = performance.now();

      this.chart.update("none"); // 애니메이션 없이 업데이트
      // const debugAfter_UPDATE = performance.now();

      // *** 4. 오버레이 및 크로스헤어 렌더링 (필요시) ***
      this.renderOverlays(); // 오버레이 다시 그리기

      // 렌더링 타임스탬프 업데이트 (기존 유지)
      this.performance.updateRenderTimestamp();
      this.lastRenderTimestamp = this.performance.lastRenderTimestamp;

      // const debugAfter_UPDATE_RENDER_TIMESTAMP = performance.now();

      // 차트 업데이트 상태 리셋
      this.chartNeedsUpdate = false;

      // const debugAfter_AFTER_UPDATE_CALLBACKS = performance.now();
    } catch (error) {
      console.error("차트 렌더링 중 오류 발생:", error);
      // 오류가 발생하면 차트를 다시 초기화
      try {
        this.createChart();
      } catch (initError) {
        console.error("차트 재초기화 중 오류 발생:", initError);
      }
    }
  }

  // 차트 업데이트 최적화
  // startChartMonitoring() {
  //   // 차트 상태 감시 타이머
  //   setInterval(() => {
  //     try {
  //       // 차트 있는지 확인
  //       if (!this.chart || !this.chart.scales || !this.chart.scales.x) return;

  //       const xScale = this.chart.scales.x;

  //       // 무효한 범위 감지 및 복구
  //       if (
  //         isNaN(xScale.min) ||
  //         isNaN(xScale.max) ||
  //         xScale.min >= xScale.max
  //       ) {
  //         console.warn("차트 범위 복구 중...");
  //         if (this.lastValidMin && this.lastValidMax) {
  //           xScale.options.min = this.lastValidMin;
  //           xScale.options.max = this.lastValidMax;
  //         } else {
  //           const latestX =
  //             this.dataManager.size > 0
  //               ? this.dataManager.timestamps[this.dataManager.size - 1]
  //               : this.chart.data.labels[this.chart.data.labels.length - 1];
  //           xScale.options.min = this.earliestX;
  //           xScale.options.max = latestX;
  //         }

  //         // 즉시 렌더링
  //         this.chartNeedsUpdate = true;
  //         this.renderAllCharts();
  //       } else {
  //         // 최종 유효 범위 저장
  //         this.lastValidMin = xScale.min;
  //         this.lastValidMax = xScale.max;
  //       }
  //     } catch (e) {
  //       console.error("차트 상태 확인 중 오류:", e);
  //     }
  //   }, 1000);
  // }

  // addNewData, loadMoreData: Chart.js 데이터셋 직접 수정 제거
  addNewData(newData) {
    if (!newData || !Array.isArray(newData)) return;
    this.dataManager.addCandlesFromArray(newData);
    this.latestX = this.dataManager.timestamps[this.dataManager.size - 1];
    // chart.options.scales.x.max = this.latestX; // 필요 시 유지
    this.chartNeedsUpdate = true; // 업데이트 예약
    this.eventHandler.subscribeChartUpdate("live-data"); // Ticker 활성화
  }

  // 좌표 변환 메서드 - 단일 재사용 객체 활용
  pixelToValue(x, y) {
    if (!this.chart || !this.chart.scales) {
      if (!this._tempValuePoint) {
        this._tempValuePoint = { x: 0, y: 0 };
      }
      this._tempValuePoint.x = 0;
      this._tempValuePoint.y = 0;
      return this._tempValuePoint;
    }

    const xValue = this.chart.scales.x.getValueForPixel(x);
    const yValue = this.chart.scales.y.getValueForPixel(y);

    if (!this._tempValuePoint) {
      this._tempValuePoint = { x: 0, y: 0 };
    }
    this._tempValuePoint.x = xValue;
    this._tempValuePoint.y = yValue;

    return this._tempValuePoint;
  }

  valueToPixel(x, y) {
    if (!this.chart || !this.chart.scales) {
      if (!this._tempPixelPoint) {
        this._tempPixelPoint = { x: 0, y: 0 };
      }
      this._tempPixelPoint.x = 0;
      this._tempPixelPoint.y = 0;
      return this._tempPixelPoint;
    }

    const xPixel = this.chart.scales.x.getPixelForValue(x);
    const yPixel = this.chart.scales.y.getPixelForValue(y);

    if (!this._tempPixelPoint) {
      this._tempPixelPoint = { x: 0, y: 0 };
    }
    this._tempPixelPoint.x = xPixel;
    this._tempPixelPoint.y = yPixel;

    return this._tempPixelPoint;
  }

  // // 성능 통계 정보 가져오기
  // getPerformanceStats() {
  //   return this.performance.getPerformanceStats(this.dataManager, this.chart);
  // }

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
  }

  // 리사이징 처리 함수
  handleResize() {
    if (!this.chart) return;

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

        // 이벤트 핸들러 참조 갱신
        if (this.eventHandler && this.chart) {
          this.eventHandler.chart = this.chart;

          // 이벤트 핸들러 재설정 (필요한 경우)
          if (this.chart.canvas) {
            this.eventHandler.setupEventHandlers(this.chart.canvas);
          }
        }

        // 오버레이 업데이트
        if (this.overlayManager) {
          this.overlayManager.updateOverlayCanvas();
        }
      } catch (error) {
        console.error("차트 리사이징 중 오류:", error);
      }
    }, 100); // 100ms 디바운스
  }

  // 캔버스 크기 업데이트 (최적화 버전)
  updateCanvasSizes() {
    try {
      if (!this.chart || !this.chart.canvas) {
        console.warn(
          "차트 또는 캔버스가 없습니다. 캔버스 크기 업데이트를 건너뜁니다."
        );
        return;
      }

      const parentElement = this.chart.canvas.parentElement;
      if (!parentElement) {
        console.warn(
          "캔버스의 부모 요소가 없습니다. 캔버스 크기 업데이트를 건너뜁니다."
        );
        return;
      }

      // 컨테이너 크기를 한 번만 읽음
      const containerWidth = parentElement.clientWidth;
      const containerHeight = parentElement.clientHeight;

      // 이전 크기와 같으면 업데이트 건너뛰기
      if (
        this._canvasSizeCache.width === containerWidth &&
        this._canvasSizeCache.height === containerHeight
      ) {
        return;
      }

      // 새 크기 캐시
      this._canvasSizeCache.width = containerWidth;
      this._canvasSizeCache.height = containerHeight;

      // 현재 디바이스 픽셀 비율 확인
      const pixelRatio = window.devicePixelRatio || 1;
      const scaleRatio = 2; // 고정 스케일 비율 유지 (기존 코드와 일관성)

      // 빠른 참조를 위한 캔버스 배열 생성
      const canvasContexts = [
        { ctx: this.chartCtx, canvas: this.chartCtx?.canvas },
        { ctx: this.crosshairCtx, canvas: this.crosshairCtx?.canvas },
        { ctx: this.overlayCtx, canvas: this.overlayCtx?.canvas },
      ];

      // requestAnimationFrame을 사용하여 레이아웃 변경 일괄 처리
      console.log("updateCanvasSizes");
      for (const item of canvasContexts) {
        if (!item.ctx || !item.canvas) continue;

        const canvas = item.canvas;

        // 캔버스의 내부 크기 설정 (물리적 픽셀)
        canvas.width = containerWidth * scaleRatio;
        canvas.height = containerHeight * scaleRatio;

        // CSS 크기 일괄 설정 (한 번의 리플로우만 발생)
        Object.assign(canvas.style, {
          width: `${containerWidth}px`,
          height: `${containerHeight}px`,
        });

        // 컨텍스트 초기화 및 한 번만 스케일링
        item.ctx.setTransform(1, 0, 0, 1, 0, 0); // 변환 초기화
        item.ctx.scale(scaleRatio, scaleRatio);
      }
    } catch (error) {
      console.error("캔버스 크기 업데이트 중 오류:", error);
    }
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

    // 임시 객체와 배열 정리
    this._tempPoint = null;
    this._tempCandle = null;
    this._tempDataArray = null;
    this._tempVolumePoint = null;
    this._tempCandleArray = null;
    this._tempMoreDataArray = null;
    this._visibleDataCache = null;
    this._tempValuePoint = null;
    this._tempPixelPoint = null;
    this._canvasSizeCache = null;

    // 캔버스 컨텍스트 참조 제거
    this.chartCtx = null;
    this.crosshairCtx = null;
    this.overlayCtx = null;

    // 성능 관리 객체 참조 제거
    this.performance = null;
  }

  // EventManager에서 호출되는 마우스 위치 업데이트 메서드
  updateMousePosition(x, y) {
    if (!this.chart || !this.crosshair) return;

    // 마우스 좌표 저장
    const mousePos = { x, y };

    // 크로스헤어 업데이트 - 정확한 메서드 호출
    this.crosshair.updatePosition(x, y);

    // // 차트 영역 확인
    // const chartArea = this.chart.chartArea;
    // if (
    //   chartArea &&
    //   x >= chartArea.left &&
    //   x <= chartArea.right &&
    //   y >= chartArea.top &&
    //   y <= chartArea.bottom
    // ) {
    //   // 가격 및 시간 값 계산
    //   const xValue = this.chart.scales.x.getValueForPixel(x);
    //   const yValue = this.chart.scales.y.getValueForPixel(y);

    //   // 추가 작업이 필요한 경우 여기에 구현
    // }
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

  // 더 많은 데이터 로드 메서드 추가
  async loadMoreData(count = 500) {
    // 이미 로딩 중이거나 API 한계에 도달한 경우 요청 방지
    if (this.isLoading || this.reachedApiLimit) {
      return;
    }

    this.isLoading = true;

    if (this.chartCtx && this.chartCtx.canvas) {
      this.uiHelper.showLoadingSpinner(this.chartCtx.canvas.parentNode);
    }

    try {
      // 가장 오래된 데이터의 타임스탬프 가져오기
      const oldestTimestamp =
        this.dataManager.size > 0 ? this.dataManager.timestamps[0] : Date.now();

      // endTime 파라미터를 사용하여 이전 데이터 요청
      const endTime = oldestTimestamp - 1; // 1ms 이전 데이터부터 요청

      // API에서 이전 데이터 가져오기
      const response = await axios.get(
        `https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=${count}&endTime=${endTime}`
      );

      // 데이터 없음 또는 기대보다 적은 데이터를 받은 경우 API 한계로 간주
      if (
        !response.data ||
        !Array.isArray(response.data) ||
        response.data.length === 0 ||
        response.data.length < count
      ) {
        this.reachedApiLimit = true; // API 한계 플래그 설정

        if (response.data.length === 0) {
          return; // 데이터가 없으면 여기서 종료
        }
      }

      // 임시 객체 생성하여 재사용
      const tempCandle = { x: 0, o: 0, h: 0, l: 0, c: 0, v: 0 };

      // 임시 배열 생성 (또는 재사용)
      if (!this._tempMoreDataArray) {
        this._tempMoreDataArray = [];
      }

      // 배열 초기화
      const formattedData = this._tempMoreDataArray;
      formattedData.length = 0;

      // API 데이터 처리
      const responseData = response.data;
      const length = responseData.length;

      for (let i = 0; i < length; i++) {
        const item = responseData[i];

        // 임시 객체 속성 업데이트
        tempCandle.x = item[0];
        tempCandle.o = parseFloat(item[1]);
        tempCandle.h = parseFloat(item[2]);
        tempCandle.l = parseFloat(item[3]);
        tempCandle.c = parseFloat(item[4]);
        tempCandle.v = parseFloat(item[5]);

        // 객체 복사하여 배열에 추가 (얕은 복사)
        formattedData.push({ ...tempCandle });
      }

      // 시간순으로 정렬 (오래된 데이터부터)
      formattedData.sort((a, b) => a.x - b.x);

      // 이전 데이터이므로 앞부분에 추가
      this.dataManager.prependCandles(formattedData);

      // earliestX 업데이트 - 새로운 한계점 설정
      if (formattedData.length > 0) {
        this.earliestX = Math.min(this.earliestX, formattedData[0].x);
      }

      // 차트 업데이트
      this.chartNeedsUpdate = true;
      this.eventHandler.subscribeChartUpdate("past-data");

      return formattedData;
    } catch (error) {
      console.error("추가 데이터 로드 중 오류:", error);
      return null;
    } finally {
      this.isLoading = false;
      this.uiHelper.hideLoadingSpinner();
    }
  }

  // 실시간 데이터 업데이트 메서드
  setupLiveDataUpdate(interval = 60000) {
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
  }

  _applyTransparency(color, opacity) {
    // 이미 rgba 형식인 경우
    if (color.startsWith("rgba")) {
      return color.replace(/[\d\.]+\)$/, `${opacity})`);
    }

    // rgb 형식인 경우
    if (color.startsWith("rgb(")) {
      return color.replace("rgb(", "rgba(").replace(")", `, ${opacity})`);
    }

    // 16진수 형식인 경우
    if (color.startsWith("#")) {
      const r = parseInt(color.slice(1, 3), 16);
      const g = parseInt(color.slice(3, 5), 16);
      const b = parseInt(color.slice(5, 7), 16);
      return `rgba(${r}, ${g}, ${b}, ${opacity})`;
    }

    // 기본 처리 (rgba 형식으로 변환)
    const rgba = color.match(/\d+/g);
    if (rgba && rgba.length >= 3) {
      return `rgba(${rgba[0]}, ${rgba[1]}, ${rgba[2]}, ${opacity})`;
    }

    // 변환할 수 없는 경우 기본값 반환
    return `rgba(68, 221, 152, ${opacity})`;
  }

  // 최대 볼륨 값을 가져오는 메서드 추가
  getMaxVolume() {
    this.maxVolume = 0;
    for (let i = 0; i < this.dataManager.size; i++) {
      if (this.dataManager.volumes[i] > this.maxVolume) {
        this.maxVolume = this.dataManager.volumes[i];
      }
    }
    // 최대값이 0이면 기본값 반환
    return this.maxVolume > 0 ? this.maxVolume : 1;
  }

  // 오버레이 렌더링 메서드 추가
  renderOverlays() {
    if (this.overlayManager) {
      this.overlayManager.updateOverlayCanvas();
    }
  }
}
