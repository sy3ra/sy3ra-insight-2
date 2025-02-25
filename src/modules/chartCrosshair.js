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
    this.boundDraw = this.draw.bind(this);
    this.isSubscribed = false;
  }

  draw() {
    // 크로스헤어가 표시되지 않아야 하는 경우 구독 해제
    if (!this.isVisible) {
      this.unsubscribeFromTicker();
      return;
    }

    // 위치가 변경되지 않았다면 다시 그리지 않음
    const { ctx, x, y, previousX, previousY } = this;
    if (x === previousX && y === previousY) {
      return;
    }

    // 캔버스를 지우고 새로 그리기
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    // 크로스헤어 그리기
    this.drawCrosshair(x, y);

    // 이전 위치 업데이트
    this.previousX = x;
    this.previousY = y;
  }

  // 크로스헤어 그리기 메서드
  drawCrosshair(x, y) {
    const { ctx } = this;

    // 크로스헤어 스타일 설정
    ctx.strokeStyle = "rgba(255, 255, 255, 0.49)";
    ctx.lineWidth = 1;
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
  }

  updatePosition(x, y) {
    this.x = x;
    this.y = y;
    this.isVisible = true;
    this.subscribeToTicker();
  }

  // 티커에 구독
  subscribeToTicker() {
    if (!this.isSubscribed) {
      tickerInstance.subscribe(this.boundDraw);
      this.isSubscribed = true;
    }
  }

  // 티커 구독 해제
  unsubscribeFromTicker() {
    if (this.isSubscribed) {
      tickerInstance.unsubscribe(this.boundDraw);
      this.isSubscribed = false;
    }
  }

  mouseLeave() {
    this.isVisible = false;
    this.ctx.clearRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);
  }
}
