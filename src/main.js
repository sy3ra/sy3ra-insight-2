import { ChartTest } from "./modules/chartTest.js";
import axios from "axios";

class App {
  constructor() {
    //차트 캔버스
    this.chartCanvas = document.createElement("canvas");
    this.chartCanvas.id = "chartCanvas";
    this.chartCtx = this.chartCanvas.getContext("2d");
    document.body.appendChild(this.chartCanvas);

    // 크로스헤어 캔버스
    this.crosshairCanvas = document.createElement("canvas");
    this.crosshairCanvas.id = "crosshairCanvas";
    this.crosshairCtx = this.crosshairCanvas.getContext("2d");
    document.body.appendChild(this.crosshairCanvas);

    // 오버레이 캔버스
    this.overlayCanvas = document.createElement("canvas");
    this.overlayCanvas.id = "overlayCanvas";
    this.overlayCtx = this.overlayCanvas.getContext("2d");
    document.body.appendChild(this.overlayCanvas);

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
      this.chartTestInstance = new ChartTest(
        formattedData,
        this.chartCtx,
        this.crosshairCtx
      );
      this.resize();
    });

    // 차트 캔버스 마우스 이벤트 핸들러
    const events = ["mousemove", "mousedown", "mouseup", "click"];
    events.forEach((event) => {
      this.chartCanvas.addEventListener(event, this.handleMouseMove.bind(this));
    });

    //resize 이벤트 리스너
    window.addEventListener("resize", this.resize.bind(this), false);
  }

  resize() {
    this.stageWidth = document.body.clientWidth;
    this.stageHeight = document.body.clientHeight;

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

    if (this.chartTestInstance) {
      this.chartTestInstance.updateMousePosition(x, y);
    }
  }
}

window.onload = () => {
  new App();
};
