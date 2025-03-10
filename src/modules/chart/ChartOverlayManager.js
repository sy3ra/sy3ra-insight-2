import { tickerInstance } from "../ticker.js";

export class ChartOverlayManager {
  constructor(overlayCtx, chart) {
    this.overlayCtx = overlayCtx;
    this.chart = chart;

    // 바인딩된 메서드
    this.boundUpdateOverlayCanvas = this.updateOverlayCanvas.bind(this);

    // 구독 상태
    this.isOverlaySubscribed = false;

    // 렌더링 버퍼
    this.renderBuffer = {
      lineCoords: new Float32Array(10000),
      lineStyles: [],
      lineCount: 0,
      rectCoords: new Float32Array(1000),
      rectStyles: [],
      rectCount: 0,
    };
  }

  // 오버레이 업데이트 구독
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

  // 오버레이 캔버스 업데이트
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

  // 오버레이 그리기
  _drawOverlays(overlays, fullClear = false) {
    if (!this.isValidOverlaysArray(overlays)) return;

    // 캔버스 클리어
    this.clearOverlayCanvas(fullClear);

    // 렌더링 버퍼 초기화
    let lineIndex = 0;
    this.renderBuffer.lineStyles = [];

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

  // 특정 타입의 오버레이 그리기
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

  // 선 그리기 메서드들
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

  // 리소스 해제
  dispose() {
    this.unsubscribeOverlayUpdate();
    this.renderBuffer.lineCoords = null;
    this.renderBuffer.lineStyles = null;
    this.renderBuffer.rectCoords = null;
    this.renderBuffer.rectStyles = null;
  }
}
