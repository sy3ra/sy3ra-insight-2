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

    // 레이블 스타일 설정
    this.labelBackgroundColor = "#2d3c3d";
    this.labelTextColor = "#ffffff";
    this.labelFont = "12px Arial";
    this.labelPadding = 10;

    // 고정 레이블 크기 설정
    this.xLabelFixedWidth = 180; // 날짜 레이블 고정 너비
    this.yLabelFixedWidth = 80; // 가격 레이블 고정 너비
    this.labelFixedHeight = 24; // 레이블 고정 높이
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

    // 값 레이블 그리기
    this.drawValueLabels(x, y);

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

  // 값 레이블 그리기 메서드
  drawValueLabels(x, y) {
    const { ctx, chart } = this;

    // 차트 영역 확인
    const chartArea = chart.chartArea;
    if (
      !chartArea ||
      x < chartArea.left ||
      x > chartArea.right ||
      y < chartArea.top ||
      y > chartArea.bottom
    ) {
      return;
    }

    // X축(시간) 값 가져오기
    const xValue = chart.scales.x.getValueForPixel(x);
    const xDate = new Date(xValue);

    // 날짜 포맷팅
    const dateOptions = {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    };
    const formattedDate = xDate.toLocaleDateString("ko-KR", dateOptions);

    // Y축(가격) 값 가져오기
    const yValue = chart.scales.y.getValueForPixel(y);
    const formattedPrice = yValue.toLocaleString("ko-KR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

    // 레이블 그리기 설정
    ctx.font = this.labelFont;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";

    // 둥근 모서리 반경 설정
    const borderRadius = 4;

    // X축 레이블 그리기 (하단)
    const xLabelText = formattedDate;
    // 고정 너비 사용
    const xLabelWidth = this.xLabelFixedWidth;
    const xLabelHeight = this.labelFixedHeight;
    const xLabelX = x;
    const xLabelY = chartArea.bottom + 15;

    // X축 레이블 배경 (둥근 모서리)
    ctx.fillStyle = this.labelBackgroundColor;
    this.drawRoundedRect(
      ctx,
      xLabelX - xLabelWidth / 2,
      xLabelY - xLabelHeight / 2,
      xLabelWidth,
      xLabelHeight,
      borderRadius
    );

    // X축 레이블 텍스트 - 수직 위치 미세 조정
    ctx.fillStyle = this.labelTextColor;
    ctx.fillText(xLabelText, xLabelX, xLabelY + 4);

    // Y축 레이블 그리기 (우측)
    const yLabelText = formattedPrice;
    // 고정 너비 사용
    const yLabelWidth = this.yLabelFixedWidth;
    const yLabelHeight = this.labelFixedHeight;
    const yLabelX = chartArea.right + 45;
    const yLabelY = y;

    // Y축 레이블 배경 (둥근 모서리)
    ctx.fillStyle = this.labelBackgroundColor;
    this.drawRoundedRect(
      ctx,
      yLabelX - yLabelWidth / 2,
      yLabelY - yLabelHeight / 2,
      yLabelWidth,
      yLabelHeight,
      borderRadius
    );

    // Y축 레이블 텍스트 - 수직 위치 미세 조정
    ctx.fillStyle = this.labelTextColor;
    ctx.fillText(yLabelText, yLabelX, yLabelY + 4);
  }

  // 둥근 모서리 사각형 그리기 헬퍼 메서드
  drawRoundedRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
    ctx.fill();
  }

  updatePosition(x, y) {
    // 차트 영역 확인
    const chartArea = this.chart.chartArea;
    if (!chartArea) {
      this.isVisible = false;
      return;
    }

    // 레이블 영역 계산
    // X축 레이블 영역 (하단)
    const xLabelY = chartArea.bottom + 15;
    const xLabelHeight = this.labelFixedHeight;
    const xLabelTop = xLabelY - xLabelHeight / 2;
    const xLabelBottom = xLabelY + xLabelHeight / 2;

    // Y축 레이블 영역 (우측)
    const yLabelX = chartArea.right + 45;
    const yLabelWidth = this.yLabelFixedWidth;
    const yLabelLeft = yLabelX - yLabelWidth / 2;
    const yLabelRight = yLabelX + yLabelWidth / 2;

    // 마우스가 X축 레이블 영역에 있는지 확인
    const isInXLabelArea = y >= xLabelTop && y <= xLabelBottom;

    // 마우스가 Y축 레이블 영역에 있는지 확인
    const isInYLabelArea = x >= yLabelLeft && x <= yLabelRight;

    // 마우스가 레이블 영역에 있으면 크로스헤어 숨기기
    if (isInXLabelArea || isInYLabelArea) {
      this.isVisible = false;
      this.ctx.clearRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);
      return;
    }

    // 마우스가 차트 영역 내에 있는지 확인
    const isInChartArea =
      x >= chartArea.left &&
      x <= chartArea.right &&
      y >= chartArea.top &&
      y <= chartArea.bottom;

    // 차트 영역 내에 있을 때만 크로스헤어 표시
    this.isVisible = isInChartArea;

    // 위치 업데이트
    this.x = x;
    this.y = y;

    // 크로스헤어가 표시되어야 하면 티커 구독
    if (this.isVisible) {
      this.subscribeToTicker();
    } else {
      this.ctx.clearRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);
    }
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
