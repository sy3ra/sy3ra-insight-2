import { tickerInstance } from "../ticker.js";

export class ChartEventHandler {
  constructor(chart, chartInstance) {
    this.chart = chart;
    this.chartInstance = chartInstance;

    // 상태 변수
    this.isDragging = false;
    this.lastMouseX = 0;
    this.lastMouseY = 0;
    this.lastWheelTime = 0;

    // 마우스 움직임 감지 변수 추가
    this.lastMouseMoveTime = 0;
    this.isMouseActive = false;

    // 바인딩된 메서드
    this.boundUpdateCharts = this.updateCharts.bind(this);

    // 구독 상태 관리
    this.isChartUpdateSubscribed = false;
    this.chartUpdateRefCount = 0;

    // 자동 구독 해제 타이머
    this.idleUnsubscribeTimer = null;
    this.IDLE_TIMEOUT_MS = 300; // 300ms 동안 마우스 움직임 없으면 구독 해제

    // 메서드 바인딩
    this.handleWheel = this.handleWheel.bind(this);
    this.handleMouseDown = this.handleMouseDown.bind(this);
    this.handleMouseMove = this.handleMouseMove.bind(this);
    this.handleMouseUp = this.handleMouseUp.bind(this);
    this.handleMouseLeave = this.handleMouseLeave.bind(this);

    // 드로잉 관련 상태 추가
    this.drawingTool = null;
    this.isDrawingMode = false;
    this.originalState = null;
  }

  // 드로잉 도구 등록 메서드 추가
  registerDrawingTool(drawingTool) {
    this.drawingTool = drawingTool;
  }

  // 드로잉 모드 활성화/비활성화 메서드 추가
  setDrawingMode(isActive) {
    this.isDrawingMode = isActive;

    if (isActive) {
      this.isDragging = false;
    }
  }

  setupEventHandlers(canvas) {
    if (!canvas) return;

    // 이벤트 리스너 추가
    canvas.addEventListener("wheel", this.handleWheel, { passive: false });
    canvas.addEventListener("mousedown", this.handleMouseDown);
    canvas.addEventListener("mousemove", this.handleMouseMove);
    window.addEventListener("mouseup", this.handleMouseUp);
    canvas.addEventListener("mouseleave", this.handleMouseLeave);
  }

  handleWheel(e) {
    e.preventDefault();
    if (this.isDrawingMode) return;

    // 시간 제한 (쓰로틀링)
    const now = Date.now();
    if (now - this.lastWheelTime < 8) {
      return;
    }
    this.lastWheelTime = now;

    const currentTarget = e.currentTarget;
    if (!currentTarget) return;
    const rect = currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (!this.isPointInChartArea({ x, y })) {
      return;
    }

    const isModifierPressed = e.shiftKey || e.metaKey || e.ctrlKey;
    const speed = 0.1;
    const delta = e.deltaY > 0 ? 1 + speed : 1 - speed;
    const direction = isModifierPressed ? "y" : "x";

    // 마우스 활성 상태로 설정
    this.setMouseActive();

    // 차트 상태 업데이트
    this.chartInstance.updateChartState(x, y, delta, direction);
    this.chartInstance.chartNeedsUpdate = true;

    // Ticker 구독 요청
    this.subscribeChartUpdate("wheel");
  }

  handleMouseDown(e) {
    // e.preventDefault();
    if (this.isDrawingMode && this.drawingTool) {
      return;
    }
    if (e.button === 2) return;

    try {
      const currentTarget = e.currentTarget;
      if (!currentTarget) return;
      const rect = currentTarget.getBoundingClientRect();
      this.lastMouseX = e.clientX - rect.left;
      this.lastMouseY = e.clientY - rect.top;

      if (
        !this.isPointInChartArea({ x: this.lastMouseX, y: this.lastMouseY })
      ) {
        return;
      }

      // 마우스 활성 상태로 설정
      this.setMouseActive();

      this.isDragging = true;
      this.subscribeChartUpdate("mouse-down");
      // e.preventDefault();
    } catch (error) {
      console.error("Error in handleMouseDown:", error);
    }
  }

  handleMouseMove(e) {
    const currentTarget = e.currentTarget || this.chart?.canvas;
    if (!currentTarget) return;
    const rect = currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // 마우스 활성 상태로 설정
    this.setMouseActive();

    if (this.isDrawingMode && this.drawingTool) {
      this.drawingTool.onMouseMove(x, y);
      return;
    }

    // 크로스헤어 즉시 업데이트 및 렌더링
    // if (this.chartInstance.crosshair) {
    //   this.chartInstance.updateMousePosition(x, y);
    //   // this.chartInstance.crosshair.draw(); // 즉시 크로스헤어 다시 그리기
    // }

    if (!this.isDragging || !this.chart) return;

    try {
      if (!this.chart.canvas) {
        this.isDragging = false;
        this.unsubscribeChartUpdate("mouse-move-error");
        return;
      }

      const deltaX = x - this.lastMouseX;
      const deltaY = y - this.lastMouseY;

      this.chartInstance.panChart(deltaX, deltaY);
      if (this.chartInstance.overlayManager) {
        this.chartInstance.overlayManager.panOverlays(deltaX, deltaY);
      }

      this.lastMouseX = x;
      this.lastMouseY = y;

      this.chartInstance.chartNeedsUpdate = true;
      this.subscribeChartUpdate("mouse-move");
    } catch (error) {
      console.error("Error in handleMouseMove:", error);
    }
  }

  // 마우스 활성 상태 설정 및 타이머 관리 메서드 추가
  setMouseActive() {
    this.lastMouseMoveTime = Date.now();

    // 비활성 상태에서 활성 상태로 전환될 때만 구독
    if (!this.isMouseActive) {
      this.isMouseActive = true;
      this.subscribeChartUpdate("mouse-active");
    }

    // 기존 타이머가 있으면 초기화
    if (this.idleUnsubscribeTimer) {
      clearTimeout(this.idleUnsubscribeTimer);
    }

    // 새 타이머 설정 - 일정 시간 뒤에 구독 해제
    this.idleUnsubscribeTimer = setTimeout(() => {
      this.isMouseActive = false;
      this.unsubscribeChartUpdate("mouse-active");
      this.idleUnsubscribeTimer = null;
    }, this.IDLE_TIMEOUT_MS);
  }

  handleMouseUp(e) {
    if (this.isDrawingMode && this.drawingTool) {
      return;
    }

    if (this.isDragging) {
      this.isDragging = false;
      // 마우스 이동 완료 후 최종 렌더링을 위해 활성 상태 유지
      this.setMouseActive();
    }
  }

  handleMouseLeave(e) {
    if (this.isDragging) {
      this.isDragging = false;
    }

    // 마우스가 영역을 떠나면 비활성 상태로 설정
    this.isMouseActive = false;
    this.unsubscribeChartUpdate("mouse-leave");

    if (this.chartInstance.crosshair) {
      this.chartInstance.crosshair.mouseLeave();
    }

    // 타이머 초기화
    if (this.idleUnsubscribeTimer) {
      clearTimeout(this.idleUnsubscribeTimer);
      this.idleUnsubscribeTimer = null;
    }
  }

  isPointInChartArea(point) {
    try {
      if (!this.chart || !this.chart.chartArea) {
        return false;
      }
      const chartArea = this.chart.chartArea;
      return (
        point.x >= chartArea.left &&
        point.x <= chartArea.right &&
        point.y >= chartArea.top &&
        point.y <= chartArea.bottom
      );
    } catch (error) {
      console.error("Error in isPointInChartArea:", error);
      return false;
    }
  }

  // 차트 업데이트 구독
  subscribeChartUpdate(source = "unknown") {
    this.chartUpdateRefCount++;

    if (!this.isChartUpdateSubscribed && this.chartUpdateRefCount > 0) {
      try {
        tickerInstance.subscribe(this.boundUpdateCharts, {
          eventType: "chartUpdate",
          priority: 0,
        });
        this.isChartUpdateSubscribed = true;
        // console.log(`Ticker 구독 시작: ${source}`);
      } catch (error) {
        console.error("Error subscribing to ticker:", error);
        this.isChartUpdateSubscribed = false;
        this.chartUpdateRefCount = Math.max(0, this.chartUpdateRefCount - 1);
      }
    }
  }

  // 차트 업데이트 구독 해제
  unsubscribeChartUpdate(source = "unknown") {
    if (this.chartUpdateRefCount > 0) {
      this.chartUpdateRefCount--;
    }

    if (this.chartUpdateRefCount === 0 && this.isChartUpdateSubscribed) {
      try {
        // console.log("unsubscribeChartUpdate");

        const unsubscribed = tickerInstance.unsubscribe(
          this.boundUpdateCharts,
          {
            eventType: "chartUpdate",
          }
        );
        if (unsubscribed) {
          this.isChartUpdateSubscribed = false;
          // console.log(`Ticker 구독 해제: ${source}`);
        } else {
          this.isChartUpdateSubscribed = false;
        }
      } catch (error) {
        console.error("Error unsubscribing from ticker:", error);
      }
    }
  }

  // 차트 업데이트 메서드
  updateCharts(timestamp) {
    // 마우스가 비활성 상태이고 구독 해제 타이머가 없는 경우 즉시 구독 해제
    if (!this.isMouseActive && !this.idleUnsubscribeTimer && !this.isDragging) {
      this.unsubscribeChartUpdate("auto-unsubscribe");
      return;
    }

    if (!this.chartInstance || !this.chartInstance.chart) {
      this.unsubscribeChartUpdate("chart-destroyed-in-tick");
      return;
    }

    try {
      if (!this.chartInstance.chart.data?.datasets?.[0]) {
        console.warn("Chart data invalid in updateCharts");
        return;
      }

      if (this.chartInstance.chartNeedsUpdate) {
        this.chartInstance.renderAllCharts();
        this.chartInstance.chartNeedsUpdate = false;
      }
    } catch (error) {
      console.error("차트 업데이트 중 오류 발생:", error);
      this.unsubscribeChartUpdate("update-error");
    }
  }

  // 리소스 해제
  dispose() {
    if (this.isChartUpdateSubscribed) {
      tickerInstance.unsubscribe(this.boundUpdateCharts, {
        eventType: "chartUpdate",
      });
    }

    if (this.idleUnsubscribeTimer) {
      clearTimeout(this.idleUnsubscribeTimer);
    }

    this.isChartUpdateSubscribed = false;
    this.chartUpdateRefCount = 0;
    this.idleUnsubscribeTimer = null;
    this.isMouseActive = false;

    if (this.chart?.canvas) {
      const canvas = this.chart.canvas;
      canvas.removeEventListener("wheel", this.handleWheel);
      canvas.removeEventListener("mousedown", this.handleMouseDown);
      canvas.removeEventListener("mousemove", this.handleMouseMove);
      window.removeEventListener("mouseup", this.handleMouseUp);
      canvas.removeEventListener("mouseleave", this.handleMouseLeave);
    }
  }
}
