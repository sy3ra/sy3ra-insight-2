import { tickerInstance } from "./ticker.js";

export class ChartCrosshair {
  constructor(ctx, chart) {
    this.ctx = ctx;
    this.chart = chart;
    this.x = 0;
    this.y = 0;
    this.previousX = null;
    this.previousY = null;
    this.chartArea = this.ctx.canvas.getBoundingClientRect();
    this.isVisible = false;

    tickerInstance.subscribe(this.draw.bind(this));
  }

  draw() {
    if (!this.isVisible) {
      return;
    }

    const { ctx, x, y, previousX, previousY } = this;
    if (x === previousX && y === previousY) {
      return;
    }

    // 캔버스를 지우고 새로 그리기
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    // 크로스헤어 스타일 설정
    ctx.strokeStyle = "rgba(255, 255, 255, 0.49)";
    ctx.lineWidth = 1;

    // 선 스타일을 점선으로 설정
    ctx.setLineDash([6, 6]);
    // 수직선 그리기
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, this.ctx.canvas.height);
    ctx.stroke();

    // 수평선 그리기
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(this.ctx.canvas.width, y);
    ctx.stroke();

    // 이전 위치 업데이트
    this.previousX = x;
    this.previousY = y;
  }

  updatePosition(x, y) {
    this.x = x;
    this.y = y;
    this.isVisible = true;
  }

  mouseLeave() {
    this.isVisible = false;
    this.ctx.clearRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);
  }
}
