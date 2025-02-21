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

    tickerInstance.subscribe(this.draw.bind(this));
  }

  updatePosition(x, y) {
    this.x = x;
    this.y = y;
  }

  mouseLeave() {
    this.ctx.clearRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);
  }

  draw() {
    const { ctx, x, y, previousX, previousY } = this;
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
      console.log("chartArea 밖에 있음");
      return;
    }
    // 크로스헤어 스타일 설정
    ctx.strokeStyle = "rgba(255, 255, 255, 0.49)";
    ctx.lineWidth = 1;

    // 선 스타일을 점선으로 설정
    ctx.setLineDash([6, 6]);

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

    // 선 스타일 초기화 (필요시)
    ctx.setLineDash([]);

    // 이전 위치 업데이트
    this.previousX = x;
    this.previousY = y;
  }
}
