import { tickerInstance } from "./ticker.js";

export class DrawingTool {
  constructor(container, chartCanvas, drawingCanvas, overlayCanvas) {
    this.container = container;
    this.chartCtx = chartCanvas;
    this.drawingCanvas = drawingCanvas;
    this.drawingCtx = drawingCanvas.getContext("2d");
    this.overlayCanvas = overlayCanvas;
    this.overlayCtx = overlayCanvas.getContext("2d");
    this.mouseMoveHandler = null;
    this.clickHandler = null;
    this.currentPosition = { x: null, y: null }; // 현재 마우스 위치 (데이터 값)
    this.points = {
      start: { x: null, y: null }, // 시작점 (픽셀 값)
      end: { x: null, y: null }, // 끝점 (픽셀 값)
    };
    this.clickCount = 0; // 클릭 횟수를 기록하기 위한 변수
    this.finishDrawLineHandler = null;
    this.isDrawingMode = false; // 그리기 모드 상태 추적
    this.originalZoomPanState = null; // 원래 줌/패닝 상태 저장
    this.currentTool = null; // 현재 선택된 도구 타입 저장

    // 가능한 그리기 도구들
    this.tools = [
      { name: "Line", icon: "public/icons/line.svg" },
      { name: "ExtendedLine", icon: "public/icons/extended line.svg" },
      { name: "Ray", icon: "public/icons/ray.svg" },
      { name: "HorizontalLine", icon: "public/icons/horizontal line.svg" },
      { name: "VerticalLine", icon: "public/icons/vertical line.svg" },
    ];
  }

  // UI 관련 메서드
  createToolPanel() {
    const toolPanel = this.container;
    toolPanel.classList.add("tool-panel");

    this.tools.forEach((tool) => {
      const button = document.createElement("button");
      const img = document.createElement("img");
      img.src = tool.icon;
      img.alt = tool.name;

      button.appendChild(img);
      button.addEventListener("click", () => {
        this.clickDrawTool(tool.name);
      });

      toolPanel.appendChild(button);
    });
  }

  // 도구 선택 및 그리기 모드 제어 메서드
  clickDrawTool(toolType) {
    console.log(`draw${toolType}`);
    this.resetDrawingState();
    this.currentTool = toolType;
    this.enableDrawingMode();
  }

  // 그리기 상태 초기화
  resetDrawingState() {
    this.clickCount = 0;
    this.currentPosition = { x: null, y: null };
    this.points = {
      start: { x: null, y: null },
      end: { x: null, y: null },
    };
  }

  // 그리기 모드 활성화 메서드
  enableDrawingMode() {
    this.isDrawingMode = true;
    this.setChartZoomPanState(false);
    this.setupMouseListeners(true);
  }

  // 차트 줌/팬 상태 설정
  setChartZoomPanState(enabled) {
    if (!this.chartCtx.chart) return;

    const chart = this.chartCtx.chart;

    if (enabled) {
      // 원래 상태로 복원
      if (this.originalZoomPanState) {
        chart.options.plugins.zoom.zoom.wheel.enabled =
          this.originalZoomPanState.zoomEnabled;
        chart.options.plugins.zoom.pan.enabled =
          this.originalZoomPanState.panEnabled;

        console.log("그리기 모드 비활성화: 줌/패닝 기능 복원됨");
      }
    } else {
      // 현재 상태 저장 및 비활성화
      this.originalZoomPanState = {
        zoomEnabled: chart.options.plugins.zoom.zoom.wheel.enabled,
        panEnabled: chart.options.plugins.zoom.pan.enabled,
      };

      chart.options.plugins.zoom.zoom.wheel.enabled = false;
      chart.options.plugins.zoom.pan.enabled = false;

      console.log("그리기 모드 활성화: 줌/패닝 기능 비활성화됨");
    }

    chart.update("none");
  }

  // 마우스 이벤트 리스너 설정/제거
  setupMouseListeners(add) {
    if (!window.mainCanvas) {
      console.error("MainCanvas 인스턴스를 찾을 수 없습니다.");
      return;
    }

    if (add) {
      // 리스너 추가
      console.log("마우스 좌표 및 클릭 이벤트 구독 시작");

      this.mouseMoveHandler = this.onMouseMove.bind(this);
      this.clickHandler = this.onMouseClick.bind(this);

      if (typeof window.mainCanvas.addMouseMoveListener === "function") {
        window.mainCanvas.addMouseMoveListener(this.mouseMoveHandler);
      } else {
        console.error("mouseMove 구독에 실패했습니다.");
      }

      if (typeof window.mainCanvas.addMouseClickListener === "function") {
        window.mainCanvas.addMouseClickListener(this.clickHandler);
      } else {
        console.error("mouseClick 구독에 실패했습니다.");
      }
    } else {
      // 리스너 제거
      if (
        this.mouseMoveHandler &&
        typeof window.mainCanvas.removeMouseMoveListener === "function"
      ) {
        window.mainCanvas.removeMouseMoveListener(this.mouseMoveHandler);
        this.mouseMoveHandler = null;
        console.log("마우스 좌표 구독이 취소되었습니다.");
      }

      if (
        this.clickHandler &&
        typeof window.mainCanvas.removeMouseClickListener === "function"
      ) {
        window.mainCanvas.removeMouseClickListener(this.clickHandler);
        this.clickHandler = null;
        console.log("마우스 클릭 구독이 취소되었습니다.");
      }
    }
  }

  // 마우스 이벤트 핸들러
  onMouseMove(x, y) {
    const { x: dataX, y: dataY } = this.getValueForPixel(x, y);
    this.currentPosition.x = dataX;
    this.currentPosition.y = dataY;

    if (this.clickCount === 1 && !this.finishDrawLineHandler) {
      this.finishDrawLineHandler = this.finishDrawLine.bind(this);
      tickerInstance.subscribe(this.finishDrawLineHandler);
    }
  }

  onMouseClick(x, y) {
    if (this.clickCount === 0) {
      console.log("첫번째 클릭");
      this.clickCount++;
      this.startDrawLine();
    } else if (this.clickCount === 1) {
      console.log("두번째 클릭, finish");
      this.clickCount++;
      this.finishDrawLine();
    }
  }

  // 그리기 관련 메서드
  startDrawLine() {
    const { x: pixelX, y: pixelY } = this.getPixelForValue(
      this.currentPosition.x,
      this.currentPosition.y
    );
    this.points.start.x = pixelX;
    this.points.start.y = pixelY;
  }

  finishDrawLine() {
    const { x: pixelX, y: pixelY } = this.getPixelForValue(
      this.currentPosition.x,
      this.currentPosition.y
    );
    this.points.end.x = pixelX;
    this.points.end.y = pixelY;

    this.drawLine();

    if (this.clickCount === 2) {
      this.cleanupDrawingProcess();
    }
  }

  drawLine() {
    this.clearDrawingCanvas();

    this.drawingCtx.beginPath();
    this.drawingCtx.moveTo(this.points.start.x, this.points.start.y);
    this.drawingCtx.lineTo(this.points.end.x, this.points.end.y);
    this.drawingCtx.lineWidth = 1;
    this.drawingCtx.strokeStyle = "white";
    this.drawingCtx.stroke();
  }

  clearDrawingCanvas() {
    this.drawingCtx.clearRect(
      0,
      0,
      this.drawingCanvas.width,
      this.drawingCanvas.height
    );
  }

  cleanupDrawingProcess() {
    if (this.finishDrawLineHandler) {
      tickerInstance.unsubscribe(this.finishDrawLineHandler);
      this.finishDrawLineHandler = null;
    }
    this.disableDrawingMode();
    this.saveDrawingToOverlay();
  }

  saveDrawingToOverlay() {
    const { start, end } = this.points;

    this.overlayCtx.beginPath();
    this.overlayCtx.moveTo(start.x, start.y);
    this.overlayCtx.lineTo(end.x, end.y);
    this.overlayCtx.strokeStyle = "red";
    this.overlayCtx.stroke();

    const { x: startDataX, y: startDataY } = this.getValueForPixel(
      start.x,
      start.y
    );
    const { x: endDataX, y: endDataY } = this.getValueForPixel(end.x, end.y);

    window.mainCanvas.storeOverlay(startDataX, startDataY, endDataX, endDataY);
    this.clearDrawingCanvas();
    this.resetDrawingState();
  }

  disableDrawingMode() {
    this.setupMouseListeners(false);
    this.isDrawingMode = false;
    this.setChartZoomPanState(true);
  }

  // 좌표 변환 유틸리티 메서드
  /**
   * 픽셀 좌표를 데이터 값으로 변환합니다.
   * @param {number} pixelX - X축 픽셀 좌표
   * @param {number} pixelY - Y축 픽셀 좌표
   * @returns {Object} 변환된 데이터 좌표 {x, y}
   */
  getValueForPixel(pixelX, pixelY) {
    const chart = this.chartCtx.chart;
    const xScale = chart.scales.x;
    const yScale = chart.scales.y;

    return {
      x: xScale.getValueForPixel(pixelX),
      y: yScale.getValueForPixel(pixelY),
    };
  }

  /**
   * 데이터 값을 픽셀 좌표로 변환합니다.
   * @param {number} dataX - X축 데이터 값
   * @param {number} dataY - Y축 데이터 값
   * @returns {Object} 변환된 픽셀 좌표 {x, y}
   */
  getPixelForValue(dataX, dataY) {
    const chart = this.chartCtx.chart;
    const xScale = chart.scales.x;
    const yScale = chart.scales.y;

    return {
      x: xScale.getPixelForValue(dataX),
      y: yScale.getPixelForValue(dataY),
    };
  }
}
