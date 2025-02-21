import { ChartTest } from "./modules/chartTest.js";

class MainCanvas {
  constructor(parent) {
    this.parent = parent;
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
    this.stageWidth = document.body.clientWidth;
    this.stageHeight = document.body.clientHeight;

    //차트 인스턴스 생성
    this.chartTestInstance = new ChartTest(this.chartCtx, this.crosshairCtx);
    this.resize();

    // 차트 캔버스 마우스 이벤트 핸들러
    const events = ["mousemove", "mousedown", "mouseup", "click"];
    events.forEach((event) => {
      this.chartCanvas.addEventListener(event, this.handleMouseMove.bind(this));
    });

    this.chartCanvas.addEventListener(
      "mouseleave",
      this.handleMouseLeave.bind(this)
    );

    //resize 이벤트 리스너
    window.addEventListener("resize", this.resize.bind(this), false);
  }

  resize() {
    this.stageWidth = this.parent.clientWidth;
    this.stageHeight = this.parent.clientHeight;

    // 캔버스 크기 설정
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

    // 차트를 재렌더링 (ChartTest 클래스에 render() 같은 메서드가 필요)
    if (
      this.chartTestInstance &&
      typeof this.chartTestInstance.render === "function"
    ) {
      this.chartTestInstance.render();
    }
  }

  handleMouseMove(event) {
    const rect = this.chartCanvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    // console.log(x, y);
    if (this.chartTestInstance) {
      this.chartTestInstance.updateMousePosition(x, y);
    }
  }
  handleMouseLeave(event) {
    if (this.chartTestInstance) {
      this.chartTestInstance.mouseLeave();
    }
  }
}

window.onload = () => {
  const mainCanvasParent = document.querySelector("#mainCanvas");
  new MainCanvas(mainCanvasParent);
};
