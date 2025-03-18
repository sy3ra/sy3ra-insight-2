import { tickerInstance } from "../ticker.js";
import {
  calculateSlope,
  calculateDirection,
} from "../../utilities/lineUtils.js";

export class ChartOverlayManager {
  constructor(overlayCtx, chart) {
    this.overlayCtx = overlayCtx;
    this.chart = chart;

    // 바인딩된 메서드
    this.boundUpdateOverlayCanvas = this.updateOverlayCanvas.bind(this);

    // 구독 상태
    this.isOverlaySubscribed = false;

    // 렌더링 버퍼 - 최적화를 위한 구조 개선
    this.renderBuffer = {
      // 라인 버퍼
      lines: [],
      // 수평선 버퍼
      horizontalLines: [],
      // 수직선 버퍼
      verticalLines: [],
      // 확장 라인 버퍼
      extendedLines: [],
      // 레이 버퍼
      rays: [],
      // 디버그 요소 버퍼
      debugElements: [],
    };

    //패닝중 여부
    this.isPanning = false;

    // 좌표 변환 디버깅 정보
    this.debugCoordinates = false;

    // 변경 감지를 위한 변수 추가
    this.previousOverlays = []; // null 대신 빈 배열로 초기화
    this.renderRequired = false;
    this.lastRenderTime = 0;
    this.renderThrottleMs = 8; // 약 60fps (필요시 조정)

    // 자동 구독 관리 플래그 (기본 활성화)
    this.autoManageSubscription = true;

    // 초기화 로그
    console.log("ChartOverlayManager 초기화됨", {
      chart: !!chart,
      overlayCtx: !!overlayCtx,
    });

    // 초기 구독 상태 확인 및 설정 (지연 실행)
    setTimeout(() => {
      console.log("지연된 구독 상태 초기화 실행");
      this._updateSubscriptionState();
    }, 100);
  }

  // 마우스 이벤트에서 캔버스 상대 좌표 계산
  _getCanvasCoordinates(event) {
    if (!this.overlayCtx || !this.overlayCtx.canvas) return null;

    const canvas = this.overlayCtx.canvas;
    const rect = canvas.getBoundingClientRect();

    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }

  // 오버레이 변경 감지 메서드
  _hasOverlaysChanged(currentOverlays) {
    // overlays가 null이거나 undefined인 경우 처리
    if (!currentOverlays || currentOverlays.length === 0) {
      // 이전에도 오버레이가 없었으면 변경 없음으로 처리
      return (
        this.previousOverlays !== null &&
        !(
          Array.isArray(this.previousOverlays) &&
          this.previousOverlays.length === 0
        )
      );
    }

    // 이전에 오버레이가 없었으면 변경 있음으로 처리
    if (!this.previousOverlays || !Array.isArray(this.previousOverlays)) {
      return true;
    }

    // 길이가 다른 경우
    if (currentOverlays.length !== this.previousOverlays.length) return true;

    // 내용 비교 (간단한 비교)
    for (let i = 0; i < currentOverlays.length; i++) {
      const curr = currentOverlays[i];
      const prev = this.previousOverlays[i];

      if (!curr || !prev) return true;

      // 주요 속성 비교
      if (curr.lineType !== prev.lineType) return true;
      if (curr.startX !== prev.startX || curr.startY !== prev.startY)
        return true;
      if (curr.endX !== prev.endX || curr.endY !== prev.endY) return true;
    }

    return false;
  }

  // 캔버스 좌표를 데이터 좌표로 변환
  _getDataCoordinates(canvasX, canvasY) {
    if (!this.chart || !this.chart.scales) return null;

    const xScale = this.chart.scales.x;
    const yScale = this.chart.scales.y;

    if (!xScale || !yScale) return null;

    return {
      x: xScale.getValueForPixel(canvasX),
      y: yScale.getValueForPixel(canvasY),
    };
  }

  // 데이터 좌표를 캔버스 픽셀 좌표로 변환
  _getPixelCoordinates(dataX, dataY) {
    if (!this.chart || !this.chart.scales) return null;

    const xScale = this.chart.scales.x;
    const yScale = this.chart.scales.y;
    const chartArea = this.chart.chartArea;

    if (!xScale || !yScale) return null;

    // 데이터 좌표를 픽셀로 변환
    const pixelX = xScale.getPixelForValue(dataX);
    const pixelY = yScale.getPixelForValue(dataY);

    // 차트 영역 경계 내에 있는지 확인
    const isInsideChartArea =
      pixelX >= chartArea.left &&
      pixelX <= chartArea.right &&
      pixelY >= chartArea.top &&
      pixelY <= chartArea.bottom;

    // // 디버깅 로그
    // if (this.debugCoordinates) {
    //   console.log("좌표 변환 (데이터→픽셀):", {
    //     데이터: { x: dataX, y: dataY },
    //     픽셀: { x: pixelX, y: pixelY },
    //     차트영역: chartArea,
    //     영역내부: isInsideChartArea,
    //   });
    // }

    return {
      x: pixelX,
      y: pixelY,
      isInsideChartArea,
    };
  }

  // 마우스 이벤트를 데이터 좌표로 직접 변환 (통합 메서드)
  convertMouseToDataCoordinates(event) {
    const canvasCoords = this._getCanvasCoordinates(event);
    if (!canvasCoords) return null;

    const dataCoords = this._getDataCoordinates(canvasCoords.x, canvasCoords.y);
    if (!dataCoords) return null;

    // 차트 영역 내부인지 확인
    const chartArea = this.chart.chartArea;
    const isInChartArea =
      canvasCoords.x >= chartArea.left &&
      canvasCoords.x <= chartArea.right &&
      canvasCoords.y >= chartArea.top &&
      canvasCoords.y <= chartArea.bottom;

    // 디버깅 정보 출력
    if (this.debugCoordinates) {
      // console.log("좌표 변환:", {
      //   마우스: { clientX: event.clientX, clientY: event.clientY },
      //   캔버스: canvasCoords,
      //   데이터: dataCoords,
      //   차트영역내부: isInChartArea,
      // });

      // 변환 정확도 테스트 (데이터 → 픽셀 → 데이터)
      const backToPixel = this._getPixelCoordinates(dataCoords.x, dataCoords.y);
      console.log("변환 정확도 테스트:", {
        원본캔버스좌표: canvasCoords,
        다시변환된캔버스좌표: backToPixel,
        오차: {
          x: canvasCoords.x - backToPixel.x,
          y: canvasCoords.y - backToPixel.y,
        },
      });
    }

    return {
      dataX: dataCoords.x,
      dataY: dataCoords.y,
      canvasX: canvasCoords.x,
      canvasY: canvasCoords.y,
      isInChartArea,
    };
  }

  // 디버깅 좌표 표시 토글
  toggleCoordinateDebug(enabled = true) {
    this.debugCoordinates = enabled;
    console.log(`좌표 디버깅 ${enabled ? "활성화" : "비활성화"}`);

    if (enabled) {
      // 디버깅 모드 활성화 시 마우스 이벤트 리스너 추가
      this._setupDebugMouseTracking();

      // 차트 영역 시각화
      this.visualizeChartArea();
    } else {
      // 디버깅 모드 비활성화 시 마우스 이벤트 리스너 제거
      this._removeDebugMouseTracking();
    }
  }

  // 디버깅용 마우스 추적 설정
  _setupDebugMouseTracking() {
    if (!this.overlayCtx || !this.overlayCtx.canvas) return;

    // 이미 설정되어 있으면 중복 설정 방지
    if (this._debugMouseMoveHandler) return;

    // 마우스 이동 핸들러 생성 및 바인딩
    this._debugMouseMoveHandler = this._handleDebugMouseMove.bind(this);

    // 캔버스에 마우스 이벤트 리스너 추가
    this.overlayCtx.canvas.addEventListener(
      "mousemove",
      this._debugMouseMoveHandler
    );

    console.log("디버깅 마우스 추적 활성화");
  }

  // 디버깅용 마우스 추적 제거
  _removeDebugMouseTracking() {
    if (
      !this.overlayCtx ||
      !this.overlayCtx.canvas ||
      !this._debugMouseMoveHandler
    )
      return;

    // 캔버스에서 마우스 이벤트 리스너 제거
    this.overlayCtx.canvas.removeEventListener(
      "mousemove",
      this._debugMouseMoveHandler
    );

    // 핸들러 참조 제거
    this._debugMouseMoveHandler = null;

    console.log("디버깅 마우스 추적 비활성화");
  }

  // 디버깅용 마우스 이동 핸들러
  _handleDebugMouseMove(event) {
    if (!this.overlayCtx || !this.chart) return;

    // 마우스 좌표를 데이터 좌표로 변환
    const coords = this.convertMouseToDataCoordinates(event);
    if (!coords) return;

    // 마우스 이벤트 정보 추가
    coords.clientX = event.clientX;
    coords.clientY = event.clientY;

    // 다음 프레임에서 오버레이 업데이트 시 디버그 정보 표시를 위해 저장
    this._lastDebugMouseCoords = coords;

    // 디버그 정보 표시
    this._drawDebugCoordinateInfo(coords);
  }

  // 디버깅 좌표 정보 표시
  _drawDebugCoordinateInfo(coords) {
    if (!this.overlayCtx || !this.chart) return;

    const ctx = this.overlayCtx;
    const chartArea = this.chart.chartArea;

    // 임시 캔버스 생성 (기존 오버레이를 지우지 않고 디버그 정보만 업데이트)
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = ctx.canvas.width;
    tempCanvas.height = ctx.canvas.height;
    const tempCtx = tempCanvas.getContext("2d");

    // 배경 그리기
    tempCtx.fillStyle = "rgba(0, 0, 0, 0.7)";
    tempCtx.fillRect(10, 10, 250, 120);

    // 텍스트 정보 표시
    tempCtx.fillStyle = "white";
    tempCtx.font = "12px monospace";
    tempCtx.fillText(
      `마우스: (${coords.clientX || "?"}, ${coords.clientY || "?"})`,
      20,
      30
    );
    tempCtx.fillText(
      `캔버스: (${coords.canvasX.toFixed(1)}, ${coords.canvasY.toFixed(1)})`,
      20,
      50
    );
    tempCtx.fillText(
      `데이터: (${coords.dataX.toFixed(4)}, ${coords.dataY.toFixed(4)})`,
      20,
      70
    );
    tempCtx.fillText(`차트영역 내부: ${coords.isInChartArea}`, 20, 90);

    // 차트 영역 표시
    tempCtx.strokeStyle = "rgba(255, 0, 0, 0.5)";
    tempCtx.lineWidth = 1;
    tempCtx.setLineDash([5, 5]);
    tempCtx.strokeRect(
      chartArea.left,
      chartArea.top,
      chartArea.right - chartArea.left,
      chartArea.bottom - chartArea.top
    );

    // 마우스 위치 표시 (십자선)
    tempCtx.strokeStyle = "rgba(0, 255, 0, 0.8)";
    tempCtx.lineWidth = 1;
    tempCtx.setLineDash([]);

    // 수평선
    tempCtx.beginPath();
    tempCtx.moveTo(chartArea.left, coords.canvasY);
    tempCtx.lineTo(chartArea.right, coords.canvasY);
    tempCtx.stroke();

    // 수직선
    tempCtx.beginPath();
    tempCtx.moveTo(coords.canvasX, chartArea.top);
    tempCtx.lineTo(coords.canvasX, chartArea.bottom);
    tempCtx.stroke();

    // 마우스 포인트 표시
    tempCtx.fillStyle = "yellow";
    tempCtx.beginPath();
    tempCtx.arc(coords.canvasX, coords.canvasY, 5, 0, Math.PI * 2);
    tempCtx.fill();

    // 임시 캔버스 내용을 오버레이 캔버스에 복사
    ctx.drawImage(tempCanvas, 0, 0);
  }

  // 오버레이 업데이트 구독
  subscribeOverlayUpdate(forceSubscribe = false) {
    // 이미 구독 중이고 강제 구독 아닌 경우 무시
    if (this.isOverlaySubscribed && !forceSubscribe) {
      return;
    }

    // 구독 중이면 먼저 구독 해제 (중복 방지)
    if (this.isOverlaySubscribed) {
      this.unsubscribeOverlayUpdate();
    }

    // 디버그 로그 추가
    console.log("오버레이 구독 시도:", {
      throttleMs: this.renderThrottleMs,
      chart: !!this.chart,
      overlayCtx: !!this.overlayCtx,
    });

    tickerInstance.subscribe(this.boundUpdateOverlayCanvas, {
      throttleMs: this.renderThrottleMs, // 스로틀링 적용
      eventType: "chartOverlay", // 고유한 이벤트 타입 사용
    });
    this.isOverlaySubscribed = true;

    // 디버그 모드에서만 로그 출력
    if (this.debugCoordinates) {
      console.log(
        "오버레이 업데이트 구독됨 (스로틀링:",
        this.renderThrottleMs,
        "ms)"
      );
    }
  }

  // 오버레이 업데이트 구독 해제
  unsubscribeOverlayUpdate() {
    if (this.isOverlaySubscribed) {
      // 디버그 로그 추가
      console.log("오버레이 구독 해제 시도");

      tickerInstance.unsubscribe(this.boundUpdateOverlayCanvas);
      this.isOverlaySubscribed = false;

      // 디버그 모드에서만 로그 출력
      if (this.debugCoordinates) {
        console.log("오버레이 업데이트 구독 해제됨");
      }
    }
  }
  // 오버레이 직접 패닝 메서드
  panOverlays(deltaX, deltaY) {
    if (!this.overlayCtx) return;

    // 패닝 시작 플래그 설정
    this.isPanning = true;

    // 차트 스케일 정보 가져오기
    const xScale = this.chart.scales.x;
    const yScale = this.chart.scales.y;

    // 픽셀당 데이터 비율 계산 (스케일 변환 계수)
    const xPixelRange = xScale.right - xScale.left;
    const yPixelRange = yScale.bottom - yScale.top;
    const xDataRange = xScale.max - xScale.min;
    const yDataRange = yScale.max - yScale.min;

    // 변환 계수가 0이 되는 경우를 방지
    if (xPixelRange === 0 || yPixelRange === 0) return;

    // 현재 차트 영역 저장
    this.lastPanTranslate = { x: deltaX, y: deltaY };

    // 캔버스 초기화 (전체 지우기)
    this.clearOverlayCanvas(true);

    // 패닝 시 사용할 임시 변환 행렬
    this.overlayCtx.save();
    this.overlayCtx.translate(deltaX, deltaY);

    // 버퍼의 항목들 렌더링 (기존 위치에서 deltaX, deltaY만큼 이동)
    this._renderBufferedItems();

    this.overlayCtx.restore();
  }

  // 오버레이 캔버스 업데이트
  updateOverlayCanvas() {
    try {
      // 디버그 로그 추가 (호출 확인용)
      // console.log("updateOverlayCanvas 호출됨", timestamp);

      const overlays = window.mainCanvas?.getOverlaysArray?.() || [];
      // const currentTime = performance.now();

      // 스케일 변경 감지 (기존 메서드 호출)
      const scaleChanged = this._checkChartScaleChanges();

      // 오버레이 변경 감지
      const overlaysChanged = this._hasOverlaysChanged(overlays);

      // 여기서 중요한 변경: overlays가 빈 배열이고 이전 상태도 빈 배열이었다면
      // 렌더링이 필요하지 않음을 명시적으로 처리
      if (
        overlays.length === 0 &&
        Array.isArray(this.previousOverlays) &&
        this.previousOverlays.length === 0
      ) {
        // 자동 구독 관리 수행 (로그 출력 없이)
        if (this.autoManageSubscription) {
          this._updateSubscriptionState();
        }
        return;
      }

      // // // 렌더링 필요 여부 결정
      // const timeThresholdMet =
      //   currentTime - this.lastRenderTime >= this.renderThrottleMs;
      const renderNeeded = scaleChanged || overlaysChanged;
      // const renderNeeded = true;

      // 변경이 감지되지 않으면 불필요한 렌더링 스킵
      if (!renderNeeded) {
        // 디버깅 모드일 때만 마우스 좌표 정보 업데이트
        // if (this.debugCoordinates && this._lastDebugMouseCoords) {
        //   this._drawDebugCoordinateInfo(this._lastDebugMouseCoords);
        // }

        // 자동 구독 관리 수행 (통합된 방식으로)
        if (
          this.autoManageSubscription &&
          (!overlays || overlays.length === 0)
        ) {
          this._updateSubscriptionState();
        }

        return;
      }

      // // 디버그 모드에서만 로그 출력
      // if (this.debugCoordinates) {
      //   console.log("오버레이 업데이트 수행:", {
      //     스케일변경: scaleChanged,
      //     오버레이변경: overlaysChanged,
      //     // 마지막렌더링이후: currentTime - this.lastRenderTime + "ms",
      //   });
      // }

      //오버레이 패닝 translate 구현

      // 렌더링 버퍼 초기화
      this._clearRenderBuffer();

      if (overlays && overlays.length > 0) {
        // 오버레이 처리 (버퍼에 추가)
        this._processOverlays(overlays);

        // 버퍼에 있는 모든 항목 한 번에 렌더링
        this._renderBufferedItems();
        console.log("렌더링 완료 123");
        // 현재 오버레이 상태 저장 (깊은 복사)
        this.previousOverlays = JSON.parse(JSON.stringify(overlays));

        // 디버그 모드에서만 로그 출력
        if (this.debugCoordinates) {
          console.log("오버레이 그리기 완료");
        }
      } else {
        this.clearOverlayCanvas(true);
        // null 대신 빈 배열로 설정하여 일관성 유지
        this.previousOverlays = [];

        // 디버그 모드에서만 로그 출력
        if (this.debugCoordinates) {
          console.log("오버레이 없음, 캔버스 클리어됨");
        }

        // 자동 구독 관리 수행
        if (this.autoManageSubscription) {
          this._updateSubscriptionState();
        }
      }

      // 렌더링 시간 기록 및 플래그 초기화
      // this.lastRenderTime = currentTime;
      // this.renderRequired = false;

      // 디버깅 모드일 때 마지막 마우스 좌표 정보 표시
      if (this.debugCoordinates && this._lastDebugMouseCoords) {
        this._drawDebugCoordinateInfo(this._lastDebugMouseCoords);
      }
    } catch (error) {
      console.error("오버레이 업데이트 중 오류:", error);
    }
  }

  // 렌더링 버퍼 초기화
  _clearRenderBuffer() {
    // console.log("buffer clear", this.renderBuffer);
    this.renderBuffer.lines = [];
    this.renderBuffer.horizontalLines = [];
    this.renderBuffer.verticalLines = [];
    this.renderBuffer.extendedLines = [];
    this.renderBuffer.rays = [];
    this.renderBuffer.debugElements = [];
  }

  // 차트 스케일 변경 감지
  _checkChartScaleChanges() {
    if (!this.chart || !this.chart.scales) return false;

    const xScale = this.chart.scales.x;
    const yScale = this.chart.scales.y;

    // 이전 스케일 정보가 없으면 현재 스케일 저장
    if (!this._prevScales) {
      this._prevScales = {
        xMin: xScale.min,
        xMax: xScale.max,
        yMin: yScale.min,
        yMax: yScale.max,
      };
      return true; // 초기 설정은 변경으로 간주
    }

    // 스케일 변경 감지
    const isScaleChanged =
      this._prevScales.xMin !== xScale.min ||
      this._prevScales.xMax !== xScale.max ||
      this._prevScales.yMin !== yScale.min ||
      this._prevScales.yMax !== yScale.max;

    if (isScaleChanged) {
      // 디버그 모드에서만 로그 출력
      if (this.debugCoordinates) {
        // console.log("차트 스케일 변경 감지:", {
        //   이전: this._prevScales,
        //   현재: {
        //     xMin: xScale.min,
        //     xMax: xScale.max,
        //     yMin: yScale.min,
        //     yMax: yScale.max,
        //   },
        // });
      }

      // 현재 스케일 정보 업데이트
      this._prevScales = {
        xMin: xScale.min,
        xMax: xScale.max,
        yMin: yScale.min,
        yMax: yScale.max,
      };
    }

    return isScaleChanged;
  }

  // 오버레이 처리 (버퍼에 추가)
  _processOverlays(overlays) {
    if (!this.isValidOverlaysArray(overlays)) {
      console.warn("유효하지 않은 오버레이 배열:", overlays);
      return;
    }

    // 캔버스 클리어
    this.clearOverlayCanvas(true);

    // 디버그 모드에서만 로그 출력
    if (this.debugCoordinates) {
      console.log(`${overlays.length}개의 오버레이 처리 시작`);
    }

    // 각 오버레이를 개별적으로 처리하여 버퍼에 추가
    for (let i = 0; i < overlays.length; i++) {
      const overlay = overlays[i];
      if (!overlay) continue;

      // 오버레이 데이터 유효성 검사
      if (!this._isValidOverlayData(overlay)) {
        console.warn(`오버레이 #${i}의 데이터가 유효하지 않습니다:`, overlay);
        continue;
      }

      // 디버깅 정보 출력
      if (this.debugCoordinates) {
        const startPixel = this._getPixelCoordinates(
          overlay.startX,
          overlay.startY
        );
        const endPixel = this._getPixelCoordinates(overlay.endX, overlay.endY);

        // console.log(`오버레이 #${i} 좌표 변환:`, {
        //   데이터좌표: {
        //     시작: { x: overlay.startX, y: overlay.startY },
        //     끝: { x: overlay.endX, y: overlay.endY },
        //   },
        //   픽셀좌표: {
        //     시작: startPixel,
        //     끝: endPixel,
        //   },
        //   타입: overlay.lineType,
        // });
      }

      // 오버레이 타입별 처리 (버퍼에 추가)
      const style = { lineWidth: 2, strokeStyle: "#ffffff" };

      switch (overlay.lineType) {
        case "Line":
          this._addLineToBuffer(
            overlay.startX,
            overlay.startY,
            overlay.endX,
            overlay.endY,
            style
          );
          break;
        case "ExtendedLine":
          this._addExtendedLineToBuffer(
            overlay.startX,
            overlay.startY,
            overlay.endX,
            overlay.endY,
            style
          );
          break;
        case "Ray":
          this._addRayToBuffer(
            overlay.startX,
            overlay.startY,
            overlay.endX,
            overlay.endY,
            style
          );
          break;
        case "HorizontalLine":
          this._addHorizontalLineToBuffer(overlay.startY, style);
          break;
        case "VerticalLine":
          this._addVerticalLineToBuffer(overlay.startX, style);
          break;
        default:
          console.warn(`알 수 없는 라인 타입: ${overlay.lineType}`);
          this._addLineToBuffer(
            overlay.startX,
            overlay.startY,
            overlay.endX,
            overlay.endY,
            style
          );
      }
    }

    // 디버깅 모드일 때 차트 영역 표시를 버퍼에 추가
    if (this.debugCoordinates && this.chart?.chartArea) {
      const chartArea = this.chart.chartArea;
      this.renderBuffer.debugElements.push({
        type: "chartArea",
        chartArea,
        style: {
          strokeStyle: "rgba(255, 0, 0, 0.5)",
          lineWidth: 1,
          lineDash: [5, 5],
        },
      });
    }
  }

  // 라인을 버퍼에 추가
  _addLineToBuffer(startX, startY, endX, endY, style) {
    if (!this.chart) return;

    // 데이터 좌표를 픽셀 좌표로 변환
    const startPixel = this._getPixelCoordinates(startX, startY);
    const endPixel = this._getPixelCoordinates(endX, endY);

    if (!startPixel || !endPixel) return;

    // 버퍼에 라인 정보 추가
    this.renderBuffer.lines.push({
      startPixelX: startPixel.x,
      startPixelY: startPixel.y,
      endPixelX: endPixel.x,
      endPixelY: endPixel.y,
      style: { ...style },
    });

    if (this.debugCoordinates) {
      console.log("라인 버퍼에 추가:", {
        데이터좌표: { startX, startY, endX, endY },
        픽셀좌표: {
          시작: { x: startPixel.x, y: startPixel.y },
          끝: { x: endPixel.x, y: endPixel.y },
        },
      });
    }
  }

  // 수평선을 버퍼에 추가
  _addHorizontalLineToBuffer(y, style) {
    if (!this.chart) return;

    const yScale = this.chart.scales.y;
    const chartArea = this.getChartAreaInfo() || this.chart.chartArea;

    // 데이터 y 좌표를 픽셀 좌표로 변환
    const pixelY = yScale.getPixelForValue(y);

    // 버퍼에 수평선 정보 추가
    this.renderBuffer.horizontalLines.push({
      pixelY,
      left: chartArea.left,
      right: chartArea.right,
      style: { ...style },
    });

    if (this.debugCoordinates) {
      console.log("수평선 버퍼에 추가:", {
        데이터좌표: { y },
        픽셀좌표: { pixelY },
        차트영역: { left: chartArea.left, right: chartArea.right },
      });
    }
  }

  // 수직선을 버퍼에 추가
  _addVerticalLineToBuffer(x, style) {
    if (!this.chart) return;

    const xScale = this.chart.scales.x;
    const chartArea = this.getChartAreaInfo() || this.chart.chartArea;

    // 데이터 x 좌표를 픽셀 좌표로 변환
    const pixelX = xScale.getPixelForValue(x);

    // 버퍼에 수직선 정보 추가
    this.renderBuffer.verticalLines.push({
      pixelX,
      top: chartArea.top,
      bottom: chartArea.bottom,
      style: { ...style },
    });

    if (this.debugCoordinates) {
      console.log("수직선 버퍼에 추가:", {
        데이터좌표: { x },
        픽셀좌표: { pixelX },
        차트영역: { top: chartArea.top, bottom: chartArea.bottom },
      });
    }
  }

  // 확장 라인을 버퍼에 추가
  _addExtendedLineToBuffer(startX, startY, endX, endY, style) {
    if (!this.chart) return;

    // 데이터 좌표를 픽셀 좌표로 변환
    const startPixel = this._getPixelCoordinates(startX, startY);
    const endPixel = this._getPixelCoordinates(endX, endY);

    if (!startPixel || !endPixel) return;

    const chartArea = this.getChartAreaInfo() || this.chart.chartArea;

    // 선의 기울기 계산
    const slope = calculateSlope(
      startPixel.x,
      startPixel.y,
      endPixel.x,
      endPixel.y
    );
    const direction = calculateDirection(
      startPixel.x,
      startPixel.y,
      endPixel.x,
      endPixel.y
    );

    // 차트 영역 경계까지 확장된 선의 끝점 계산
    const extendedPoints = this._calculateExtendedLinePoints(
      startPixel.x,
      startPixel.y,
      endPixel.x,
      endPixel.y,
      slope,
      direction,
      chartArea
    );

    // 버퍼에 확장 라인 정보 추가
    this.renderBuffer.extendedLines.push({
      startPixelX: startPixel.x,
      startPixelY: startPixel.y,
      endPixelX: endPixel.x,
      endPixelY: endPixel.y,
      extendedPoints,
      style: { ...style },
    });

    if (this.debugCoordinates) {
      console.log("확장 라인 버퍼에 추가:", {
        데이터좌표: { startX, startY, endX, endY },
        픽셀좌표: {
          시작: { x: startPixel.x, y: startPixel.y },
          끝: { x: endPixel.x, y: endPixel.y },
        },
        확장점: extendedPoints,
      });
    }
  }

  // 레이를 버퍼에 추가
  _addRayToBuffer(startX, startY, endX, endY, style) {
    if (!this.chart) return;

    // 데이터 좌표를 픽셀 좌표로 변환
    const startPixel = this._getPixelCoordinates(startX, startY);
    const endPixel = this._getPixelCoordinates(endX, endY);

    if (!startPixel || !endPixel) return;

    const chartArea = this.getChartAreaInfo() || this.chart.chartArea;

    // 선의 기울기 계산
    const slope = calculateSlope(
      startPixel.x,
      startPixel.y,
      endPixel.x,
      endPixel.y
    );
    const direction = calculateDirection(
      startPixel.x,
      startPixel.y,
      endPixel.x,
      endPixel.y
    );

    // 차트 영역 경계까지 확장된 선의 끝점 계산
    const extendedEnd = this._calculateRayEndPoint(
      startPixel.x,
      startPixel.y,
      endPixel.x,
      endPixel.y,
      slope,
      direction,
      chartArea
    );

    // 버퍼에 레이 정보 추가
    this.renderBuffer.rays.push({
      startPixelX: startPixel.x,
      startPixelY: startPixel.y,
      endPixelX: endPixel.x,
      endPixelY: endPixel.y,
      extendedEnd,
      style: { ...style },
    });

    if (this.debugCoordinates) {
      console.log("레이 버퍼에 추가:", {
        데이터좌표: { startX, startY, endX, endY },
        픽셀좌표: {
          시작: {
            x: startPixel.x,
            y: startPixel.y,
            영역내부: startPixel.isInsideChartArea,
          },
          끝: {
            x: endPixel.x,
            y: endPixel.y,
            영역내부: endPixel.isInsideChartArea,
          },
        },
        확장끝점: extendedEnd,
      });
    }
  }

  // 오버레이 데이터 유효성 검사
  _isValidOverlayData(overlay) {
    // 기본 필드 검사
    if (!overlay || typeof overlay !== "object") return false;

    // 라인 타입 검사
    if (!overlay.lineType) return false;

    // 좌표 검사 (타입별로 다름)
    switch (overlay.lineType) {
      case "HorizontalLine":
        return typeof overlay.startY !== "undefined";
      case "VerticalLine":
        return typeof overlay.startX !== "undefined";
      default:
        return (
          typeof overlay.startX !== "undefined" &&
          typeof overlay.startY !== "undefined" &&
          typeof overlay.endX !== "undefined" &&
          typeof overlay.endY !== "undefined"
        );
    }
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

  // 확장된 선의 끝점 계산 유틸리티
  _calculateExtendedLinePoints(x1, y1, x2, y2, slope, direction, chartArea) {
    // 차트 영역 경계
    const { left, right, top, bottom } = chartArea;

    // 결과 객체 초기화
    const result = {
      start: { x: x1, y: y1 },
      end: { x: x2, y: y2 },
    };

    // 수평선인 경우
    if (slope === 0) {
      result.start.x = left;
      result.end.x = right;
      return result;
    }

    // 수직선인 경우
    if (!isFinite(slope)) {
      result.start.y = top;
      result.end.y = bottom;
      return result;
    }

    // 일반적인 경우: 차트 영역 경계와의 교차점 계산
    // 왼쪽 경계와의 교차점
    const leftY = y1 + slope * (left - x1);
    // 오른쪽 경계와의 교차점
    const rightY = y1 + slope * (right - x1);
    // 위쪽 경계와의 교차점
    const topX = x1 + (top - y1) / slope;
    // 아래쪽 경계와의 교차점
    const bottomX = x1 + (bottom - y1) / slope;

    // 교차점들 중 차트 영역 내에 있는 것들을 찾아 시작점과 끝점 결정
    const intersections = [];

    if (leftY >= top && leftY <= bottom) {
      intersections.push({ x: left, y: leftY });
    }

    if (rightY >= top && rightY <= bottom) {
      intersections.push({ x: right, y: rightY });
    }

    if (topX >= left && topX <= right) {
      intersections.push({ x: topX, y: top });
    }

    if (bottomX >= left && bottomX <= right) {
      intersections.push({ x: bottomX, y: bottom });
    }

    // 교차점이 2개 이상이면 확장된 선의 시작점과 끝점으로 사용
    if (intersections.length >= 2) {
      result.start = intersections[0];
      result.end = intersections[1];
    }

    return result;
  }

  // 레이의 끝점 계산 유틸리티
  _calculateRayEndPoint(x1, y1, x2, y2, slope, direction, chartArea) {
    // 차트 영역 경계
    const { left, right, top, bottom } = chartArea;

    // 수평선인 경우
    if (slope === 0) {
      return direction > 0 ? { x: right, y: y1 } : { x: left, y: y1 };
    }

    // 수직선인 경우
    if (!isFinite(slope)) {
      return direction > 0 ? { x: x1, y: bottom } : { x: x1, y: top };
    }

    // 일반적인 경우: 차트 영역 경계와의 교차점 계산
    // 왼쪽 경계와의 교차점
    const leftY = y1 + slope * (left - x1);
    // 오른쪽 경계와의 교차점
    const rightY = y1 + slope * (right - x1);
    // 위쪽 경계와의 교차점
    const topX = x1 + (top - y1) / slope;
    // 아래쪽 경계와의 교차점
    const bottomX = x1 + (bottom - y1) / slope;

    // 방향에 따라 적절한 교차점 선택
    if (direction > 0) {
      // 오른쪽/아래쪽 방향
      if (x2 > x1) {
        // 오른쪽 경계와의 교차점이 차트 영역 내에 있으면 사용
        if (rightY >= top && rightY <= bottom) {
          return { x: right, y: rightY };
        }
        // 아래쪽 경계와의 교차점이 차트 영역 내에 있으면 사용
        if (bottomX >= left && bottomX <= right) {
          return { x: bottomX, y: bottom };
        }
      } else {
        // 왼쪽 경계와의 교차점이 차트 영역 내에 있으면 사용
        if (leftY >= top && leftY <= bottom) {
          return { x: left, y: leftY };
        }
        // 아래쪽 경계와의 교차점이 차트 영역 내에 있으면 사용
        if (bottomX >= left && bottomX <= right) {
          return { x: bottomX, y: bottom };
        }
      }
    } else {
      // 왼쪽/위쪽 방향
      if (x2 < x1) {
        // 왼쪽 경계와의 교차점이 차트 영역 내에 있으면 사용
        if (leftY >= top && leftY <= bottom) {
          return { x: left, y: leftY };
        }
        // 위쪽 경계와의 교차점이 차트 영역 내에 있으면 사용
        if (topX >= left && topX <= right) {
          return { x: topX, y: top };
        }
      } else {
        // 오른쪽 경계와의 교차점이 차트 영역 내에 있으면 사용
        if (rightY >= top && rightY <= bottom) {
          return { x: right, y: rightY };
        }
        // 위쪽 경계와의 교차점이 차트 영역 내에 있으면 사용
        if (topX >= left && topX <= right) {
          return { x: topX, y: top };
        }
      }
    }

    // 기본값으로 원래 끝점 반환
    return { x: x2, y: y2 };
  }

  // 차트 영역 시각화
  visualizeChartArea() {
    if (!this.overlayCtx || !this.chart) return;

    // 차트 영역 정보를 버퍼에 추가
    const chartArea = this.chart.chartArea;
    this.renderBuffer.debugElements.push({
      type: "chartArea",
      chartArea,
      style: {
        strokeStyle: "rgba(255, 0, 0, 0.7)",
        lineWidth: 2,
        lineDash: [5, 5],
      },
    });

    // 차트 영역 정보 텍스트를 버퍼에 추가
    this.renderBuffer.debugElements.push({
      type: "chartAreaText",
      chartArea,
      text: `차트영역: (${Math.round(chartArea.left)},${Math.round(
        chartArea.top
      )}) - (${Math.round(chartArea.right)},${Math.round(chartArea.bottom)})`,
      style: {
        fillStyle: "rgba(255, 0, 0, 0.9)",
        font: "12px Arial",
      },
    });

    // 좌표계 축을 버퍼에 추가
    this.renderBuffer.debugElements.push({
      type: "xAxis",
      chartArea,
      style: {
        strokeStyle: "rgba(0, 255, 0, 0.5)",
        lineWidth: 1,
      },
    });

    this.renderBuffer.debugElements.push({
      type: "yAxis",
      chartArea,
      style: {
        strokeStyle: "rgba(0, 255, 0, 0.5)",
        lineWidth: 1,
      },
    });

    // 버퍼에 있는 모든 항목 한 번에 렌더링
    this._renderBufferedItems();

    console.log("차트 영역 시각화 완료:", chartArea);
  }

  // 리소스 해제
  dispose() {
    this.unsubscribeOverlayUpdate();

    // 디버깅 마우스 추적 제거
    if (this._debugMouseMoveHandler) {
      this._removeDebugMouseTracking();
    }

    // 렌더링 버퍼 초기화
    this._clearRenderBuffer();

    // 변경 감지 관련 리소스 정리
    this.previousOverlays = null;
    this.renderRequired = false;

    // 자동 구독 관리 비활성화
    this.autoManageSubscription = false;

    // 참조 해제
    this.renderBuffer = null;
    this._prevScales = null;
    this._customChartAreaInfo = null;
    this._lastDebugMouseCoords = null;

    console.log("ChartOverlayManager 리소스 해제 완료");
  }

  // 차트 영역 정보 설정
  setChartAreaInfo(chartAreaInfo) {
    if (!chartAreaInfo) return;

    this._customChartAreaInfo = chartAreaInfo;

    console.log("차트 영역 정보 설정됨:", chartAreaInfo);

    // 디버깅 모드일 때 차트 영역 시각화
    if (this.debugCoordinates) {
      this.visualizeChartArea();
    }
  }

  // 차트 영역 정보 가져오기 (커스텀 정보 또는 차트에서 직접 가져오기)
  getChartAreaInfo() {
    // 커스텀 차트 영역 정보가 있으면 사용
    if (this._customChartAreaInfo) {
      return this._customChartAreaInfo;
    }

    // 차트에서 직접 가져오기
    if (this.chart && this.chart.chartArea) {
      const chartArea = this.chart.chartArea;
      return {
        left: chartArea.left,
        right: chartArea.right,
        top: chartArea.top,
        bottom: chartArea.bottom,
        width: chartArea.right - chartArea.left,
        height: chartArea.bottom - chartArea.top,
      };
    }

    // 기본값 반환
    return null;
  }

  // 다양한 드로잉 타입을 지원하는 메서드 추가
  addLine(startX, startY, endX, endY, style = {}) {
    // 기본 스타일 설정
    const defaultStyle = {
      lineWidth: 2,
      strokeStyle: "#ffffff",
      ...style,
    };

    console.log("선 추가:", {
      startX,
      startY,
      endX,
      endY,
      스타일: defaultStyle,
    });

    // 오버레이 배열에 추가 (데이터 좌표로 저장)
    if (
      window.mainCanvas &&
      typeof window.mainCanvas.storeOverlay === "function"
    ) {
      window.mainCanvas.storeOverlay(startX, startY, endX, endY, "Line");
    }

    // 버퍼에 추가 (데이터 좌표 전달)
    this._addLineToBuffer(startX, startY, endX, endY, defaultStyle);

    // 렌더링 요청
    this.requestRender();

    // 자동 구독 관리
    this._updateSubscriptionState();

    // 즉시 렌더링 (필요한 경우)
    this._renderBufferedItems();
  }

  addExtendedLine(startX, startY, endX, endY, style = {}) {
    // 기본 스타일 설정
    const defaultStyle = {
      lineWidth: 2,
      strokeStyle: "#ffffff",
      ...style,
    };

    console.log("확장 선 추가:", {
      startX,
      startY,
      endX,
      endY,
      스타일: defaultStyle,
    });

    // 오버레이 배열에 추가 (데이터 좌표로 저장)
    if (
      window.mainCanvas &&
      typeof window.mainCanvas.storeOverlay === "function"
    ) {
      window.mainCanvas.storeOverlay(
        startX,
        startY,
        endX,
        endY,
        "ExtendedLine"
      );
    }

    // 버퍼에 추가 (데이터 좌표 전달)
    this._addExtendedLineToBuffer(startX, startY, endX, endY, defaultStyle);

    // 렌더링 요청
    this.requestRender();

    // 자동 구독 관리
    this._updateSubscriptionState();

    // 즉시 렌더링 (필요한 경우)
    this._renderBufferedItems();
  }

  addRay(startX, startY, endX, endY, style = {}) {
    // 기본 스타일 설정
    const defaultStyle = {
      lineWidth: 2,
      strokeStyle: "#ffffff",
      ...style,
    };

    console.log("레이 추가:", {
      startX,
      startY,
      endX,
      endY,
      스타일: defaultStyle,
    });

    // 오버레이 배열에 추가 (데이터 좌표로 저장)
    if (
      window.mainCanvas &&
      typeof window.mainCanvas.storeOverlay === "function"
    ) {
      window.mainCanvas.storeOverlay(startX, startY, endX, endY, "Ray");
    }

    // 버퍼에 추가 (데이터 좌표 전달)
    this._addRayToBuffer(startX, startY, endX, endY, defaultStyle);

    // 렌더링 요청
    this.requestRender();

    // 자동 구독 관리
    this._updateSubscriptionState();

    // 즉시 렌더링 (필요한 경우)
    this._renderBufferedItems();
  }

  addHorizontalLine(y, style = {}) {
    // 기본 스타일 설정
    const defaultStyle = {
      lineWidth: 2,
      strokeStyle: "#ffffff",
      ...style,
    };

    console.log("수평선 추가:", { y, 스타일: defaultStyle });

    // 차트 영역 가져오기
    const chartArea = this.chart.chartArea;
    const startX = this.chart.scales.x.min;
    const endX = this.chart.scales.x.max;

    // 오버레이 배열에 추가 (데이터 좌표로 저장)
    if (
      window.mainCanvas &&
      typeof window.mainCanvas.storeOverlay === "function"
    ) {
      window.mainCanvas.storeOverlay(startX, y, endX, y, "HorizontalLine");
    }

    // 버퍼에 추가 (데이터 좌표 전달)
    this._addHorizontalLineToBuffer(y, defaultStyle);

    // 렌더링 요청
    this.requestRender();

    // 자동 구독 관리
    this._updateSubscriptionState();

    // 즉시 렌더링 (필요한 경우)
    this._renderBufferedItems();
  }

  addVerticalLine(x, style = {}) {
    // 기본 스타일 설정
    const defaultStyle = {
      lineWidth: 2,
      strokeStyle: "#ffffff",
      ...style,
    };

    console.log("수직선 추가:", { x, 스타일: defaultStyle });

    // 차트 영역 가져오기
    const chartArea = this.chart.chartArea;
    const startY = this.chart.scales.y.min;
    const endY = this.chart.scales.y.max;

    // 오버레이 배열에 추가 (데이터 좌표로 저장)
    if (
      window.mainCanvas &&
      typeof window.mainCanvas.storeOverlay === "function"
    ) {
      window.mainCanvas.storeOverlay(x, startY, x, endY, "VerticalLine");
    }

    // 버퍼에 추가 (데이터 좌표 전달)
    this._addVerticalLineToBuffer(x, defaultStyle);

    // 렌더링 요청
    this.requestRender();

    // 자동 구독 관리
    this._updateSubscriptionState();

    // 즉시 렌더링 (필요한 경우)
    this._renderBufferedItems();
  }

  // 버퍼에 있는 모든 항목 한 번에 렌더링 -->스위치 문으로 바꿔서 배열 한번 탐색한 후에 일괄 렌더링
  _renderBufferedItems() {
    if (!this.overlayCtx) return;

    const ctx = this.overlayCtx;
    const debugMode = this.debugCoordinates;

    // 모든 렌더링 요소를 단일 배열로 통합
    const allItems = [
      ...this.renderBuffer.lines.map((item) => ({ type: "line", ...item })),
      ...this.renderBuffer.horizontalLines.map((item) => ({
        type: "horizontalLine",
        ...item,
      })),
      ...this.renderBuffer.verticalLines.map((item) => ({
        type: "verticalLine",
        ...item,
      })),
      ...this.renderBuffer.extendedLines.map((item) => ({
        type: "extendedLine",
        ...item,
      })),
      ...this.renderBuffer.rays.map((item) => ({ type: "ray", ...item })),
      ...this.renderBuffer.debugElements,
    ];

    if (allItems.length === 0) return;

    // 스타일별로 아이템 그룹화
    const groupedByStyle = {};

    // 항목을 스타일 및 타입별로 그룹화
    for (const item of allItems) {
      // 디버그 요소나 특수 요소는 별도 처리
      if (
        item.type === "chartArea" ||
        item.type === "chartAreaText" ||
        item.type === "xAxis" ||
        item.type === "yAxis"
      ) {
        if (!groupedByStyle[item.type]) {
          groupedByStyle[item.type] = [];
        }
        groupedByStyle[item.type].push(item);
        continue;
      }

      // 라인 스타일에 따라 그룹화
      const styleKey = item.style
        ? `${item.type}_${item.style.lineWidth}_${item.style.strokeStyle}`
        : item.type;

      if (!groupedByStyle[styleKey]) {
        groupedByStyle[styleKey] = [];
      }
      groupedByStyle[styleKey].push(item);
    }

    ctx.save();

    // 각 스타일 그룹마다 일괄 처리
    for (const styleKey in groupedByStyle) {
      const items = groupedByStyle[styleKey];
      if (!items.length) continue;

      // 특수 요소 처리
      if (
        styleKey === "chartArea" ||
        styleKey === "chartAreaText" ||
        styleKey === "xAxis" ||
        styleKey === "yAxis"
      ) {
        for (const item of items) {
          // this._renderSpecialItem(ctx, item);
        }
        continue;
      }

      // 첫 항목의 스타일 적용
      const firstItem = items[0];
      if (firstItem.style) {
        ctx.lineWidth = firstItem.style.lineWidth;
        ctx.strokeStyle = firstItem.style.strokeStyle;
        if (firstItem.style.lineDash) {
          ctx.setLineDash(firstItem.style.lineDash);
        } else {
          ctx.setLineDash([]);
        }
      }

      // 동일 스타일의 모든 경로를 한 번에 그리기
      ctx.beginPath();

      for (const item of items) {
        // 타입에 따라 경로 추가
        switch (item.type) {
          case "line":
            ctx.moveTo(item.startPixelX, item.startPixelY);
            ctx.lineTo(item.endPixelX, item.endPixelY);
            break;

          case "horizontalLine":
            ctx.moveTo(item.left, item.pixelY);
            ctx.lineTo(item.right, item.pixelY);
            break;

          case "verticalLine":
            ctx.moveTo(item.pixelX, item.top);
            ctx.lineTo(item.pixelX, item.bottom);
            break;

          case "extendedLine":
            ctx.moveTo(
              item.extendedPoints.start.x,
              item.extendedPoints.start.y
            );
            ctx.lineTo(item.extendedPoints.end.x, item.extendedPoints.end.y);
            break;

          case "ray":
            ctx.moveTo(item.startPixelX, item.startPixelY);
            ctx.lineTo(item.extendedEnd.x, item.extendedEnd.y);
            break;
        }
      }

      // 모든 경로를 한 번에 그리기
      ctx.stroke();

      // 디버깅 모드일 때 추가 표시 요소 그리기
      if (debugMode) {
        // this._renderDebugElements(ctx, items);
      }
    }

    ctx.restore();
  }

  // 특수 아이템 렌더링 (차트 영역, 텍스트 등)
  _renderSpecialItem(ctx, item) {
    switch (item.type) {
      case "chartArea":
        ctx.strokeStyle = item.style.strokeStyle;
        ctx.lineWidth = item.style.lineWidth;
        ctx.setLineDash(item.style.lineDash || []);
        ctx.strokeRect(
          item.chartArea.left,
          item.chartArea.top,
          item.chartArea.right - item.chartArea.left,
          item.chartArea.bottom - item.chartArea.top
        );
        ctx.setLineDash([]);
        break;

      case "chartAreaText":
        ctx.fillStyle = item.style.fillStyle;
        ctx.font = item.style.font;
        ctx.fillText(
          item.text,
          item.chartArea.left + 5,
          item.chartArea.top - 5
        );
        break;

      case "xAxis":
        ctx.strokeStyle = item.style.strokeStyle;
        ctx.lineWidth = item.style.lineWidth;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(item.chartArea.left, item.chartArea.bottom + 10);
        ctx.lineTo(item.chartArea.right, item.chartArea.bottom + 10);
        ctx.stroke();
        break;

      case "yAxis":
        ctx.strokeStyle = item.style.strokeStyle;
        ctx.lineWidth = item.style.lineWidth;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(item.chartArea.left - 10, item.chartArea.top);
        ctx.lineTo(item.chartArea.left - 10, item.chartArea.bottom);
        ctx.stroke();
        break;
    }
  }

  // 디버그 요소 렌더링
  _renderDebugElements(ctx, items) {
    for (const item of items) {
      switch (item.type) {
        case "line":
          // 시작점 (빨간색)
          ctx.fillStyle = "red";
          ctx.beginPath();
          ctx.arc(item.startPixelX, item.startPixelY, 4, 0, Math.PI * 2);
          ctx.fill();

          // 끝점 (파란색)
          ctx.fillStyle = "blue";
          ctx.beginPath();
          ctx.arc(item.endPixelX, item.endPixelY, 4, 0, Math.PI * 2);
          ctx.fill();
          break;

        // 다른 타입의 디버그 요소도 추가
        // ... 생략 ...
      }
    }
  }

  // 자동 구독 관리 설정
  setAutoManageSubscription(enabled = true) {
    this.autoManageSubscription = enabled;

    // 디버그 모드에서만 로그 출력
    if (this.debugCoordinates) {
      console.log("자동 구독 관리:", enabled ? "활성화" : "비활성화");
    }

    // 설정 변경 시 현재 상태에 맞게 처리
    if (enabled) {
      this._updateSubscriptionState();
    }
  }

  // 구독 상태 업데이트 (자동 관리)
  _updateSubscriptionState() {
    if (!this.autoManageSubscription) return;

    const overlays = window.mainCanvas?.getOverlaysArray?.() || [];

    // 디버그 로그 추가
    // console.log("구독 상태 업데이트:", {
    //   autoManage: this.autoManageSubscription,
    //   overlays: overlays.length,
    //   isSubscribed: this.isOverlaySubscribed,
    // });

    if (overlays.length > 0) {
      // 오버레이가 있고 구독 중이 아니면 구독
      if (!this.isOverlaySubscribed) {
        console.log("오버레이 구독 시도");
        this.subscribeOverlayUpdate();
      }
    } else {
      // 오버레이가 없고 구독 중이면 구독 해제
      if (this.isOverlaySubscribed) {
        console.log("오버레이 구독 해제 시도");
        this.unsubscribeOverlayUpdate();
      }
    }
  }

  // 수동으로 렌더링 요청
  requestRender() {
    this.renderRequired = true;

    // 구독되어 있지 않을 때만 구독 추가
    if (!this.isOverlaySubscribed) {
      this.subscribeOverlayUpdate();
    }
  }
}
