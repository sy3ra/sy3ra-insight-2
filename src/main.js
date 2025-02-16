import { ChartTest } from "./modules/chartTest.js";
import axios from "axios";
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

    this.chartData = async (endTime) => {
      try {
        const symbol = "BTCUSDT";
        const interval = "1h";
        const limit = 24;
        let url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;

        if (endTime) {
          url += `&endTime=${endTime}`;
        }
        const response = await axios.get(url);
        const formattedData = response.data.map((item) => ({
          openTime: item[0],
          open: parseFloat(item[1]),
          high: parseFloat(item[2]),
          low: parseFloat(item[3]),
          close: parseFloat(item[4]),
          volume: parseFloat(item[5]),
          closeTime: item[6],
        }));

        return formattedData;
      } catch (error) {
        console.error(error);
      }
    };

    this.chartData().then((formattedData) => {
      new ChartTest(formattedData, this.chartCtx);
    });

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
