import { tickerInstance } from "./ticker.js";
import { EventTypes } from "../utilities/eventManager.js";
import { calculateSlope, calculateDirection } from "../utilities/lineUtils.js";

export class DrawingTool {
  constructor(container, chartInstance, drawingCanvas, overlayCanvas) {
    this.container = container;

    // 차트 인스턴스 참조 업데이트
    this.chartInstance = chartInstance;
    this.chartCtx = chartInstance.chartCtx;

    // 캔버스 참조
    this.drawingCanvas = drawingCanvas;
    this.drawingCtx = drawingCanvas.getContext("2d");
    this.overlayCanvas = overlayCanvas;
    this.overlayCtx = overlayCanvas.getContext("2d");

    // 리팩토링된 차트 모듈 구성요소에 접근
    this.overlayManager = chartInstance.overlayManager;
    this.eventHandler = chartInstance.eventHandler;

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

    // 차트 이벤트 핸들러에 드로잉 도구 등록
    if (this.eventHandler) {
      this.registerWithEventHandler();
    }
  }

  // 차트 이벤트 핸들러에 등록
  registerWithEventHandler() {
    if (!this.eventHandler) return;

    // 이벤트 핸들러에 드로잉 도구 참조 등록
    if (typeof this.eventHandler.registerDrawingTool === "function") {
      this.eventHandler.registerDrawingTool(this);
    } else {
      console.warn(
        "ChartEventHandler에 registerDrawingTool 메서드가 없습니다. 이벤트 핸들러를 확장해야 합니다."
      );
    }
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

  // 그리기 모드 활성화
  enableDrawingMode() {
    if (this.isDrawingMode) return;

    // 차트 이벤트 핸들러에 드로잉 모드 설정
    if (this.eventHandler) {
      this.eventHandler.setDrawingMode(true);
    }

    // 원래 차트의 줌/패닝 상태 저장
    this.saveChartZoomPanState();

    // 차트의 줌/패닝 비활성화
    this.disableChartZoomPan();

    // 마우스 이벤트 리스너 설정
    this.setupMouseListeners(true);

    this.isDrawingMode = true;
    this.dispatchEvent(EventTypes.DRAWING_START, { tool: this.currentTool });
    console.log("드로잉 모드 활성화됨");
  }

  // 그리기 모드 비활성화
  disableDrawingMode(resetTool = false) {
    if (!this.isDrawingMode) return;

    // 차트 이벤트 핸들러에 드로잉 모드 해제
    if (this.eventHandler) {
      this.eventHandler.setDrawingMode(false);
    }

    // 차트의 줌/패닝 복원
    this.restoreChartZoomPanState();

    // 마우스 이벤트 리스너 제거
    this.setupMouseListeners(false);

    // 그리기 상태 초기화
    this.clearDrawingCanvas();
    this.resetDrawingState();

    // 도구 선택 해제 (필요한 경우)
    if (resetTool && this.currentTool) {
      this.updateToolButtonStyles(this.currentTool, false);
      this.currentTool = null;
    }

    this.isDrawingMode = false;
    this.dispatchEvent(EventTypes.DRAWING_CANCEL, {});
    console.log("드로잉 모드 비활성화됨");
  }

  // 차트 줌/팬 상태 설정 (더 명확한 구현)
  setChartZoomPanState(enabled) {
    if (enabled) {
      this.restoreChartZoomPanState();
    } else {
      this.saveChartZoomPanState();
      this.disableChartZoomPan();
    }
  }

  // 차트 줌/팬 상태 저장
  saveChartZoomPanState() {
    if (!this.chartInstance || !this.chartInstance.chart) return;

    try {
      const chart = this.chartInstance.chart;

      // Chart.js 줌 플러그인 확인
      if (chart.options && chart.options.plugins) {
        const zoomOptions = chart.options.plugins.zoom;

        if (zoomOptions) {
          // 현재 상태 저장
          this.originalZoomPanState = {
            zoomEnabled: zoomOptions.zoom?.wheel?.enabled,
            panEnabled: zoomOptions.pan?.enabled,
          };

          console.log(
            "차트 줌/패닝 상태가 저장되었습니다:",
            this.originalZoomPanState
          );
        } else {
          // 이벤트 핸들러를 통한 상태 저장
          if (this.eventHandler) {
            this.originalZoomPanState = {
              isDragging: this.eventHandler.isDragging,
              isWheelActive: this.eventHandler.isWheelActive,
            };
            console.log(
              "이벤트 핸들러 상태가 저장되었습니다:",
              this.originalZoomPanState
            );
          }
        }
      }
    } catch (error) {
      console.error("차트 줌/패닝 상태 저장 중 오류:", error);
    }
  }

  // 차트 줌/팬 비활성화
  disableChartZoomPan() {
    if (!this.chartInstance || !this.chartInstance.chart) return;

    try {
      const chart = this.chartInstance.chart;

      // Chart.js 줌 플러그인 확인
      if (chart.options && chart.options.plugins) {
        const zoomOptions = chart.options.plugins.zoom;

        if (zoomOptions) {
          // 줌/패닝 기능 비활성화
          if (zoomOptions.zoom?.wheel) zoomOptions.zoom.wheel.enabled = false;
          if (zoomOptions.pan) zoomOptions.pan.enabled = false;

          chart.update("none");
          console.log("차트 줌/패닝 기능이 비활성화되었습니다.");
        }
      }

      // 이벤트 핸들러를 통한 비활성화
      if (this.eventHandler) {
        this.eventHandler.isDragging = false;
        this.eventHandler.isWheelActive = false;
        console.log("이벤트 핸들러 상태가 비활성화되었습니다.");
      }
    } catch (error) {
      console.error("차트 줌/패닝 비활성화 중 오류:", error);
    }
  }

  // 차트 줌/팬 상태 복원
  restoreChartZoomPanState() {
    if (
      !this.chartInstance ||
      !this.chartInstance.chart ||
      !this.originalZoomPanState
    )
      return;

    try {
      const chart = this.chartInstance.chart;

      // Chart.js 줌 플러그인 확인
      if (chart.options && chart.options.plugins) {
        const zoomOptions = chart.options.plugins.zoom;

        if (
          zoomOptions &&
          this.originalZoomPanState.zoomEnabled !== undefined
        ) {
          // 원래 상태로 복원
          if (zoomOptions.zoom?.wheel) {
            zoomOptions.zoom.wheel.enabled =
              this.originalZoomPanState.zoomEnabled;
          }

          if (zoomOptions.pan) {
            zoomOptions.pan.enabled = this.originalZoomPanState.panEnabled;
          }

          chart.update("none");
          console.log(
            "차트 줌/패닝 상태가 복원되었습니다:",
            this.originalZoomPanState
          );
        }
      }

      // 이벤트 핸들러를 통한 상태 복원
      if (
        this.eventHandler &&
        this.originalZoomPanState.isDragging !== undefined
      ) {
        this.eventHandler.isDragging = this.originalZoomPanState.isDragging;
        this.eventHandler.isWheelActive =
          this.originalZoomPanState.isWheelActive;
        console.log(
          "이벤트 핸들러 상태가 복원되었습니다:",
          this.originalZoomPanState
        );
      }
    } catch (error) {
      console.error("차트 줌/패닝 상태 복원 중 오류:", error);
    }
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
        // 첫 번째 클릭 후 선 그리기 모드에서만 처리
        if (this.clickCount === 1) {
          this.previewLine();
          if (!this.finishDrawLineHandler) {
            this.finishDrawLineHandler = this.finishDrawLine.bind(this);
            tickerInstance.subscribe(this.finishDrawLineHandler);
          }
        }
        break;
      case "Ray":
        // 첫 번째 클릭 후 선 그리기 모드에서만 처리
        if (this.clickCount === 1) {
          this.previewRay();
          if (!this.finishDrawLineHandler) {
            this.finishDrawLineHandler = this.finishDrawLine.bind(this);
            tickerInstance.subscribe(this.finishDrawLineHandler);
          }
        }
        break;
      case "ExtendedLine":
        // 첫 번째 클릭 후 선 그리기 모드에서만 처리
        if (this.clickCount === 1) {
          this.previewExtendedLine();
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

    // 클릭 카운트 증가 (여기로 이동)
    this.clickCount++;

    // 첫 번째 클릭: 시작점 설정
    if (this.clickCount === 1) {
      const { x: pixelX, y: pixelY } = this.getPixelForValue(dataX, dataY);
      this.points.start.x = pixelX;
      this.points.start.y = pixelY;

      // 첫 번째 클릭 후 미리보기 시작
      switch (this.currentTool) {
        case "Line":
          this.previewLine();
          break;
        case "Ray":
          this.previewRay();
          break;
        case "ExtendedLine":
          this.previewExtendedLine();
          break;
      }
    }
    // 두 번째 클릭: 끝점 설정 및 그리기 완료
    else if (this.clickCount === 2) {
      // 클릭한 지점이 차트 영역 밖인지 확인
      const chartArea = this.chartInstance.chart.chartArea;
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

      console.log("두 번째 클릭 - 그리기 완료:", {
        startX: this.points.start.x,
        startY: this.points.start.y,
        endX: pixelX,
        endY: pixelY,
        tool: this.currentTool,
      });

      this.points.end.x = pixelX;
      this.points.end.y = pixelY;

      // 티커에서 업데이트 핸들러 제거
      if (this.finishDrawLineHandler) {
        tickerInstance.unsubscribe(this.finishDrawLineHandler);
        this.finishDrawLineHandler = null;
      }

      // 최종 그리기 저장
      this.saveDrawingToOverlay();

      // 그리기 모드 비활성화
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

  // 선 그리기 완료 (ticker에서 호출)
  finishDrawLine() {
    if (this.clickCount !== 1 || !this.isDrawingMode) {
      if (this.finishDrawLineHandler) {
        tickerInstance.unsubscribe(this.finishDrawLineHandler);
        this.finishDrawLineHandler = null;
      }
      return;
    }

    this.clearDrawingCanvas();

    // 시작점과 현재 위치 사이에 선 그리기
    const startPoint = this.points.start;
    const { x: pixelX, y: pixelY } = this.getPixelForValue(
      this.currentPosition.x,
      this.currentPosition.y
    );
    const currentPixelPosition = { x: pixelX, y: pixelY };

    // 도구별 미리보기 처리
    switch (this.currentTool) {
      case "Line":
        this.previewLine();
        break;
      case "Ray":
        this.previewRay();
        break;
      case "ExtendedLine":
        this.previewExtendedLine();
        break;
      default:
        // 임시 선 그리기 (드로잉 캔버스에)
        this.drawLineOnCanvas(
          this.drawingCtx,
          startPoint.x,
          startPoint.y,
          currentPixelPosition.x,
          currentPixelPosition.y,
          this.currentTool
        );
    }
  }

  // 일반 선 미리보기
  previewLine() {
    if (!this.points.start.x) return;

    this.clearDrawingCanvas();

    // 시작점과 현재 마우스 위치 사이에 선 그리기
    const startPoint = this.points.start;
    const { x: pixelX, y: pixelY } = this.getPixelForValue(
      this.currentPosition.x,
      this.currentPosition.y
    );

    this.drawingCtx.beginPath();
    this.drawingCtx.moveTo(startPoint.x, startPoint.y);
    this.drawingCtx.lineTo(pixelX, pixelY);
    this.drawingCtx.lineWidth = 1;
    this.drawingCtx.strokeStyle = "white";
    this.drawingCtx.stroke();

    // 앵커 포인트 표시
    this.drawingCtx.beginPath();
    this.drawingCtx.arc(startPoint.x, startPoint.y, 4, 0, Math.PI * 2);
    this.drawingCtx.fillStyle = "white";
    this.drawingCtx.fill();
  }

  // Ray 미리보기
  previewRay() {
    if (!this.points.start.x) return;

    this.clearDrawingCanvas();

    // 시작점과 현재 마우스 위치
    const startPoint = this.points.start;
    const { x: pixelX, y: pixelY } = this.getPixelForValue(
      this.currentPosition.x,
      this.currentPosition.y
    );

    // 차트 영역 가져오기
    const chartArea = this.chartInstance.chart.chartArea;

    // 방향 계산
    const direction = calculateDirection(
      startPoint.x,
      startPoint.y,
      pixelX,
      pixelY
    );

    // 기울기 계산
    const slope = calculateSlope(startPoint.x, startPoint.y, pixelX, pixelY);

    // 차트 경계와의 교차점 계산
    let endPx = { x: pixelX, y: pixelY };
    const intersections = [];

    // 수평선인 경우
    if (slope === 0) {
      if (direction.x > 0) {
        endPx = { x: chartArea.right, y: startPoint.y };
      } else {
        endPx = { x: chartArea.left, y: startPoint.y };
      }
    }
    // 수직선인 경우
    else if (!isFinite(slope)) {
      if (direction.y > 0) {
        endPx = { x: startPoint.x, y: chartArea.bottom };
      } else {
        endPx = { x: startPoint.x, y: chartArea.top };
      }
    }
    // 일반적인 기울기를 가진 선
    else {
      // 각 경계와의 교차점 계산
      // 오른쪽 경계와의 교차점
      if (direction.x > 0) {
        const yAtRight =
          startPoint.y + slope * (chartArea.right - startPoint.x);
        if (yAtRight >= chartArea.top && yAtRight <= chartArea.bottom) {
          intersections.push({
            x: chartArea.right,
            y: yAtRight,
            distance:
              Math.pow(chartArea.right - startPoint.x, 2) +
              Math.pow(yAtRight - startPoint.y, 2),
            direction: { x: 1, y: yAtRight > startPoint.y ? 1 : -1 },
          });
        }
      }

      // 왼쪽 경계와의 교차점
      if (direction.x < 0) {
        const yAtLeft = startPoint.y + slope * (chartArea.left - startPoint.x);
        if (yAtLeft >= chartArea.top && yAtLeft <= chartArea.bottom) {
          intersections.push({
            x: chartArea.left,
            y: yAtLeft,
            distance:
              Math.pow(chartArea.left - startPoint.x, 2) +
              Math.pow(yAtLeft - startPoint.y, 2),
            direction: { x: -1, y: yAtLeft > startPoint.y ? 1 : -1 },
          });
        }
      }

      // 상단 경계와의 교차점
      if (direction.y < 0) {
        const xAtTop = startPoint.x + (chartArea.top - startPoint.y) / slope;
        if (xAtTop >= chartArea.left && xAtTop <= chartArea.right) {
          intersections.push({
            x: xAtTop,
            y: chartArea.top,
            distance:
              Math.pow(xAtTop - startPoint.x, 2) +
              Math.pow(chartArea.top - startPoint.y, 2),
            direction: { x: xAtTop > startPoint.x ? 1 : -1, y: -1 },
          });
        }
      }

      // 하단 경계와의 교차점
      if (direction.y > 0) {
        const xAtBottom =
          startPoint.x + (chartArea.bottom - startPoint.y) / slope;
        if (xAtBottom >= chartArea.left && xAtBottom <= chartArea.right) {
          intersections.push({
            x: xAtBottom,
            y: chartArea.bottom,
            distance:
              Math.pow(xAtBottom - startPoint.x, 2) +
              Math.pow(chartArea.bottom - startPoint.y, 2),
            direction: { x: xAtBottom > startPoint.x ? 1 : -1, y: 1 },
          });
        }
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
        // 가장 가까운 교차점 선택
        endPx = validIntersections.reduce((closest, current) =>
          current.distance < closest.distance ? current : closest
        );
      }
    }

    // 반직선 그리기
    this.drawingCtx.beginPath();
    this.drawingCtx.moveTo(startPoint.x, startPoint.y);
    this.drawingCtx.lineTo(endPx.x, endPx.y);
    this.drawingCtx.lineWidth = 1;
    this.drawingCtx.strokeStyle = "white";
    this.drawingCtx.stroke();

    // 앵커 포인트 표시
    this.drawingCtx.beginPath();
    this.drawingCtx.arc(startPoint.x, startPoint.y, 4, 0, Math.PI * 2);
    this.drawingCtx.fillStyle = "white";
    this.drawingCtx.fill();
  }

  // 오버레이에 선 그리기 (최종 확정)
  drawLineOnOverlay(startPoint, endPoint, lineType) {
    // ChartOverlayManager를 통한 그리기로 변경
    if (this.overlayManager) {
      const style = {
        lineWidth: 2,
        strokeStyle: "#ffffff",
      };

      // 오버레이 관리자를 통해 선 그리기
      switch (lineType) {
        case "Line":
          this.overlayManager.addLine(
            startPoint.x,
            startPoint.y,
            endPoint.x,
            endPoint.y,
            style
          );
          break;
        case "ExtendedLine":
          this.overlayManager.addExtendedLine(
            startPoint.x,
            startPoint.y,
            endPoint.x,
            endPoint.y,
            style
          );
          break;
        case "Ray":
          this.overlayManager.addRay(
            startPoint.x,
            startPoint.y,
            endPoint.x,
            endPoint.y,
            style
          );
          break;
        case "HorizontalLine":
          this.overlayManager.addHorizontalLine(startPoint.y, style);
          break;
        case "VerticalLine":
          this.overlayManager.addVerticalLine(startPoint.x, style);
          break;
        default:
          this.overlayManager.addLine(
            startPoint.x,
            startPoint.y,
            endPoint.x,
            endPoint.y,
            style
          );
      }

      // 오버레이 업데이트 트리거
      this.overlayManager.updateOverlayCanvas();
    } else {
      // 폴백: 기존 방식으로 직접 그리기
      this.drawLineOnCanvas(
        this.overlayCtx,
        startPoint.x,
        startPoint.y,
        endPoint.x,
        endPoint.y,
        lineType
      );

      // 오버레이 저장 (기존 방식)
      if (
        window.mainCanvas &&
        typeof window.mainCanvas.storeOverlay === "function"
      ) {
        window.mainCanvas.storeOverlay(
          startPoint.x,
          startPoint.y,
          endPoint.x,
          endPoint.y,
          lineType
        );
      }
    }
  }

  drawLine() {
    if (!this.drawingCtx || !this.points.start.x || !this.points.end.x) return;

    // 차트 영역 가져오기
    const chartArea = this.chartInstance.chart.chartArea;

    this.clearDrawingCanvas();

    const { start, end } = this.points;

    // 시작점과 마우스 현재 위치(끝점)
    let startPx = { x: start.x, y: start.y };
    let endPx = { x: end.x, y: end.y };

    // 마우스가 차트 영역을 벗어났는지 확인
    const isEndOutsideChart =
      endPx.x < chartArea.left ||
      endPx.x > chartArea.right ||
      endPx.y < chartArea.top ||
      endPx.y > chartArea.bottom;

    if (isEndOutsideChart) {
      // 마우스가 차트 영역 밖에 있을 때 차트 경계와의 교차점 계산
      const slope = calculateSlope(startPx.x, startPx.y, endPx.x, endPx.y);
      const direction = calculateDirection(
        startPx.x,
        startPx.y,
        endPx.x,
        endPx.y
      );

      // 각 경계와의 교차점 계산
      const intersections = [];

      // 오른쪽 경계와의 교차점
      if (direction.x > 0) {
        // 오른쪽 방향이면
        const yAtRight = startPx.y + slope * (chartArea.right - startPx.x);
        if (yAtRight >= chartArea.top && yAtRight <= chartArea.bottom) {
          intersections.push({
            x: chartArea.right,
            y: yAtRight,
            distance:
              Math.pow(chartArea.right - startPx.x, 2) +
              Math.pow(yAtRight - startPx.y, 2),
          });
        }
      }

      // 왼쪽 경계와의 교차점
      if (direction.x < 0) {
        // 왼쪽 방향이면
        const yAtLeft = startPx.y + slope * (chartArea.left - startPx.x);
        if (yAtLeft >= chartArea.top && yAtLeft <= chartArea.bottom) {
          intersections.push({
            x: chartArea.left,
            y: yAtLeft,
            distance:
              Math.pow(chartArea.left - startPx.x, 2) +
              Math.pow(yAtLeft - startPx.y, 2),
          });
        }
      }

      // 상단 경계와의 교차점
      if (direction.y < 0) {
        // 위쪽 방향이면
        const xAtTop = startPx.x + (chartArea.top - startPx.y) / slope;
        if (xAtTop >= chartArea.left && xAtTop <= chartArea.right) {
          intersections.push({
            x: xAtTop,
            y: chartArea.top,
            distance:
              Math.pow(xAtTop - startPx.x, 2) +
              Math.pow(chartArea.top - startPx.y, 2),
          });
        }
      }

      // 하단 경계와의 교차점
      if (direction.y > 0) {
        // 아래쪽 방향이면
        const xAtBottom = startPx.x + (chartArea.bottom - startPx.y) / slope;
        if (xAtBottom >= chartArea.left && xAtBottom <= chartArea.right) {
          intersections.push({
            x: xAtBottom,
            y: chartArea.bottom,
            distance:
              Math.pow(xAtBottom - startPx.x, 2) +
              Math.pow(chartArea.bottom - startPx.y, 2),
          });
        }
      }

      // 가장 가까운 교차점 선택
      if (intersections.length > 0) {
        endPx = intersections.reduce((closest, current) =>
          current.distance < closest.distance ? current : closest
        );
      }
    }

    // 선 그리기
    this.drawingCtx.beginPath();
    this.drawingCtx.moveTo(startPx.x, startPx.y);
    this.drawingCtx.lineTo(endPx.x, endPx.y);
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
    if (!this.points.start.x || !this.points.end.x) {
      console.warn("그리기 저장 실패: 시작점 또는 끝점이 없습니다.");
      return;
    }

    const { start, end } = this.points;
    const chartArea = this.chartInstance.chart.chartArea;

    // 데이터 값으로 변환
    const startData = this.getValueForPixel(start.x, start.y);
    const endData = this.getValueForPixel(end.x, end.y);

    console.log("오버레이 저장 시작:", {
      startData,
      endData,
      tool: this.currentTool,
    });

    // 오버레이 관리자를 통한 저장 시도
    if (this.overlayManager) {
      const style = {
        lineWidth: 2,
        strokeStyle: "#ffffff",
      };

      // 오버레이 관리자를 통해 선 그리기
      switch (this.currentTool) {
        case "Line":
          this.overlayManager.addLine(
            startData.x,
            startData.y,
            endData.x,
            endData.y,
            style
          );
          break;
        case "ExtendedLine":
          this.overlayManager.addExtendedLine(
            startData.x,
            startData.y,
            endData.x,
            endData.y,
            style
          );
          break;
        case "Ray":
          this.overlayManager.addRay(
            startData.x,
            startData.y,
            endData.x,
            endData.y,
            style
          );
          break;
        case "HorizontalLine":
          this.overlayManager.addHorizontalLine(startData.y, style);
          break;
        case "VerticalLine":
          this.overlayManager.addVerticalLine(startData.x, style);
          break;
      }

      // 오버레이 업데이트 트리거
      this.overlayManager.updateOverlayCanvas();
      console.log("오버레이 관리자를 통해 저장 완료");
    } else {
      // 폴백: window.mainCanvas를 통한 저장
      window.mainCanvas.storeOverlay(
        startData.x,
        startData.y,
        endData.x,
        endData.y,
        this.currentTool // 선 타입 정보 전달
      );
      console.log("window.mainCanvas를 통해 저장 완료");
    }

    // 오버레이 배열 확인
    if (window.mainCanvas && window.mainCanvas.getOverlaysArray) {
      console.log("현재 오버레이 배열:", window.mainCanvas.getOverlaysArray());
    }

    // 드로잉 캔버스 비우기
    this.clearDrawingCanvas();

    // 그리기 상태 초기화
    this.resetDrawingState();

    // 즉시 오버레이 렌더링 호출
    if (window.mainCanvas.chartTestInstance?.renderOverlays) {
      console.log("renderOverlays 메서드 호출");
      window.mainCanvas.chartTestInstance.renderOverlays();
    } else {
      console.warn("renderOverlays 메서드를 찾을 수 없습니다.");
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
    if (!this.chartInstance || !this.chartInstance.chart) {
      console.error("Chart 인스턴스가 유효하지 않습니다.");
      return { x: 0, y: 0 };
    }

    try {
      const chart = this.chartInstance.chart;
      const xScale = chart.scales.x;
      const yScale = chart.scales.y;

      return {
        x: xScale.getValueForPixel(pixelX),
        y: yScale.getValueForPixel(pixelY),
      };
    } catch (error) {
      console.error("좌표 변환 중 오류:", error);
      return { x: 0, y: 0 };
    }
  }

  /**
   * 데이터 값을 픽셀 좌표로 변환합니다.
   * @param {number} dataX - X축 데이터 값
   * @param {number} dataY - Y축 데이터 값
   * @returns {Object} 변환된 픽셀 좌표 {x, y}
   */
  getPixelForValue(dataX, dataY) {
    if (!this.chartInstance || !this.chartInstance.chart) {
      console.error("Chart 인스턴스가 유효하지 않습니다.");
      return { x: 0, y: 0 };
    }

    try {
      const chart = this.chartInstance.chart;
      const xScale = chart.scales.x;
      const yScale = chart.scales.y;

      return {
        x: xScale.getPixelForValue(dataX),
        y: yScale.getPixelForValue(dataY),
      };
    } catch (error) {
      console.error("좌표 변환 중 오류:", error);
      return { x: 0, y: 0 };
    }
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
    if (!this.chartInstance || !this.chartInstance.chart) {
      console.error("Chart 인스턴스가 유효하지 않습니다.");
      return;
    }

    try {
      this.clearDrawingCanvas();

      const { x: pixelX, y: pixelY } = this.getPixelForValue(
        this.currentPosition.x,
        this.currentPosition.y
      );

      // 차트 영역의 가로 전체를 커버하는 수평선
      const chartArea = this.chartInstance.chart.chartArea;
      const startX = chartArea.left;
      const endX = chartArea.right;

      this.drawingCtx.beginPath();
      this.drawingCtx.moveTo(startX, pixelY);
      this.drawingCtx.lineTo(endX, pixelY);
      this.drawingCtx.lineWidth = 1;
      this.drawingCtx.strokeStyle = "white";
      this.drawingCtx.stroke();
    } catch (error) {
      console.error("수평선 미리보기 중 오류:", error);
    }
  }

  previewVerticalLine() {
    if (!this.chartInstance || !this.chartInstance.chart) {
      console.error("Chart 인스턴스가 유효하지 않습니다.");
      return;
    }

    try {
      this.clearDrawingCanvas();

      const { x: pixelX, y: pixelY } = this.getPixelForValue(
        this.currentPosition.x,
        this.currentPosition.y
      );

      // 차트 영역의 세로 전체를 커버하는 수직선
      const chartArea = this.chartInstance.chart.chartArea;
      const startY = chartArea.top;
      const endY = chartArea.bottom;

      this.drawingCtx.beginPath();
      this.drawingCtx.moveTo(pixelX, startY);
      this.drawingCtx.lineTo(pixelX, endY);
      this.drawingCtx.lineWidth = 1;
      this.drawingCtx.strokeStyle = "white";
      this.drawingCtx.stroke();
    } catch (error) {
      console.error("수직선 미리보기 중 오류:", error);
    }
  }

  // 한 번의 클릭으로 선 그리기
  drawSingleClickLine() {
    if (!this.drawingCtx || !this.points.start.x) return;

    // 차트 영역 가져오기
    const chartArea = this.chartInstance.chart.chartArea;

    const { x: pixelX, y: pixelY } = this.getPixelForValue(
      this.currentPosition.x,
      this.currentPosition.y
    );

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
    if (!this.drawingCtx || !this.points.start.x) return;

    this.clearDrawingCanvas();

    const { start, end } = this.points;
    // 차트 영역 가져오기
    const chartArea = this.chartInstance.chart.chartArea;

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
      const xAtTop = start.x + (chartArea.top - start.y) / slope;
      // 차트 하단 경계와의 교차점 계산
      const xAtBottom = start.x + (chartArea.bottom - start.y) / slope;

      // 교차점이 차트 영역 내에 있는지 확인하고 선택
      const intersections = [];

      if (yAtLeft >= chartArea.top && yAtLeft <= chartArea.bottom) {
        intersections.push({ x: chartArea.left, y: yAtLeft });
      }

      if (yAtRight >= chartArea.top && yAtRight <= chartArea.bottom) {
        intersections.push({ x: chartArea.right, y: yAtRight });
      }

      if (xAtTop >= chartArea.left && xAtTop <= chartArea.right) {
        intersections.push({ x: xAtTop, y: chartArea.top });
      }

      if (xAtBottom >= chartArea.left && xAtBottom <= chartArea.right) {
        intersections.push({ x: xAtBottom, y: chartArea.bottom });
      }

      // 교차점이 2개 이상이면 확장된 선의 시작점과 끝점으로 사용
      if (intersections.length >= 2) {
        startPx = intersections[0];
        endPx = intersections[1];
      } else {
        // 교차점이 충분하지 않으면 기본값 사용
        startPx = start;
        endPx = end;
      }
    }

    // 선 그리기
    this.drawingCtx.beginPath();
    this.drawingCtx.moveTo(startPx.x, startPx.y);
    this.drawingCtx.lineTo(endPx.x, endPx.y);
    this.drawingCtx.strokeStyle = "white";
    this.drawingCtx.lineWidth = 1;
    this.drawingCtx.stroke();

    // x좌표로부터 y좌표 계산 함수
    function yAtTop(y) {
      return start.x + (y - start.y) / slope;
    }

    // 앵커 포인트 표시
    this.drawingCtx.beginPath();
    this.drawingCtx.arc(start.x, start.y, 4, 0, Math.PI * 2);
    this.drawingCtx.fillStyle = "white";
    this.drawingCtx.fill();
  }

  /**
   * 캔버스에 선을 그립니다.
   * @param {CanvasRenderingContext2D} ctx - 그리기 컨텍스트
   * @param {number} startX - 시작점 X 좌표
   * @param {number} startY - 시작점 Y 좌표
   * @param {number} endX - 끝점 X 좌표
   * @param {number} endY - 끝점 Y 좌표
   * @param {string} lineType - 선 타입 (Line, ExtendedLine, Ray, HorizontalLine, VerticalLine)
   */
  drawLineOnCanvas(ctx, startX, startY, endX, endY, lineType) {
    if (!ctx || !this.chartInstance || !this.chartInstance.chart) return;

    const chartArea = this.chartInstance.chart.chartArea;

    // 컨텍스트 설정 저장
    ctx.save();

    // 선 스타일 설정
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#ffffff";

    switch (lineType) {
      case "Line":
        // 일반 선
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.stroke();
        break;

      case "ExtendedLine":
        // 확장된 선 (차트 영역 경계까지)
        const slope = calculateSlope(startX, startY, endX, endY);

        // 수평선인 경우
        if (slope === 0) {
          ctx.beginPath();
          ctx.moveTo(chartArea.left, startY);
          ctx.lineTo(chartArea.right, startY);
          ctx.stroke();
        }
        // 수직선인 경우
        else if (!isFinite(slope)) {
          ctx.beginPath();
          ctx.moveTo(startX, chartArea.top);
          ctx.lineTo(startX, chartArea.bottom);
          ctx.stroke();
        }
        // 일반적인 기울기를 가진 선
        else {
          // 왼쪽 경계와의 교차점
          const yAtLeft = startY + slope * (chartArea.left - startX);
          // 오른쪽 경계와의 교차점
          const yAtRight = startY + slope * (chartArea.right - startX);
          // 위쪽 경계와의 교차점
          const xAtTop = startX + (chartArea.top - startY) / slope;
          // 아래쪽 경계와의 교차점
          const xAtBottom = startX + (chartArea.bottom - startY) / slope;

          // 교차점들 중 차트 영역 내에 있는 것들을 찾아 시작점과 끝점 결정
          const intersections = [];

          if (yAtLeft >= chartArea.top && yAtLeft <= chartArea.bottom) {
            intersections.push({ x: chartArea.left, y: yAtLeft });
          }

          if (yAtRight >= chartArea.top && yAtRight <= chartArea.bottom) {
            intersections.push({ x: chartArea.right, y: yAtRight });
          }

          if (xAtTop >= chartArea.left && xAtTop <= chartArea.right) {
            intersections.push({ x: xAtTop, y: chartArea.top });
          }

          if (xAtBottom >= chartArea.left && xAtBottom <= chartArea.right) {
            intersections.push({ x: xAtBottom, y: chartArea.bottom });
          }

          // 교차점이 2개 이상이면 확장된 선의 시작점과 끝점으로 사용
          if (intersections.length >= 2) {
            ctx.beginPath();
            ctx.moveTo(intersections[0].x, intersections[0].y);
            ctx.lineTo(intersections[1].x, intersections[1].y);
            ctx.stroke();
          } else {
            // 교차점이 충분하지 않으면 일반 선으로 그리기
            ctx.beginPath();
            ctx.moveTo(startX, startY);
            ctx.lineTo(endX, endY);
            ctx.stroke();
          }
        }
        break;

      case "Ray":
        // 반직선 (시작점에서 차트 영역 경계까지)
        const direction = calculateDirection(startX, startY, endX, endY);
        const raySlope = calculateSlope(startX, startY, endX, endY);

        // 수평선인 경우
        if (raySlope === 0) {
          ctx.beginPath();
          ctx.moveTo(startX, startY);
          ctx.lineTo(
            direction.x > 0 ? chartArea.right : chartArea.left,
            startY
          );
          ctx.stroke();
        }
        // 수직선인 경우
        else if (!isFinite(raySlope)) {
          ctx.beginPath();
          ctx.moveTo(startX, startY);
          ctx.lineTo(
            startX,
            direction.y > 0 ? chartArea.bottom : chartArea.top
          );
          ctx.stroke();
        }
        // 일반적인 기울기를 가진 선
        else {
          // 각 경계와의 교차점 계산
          const intersections = [];

          // 오른쪽 경계와의 교차점
          const yAtRight = startY + raySlope * (chartArea.right - startX);
          if (yAtRight >= chartArea.top && yAtRight <= chartArea.bottom) {
            intersections.push({
              x: chartArea.right,
              y: yAtRight,
              direction: { x: 1, y: yAtRight > startY ? 1 : -1 },
            });
          }

          // 왼쪽 경계와의 교차점
          const yAtLeft = startY + raySlope * (chartArea.left - startX);
          if (yAtLeft >= chartArea.top && yAtLeft <= chartArea.bottom) {
            intersections.push({
              x: chartArea.left,
              y: yAtLeft,
              direction: { x: -1, y: yAtLeft > startY ? 1 : -1 },
            });
          }

          // 상단 경계와의 교차점
          const xAtTop = startX + (chartArea.top - startY) / raySlope;
          if (xAtTop >= chartArea.left && xAtTop <= chartArea.right) {
            intersections.push({
              x: xAtTop,
              y: chartArea.top,
              direction: { x: xAtTop > startX ? 1 : -1, y: -1 },
            });
          }

          // 하단 경계와의 교차점
          const xAtBottom = startX + (chartArea.bottom - startY) / raySlope;
          if (xAtBottom >= chartArea.left && xAtBottom <= chartArea.right) {
            intersections.push({
              x: xAtBottom,
              y: chartArea.bottom,
              direction: { x: xAtBottom > startX ? 1 : -1, y: 1 },
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
            ctx.beginPath();
            ctx.moveTo(startX, startY);
            ctx.lineTo(validIntersections[0].x, validIntersections[0].y);
            ctx.stroke();
          } else {
            // 유효한 교차점이 없으면 원래 선 그리기
            ctx.beginPath();
            ctx.moveTo(startX, startY);
            ctx.lineTo(endX, endY);
            ctx.stroke();
          }
        }
        break;

      case "HorizontalLine":
        // 수평선
        ctx.beginPath();
        ctx.moveTo(chartArea.left, startY);
        ctx.lineTo(chartArea.right, startY);
        ctx.stroke();
        break;

      case "VerticalLine":
        // 수직선
        ctx.beginPath();
        ctx.moveTo(startX, chartArea.top);
        ctx.lineTo(startX, chartArea.bottom);
        ctx.stroke();
        break;

      default:
        // 기본값: 일반 선
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.stroke();
    }

    // 컨텍스트 설정 복원
    ctx.restore();
  }
}
