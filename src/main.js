import { ChartTest } from "./modules/chartTest.js";
import { DrawingTool } from "./modules/drawingTool.js";

class MainCanvas {
  constructor(parent) {
    this.parent = parent;

    //오버레이 배열
    this.overlaysArray = [];

    //차트 캔버스
    this.chartCanvas = document.createElement("canvas");
    this.chartCanvas.id = "chartCanvas";
    this.chartCtx = this.chartCanvas.getContext("2d");
    parent.appendChild(this.chartCanvas);

    // 크로스헤어 캔버스
    this.crosshairCanvas = document.createElement("canvas");
    this.crosshairCanvas.id = "crosshairCanvas";
    this.crosshairCtx = this.crosshairCanvas.getContext("2d");
    parent.appendChild(this.crosshairCanvas);

    // 오버레이 캔버스
    this.overlayCanvas = document.createElement("canvas");
    this.overlayCanvas.id = "overlayCanvas";
    this.overlayCtx = this.overlayCanvas.getContext("2d");
    parent.appendChild(this.overlayCanvas);

    // 그리기 캔버스
    this.drawingCanvas = document.createElement("canvas");
    this.drawingCanvas.id = "drawingCanvas";
    this.drawingCtx = this.drawingCanvas.getContext("2d");
    parent.appendChild(this.drawingCanvas);

    // 스테이지 크기
    this.stageWidth = parent.clientWidth;
    this.stageHeight = parent.clientHeight;

    //차트 인스턴스 생성
    this.chartTestInstance = new ChartTest(
      this.chartCtx,
      this.crosshairCtx,
      this.overlayCtx
    );

    // 드로잉 인스턴스
    const toolPanelContainer = document.querySelector("#toolPanel");
    this.drawingInstance = new DrawingTool(
      toolPanelContainer,
      this.chartTestInstance,
      this.drawingCanvas,
      this.overlayCanvas
    );
    this.drawingInstance.createToolPanel();

    this.resize();

    // 마우스 좌표 구독자를 저장할 셋 생성
    this.mouseMoveListeners = new Set();
    // 마우스 클릭 구독자를 저장할 셋 생성
    this.clickListeners = new Set();

    // 마우스 움직임 관련 이벤트 리스너 등록 (mousemove, mousedown, mouseup)
    const mouseMoveEvents = ["mousemove", "mousedown", "mouseup"];
    mouseMoveEvents.forEach((event) => {
      this.chartCanvas.addEventListener(event, this.handleMouseMove.bind(this));
    });
    // 클릭 이벤트는 별도의 핸들러에 등록
    this.chartCanvas.addEventListener("click", this.handleClick.bind(this));

    this.chartCanvas.addEventListener(
      "mouseleave",
      this.handleMouseLeave.bind(this)
    );
    window.addEventListener("resize", this.resize.bind(this), false);
  }

  resize() {
    this.stageWidth = this.parent.clientWidth;
    this.stageHeight = this.parent.clientHeight;

    // 캔버스 크기 설정 (정수 픽셀값 사용)
    this.chartCanvas.width = this.stageWidth * 2;
    this.chartCanvas.height = this.stageHeight * 2;

    this.crosshairCanvas.width = this.stageWidth * 2;
    this.crosshairCanvas.height = this.stageHeight * 2;

    this.overlayCanvas.width = this.stageWidth * 2;
    this.overlayCanvas.height = this.stageHeight * 2;

    this.drawingCanvas.width = this.stageWidth * 2;
    this.drawingCanvas.height = this.stageHeight * 2;

    // 캔버스 스케일 설정 레티나 디스플레이 대응
    this.chartCtx.scale(2, 2);
    this.crosshairCtx.scale(2, 2);
    this.overlayCtx.scale(2, 2);
    this.drawingCtx.scale(2, 2);

    // 차트를 재렌더링
    if (
      this.chartTestInstance &&
      typeof this.chartTestInstance.render === "function"
    ) {
      this.chartTestInstance.render();
    }
  }

  // 마우스 움직임 구독자 추가 메서드
  addMouseMoveListener(listener) {
    this.mouseMoveListeners.add(listener);
  }

  // 마우스 움직임 구독자 제거 메서드
  removeMouseMoveListener(listener) {
    this.mouseMoveListeners.delete(listener);
  }

  // 마우스 클릭 구독자 추가 메서드
  addMouseClickListener(listener) {
    this.clickListeners.add(listener);
  }

  // 마우스 클릭 구독자 제거 메서드
  removeMouseClickListener(listener) {
    this.clickListeners.delete(listener);
  }

  handleMouseMove(event) {
    const rect = this.chartCanvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    // 기존 동작: 차트 인스턴스 업데이트
    if (this.chartTestInstance) {
      this.chartTestInstance.updateMousePosition(x, y);
    }

    // 구독된 모든 마우스 움직임 리스너에게 좌표 전달
    this.mouseMoveListeners.forEach((listener) => {
      if (typeof listener === "function") {
        listener(x, y);
      }
    });
  }

  handleClick(event) {
    const rect = this.chartCanvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    // 구독된 모든 클릭 리스너에게 좌표 전달
    this.clickListeners.forEach((listener) => {
      if (typeof listener === "function") {
        listener(x, y);
      }
    });
  }

  handleMouseLeave(event) {
    if (this.chartTestInstance) {
      this.chartTestInstance.mouseLeave();
    }
  }

  storeOverlay(startX, startY, endX, endY) {
    this.overlaysArray.push({
      index: this.overlaysArray.length,
      startX,
      startY,
      endX,
      endY,
    });
    console.log(this.overlaysArray);
  }
  getOverlaysArray() {
    return this.overlaysArray;
  }
}

window.onload = () => {
  const mainCanvasParent = document.querySelector("#mainCanvas");
  window.mainCanvas = new MainCanvas(mainCanvasParent);
};
