import { tickerInstance } from "./ticker.js";

export class ChartCrosshair {
  constructor(ctx, chart /*, volumeChart*/) {
    this.ctx = ctx;
    this.chart = chart;
    // this.volumeChart = volumeChart;
    this.x = 0;
    this.y = 0;
    this.previousX = null;
    this.previousY = null;
    this.chartArea = this.ctx.canvas.getBoundingClientRect();
    this.isVisible = false;
    this.boundDraw = this.draw.bind(this);
    this.isSubscribed = false;

    // 마우스 움직임 감지 관련 변수
    this.lastMoveTime = 0;
    this.idleCheckInterval = null;
    this.IDLE_TIMEOUT_MS = 200; // 200ms 동안 움직임 없으면 구독 해제

    // 스타일 설정
    this.initializeStyles();
  }

  // 스타일 초기화
  initializeStyles() {
    // 레이블 스타일
    this.labelStyles = {
      backgroundColor: "#2d3c3d",
      textColor: "#ffffff",
      font: "12px Arial",
      padding: 10,
      borderRadius: 4,
    };

    // 레이블 크기
    this.labelDimensions = {
      xWidth: 180, // 날짜 레이블 너비
      yWidth: 80, // 가격 레이블 너비
      height: 24, // 레이블 높이
    };
  }

  draw() {
    // 크로스헤어가 표시되지 않아야 하는 경우
    if (!this.isVisible || !this.isSubscribed) {
      return;
    }

    // 캔버스를 지우고 새로 그리기
    this.ctx.clearRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);

    // 크로스헤어 그리기
    this.drawCrosshair(this.x, this.y);

    // 값 레이블 그리기
    this.drawValueLabels(this.x, this.y);
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

    // 수평선 그리기
    ctx.moveTo(0, y);
    ctx.lineTo(this.ctx.canvas.width, y);
    ctx.stroke();
  }

  // 값 레이블 그리기 메서드
  drawValueLabels(x, y) {
    const { ctx, chart } = this;
    const chartArea = chart.chartArea;

    // 차트 영역 밖이면 그리지 않음
    if (!this.isInChartArea(x, y, chartArea)) return;

    // 값 가져오기
    const xValue = chart.scales.x.getValueForPixel(x);
    const yValue = chart.scales.y.getValueForPixel(y);

    // 값 포맷팅
    const formattedDate = this.formatDate(xValue);
    const formattedPrice = this.formatPrice(yValue);

    // 텍스트 렌더링 스타일 설정
    this.setTextRenderingStyle();

    // X축 레이블 그리기
    this.drawXAxisLabel(x, chartArea.bottom, formattedDate);

    // Y축 레이블 그리기
    this.drawYAxisLabel(chartArea.right, y, formattedPrice);
  }

  // 차트 영역 확인
  isInChartArea(x, y, chartArea) {
    return (
      chartArea &&
      x >= chartArea.left &&
      x <= chartArea.right &&
      y >= chartArea.top &&
      y <= chartArea.bottom
    );
  }

  // 날짜 포맷팅
  formatDate(timestamp) {
    const date = new Date(timestamp);
    const options = {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    };
    return date.toLocaleDateString("ko-KR", options);
  }

  // 가격 포맷팅
  formatPrice(value) {
    return value.toLocaleString("ko-KR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  // 텍스트 렌더링 스타일 설정
  setTextRenderingStyle() {
    this.ctx.font = this.labelStyles.font;
    this.ctx.textAlign = "center";
    this.ctx.textBaseline = "alphabetic";
  }

  // X축 레이블 그리기
  drawXAxisLabel(x, bottomY, text) {
    const { xWidth: width, height } = this.labelDimensions;
    const y = bottomY + 15;

    // 레이블 배경
    this.ctx.fillStyle = this.labelStyles.backgroundColor;
    this.drawRoundedRect(
      this.ctx,
      x - width / 2,
      y - height / 2,
      width,
      height,
      this.labelStyles.borderRadius
    );

    // 레이블 텍스트
    this.ctx.fillStyle = this.labelStyles.textColor;
    this.ctx.fillText(text, x, y + 4);
  }

  // Y축 레이블 그리기
  drawYAxisLabel(rightX, y, text) {
    const { yWidth: width, height } = this.labelDimensions;
    const x = rightX + 45;

    // 레이블 배경
    this.ctx.fillStyle = this.labelStyles.backgroundColor;
    this.drawRoundedRect(
      this.ctx,
      x - width / 2,
      y - height / 2,
      width,
      height,
      this.labelStyles.borderRadius
    );

    // 레이블 텍스트
    this.ctx.fillStyle = this.labelStyles.textColor;
    this.ctx.fillText(text, x, y + 4);
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
    // 위치가 변경되지 않았으면 리턴
    if (this.x === x && this.y === y) {
      return;
    }

    // 위치 업데이트
    this.x = x;
    this.y = y;

    // 마우스 움직임 시간 업데이트
    this.lastMoveTime = Date.now();

    // 차트 영역 확인
    const chartArea = this.chart.chartArea;
    if (!chartArea) {
      this.isVisible = false;
      this.clearAndUnsubscribe();
      return;
    }

    // 레이블 영역 계산
    // X축 레이블 영역 (하단)
    const xLabelY = chartArea.bottom + 15;
    const xLabelHeight = this.labelDimensions.height;
    const xLabelTop = xLabelY - xLabelHeight / 2;
    const xLabelBottom = xLabelY + xLabelHeight / 2;

    // Y축 레이블 영역 (우측)
    const yLabelX = chartArea.right + 45;
    const yLabelWidth = this.labelDimensions.yWidth;
    const yLabelLeft = yLabelX - yLabelWidth / 2;
    const yLabelRight = yLabelX + yLabelWidth / 2;

    // 마우스가 X축 레이블 영역에 있는지 확인
    const isInXLabelArea = this.y >= xLabelTop && this.y <= xLabelBottom;

    // 마우스가 Y축 레이블 영역에 있는지 확인
    const isInYLabelArea = this.x >= yLabelLeft && this.x <= yLabelRight;

    // 마우스가 레이블 영역에 있으면 크로스헤어 숨기기
    if (isInXLabelArea || isInYLabelArea) {
      this.isVisible = false;
      this.clearAndUnsubscribe();
      return;
    }

    // 마우스가 차트 영역 내에 있는지 확인
    const wasVisible = this.isVisible;
    this.isVisible =
      this.x >= chartArea.left &&
      this.x <= chartArea.right &&
      this.y >= chartArea.top &&
      this.y <= chartArea.bottom;

    // 크로스헤어가 표시되어야 하면 티커 구독
    if (this.isVisible) {
      this.subscribeToTicker();

      // 움직임 감지 타이머 설정
      this.setupIdleCheck();
    } else if (wasVisible && !this.isVisible) {
      this.clearAndUnsubscribe();
    }
  }

  // 마우스 움직임 감지 타이머 설정
  setupIdleCheck() {
    // 기존 타이머 제거
    if (this.idleCheckInterval) {
      clearInterval(this.idleCheckInterval);
    }

    // 새 타이머 설정
    this.idleCheckInterval = setInterval(() => {
      const now = Date.now();
      const timeSinceLastMove = now - this.lastMoveTime;

      // 일정 시간 동안 움직임이 없으면 구독 해제
      if (timeSinceLastMove > this.IDLE_TIMEOUT_MS) {
        if (this.isSubscribed) {
          console.log(
            `마우스 움직임 없음 (${timeSinceLastMove}ms): 크로스헤어 구독 해제`
          );
          // 구독만 해제하고 크로스헤어는 유지
          this.unsubscribeOnly();
        }

        // 타이머 제거
        clearInterval(this.idleCheckInterval);
        this.idleCheckInterval = null;
      }
    }, this.IDLE_TIMEOUT_MS / 2); // 타임아웃의 절반 간격으로 체크
  }

  // 화면 지우고 구독 해제
  clearAndUnsubscribe() {
    this.ctx.clearRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);
    this.unsubscribeFromTicker();
  }

  // 구독만 해제하고 화면은 유지
  unsubscribeOnly() {
    this.unsubscribeFromTicker();
  }

  // 티커에 구독
  subscribeToTicker() {
    if (!this.isSubscribed) {
      tickerInstance.subscribe(this.boundDraw, {
        priority: 10,
        throttleMs: 0,
        eventType: "chartCrosshair",
      });
      console.log("크로스헤어 구독 시작");
      this.isSubscribed = true;

      // 처음 구독 시 한 번 그려줌
      this.draw();
    }
  }

  // 티커 구독 해제
  unsubscribeFromTicker() {
    if (this.isSubscribed) {
      tickerInstance.unsubscribe(this.boundDraw, {
        eventType: "chartCrosshair",
      });
      console.log("크로스헤어 구독 해제");
      this.isSubscribed = false;

      // 마우스 움직임 감지 타이머 제거
      if (this.idleCheckInterval) {
        clearInterval(this.idleCheckInterval);
        this.idleCheckInterval = null;
      }
    }
  }

  mouseLeave() {
    this.isVisible = false;
    this.clearAndUnsubscribe();
  }
}
