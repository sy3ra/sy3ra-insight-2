import { ChartTest } from "./modules/chartTest.js";

class App {
  constructor() {
    this.mouseCaptureCanvas = document.createElement("canvas");
    this.mouseCaptureCanvas.id = "mouseCaptureCanvas";

    this.chartCanvas = document.createElement("canvas");
    this.chartCanvas.id = "chartCanvas";

    this.drawingCanvas = document.createElement("canvas");
    this.drawingCanvas.id = "drawingCanvas";

    this.mouseCaptureCtx = this.mouseCaptureCanvas.getContext("2d");
    this.chartCtx = this.chartCanvas.getContext("2d");
    this.drawingCtx = this.drawingCanvas.getContext("2d");

    document.body.appendChild(this.mouseCaptureCanvas);
    document.body.appendChild(this.chartCanvas);
    document.body.appendChild(this.drawingCanvas);

    this.stageWidth = document.body.clientWidth;
    this.stageHeight = document.body.clientHeight;

    this.chart = new ChartTest();

    window.addEventListener("resize", this.resize.bind(this), false);
    this.resize();

    requestAnimationFrame(this.animate.bind(this));
  }

  resize() {
    this.stageWidth = document.body.clientWidth;
    this.stageHeight = document.body.clientHeight;

    this.mouseCaptureCanvas.width = this.stageWidth * 2;
    this.mouseCaptureCanvas.height = this.stageHeight * 2;
    this.chartCanvas.width = this.stageWidth * 2;
    this.chartCanvas.height = this.stageHeight * 2;
    this.drawingCanvas.width = this.stageWidth * 2;
    this.drawingCanvas.height = this.stageHeight * 2;

    this.mouseCaptureCtx.scale(2, 2);
    this.chartCtx.scale(2, 2);
    this.drawingCtx.scale(2, 2);
  }

  animate() {
    window.requestAnimationFrame(this.animate.bind(this));

    // this.mouseCaptureCtx.clearRect(0, 0, this.stageWidth, this.stageHeight);
    // this.chartCtx.clearRect(0, 0, this.stageWidth, this.stageHeight);
    // this.drawingCtx.clearRect(0, 0, this.stageWidth, this.stageHeight);

    // this.chart.draw(this.chartCtx);
  }
}

window.onload = () => {
  new App();
};
