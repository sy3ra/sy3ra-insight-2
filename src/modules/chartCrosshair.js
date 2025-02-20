import { tickerInstance } from "./ticker.js";

export class ChartCrosshair {
  constructor(ctx, chart) {
    this.ctx = ctx;
    this.chart = chart;
    this.x = 0;
    this.y = 0;
    this.previousX = null;
    this.previousY = null;
    this.chartArea = this.chart.chartArea;

    tickerInstance.subscribe(this.draw.bind(this));
  }

  updatePosition(x, y) {
    this.x = x;
    this.y = y;
  }

  draw() {
    // console.log(this.ctx.canvas.width, this.ctx.canvas.height);
    const { ctx, x, y, previousX, previousY } = this;

    // 위치가 변경되지 않았으면 그리지 않음
    if (x === previousX && y === previousY) {
      return;
    }

    // 캔버스를 지우고 새로 그리기
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    // chartArea 밖에 있는 경우 리턴
    if (
      x < this.chartArea.left ||
      x > this.chartArea.right ||
      y < this.chartArea.top ||
      y > this.chartArea.bottom
    ) {
      return;
    }
    // 크로스헤어 스타일 설정
    ctx.strokeStyle = "rgba(255, 255, 255, 0.49)";
    ctx.lineWidth = 1;

    // 수직선 그리기
    ctx.beginPath();
    ctx.moveTo(x, this.chartArea.top);
    ctx.lineTo(x, this.chartArea.bottom);
    ctx.stroke();

    // 수평선 그리기
    ctx.beginPath();
    ctx.moveTo(this.chartArea.left, y);
    ctx.lineTo(this.chartArea.right, y);
    ctx.stroke();

    // 이전 위치 업데이트
    this.previousX = x;
    this.previousY = y;
  }
}
