export class ChartCrosshair {
  constructor(ctx, chart) {
    this.ctx = ctx;
    this.chart = chart;
    this.x = 0;
    this.y = 0;
    this.chartArea = this.chart.chartArea;
    // requestAnimationFrame(this.draw.bind(this));
  }

  updatePosition(x, y) {
    this.x = x;
    this.y = y;
  }

  draw() {
    const { ctx, x, y, chart } = this;

    // 캔버스를 지우고 새로 그리기
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    // 크로스헤어 스타일 설정
    ctx.strokeStyle = "rgba(255, 255, 255, 0.49)";
    ctx.lineWidth = 1;

    // 수직선 그리기
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, ctx.canvas.height);
    ctx.stroke();

    // 수평선 그리기
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(ctx.canvas.width, y);
    ctx.stroke();

    // requestAnimationFrame(this.draw.bind(this));
  }
}
