import { tickerInstance } from "./ticker.js";
import { EventTypes } from "../utilities/eventManager.js";
import {
  calculateSlope,
  calculateDirection,
  calculateExtendedLineIntersections,
  calculateRayIntersection,
  drawLine,
  drawAnchorPoint,
} from "../utilities/lineUtils.js";

export class DrawingTool {
  constructor(container, chartCanvas, drawingCanvas, overlayCanvas) {
    this.container = container;
    this.chartCtx = chartCanvas;
    this.drawingCanvas = drawingCanvas;
    this.drawingCtx = drawingCanvas.getContext("2d");
    this.overlayCanvas = overlayCanvas;
    this.overlayCtx = overlayCanvas.getContext("2d");

    // 바인딩된 이벤트 핸들러 참조 저장
    this.boundOnMouseMove = this.onMouseMove.bind(this);
    this.boundOnMouseClick = this.onMouseClick.bind(this);

    this.currentPosition = { x: null, y: null };
    this.points = {
      start: { x: null, y: null },
      end: { x: null, y: null },
    };
    this.clickCount = 0;
    this.finishDrawLineHandler = null;
    this.isDrawingMode = false;
    this.originalZoomPanState = null;
    this.currentTool = null;

    this.tools = [
      { name: "Line", icon: "public/icons/line.svg" },
      { name: "ExtendedLine", icon: "public/icons/extended line.svg" },
      { name: "Ray", icon: "public/icons/ray.svg" },
      { name: "HorizontalLine", icon: "public/icons/horizontal line.svg" },
      { name: "VerticalLine", icon: "public/icons/vertical line.svg" },
    ];

    // 커스텀 이벤트 리스너를 위한 맵 추가
    this.eventListeners = new Map();
    [
      EventTypes.DRAWING_START,
      EventTypes.DRAWING_MOVE,
      EventTypes.DRAWING_END,
      EventTypes.TOOL_CHANGE,
      EventTypes.DRAWING_CANCEL,
    ].forEach((type) => {
      this.eventListeners.set(type, new Set());
    });
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
        this.selectTool(tool.name);
      });

      toolPanel.appendChild(button);
    });
  }

  // 도구 선택 및 그리기 모드 제어 메서드
  selectTool(toolName) {
    // 이미 선택된 도구를 다시 클릭하면 선택 해제
    if (this.currentTool === toolName) {
      this.disableDrawingMode(true);
      return;
    }

    // 이전 도구 선택 해제
    if (this.currentTool) {
      this.updateToolButtonStyles(this.currentTool, false);
    }

    // 완전한 상태 초기화
    this.clearDrawingCanvas();
    this.resetDrawingState();

    // 새 도구 선택
    this.currentTool = toolName;
    this.updateToolButtonStyles(toolName, true);
    this.enableDrawingMode();

    // 이벤트 발생
    this.dispatchEvent(EventTypes.TOOL_CHANGE, { tool: toolName });
    console.log(`도구 선택됨: ${toolName}`);
  }

  // 도구 버튼 스타일 업데이트
  updateToolButtonStyles(toolName, isSelected) {
    if (!toolName) return;

    const button = this.findButtonByToolName(toolName);
    if (button) {
      if (isSelected) {
        button.classList.add("selected");
      } else {
        button.classList.remove("selected");
      }
    }
  }

  // 도구 이름으로 버튼 찾기
  findButtonByToolName(toolName) {
    const buttons = this.container.querySelectorAll("button");
    for (const button of buttons) {
      const img = button.querySelector("img");
      if (img && img.alt === toolName) {
        return button;
      }
    }
    return null;
  }

  // 그리기 상태 초기화
  resetDrawingState() {
    console.log("그리기 상태 초기화");
    this.clickCount = 0;
    this.currentPosition = { x: null, y: null };
    this.points = {
      start: { x: null, y: null },
      end: { x: null, y: null },
    };

    // 티커 구독 상태 확인 및 해제
    if (this.finishDrawLineHandler) {
      tickerInstance.unsubscribe(this.finishDrawLineHandler);
      this.finishDrawLineHandler = null;
    }
  }

  // 그리기 모드 활성화 메서드
  enableDrawingMode() {
    this.isDrawingMode = true;
    this.setChartZoomPanState(false);
    this.setupMouseListeners(true);
  }

  // 차트 줌/팬 상태 설정 (더 명확한 구현)
  setChartZoomPanState(enabled) {
    if (!this.chartCtx.chart) return;

    const chart = this.chartCtx.chart;
    const zoomOptions = chart.options.plugins.zoom;

    if (enabled) {
      // 원래 상태로 복원
      if (this.originalZoomPanState) {
        zoomOptions.zoom.wheel.enabled = this.originalZoomPanState.zoomEnabled;
        zoomOptions.pan.enabled = this.originalZoomPanState.panEnabled;
        console.log("그리기 모드 비활성화: 줌/패닝 기능 복원됨");
      }
    } else {
      // 현재 상태 저장 및 비활성화
      this.originalZoomPanState = {
        zoomEnabled: zoomOptions.zoom.wheel.enabled,
        panEnabled: zoomOptions.pan.enabled,
      };

      zoomOptions.zoom.wheel.enabled = false;
      zoomOptions.pan.enabled = false;
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
      if (typeof window.mainCanvas.addEventListener === "function") {
        window.mainCanvas.addEventListener(
          EventTypes.MOUSE_MOVE,
          this.boundOnMouseMove
        );
        window.mainCanvas.addEventListener(
          EventTypes.MOUSE_CLICK,
          this.boundOnMouseClick
        );
        window.mainCanvas.addEventListener(
          EventTypes.DRAWING_CANCEL,
          this.cancelDrawing.bind(this)
        );
      } else {
        console.error("이벤트 구독에 실패했습니다.");
      }

      console.log("마우스 이벤트 구독 시작");
    } else {
      // 리스너 제거
      if (typeof window.mainCanvas.removeEventListener === "function") {
        window.mainCanvas.removeEventListener(
          EventTypes.MOUSE_MOVE,
          this.boundOnMouseMove
        );
        window.mainCanvas.removeEventListener(
          EventTypes.MOUSE_CLICK,
          this.boundOnMouseClick
        );
        window.mainCanvas.removeEventListener(
          EventTypes.DRAWING_CANCEL,
          this.cancelDrawing.bind(this)
        );
      }

      console.log("마우스 이벤트 구독 취소됨");
    }
  }

  // 마우스 이벤트 핸들러
  onMouseMove(x, y) {
    if (!this.isDrawingMode) return;

    // 데이터 좌표로 변환
    const { x: dataX, y: dataY } = this.getValueForPixel(x, y);
    this.currentPosition.x = dataX;
    this.currentPosition.y = dataY;

    // 도구별 처리
    switch (this.currentTool) {
      case "HorizontalLine":
        this.previewHorizontalLine();
        break;
      case "VerticalLine":
        this.previewVerticalLine();
        break;
      case "Line":
      case "Ray":
      case "ExtendedLine":
        // 첫 번째 클릭 후 선 그리기 모드에서만 처리
        if (this.clickCount === 1) {
          if (!this.finishDrawLineHandler) {
            this.finishDrawLineHandler = this.finishDrawLine.bind(this);
            tickerInstance.subscribe(this.finishDrawLineHandler);
          }
        }
        break;
    }
  }

  onMouseClick(x, y) {
    if (!this.isDrawingMode) return;

    console.log("클릭 시 도구:", this.currentTool); // 디버깅용 로그 추가
    console.log("클릭 시 클릭 카운트:", this.clickCount); // 디버깅용 로그 추가
    this.clickCount++;

    // 데이터 좌표로 변환
    const { x: dataX, y: dataY } = this.getValueForPixel(x, y);

    // 수평선/수직선의 경우 한 번의 클릭으로 그리기
    if (
      this.currentTool === "HorizontalLine" ||
      this.currentTool === "VerticalLine"
    ) {
      this.currentPosition.x = dataX;
      this.currentPosition.y = dataY;
      this.drawSingleClickLine();
      this.disableDrawingMode(true); // 완전히 종료
      return;
    }

    // 첫 번째 클릭: 시작점 설정
    if (this.clickCount === 1) {
      const { x: pixelX, y: pixelY } = this.getPixelForValue(dataX, dataY);
      this.points.start.x = pixelX;
      this.points.start.y = pixelY;
    }
    // 두 번째 클릭: 끝점 설정 및 그리기 완료
    else if (this.clickCount === 2) {
      // 클릭한 지점이 차트 영역 밖인지 확인
      const chartArea = this.chartCtx.chart.chartArea;
      const { x: pixelX, y: pixelY } = this.getPixelForValue(dataX, dataY);

      // 차트 영역 밖인 경우 그리기 취소
      if (
        pixelX < chartArea.left ||
        pixelX > chartArea.right ||
        pixelY < chartArea.top ||
        pixelY > chartArea.bottom
      ) {
        console.log("차트 영역 밖 클릭으로 그리기 취소");
        this.clearDrawingCanvas();
        this.clickCount = 0;

        // 티커에서 업데이트 핸들러 제거
        if (this.finishDrawLineHandler) {
          tickerInstance.unsubscribe(this.finishDrawLineHandler);
          this.finishDrawLineHandler = null;
        }

        this.dispatchEvent(EventTypes.DRAWING_CANCEL, {
          reason: "차트 영역 밖 클릭",
        });

        this.disableDrawingMode(true);

        return;
      }

      this.points.end.x = pixelX;
      this.points.end.y = pixelY;

      // 티커에서 업데이트 핸들러 제거
      if (this.finishDrawLineHandler) {
        tickerInstance.unsubscribe(this.finishDrawLineHandler);
        this.finishDrawLineHandler = null;
      }

      this.saveDrawingToOverlay();
      this.disableDrawingMode(true); // 완전히 종료
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

    // 이벤트 발생
    this.dispatchEvent(EventTypes.DRAWING_START, {
      x: this.currentPosition.x,
      y: this.currentPosition.y,
    });
  }

  finishDrawLine() {
    const { x: pixelX, y: pixelY } = this.getPixelForValue(
      this.currentPosition.x,
      this.currentPosition.y
    );
    this.points.end.x = pixelX;
    this.points.end.y = pixelY;
    // 도구별 적절한 미리보기 메서드 호출
    if (this.currentTool === "ExtendedLine") {
      this.previewExtendedLine();
    } else if (this.currentTool === "Ray") {
      this.previewRay();
    } else {
      this.drawLine(); // 일반 Line
    }

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

    // 수평/수직선일 경우는 이미 저장되었으므로 중복 저장 방지
    if (
      this.currentTool !== "HorizontalLine" &&
      this.currentTool !== "VerticalLine"
    ) {
      this.saveDrawingToOverlay();
    }
  }

  saveDrawingToOverlay() {
    // 이미 정리되었는지 확인
    if (!this.points.start.x || !this.points.end.x) return;

    const { start, end } = this.points;
    const chartArea = this.chartCtx.chart.chartArea;

    // 데이터 값으로 변환
    const startData = this.getValueForPixel(start.x, start.y);
    const endData = this.getValueForPixel(end.x, end.y);

    // 오버레이 저장 (선 타입 정보 추가)
    window.mainCanvas.storeOverlay(
      startData.x,
      startData.y,
      endData.x,
      endData.y,
      this.currentTool // 선 타입 정보 전달
    );

    console.log(window.mainCanvas.getOverlaysArray());
    // 드로잉 캔버스 비우기
    this.clearDrawingCanvas();

    // 그리기 상태 초기화
    this.resetDrawingState();

    // 추가: 즉시 오버레이 렌더링 호출
    if (window.mainCanvas.chartTestInstance?.renderOverlays) {
      window.mainCanvas.chartTestInstance.renderOverlays();
    }
  }

  disableDrawingMode(resetTool = true) {
    this.isDrawingMode = false;
    this.setChartZoomPanState(true);
    this.setupMouseListeners(false);
    this.resetDrawingState();

    // 선택된 도구 버튼 스타일은 완전히 그리기를 마칠 때만 업데이트
    if (resetTool) {
      // 선택된 도구 버튼 스타일 업데이트
      this.updateToolButtonStyles(this.currentTool, false);
      this.currentTool = null; // 도구 초기화는 resetTool이 true일 때만
    }

    console.log("그리기 모드 비활성화됨, 도구 초기화:", resetTool);
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

  // 이벤트 발생 메서드
  dispatchEvent(type, data) {
    const listeners = this.eventListeners.get(type);
    if (listeners) {
      listeners.forEach((listener) => {
        if (typeof listener === "function") {
          listener(data);
        }
      });
    }
  }

  // 이벤트 리스너 추가 메서드
  addEventListener(type, listener) {
    const listeners = this.eventListeners.get(type);
    if (listeners) {
      listeners.add(listener);
    }
    return this;
  }

  // 이벤트 리스너 제거 메서드
  removeEventListener(type, listener) {
    const listeners = this.eventListeners.get(type);
    if (listeners) {
      listeners.delete(listener);
    }
    return this;
  }

  // 그리기 취소 메서드 수정
  cancelDrawing() {
    console.log("그리기 취소됨");

    // 드로잉 캔버스 클리어
    this.clearDrawingCanvas();

    // 모든 상태 완전 초기화
    this.resetDrawingState();

    // 그리기 모드 비활성화 및 도구 선택 초기화
    this.disableDrawingMode(true);

    // 이벤트 발생
    this.dispatchEvent(EventTypes.DRAWING_CANCEL);
  }

  // 수평/수직선 그리기 위한 메서드 추가
  previewHorizontalLine() {
    this.clearDrawingCanvas();

    const { x: pixelX, y: pixelY } = this.getPixelForValue(
      this.currentPosition.x,
      this.currentPosition.y
    );

    // 차트 영역의 가로 전체를 커버하는 수평선
    const chartArea = this.chartCtx.chart.chartArea;
    const startX = chartArea.left;
    const endX = chartArea.right;

    this.drawingCtx.beginPath();
    this.drawingCtx.moveTo(startX, pixelY);
    this.drawingCtx.lineTo(endX, pixelY);
    this.drawingCtx.lineWidth = 1;
    this.drawingCtx.strokeStyle = "white";
    this.drawingCtx.stroke();
  }

  previewVerticalLine() {
    this.clearDrawingCanvas();

    const { x: pixelX, y: pixelY } = this.getPixelForValue(
      this.currentPosition.x,
      this.currentPosition.y
    );

    // 차트 영역의 세로 전체를 커버하는 수직선
    const chartArea = this.chartCtx.chart.chartArea;
    const startY = chartArea.top;
    const endY = chartArea.bottom;

    this.drawingCtx.beginPath();
    this.drawingCtx.moveTo(pixelX, startY);
    this.drawingCtx.lineTo(pixelX, endY);
    this.drawingCtx.lineWidth = 1;
    this.drawingCtx.strokeStyle = "white";
    this.drawingCtx.stroke();
  }

  // 한 번의 클릭으로 선 그리기
  drawSingleClickLine() {
    const { x: pixelX, y: pixelY } = this.getPixelForValue(
      this.currentPosition.x,
      this.currentPosition.y
    );
    const chartArea = this.chartCtx.chart.chartArea;

    if (this.currentTool === "HorizontalLine") {
      this.points.start = { x: chartArea.left, y: pixelY };
      this.points.end = { x: chartArea.right, y: pixelY };
    } else if (this.currentTool === "VerticalLine") {
      this.points.start = { x: pixelX, y: chartArea.top };
      this.points.end = { x: pixelX, y: chartArea.bottom };
    }

    this.saveHorizontalOrVerticalLine();
  }

  // 수평/수직선 저장
  saveHorizontalOrVerticalLine() {
    const { start, end } = this.points;

    // 데이터 값으로 변환
    const startData = this.getValueForPixel(start.x, start.y);
    const endData = this.getValueForPixel(end.x, end.y);

    // 오버레이 저장 (선 타입 정보 추가)
    window.mainCanvas.storeOverlay(
      startData.x,
      startData.y,
      endData.x,
      endData.y,
      this.currentTool // 선 타입 정보 전달
    );

    this.clearDrawingCanvas();

    // 추가: 즉시 오버레이 렌더링 호출
    if (window.mainCanvas.chartTestInstance?.renderOverlays) {
      window.mainCanvas.chartTestInstance.renderOverlays();
    }
  }

  // ExtendedLine 미리보기 메서드 추가
  previewExtendedLine() {
    this.clearDrawingCanvas();

    const { start, end } = this.points;
    const chartArea = this.chartCtx.chart.chartArea;

    // 두 점이 같으면 처리하지 않음
    if (start.x === end.x && start.y === end.y) return;

    // 기울기 계산
    const slope = calculateSlope(start.x, start.y, end.x, end.y);

    let startPx, endPx;

    if (slope === Infinity || slope === -Infinity) {
      // 수직선인 경우
      startPx = { x: start.x, y: chartArea.top };
      endPx = { x: start.x, y: chartArea.bottom };
    } else if (slope === 0) {
      // 수평선인 경우
      startPx = { x: chartArea.left, y: start.y };
      endPx = { x: chartArea.right, y: start.y };
    } else {
      // 일반적인 기울기를 가진 직선
      // 차트 좌측 경계와의 교차점 계산
      const yAtLeft = start.y - slope * (start.x - chartArea.left);
      // 차트 우측 경계와의 교차점 계산
      const yAtRight = start.y + slope * (chartArea.right - start.x);

      // 차트 상단 경계와의 교차점 계산
      const xAtTop = yAtTop(chartArea.top);
      // 차트 하단 경계와의 교차점 계산
      const xAtBottom = yAtTop(chartArea.bottom);

      // 교차점이 차트 영역 내에 있는지 확인하고 선택
      if (yAtLeft >= chartArea.top && yAtLeft <= chartArea.bottom) {
        startPx = { x: chartArea.left, y: yAtLeft };
      } else if (xAtTop >= chartArea.left && xAtTop <= chartArea.right) {
        startPx = { x: xAtTop, y: chartArea.top };
      } else {
        // 기본값
        startPx = { x: chartArea.left, y: yAtLeft };
      }

      if (yAtRight >= chartArea.top && yAtRight <= chartArea.bottom) {
        endPx = { x: chartArea.right, y: yAtRight };
      } else if (xAtBottom >= chartArea.left && xAtBottom <= chartArea.right) {
        endPx = { x: xAtBottom, y: chartArea.bottom };
      } else {
        // 기본값
        endPx = { x: chartArea.right, y: yAtRight };
      }
    }

    // x좌표로부터 y좌표 계산 함수
    function yAtTop(y) {
      return start.x + (y - start.y) / slope;
    }

    // 확장된 직선 그리기
    this.drawingCtx.beginPath();
    this.drawingCtx.moveTo(startPx.x, startPx.y);
    this.drawingCtx.lineTo(endPx.x, endPx.y);
    this.drawingCtx.lineWidth = 1;
    this.drawingCtx.strokeStyle = "white";
    this.drawingCtx.stroke();

    // 앵커 포인트 표시
    this.drawingCtx.beginPath();
    this.drawingCtx.arc(start.x, start.y, 4, 0, Math.PI * 2);
    this.drawingCtx.fillStyle = "white";
    this.drawingCtx.fill();
  }

  // Ray 미리보기 메서드 추가
  previewRay() {
    this.clearDrawingCanvas();

    const { start, end } = this.points;
    const chartArea = this.chartCtx.chart.chartArea;

    // 두 점이 같으면 처리하지 않음
    if (start.x === end.x && start.y === end.y) return;

    // 기울기 계산
    const slope = calculateSlope(start.x, start.y, end.x, end.y);

    // 방향 계산 (시작점에서 마우스 방향)
    const direction = calculateDirection(start.x, start.y, end.x, end.y);

    let endPx;

    if (slope === Infinity || slope === -Infinity) {
      // 수직선인 경우 - 방향에 따라 위/아래로 확장
      endPx = {
        x: start.x,
        y: direction.y > 0 ? chartArea.bottom : chartArea.top,
      };
    } else if (slope === 0) {
      // 수평선인 경우 - 방향에 따라 좌/우로 확장
      endPx = {
        x: direction.x > 0 ? chartArea.right : chartArea.left,
        y: start.y,
      };
    } else {
      // 각 경계와의 교차점 계산
      const intersections = [];

      // 오른쪽 경계와의 교차점
      const yAtRight = start.y + slope * (chartArea.right - start.x);
      if (yAtRight >= chartArea.top && yAtRight <= chartArea.bottom) {
        intersections.push({
          x: chartArea.right,
          y: yAtRight,
          distance:
            Math.pow(chartArea.right - start.x, 2) +
            Math.pow(yAtRight - start.y, 2),
          direction: { x: 1, y: yAtRight > start.y ? 1 : -1 },
        });
      }

      // 왼쪽 경계와의 교차점
      const yAtLeft = start.y + slope * (chartArea.left - start.x);
      if (yAtLeft >= chartArea.top && yAtLeft <= chartArea.bottom) {
        intersections.push({
          x: chartArea.left,
          y: yAtLeft,
          distance:
            Math.pow(chartArea.left - start.x, 2) +
            Math.pow(yAtLeft - start.y, 2),
          direction: { x: -1, y: yAtLeft > start.y ? 1 : -1 },
        });
      }

      // 상단 경계와의 교차점
      const xAtTop = start.x + (chartArea.top - start.y) / slope;
      if (xAtTop >= chartArea.left && xAtTop <= chartArea.right) {
        intersections.push({
          x: xAtTop,
          y: chartArea.top,
          distance:
            Math.pow(xAtTop - start.x, 2) +
            Math.pow(chartArea.top - start.y, 2),
          direction: { x: xAtTop > start.x ? 1 : -1, y: -1 },
        });
      }

      // 하단 경계와의 교차점
      const xAtBottom = start.x + (chartArea.bottom - start.y) / slope;
      if (xAtBottom >= chartArea.left && xAtBottom <= chartArea.right) {
        intersections.push({
          x: xAtBottom,
          y: chartArea.bottom,
          distance:
            Math.pow(xAtBottom - start.x, 2) +
            Math.pow(chartArea.bottom - start.y, 2),
          direction: { x: xAtBottom > start.x ? 1 : -1, y: 1 },
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
        endPx = end;
      }
    }

    // 반직선 그리기
    this.drawingCtx.beginPath();
    this.drawingCtx.moveTo(start.x, start.y);
    this.drawingCtx.lineTo(endPx.x, endPx.y);
    this.drawingCtx.lineWidth = 1;
    this.drawingCtx.strokeStyle = "white";
    this.drawingCtx.stroke();

    // 앵커 포인트 표시
    this.drawingCtx.beginPath();
    this.drawingCtx.arc(start.x, start.y, 4, 0, Math.PI * 2);
    this.drawingCtx.fillStyle = "white";
    this.drawingCtx.fill();
  }
}
