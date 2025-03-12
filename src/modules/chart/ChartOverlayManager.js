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
      console.error("오버레이 업데이트 중 오류:", error);
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

  // 다양한 드로잉 타입을 지원하는 메서드 추가
  addLine(startX, startY, endX, endY, style = {}) {
    // 기본 스타일 설정
    const defaultStyle = {
      lineWidth: 2,
      strokeStyle: "#ffffff",
      ...style,
    };

    // 오버레이 배열에 추가
    if (
      window.mainCanvas &&
      typeof window.mainCanvas.storeOverlay === "function"
    ) {
      window.mainCanvas.storeOverlay(startX, startY, endX, endY, "Line");
    }

    // 즉시 그리기
    this._drawLine(startX, startY, endX, endY, defaultStyle);
  }

  addExtendedLine(startX, startY, endX, endY, style = {}) {
    // 기본 스타일 설정
    const defaultStyle = {
      lineWidth: 2,
      strokeStyle: "#ffffff",
      ...style,
    };

    // 오버레이 배열에 추가
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

    // 즉시 그리기
    this._drawExtendedLine(startX, startY, endX, endY, defaultStyle);
  }

  addRay(startX, startY, endX, endY, style = {}) {
    // 기본 스타일 설정
    const defaultStyle = {
      lineWidth: 2,
      strokeStyle: "#ffffff",
      ...style,
    };

    // 오버레이 배열에 추가
    if (
      window.mainCanvas &&
      typeof window.mainCanvas.storeOverlay === "function"
    ) {
      window.mainCanvas.storeOverlay(startX, startY, endX, endY, "Ray");
    }

    // 즉시 그리기
    this._drawRay(startX, startY, endX, endY, defaultStyle);
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

    // 오버레이 배열에 추가
    if (
      window.mainCanvas &&
      typeof window.mainCanvas.storeOverlay === "function"
    ) {
      window.mainCanvas.storeOverlay(startX, y, endX, y, "HorizontalLine");
    }

    // 즉시 그리기
    this._drawHorizontalLine(y, defaultStyle);
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

    // 오버레이 배열에 추가
    if (
      window.mainCanvas &&
      typeof window.mainCanvas.storeOverlay === "function"
    ) {
      window.mainCanvas.storeOverlay(x, startY, x, endY, "VerticalLine");
    }

    // 즉시 그리기
    this._drawVerticalLine(x, defaultStyle);
  }

  // 내부 그리기 메서드
  _drawLine(startX, startY, endX, endY, style) {
    if (!this.overlayCtx || !this.chart) return;

    const ctx = this.overlayCtx;
    const xScale = this.chart.scales.x;
    const yScale = this.chart.scales.y;

    // 데이터 좌표를 픽셀 좌표로 변환
    const startPixelX = xScale.getPixelForValue(startX);
    const startPixelY = yScale.getPixelForValue(startY);
    const endPixelX = xScale.getPixelForValue(endX);
    const endPixelY = yScale.getPixelForValue(endY);

    // 선 그리기
    ctx.save();
    ctx.beginPath();
    ctx.lineWidth = style.lineWidth || 2;
    ctx.strokeStyle = style.strokeStyle || "#ffffff";
    ctx.moveTo(startPixelX, startPixelY);
    ctx.lineTo(endPixelX, endPixelY);
    ctx.stroke();
    ctx.restore();
  }

  _drawExtendedLine(startX, startY, endX, endY, style) {
    if (!this.overlayCtx || !this.chart) return;

    const ctx = this.overlayCtx;
    const xScale = this.chart.scales.x;
    const yScale = this.chart.scales.y;
    const chartArea = this.chart.chartArea;

    // 데이터 좌표를 픽셀 좌표로 변환
    const startPixelX = xScale.getPixelForValue(startX);
    const startPixelY = yScale.getPixelForValue(startY);
    const endPixelX = xScale.getPixelForValue(endX);
    const endPixelY = yScale.getPixelForValue(endY);

    // 선의 기울기 계산
    const slope = calculateSlope(
      startPixelX,
      startPixelY,
      endPixelX,
      endPixelY
    );
    const direction = calculateDirection(
      startPixelX,
      startPixelY,
      endPixelX,
      endPixelY
    );

    // 차트 영역 경계까지 확장된 선의 끝점 계산
    const extendedPoints = this._calculateExtendedLinePoints(
      startPixelX,
      startPixelY,
      endPixelX,
      endPixelY,
      slope,
      direction,
      chartArea
    );

    // 확장된 선 그리기
    ctx.save();
    ctx.beginPath();
    ctx.lineWidth = style.lineWidth || 2;
    ctx.strokeStyle = style.strokeStyle || "#ffffff";
    ctx.moveTo(extendedPoints.start.x, extendedPoints.start.y);
    ctx.lineTo(extendedPoints.end.x, extendedPoints.end.y);
    ctx.stroke();
    ctx.restore();
  }

  _drawRay(startX, startY, endX, endY, style) {
    if (!this.overlayCtx || !this.chart) return;

    const ctx = this.overlayCtx;
    const xScale = this.chart.scales.x;
    const yScale = this.chart.scales.y;
    const chartArea = this.chart.chartArea;

    // 데이터 좌표를 픽셀 좌표로 변환
    const startPixelX = xScale.getPixelForValue(startX);
    const startPixelY = yScale.getPixelForValue(startY);
    const endPixelX = xScale.getPixelForValue(endX);
    const endPixelY = yScale.getPixelForValue(endY);

    // 선의 기울기 계산
    const slope = calculateSlope(
      startPixelX,
      startPixelY,
      endPixelX,
      endPixelY
    );
    const direction = calculateDirection(
      startPixelX,
      startPixelY,
      endPixelX,
      endPixelY
    );

    // 차트 영역 경계까지 확장된 선의 끝점 계산
    const extendedEnd = this._calculateRayEndPoint(
      startPixelX,
      startPixelY,
      endPixelX,
      endPixelY,
      slope,
      direction,
      chartArea
    );

    // 레이 그리기
    ctx.save();
    ctx.beginPath();
    ctx.lineWidth = style.lineWidth || 2;
    ctx.strokeStyle = style.strokeStyle || "#ffffff";
    ctx.moveTo(startPixelX, startPixelY);
    ctx.lineTo(extendedEnd.x, extendedEnd.y);
    ctx.stroke();
    ctx.restore();
  }

  _drawHorizontalLine(y, style) {
    if (!this.overlayCtx || !this.chart) return;

    const ctx = this.overlayCtx;
    const yScale = this.chart.scales.y;
    const chartArea = this.chart.chartArea;

    // 데이터 y 좌표를 픽셀 좌표로 변환
    const pixelY = yScale.getPixelForValue(y);

    // 수평선 그리기
    ctx.save();
    ctx.beginPath();
    ctx.lineWidth = style.lineWidth || 2;
    ctx.strokeStyle = style.strokeStyle || "#ffffff";
    ctx.moveTo(chartArea.left, pixelY);
    ctx.lineTo(chartArea.right, pixelY);
    ctx.stroke();
    ctx.restore();
  }

  _drawVerticalLine(x, style) {
    if (!this.overlayCtx || !this.chart) return;

    const ctx = this.overlayCtx;
    const xScale = this.chart.scales.x;
    const chartArea = this.chart.chartArea;

    // 데이터 x 좌표를 픽셀 좌표로 변환
    const pixelX = xScale.getPixelForValue(x);

    // 수직선 그리기
    ctx.save();
    ctx.beginPath();
    ctx.lineWidth = style.lineWidth || 2;
    ctx.strokeStyle = style.strokeStyle || "#ffffff";
    ctx.moveTo(pixelX, chartArea.top);
    ctx.lineTo(pixelX, chartArea.bottom);
    ctx.stroke();
    ctx.restore();
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

  // 리소스 해제
  dispose() {
    this.unsubscribeOverlayUpdate();
    this.renderBuffer.lineCoords = null;
    this.renderBuffer.lineStyles = null;
    this.renderBuffer.rectCoords = null;
    this.renderBuffer.rectStyles = null;
  }
}
