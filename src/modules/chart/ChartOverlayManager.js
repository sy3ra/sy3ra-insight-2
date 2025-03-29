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
    this.previousOverlays = []; // 항상 배열로 초기화
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
    // 첫 번째 검사: 배열 길이 비교 (빠른 체크)
    if (currentOverlays.length !== this.previousOverlays.length) {
      return true;
    }

    // 배열이 비어있으면 변경 없음 (이미 길이가 같음을 확인했으므로)
    if (currentOverlays.length === 0) {
      return false;
    }

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

    // 디버깅 정보 표시는 프로덕션에서 필요하지 않으므로 간소화
    ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
    ctx.fillRect(10, 10, 250, 120);

    // 텍스트 정보 표시
    ctx.fillStyle = "white";
    ctx.font = "12px monospace";
    ctx.fillText(
      `마우스: (${coords.clientX || "?"}, ${coords.clientY || "?"})`,
      20,
      30
    );
    ctx.fillText(
      `캔버스: (${coords.canvasX.toFixed(1)}, ${coords.canvasY.toFixed(1)})`,
      20,
      50
    );
    ctx.fillText(
      `데이터: (${coords.dataX.toFixed(4)}, ${coords.dataY.toFixed(4)})`,
      20,
      70
    );
    ctx.fillText(`차트영역 내부: ${coords.isInChartArea}`, 20, 90);
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

    tickerInstance.subscribe(this.boundUpdateOverlayCanvas, {
      throttleMs: this.renderThrottleMs, // 스로틀링 적용
      eventType: "chartOverlay", // 고유한 이벤트 타입 사용
    });
    this.isOverlaySubscribed = true;
  }

  // 오버레이 업데이트 구독 해제
  unsubscribeOverlayUpdate() {
    if (this.isOverlaySubscribed) {
      tickerInstance.unsubscribe(this.boundUpdateOverlayCanvas);
      this.isOverlaySubscribed = false;
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
      const overlays = window.mainCanvas?.getOverlaysArray?.() || [];

      // 스케일 변경 감지 (기존 메서드 호출)
      const scaleChanged = this._checkChartScaleChanges();

      // 빈 오버레이 빠른 체크 (단순화된 로직)
      const bothEmpty =
        overlays.length === 0 && this.previousOverlays.length === 0;
      if (bothEmpty && !scaleChanged) {
        // 구독 상태만 업데이트하고 종료
        if (this.autoManageSubscription) {
          this._updateSubscriptionState();
        }
        return;
      }

      // 오버레이 변경 감지 (스케일이 변경되었거나 둘 다 빈 배열이 아닌 경우에만)
      const overlaysChanged = !bothEmpty && this._hasOverlaysChanged(overlays);

      // 변경사항 없으면 렌더링 스킵
      const renderNeeded = scaleChanged || overlaysChanged;
      if (!renderNeeded) {
        // 자동 구독 관리 수행
        if (this.autoManageSubscription && overlays.length === 0) {
          this._updateSubscriptionState();
        }
        return;
      }

      // 렌더링 버퍼 초기화
      this._clearRenderBuffer();

      if (overlays && overlays.length > 0) {
        // 오버레이 처리 (버퍼에 추가)
        this._processOverlays(overlays);

        // 버퍼에 있는 모든 항목 한 번에 렌더링
        this._renderBufferedItems();
        // 현재 오버레이 상태 저장 (얕은 복사)
        this.previousOverlays = overlays.map((overlay) => ({ ...overlay }));
      } else {
        this.clearOverlayCanvas(true);
        // null 대신 빈 배열로 설정하여 일관성 유지
        this.previousOverlays = [];

        // 자동 구독 관리 수행
        if (this.autoManageSubscription) {
          this._updateSubscriptionState();
        }
      }

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

    // 각 오버레이를 개별적으로 처리하여 버퍼에 추가
    for (let i = 0; i < overlays.length; i++) {
      const overlay = overlays[i];
      if (!overlay) continue;

      // 오버레이 데이터 유효성 검사
      if (!this._isValidOverlayData(overlay)) {
        console.warn(`오버레이 #${i}의 데이터가 유효하지 않습니다:`, overlay);
        continue;
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

    // drawingTool.js의 구현 방식을 따라 교차점 계산
    const intersections = [];

    // 오른쪽 경계와의 교차점
    if (direction.x > 0) {
      const yAtRight = y1 + slope * (right - x1);
      if (yAtRight >= top && yAtRight <= bottom) {
        intersections.push({
          x: right,
          y: yAtRight,
          distance: Math.pow(right - x1, 2) + Math.pow(yAtRight - y1, 2),
          direction: { x: 1, y: yAtRight > y1 ? 1 : -1 },
        });
      }
    }

    // 왼쪽 경계와의 교차점
    if (direction.x < 0) {
      const yAtLeft = y1 + slope * (left - x1);
      if (yAtLeft >= top && yAtLeft <= bottom) {
        intersections.push({
          x: left,
          y: yAtLeft,
          distance: Math.pow(left - x1, 2) + Math.pow(yAtLeft - y1, 2),
          direction: { x: -1, y: yAtLeft > y1 ? 1 : -1 },
        });
      }
    }

    // 상단 경계와의 교차점
    if (direction.y < 0) {
      const xAtTop = x1 + (top - y1) / slope;
      if (xAtTop >= left && xAtTop <= right) {
        intersections.push({
          x: xAtTop,
          y: top,
          distance: Math.pow(xAtTop - x1, 2) + Math.pow(top - y1, 2),
          direction: { x: xAtTop > x1 ? 1 : -1, y: -1 },
        });
      }
    }

    // 하단 경계와의 교차점
    if (direction.y > 0) {
      const xAtBottom = x1 + (bottom - y1) / slope;
      if (xAtBottom >= left && xAtBottom <= right) {
        intersections.push({
          x: xAtBottom,
          y: bottom,
          distance: Math.pow(xAtBottom - x1, 2) + Math.pow(bottom - y1, 2),
          direction: { x: xAtBottom > x1 ? 1 : -1, y: 1 },
        });
      }
    }

    // 방향이 일치하는 교차점만 필터링
    const validIntersections = intersections.filter((intersection) => {
      // x 방향과 y 방향 모두 확인
      const dirX = intersection.x - x1;
      const dirY = intersection.y - y1;
      return (
        (dirX === 0 || Math.sign(dirX) === direction.x) &&
        (dirY === 0 || Math.sign(dirY) === direction.y)
      );
    });

    // 유효한 교차점이 있으면 가장 먼 것 선택
    if (validIntersections.length > 0) {
      // 시작점에서 가장 먼 교차점 선택
      const farthestIntersection = validIntersections.reduce(
        (farthest, current) => {
          const currentDist =
            Math.pow(current.x - x1, 2) + Math.pow(current.y - y1, 2);
          const farthestDist =
            Math.pow(farthest.x - x1, 2) + Math.pow(farthest.y - y1, 2);
          return currentDist > farthestDist ? current : farthest;
        },
        validIntersections[0]
      );

      return { x: farthestIntersection.x, y: farthestIntersection.y };
    }

    // 유효한 교차점이 없으면 원래 끝점 반환
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

  // 버퍼에 있는 모든 항목 한 번에 렌더링
  _renderBufferedItems() {
    if (!this.overlayCtx) return;

    const ctx = this.overlayCtx;

    // 간소화된 렌더링 로직
    if (this.renderBuffer.lines.length > 0) {
      ctx.save();
      ctx.beginPath();

      for (const line of this.renderBuffer.lines) {
        ctx.strokeStyle = line.style.strokeStyle || "#ffffff";
        ctx.lineWidth = line.style.lineWidth || 2;
        ctx.moveTo(line.startPixelX, line.startPixelY);
        ctx.lineTo(line.endPixelX, line.endPixelY);
        ctx.stroke();
      }

      ctx.restore();
    }

    if (this.renderBuffer.horizontalLines.length > 0) {
      ctx.save();
      ctx.beginPath();

      for (const hLine of this.renderBuffer.horizontalLines) {
        ctx.strokeStyle = hLine.style.strokeStyle || "#ffffff";
        ctx.lineWidth = hLine.style.lineWidth || 2;
        ctx.moveTo(hLine.left, hLine.pixelY);
        ctx.lineTo(hLine.right, hLine.pixelY);
        ctx.stroke();
      }

      ctx.restore();
    }

    if (this.renderBuffer.verticalLines.length > 0) {
      ctx.save();
      ctx.beginPath();

      for (const vLine of this.renderBuffer.verticalLines) {
        ctx.strokeStyle = vLine.style.strokeStyle || "#ffffff";
        ctx.lineWidth = vLine.style.lineWidth || 2;
        ctx.moveTo(vLine.pixelX, vLine.top);
        ctx.lineTo(vLine.pixelX, vLine.bottom);
        ctx.stroke();
      }

      ctx.restore();
    }

    if (this.renderBuffer.extendedLines.length > 0) {
      ctx.save();
      ctx.beginPath();

      for (const extLine of this.renderBuffer.extendedLines) {
        ctx.strokeStyle = extLine.style.strokeStyle || "#ffffff";
        ctx.lineWidth = extLine.style.lineWidth || 2;
        ctx.moveTo(
          extLine.extendedPoints.start.x,
          extLine.extendedPoints.start.y
        );
        ctx.lineTo(extLine.extendedPoints.end.x, extLine.extendedPoints.end.y);
        ctx.stroke();
      }

      ctx.restore();
    }

    if (this.renderBuffer.rays.length > 0) {
      ctx.save();
      ctx.beginPath();

      for (const ray of this.renderBuffer.rays) {
        ctx.strokeStyle = ray.style.strokeStyle || "#ffffff";
        ctx.lineWidth = ray.style.lineWidth || 2;
        ctx.moveTo(ray.startPixelX, ray.startPixelY);
        ctx.lineTo(ray.extendedEnd.x, ray.extendedEnd.y);
        ctx.stroke();
      }

      ctx.restore();
    }

    // 디버그 요소 렌더링 (필요한 경우만)
    if (this.debugCoordinates && this.renderBuffer.debugElements.length > 0) {
      for (const debugElement of this.renderBuffer.debugElements) {
        if (debugElement.type === "chartArea") {
          ctx.save();
          ctx.strokeStyle = debugElement.style.strokeStyle;
          ctx.lineWidth = debugElement.style.lineWidth;
          ctx.setLineDash(debugElement.style.lineDash || []);
          ctx.strokeRect(
            debugElement.chartArea.left,
            debugElement.chartArea.top,
            debugElement.chartArea.right - debugElement.chartArea.left,
            debugElement.chartArea.bottom - debugElement.chartArea.top
          );
          ctx.restore();
        } else if (debugElement.type === "chartAreaText") {
          ctx.save();
          ctx.fillStyle = debugElement.style.fillStyle;
          ctx.font = debugElement.style.font;
          ctx.fillText(
            debugElement.text,
            debugElement.chartArea.left + 5,
            debugElement.chartArea.top - 5
          );
          ctx.restore();
        }
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
