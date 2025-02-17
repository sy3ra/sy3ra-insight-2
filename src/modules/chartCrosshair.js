export class ChartCrosshair {
  constructor(ctx, chart) {
    this.ctx = ctx;
    this.chart = chart;
    this.x = 0;
    this.y = 0;
    this.previousX = null;
    this.previousY = null;
    this.chartArea = this.chart.chartArea;

    requestAnimationFrame(this.draw.bind(this));
  }

  updatePosition(x, y) {
    this.x = x;
    this.y = y;
  }

  draw() {
    const { ctx, x, y, previousX, previousY } = this;

    // 위치가 변경되지 않았으면 그리지 않음
    if (x === previousX && y === previousY) {
      requestAnimationFrame(this.draw.bind(this));
      return;
    }
    console.log("draw");

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

    // 이전 위치 업데이트
    this.previousX = x;
    this.previousY = y;

    requestAnimationFrame(this.draw.bind(this));
  }
}
