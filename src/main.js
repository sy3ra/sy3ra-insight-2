import { ChartTest } from "./modules/chartTest.js";
import axios from "axios";

class App {
  constructor() {
    // 마우스 캡쳐 캔버스
    this.mouseCaptureCanvas = document.createElement("canvas");
    this.mouseCaptureCanvas.id = "mouseCaptureCanvas";
    this.mouseCaptureCtx = this.mouseCaptureCanvas.getContext("2d");
    document.body.appendChild(this.mouseCaptureCanvas);

    //차트 캔버스
    this.chartCanvas = document.createElement("canvas");
    this.chartCanvas.id = "chartCanvas";
    this.chartCtx = this.chartCanvas.getContext("2d");
    document.body.appendChild(this.chartCanvas);

    // 그리기 캔버스
    this.drawingCanvas = document.createElement("canvas");
    this.drawingCanvas.id = "drawingCanvas";
    this.drawingCtx = this.drawingCanvas.getContext("2d");
    document.body.appendChild(this.drawingCanvas);

    // 스테이지 크기
    this.stageWidth = document.body.clientWidth;
    this.stageHeight = document.body.clientHeight;

    //차트 데이터 가져오기 -> 분리 예정
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

    // 차트 데이터 가져온 후 차트 인스턴스 생성
    this.chartData().then((formattedData) => {
      new ChartTest(formattedData, this.chartCtx);
    });

    window.addEventListener("resize", this.resize.bind(this), false);
    this.resize();

    requestAnimationFrame(this.animate.bind(this));
  }

  //리사이즈 핸들러
  resize() {
    this.stageWidth = document.body.clientWidth;
    this.stageHeight = document.body.clientHeight;

    // 캔버스 크기 설정
    this.mouseCaptureCanvas.width = this.stageWidth * 2;
    this.mouseCaptureCanvas.height = this.stageHeight * 2;

    this.chartCanvas.width = this.stageWidth * 2;
    this.chartCanvas.height = this.stageHeight * 2;

    this.drawingCanvas.width = this.stageWidth * 2;
    this.drawingCanvas.height = this.stageHeight * 2;

    // 캔버스 스케일 설정 레티나 디스플레이 대응
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
