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

    // 좌표 변환 디버깅 정보
    this.debugCoordinates = false;
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

    // 디버깅 로그
    if (this.debugCoordinates) {
      console.log("좌표 변환 (데이터→픽셀):", {
        데이터: { x: dataX, y: dataY },
        픽셀: { x: pixelX, y: pixelY },
        차트영역: chartArea,
        영역내부: isInsideChartArea,
      });
    }

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
      console.log("좌표 변환:", {
        마우스: { clientX: event.clientX, clientY: event.clientY },
        캔버스: canvasCoords,
        데이터: dataCoords,
        차트영역내부: isInChartArea,
      });

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
      console.log("오버레이 업데이트 호출됨, 오버레이 배열:", overlays);

      // 차트 스케일 변경 감지
      this._checkChartScaleChanges();

      if (overlays && overlays.length > 0) {
        // 캔버스 크기 확인 및 조정
        // this._ensureCanvasSize();

        // 오버레이 그리기
        this._drawOverlays(overlays, true);

        console.log("오버레이 그리기 완료");
      } else {
        this.clearOverlayCanvas(true);
        console.log("오버레이 없음, 캔버스 클리어됨");
      }
    } catch (error) {
      console.error("오버레이 업데이트 중 오류:", error);
    }
  }

  // 차트 스케일 변경 감지
  _checkChartScaleChanges() {
    if (!this.chart || !this.chart.scales) return;

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
      return;
    }

    // 스케일 변경 감지
    const isScaleChanged =
      this._prevScales.xMin !== xScale.min ||
      this._prevScales.xMax !== xScale.max ||
      this._prevScales.yMin !== yScale.min ||
      this._prevScales.yMax !== yScale.max;

    if (isScaleChanged) {
      console.log("차트 스케일 변경 감지:", {
        이전: this._prevScales,
        현재: {
          xMin: xScale.min,
          xMax: xScale.max,
          yMin: yScale.min,
          yMax: yScale.max,
        },
      });

      // 현재 스케일 정보 업데이트
      this._prevScales = {
        xMin: xScale.min,
        xMax: xScale.max,
        yMin: yScale.min,
        yMax: yScale.max,
      };
    }
  }

  // // 캔버스 크기 확인 및 조정
  // _ensureCanvasSize() {
  //   if (!this.overlayCtx || !this.overlayCtx.canvas || !this.chart) return;

  //   const canvas = this.overlayCtx.canvas;
  //   const chartCanvas = this.chart.canvas;

  //   // 차트 캔버스와 크기가 다르면 조정
  //   if (
  //     canvas.width !== chartCanvas.width ||
  //     canvas.height !== chartCanvas.height
  //   ) {
  //     console.log("오버레이 캔버스 크기 조정:", {
  //       from: { width: canvas.width, height: canvas.height },
  //       to: { width: chartCanvas.width, height: chartCanvas.height },
  //     });

  //     canvas.width = chartCanvas.width;
  //     canvas.height = chartCanvas.height;
  //   }
  // }

  // 오버레이 그리기
  _drawOverlays(overlays, fullClear = false) {
    if (!this.isValidOverlaysArray(overlays)) {
      console.warn("유효하지 않은 오버레이 배열:", overlays);
      return;
    }

    // 캔버스 클리어
    this.clearOverlayCanvas(fullClear);

    console.log(`${overlays.length}개의 오버레이 그리기 시작`);

    // 각 오버레이를 개별적으로 그리기
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

        console.log(`오버레이 #${i} 좌표 변환:`, {
          데이터좌표: {
            시작: { x: overlay.startX, y: overlay.startY },
            끝: { x: overlay.endX, y: overlay.endY },
          },
          픽셀좌표: {
            시작: startPixel,
            끝: endPixel,
          },
          타입: overlay.lineType,
        });
      }

      // 오버레이 타입별 그리기
      switch (overlay.lineType) {
        case "Line":
          this._drawLine(
            overlay.startX,
            overlay.startY,
            overlay.endX,
            overlay.endY,
            { lineWidth: 2, strokeStyle: "#ffffff" }
          );
          break;
        case "ExtendedLine":
          this._drawExtendedLine(
            overlay.startX,
            overlay.startY,
            overlay.endX,
            overlay.endY,
            { lineWidth: 2, strokeStyle: "#ffffff" }
          );
          break;
        case "Ray":
          this._drawRay(
            overlay.startX,
            overlay.startY,
            overlay.endX,
            overlay.endY,
            { lineWidth: 2, strokeStyle: "#ffffff" }
          );
          break;
        case "HorizontalLine":
          this._drawHorizontalLine(overlay.startY, {
            lineWidth: 2,
            strokeStyle: "#ffffff",
          });
          break;
        case "VerticalLine":
          this._drawVerticalLine(overlay.startX, {
            lineWidth: 2,
            strokeStyle: "#ffffff",
          });
          break;
        default:
          console.warn(`알 수 없는 라인 타입: ${overlay.lineType}`);
          this._drawLine(
            overlay.startX,
            overlay.startY,
            overlay.endX,
            overlay.endY,
            { lineWidth: 2, strokeStyle: "#ffffff" }
          );
      }
    }

    // 디버깅 모드일 때 차트 영역 표시
    if (this.debugCoordinates && this.chart?.chartArea) {
      const ctx = this.overlayCtx;
      const chartArea = this.chart.chartArea;

      ctx.save();
      ctx.strokeStyle = "rgba(255, 0, 0, 0.5)";
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 5]);
      ctx.strokeRect(
        chartArea.left,
        chartArea.top,
        chartArea.right - chartArea.left,
        chartArea.bottom - chartArea.top
      );
      ctx.restore();
    }

    console.log("오버레이 그리기 완료");
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

  // 기본 선 그리기 메서드
  _drawLine(startX, startY, endX, endY, style) {
    if (!this.overlayCtx || !this.chart) return;

    const ctx = this.overlayCtx;

    // 차트 영역 정보 가져오기 (커스텀 정보 또는 차트에서 직접)
    const chartArea = this.getChartAreaInfo() || this.chart.chartArea;

    // 데이터 좌표를 픽셀 좌표로 변환 (개선된 메서드 사용)
    const startPixel = this._getPixelCoordinates(startX, startY);
    const endPixel = this._getPixelCoordinates(endX, endY);

    if (!startPixel || !endPixel) return;

    // 시작점과 끝점의 픽셀 좌표
    const startPixelX = startPixel.x;
    const startPixelY = startPixel.y;
    const endPixelX = endPixel.x;
    const endPixelY = endPixel.y;

    if (this.debugCoordinates) {
      console.log("선 그리기 좌표 변환:", {
        데이터좌표: { startX, startY, endX, endY },
        픽셀좌표: {
          시작: {
            x: startPixelX,
            y: startPixelY,
            영역내부: startPixel.isInsideChartArea,
          },
          끝: {
            x: endPixelX,
            y: endPixelY,
            영역내부: endPixel.isInsideChartArea,
          },
        },
        차트영역: chartArea,
      });
    }

    // 선 그리기
    ctx.save();
    ctx.beginPath();
    ctx.lineWidth = style.lineWidth || 2;
    ctx.strokeStyle = style.strokeStyle || "#ffffff";
    ctx.moveTo(startPixelX, startPixelY);
    ctx.lineTo(endPixelX, endPixelY);
    ctx.stroke();

    // 디버깅 모드일 때 시작점과 끝점 표시
    if (this.debugCoordinates) {
      // 시작점 (빨간색)
      ctx.fillStyle = "red";
      ctx.beginPath();
      ctx.arc(startPixelX, startPixelY, 4, 0, Math.PI * 2);
      ctx.fill();

      // 끝점 (파란색)
      ctx.fillStyle = "blue";
      ctx.beginPath();
      ctx.arc(endPixelX, endPixelY, 4, 0, Math.PI * 2);
      ctx.fill();

      // 차트 영역 표시
      ctx.strokeStyle = "rgba(255, 0, 0, 0.5)";
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 5]);
      ctx.strokeRect(
        chartArea.left,
        chartArea.top,
        chartArea.right - chartArea.left,
        chartArea.bottom - chartArea.top
      );
      ctx.setLineDash([]);
    }

    ctx.restore();
  }

  // 수평선 그리기 메서드
  _drawHorizontalLine(y, style) {
    if (!this.overlayCtx || !this.chart) return;

    const ctx = this.overlayCtx;
    const yScale = this.chart.scales.y;

    // 차트 영역 정보 가져오기 (커스텀 정보 또는 차트에서 직접)
    const chartArea = this.getChartAreaInfo() || this.chart.chartArea;

    // 데이터 y 좌표를 픽셀 좌표로 변환
    const pixelY = yScale.getPixelForValue(y);

    if (this.debugCoordinates) {
      console.log("수평선 그리기 좌표 변환:", {
        데이터좌표: { y },
        픽셀좌표: { pixelY },
        차트영역: chartArea,
      });
    }

    // 수평선 그리기
    ctx.save();
    ctx.beginPath();
    ctx.lineWidth = style.lineWidth || 2;
    ctx.strokeStyle = style.strokeStyle || "#ffffff";
    ctx.moveTo(chartArea.left, pixelY);
    ctx.lineTo(chartArea.right, pixelY);
    ctx.stroke();

    // 디버깅 모드일 때 중간점 표시
    if (this.debugCoordinates) {
      // 중간점 (녹색)
      ctx.fillStyle = "green";
      ctx.beginPath();
      ctx.arc(
        (chartArea.left + chartArea.right) / 2,
        pixelY,
        4,
        0,
        Math.PI * 2
      );
      ctx.fill();

      // 차트 영역 표시
      ctx.strokeStyle = "rgba(255, 0, 0, 0.5)";
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 5]);
      ctx.strokeRect(
        chartArea.left,
        chartArea.top,
        chartArea.right - chartArea.left,
        chartArea.bottom - chartArea.top
      );
      ctx.setLineDash([]);
    }

    ctx.restore();
  }

  // 수직선 그리기 메서드
  _drawVerticalLine(x, style) {
    if (!this.overlayCtx || !this.chart) return;

    const ctx = this.overlayCtx;
    const xScale = this.chart.scales.x;

    // 차트 영역 정보 가져오기 (커스텀 정보 또는 차트에서 직접)
    const chartArea = this.getChartAreaInfo() || this.chart.chartArea;

    // 데이터 x 좌표를 픽셀 좌표로 변환
    const pixelX = xScale.getPixelForValue(x);

    if (this.debugCoordinates) {
      console.log("수직선 그리기 좌표 변환:", {
        데이터좌표: { x },
        픽셀좌표: { pixelX },
        차트영역: chartArea,
      });
    }

    // 수직선 그리기
    ctx.save();
    ctx.beginPath();
    ctx.lineWidth = style.lineWidth || 2;
    ctx.strokeStyle = style.strokeStyle || "#ffffff";
    ctx.moveTo(pixelX, chartArea.top);
    ctx.lineTo(pixelX, chartArea.bottom);
    ctx.stroke();

    // 디버깅 모드일 때 중간점 표시
    if (this.debugCoordinates) {
      // 중간점 (녹색)
      ctx.fillStyle = "green";
      ctx.beginPath();
      ctx.arc(
        pixelX,
        (chartArea.top + chartArea.bottom) / 2,
        4,
        0,
        Math.PI * 2
      );
      ctx.fill();

      // 차트 영역 표시
      ctx.strokeStyle = "rgba(255, 0, 0, 0.5)";
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 5]);
      ctx.strokeRect(
        chartArea.left,
        chartArea.top,
        chartArea.right - chartArea.left,
        chartArea.bottom - chartArea.top
      );
      ctx.setLineDash([]);
    }

    ctx.restore();
  }

  drawSimpleLine(startX, startY, endX, endY) {
    this.overlayCtx.beginPath();
    this.overlayCtx.moveTo(startX, startY);
    this.overlayCtx.lineTo(endX, endY);
    this.overlayCtx.stroke();
  }

  _drawExtendedLine(startX, startY, endX, endY, style) {
    if (!this.overlayCtx || !this.chart) return;

    const ctx = this.overlayCtx;

    // 차트 영역 정보 가져오기 (커스텀 정보 또는 차트에서 직접)
    const chartArea = this.getChartAreaInfo() || this.chart.chartArea;

    // 데이터 좌표를 픽셀 좌표로 변환 (개선된 메서드 사용)
    const startPixel = this._getPixelCoordinates(startX, startY);
    const endPixel = this._getPixelCoordinates(endX, endY);

    if (!startPixel || !endPixel) return;

    // 시작점과 끝점의 픽셀 좌표
    const startPixelX = startPixel.x;
    const startPixelY = startPixel.y;
    const endPixelX = endPixel.x;
    const endPixelY = endPixel.y;

    if (this.debugCoordinates) {
      console.log("확장 선 그리기 좌표 변환:", {
        데이터좌표: { startX, startY, endX, endY },
        픽셀좌표: {
          시작: {
            x: startPixelX,
            y: startPixelY,
            영역내부: startPixel.isInsideChartArea,
          },
          끝: {
            x: endPixelX,
            y: endPixelY,
            영역내부: endPixel.isInsideChartArea,
          },
        },
        차트영역: chartArea,
      });
    }

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

    // 디버깅 모드일 때 원본 점과 확장된 점 표시
    if (this.debugCoordinates) {
      // 원본 시작점 (빨간색)
      ctx.fillStyle = "red";
      ctx.beginPath();
      ctx.arc(startPixelX, startPixelY, 4, 0, Math.PI * 2);
      ctx.fill();

      // 원본 끝점 (파란색)
      ctx.fillStyle = "blue";
      ctx.beginPath();
      ctx.arc(endPixelX, endPixelY, 4, 0, Math.PI * 2);
      ctx.fill();

      // 확장된 시작점 (녹색)
      ctx.fillStyle = "green";
      ctx.beginPath();
      ctx.arc(
        extendedPoints.start.x,
        extendedPoints.start.y,
        3,
        0,
        Math.PI * 2
      );
      ctx.fill();

      // 확장된 끝점 (노란색)
      ctx.fillStyle = "yellow";
      ctx.beginPath();
      ctx.arc(extendedPoints.end.x, extendedPoints.end.y, 3, 0, Math.PI * 2);
      ctx.fill();

      // 차트 영역 표시
      ctx.strokeStyle = "rgba(255, 0, 0, 0.5)";
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 5]);
      ctx.strokeRect(
        chartArea.left,
        chartArea.top,
        chartArea.right - chartArea.left,
        chartArea.bottom - chartArea.top
      );
      ctx.setLineDash([]);
    }

    ctx.restore();
  }

  // 레이 그리기 메서드
  _drawRay(startX, startY, endX, endY, style) {
    if (!this.overlayCtx || !this.chart) return;

    const ctx = this.overlayCtx;

    // 차트 영역 정보 가져오기 (커스텀 정보 또는 차트에서 직접)
    const chartArea = this.getChartAreaInfo() || this.chart.chartArea;

    // 데이터 좌표를 픽셀 좌표로 변환 (개선된 메서드 사용)
    const startPixel = this._getPixelCoordinates(startX, startY);
    const endPixel = this._getPixelCoordinates(endX, endY);

    if (!startPixel || !endPixel) return;

    // 시작점과 끝점의 픽셀 좌표
    const startPixelX = startPixel.x;
    const startPixelY = startPixel.y;
    const endPixelX = endPixel.x;
    const endPixelY = endPixel.y;

    if (this.debugCoordinates) {
      console.log("레이 그리기 좌표 변환:", {
        데이터좌표: { startX, startY, endX, endY },
        픽셀좌표: {
          시작: {
            x: startPixelX,
            y: startPixelY,
            영역내부: startPixel.isInsideChartArea,
          },
          끝: {
            x: endPixelX,
            y: endPixelY,
            영역내부: endPixel.isInsideChartArea,
          },
        },
        차트영역: chartArea,
      });
    }

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

    // 디버깅 모드일 때 원본 점과 확장된 점 표시
    if (this.debugCoordinates) {
      // 시작점 (빨간색)
      ctx.fillStyle = "red";
      ctx.beginPath();
      ctx.arc(startPixelX, startPixelY, 4, 0, Math.PI * 2);
      ctx.fill();

      // 원본 방향점 (파란색)
      ctx.fillStyle = "blue";
      ctx.beginPath();
      ctx.arc(endPixelX, endPixelY, 4, 0, Math.PI * 2);
      ctx.fill();

      // 확장된 끝점 (녹색)
      ctx.fillStyle = "green";
      ctx.beginPath();
      ctx.arc(extendedEnd.x, extendedEnd.y, 3, 0, Math.PI * 2);
      ctx.fill();

      // 차트 영역 표시
      ctx.strokeStyle = "rgba(255, 0, 0, 0.5)";
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 5]);
      ctx.strokeRect(
        chartArea.left,
        chartArea.top,
        chartArea.right - chartArea.left,
        chartArea.bottom - chartArea.top
      );
      ctx.setLineDash([]);
    }

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

  // 차트 영역 시각화
  visualizeChartArea() {
    if (!this.overlayCtx || !this.chart) return;

    const ctx = this.overlayCtx;
    const chartArea = this.chart.chartArea;

    ctx.save();

    // 차트 영역 테두리 그리기
    ctx.beginPath();
    ctx.strokeStyle = "rgba(255, 0, 0, 0.7)";
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(
      chartArea.left,
      chartArea.top,
      chartArea.right - chartArea.left,
      chartArea.bottom - chartArea.top
    );

    // 차트 영역 정보 표시
    ctx.fillStyle = "rgba(255, 0, 0, 0.9)";
    ctx.font = "12px Arial";
    ctx.fillText(
      `차트영역: (${Math.round(chartArea.left)},${Math.round(
        chartArea.top
      )}) - (${Math.round(chartArea.right)},${Math.round(chartArea.bottom)})`,
      chartArea.left + 5,
      chartArea.top - 5
    );

    // 좌표계 축 그리기
    ctx.strokeStyle = "rgba(0, 255, 0, 0.5)";
    ctx.setLineDash([]);

    // X축
    ctx.beginPath();
    ctx.moveTo(chartArea.left, chartArea.bottom + 10);
    ctx.lineTo(chartArea.right, chartArea.bottom + 10);
    ctx.stroke();

    // Y축
    ctx.beginPath();
    ctx.moveTo(chartArea.left - 10, chartArea.top);
    ctx.lineTo(chartArea.left - 10, chartArea.bottom);
    ctx.stroke();

    ctx.restore();

    console.log("차트 영역 시각화 완료:", chartArea);
  }

  // 리소스 해제
  dispose() {
    this.unsubscribeOverlayUpdate();
    this.renderBuffer.lineCoords = null;
    this.renderBuffer.lineStyles = null;
    this.renderBuffer.rectCoords = null;
    this.renderBuffer.rectStyles = null;
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

    // 즉시 그리기 (데이터 좌표 전달)
    this._drawLine(startX, startY, endX, endY, defaultStyle);
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

    // 즉시 그리기 (데이터 좌표 전달)
    this._drawExtendedLine(startX, startY, endX, endY, defaultStyle);
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

    // 즉시 그리기 (데이터 좌표 전달)
    this._drawRay(startX, startY, endX, endY, defaultStyle);
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

    // 즉시 그리기 (데이터 좌표 전달)
    this._drawHorizontalLine(y, defaultStyle);
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

    // 즉시 그리기 (데이터 좌표 전달)
    this._drawVerticalLine(x, defaultStyle);
  }
}
