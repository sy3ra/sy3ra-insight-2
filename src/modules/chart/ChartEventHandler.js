import { tickerInstance } from "../ticker.js";

export class ChartEventHandler {
  constructor(chart, chartInstance) {
    this.chart = chart;
    this.chartInstance = chartInstance;

    // 상태 변수
    // 제거: this.isWheelActive = false; // isChartUpdateSubscribed 또는 chartUpdateRefCount > 0 으로 대체 가능
    this.isDragging = false;
    this.lastMouseX = 0;
    this.lastMouseY = 0;
    this.lastWheelTime = 0; // 쓰로틀링용 유지 (필요 없다면 제거 가능)
    // 제거: this.wheelDebounceTimer = null;
    // 제거 또는 쓰로틀링용 유지: this.accumulatedDeltaY = 0;

    // 바인딩된 메서드
    this.boundUpdateCharts = this.updateCharts.bind(this);

    // 구독 상태 관리 (참조 카운팅 방식 유지)
    this.isChartUpdateSubscribed = false;
    this.chartUpdateRefCount = 0;

    // *** 새로운 Idle 타이머 추가 ***
    this.idleUnsubscribeTimer = null;
    this.IDLE_TIMEOUT_MS = 200; // 200ms 동안 업데이트 없으면 구독 해제 (값 조절 가능)

    // 메서드 바인딩
    this.handleWheel = this.handleWheel.bind(this);
    this.handleMouseDown = this.handleMouseDown.bind(this);
    this.handleMouseMove = this.handleMouseMove.bind(this);
    this.handleMouseUp = this.handleMouseUp.bind(this);
    this.handleMouseLeave = this.handleMouseLeave.bind(this);

    // 드로잉 관련 상태 추가
    this.drawingTool = null;
    this.isDrawingMode = false;
    this.originalState = null; // 드로잉 모드 전환 시 상태 저장용
  }

  // 드로잉 도구 등록 메서드 추가
  registerDrawingTool(drawingTool) {
    this.drawingTool = drawingTool;
  }

  // 드로잉 모드 활성화/비활성화 메서드 추가
  setDrawingMode(isActive) {
    this.isDrawingMode = isActive;

    // 드로잉 모드일 때 차트 패닝/줌 비활성화
    if (isActive) {
      // this.originalState는 현재 코드에서 사용되지 않는 것으로 보임
      // 필요하다면 드래그 상태 등을 저장하는 로직 유지
      this.isDragging = false;
    }
  }

  setupEventHandlers(canvas) {
    if (!canvas) return;

    // 이벤트 리스너 추가
    canvas.addEventListener("wheel", this.handleWheel, { passive: false });
    canvas.addEventListener("mousedown", this.handleMouseDown);
    canvas.addEventListener("mousemove", this.handleMouseMove);
    // mouseup, mouseleave 리스너는 window 또는 document에 추가하는 것이 더 안정적일 수 있음
    // (캔버스 밖에서 마우스를 놓는 경우 등 처리)
    window.addEventListener("mouseup", this.handleMouseUp); // window로 변경 고려
    canvas.addEventListener("mouseleave", this.handleMouseLeave);
  }

  handleWheel(e) {
    e.preventDefault();
    if (this.isDrawingMode) return;

    // 시간 제한 (쓰로틀링, 8ms 미만 간격 무시) - 선택적 유지
    const now = Date.now();
    if (now - this.lastWheelTime < 8) {
      // this.accumulatedDeltaY = (this.accumulatedDeltaY || 0) + e.deltaY; // 필요 시 값 누적 로직 유지
      return;
    }
    this.lastWheelTime = now;

    const currentTarget = e.currentTarget; // 캐싱
    if (!currentTarget) return;
    const rect = currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // 차트 영역 확인 (기존 로직 유지)
    if (!this.isPointInChartArea({ x, y })) {
      return;
    }

    const isModifierPressed = e.shiftKey || e.metaKey || e.ctrlKey;
    const speed = 0.1;
    const delta = e.deltaY > 0 ? 1 + speed : 1 - speed;
    const direction = isModifierPressed ? "y" : "x";

    // 차트 상태 업데이트
    this.chartInstance.updateChartState(x, y, delta, direction);
    // *** 중요: 업데이트 필요 플래그 설정 ***
    this.chartInstance.chartNeedsUpdate = true;

    // *** Ticker 구독 요청 ***
    this.subscribeChartUpdate("wheel");

    // *** 제거: 휠 종료 감지 setTimeout 로직 ***
    // if (this.wheelDebounceTimer) { ... }
    // this.wheelDebounceTimer = setTimeout(...);
  }

  handleMouseDown(e) {
    if (this.isDrawingMode && this.drawingTool) {
      // ... 드로잉 로직 ...
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

      this.isDragging = true;
      // *** Ticker 구독 요청 ***
      this.subscribeChartUpdate("mouse-down");
      e.preventDefault();
    } catch (error) {
      console.error("Error in handleMouseDown:", error);
    }
  }

  handleMouseMove(e) {
    const currentTarget = e.currentTarget || this.chart?.canvas; // 캔버스 참조 유지
    if (!currentTarget) return;
    const rect = currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (this.isDrawingMode && this.drawingTool) {
      this.drawingTool.onMouseMove(x, y);
      return;
    }

    // 크로스헤어 업데이트는 항상 Ticker 루프에 맡기는 것이 좋을 수 있음
    // 또는 여기서 직접 호출하되, 성능 영향 고려
    this.chartInstance.updateMousePosition(x, y); // 크로스헤어 위치 업데이트

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

      // *** 중요: 업데이트 필요 플래그 설정 ***
      this.chartInstance.chartNeedsUpdate = true;

      // *** Ticker 구독 요청 (드래그 중에는 계속 필요) ***
      this.subscribeChartUpdate("mouse-move");
    } catch (error) {
      // ... 오류 처리 ...
    }
  }

  handleMouseUp(e) {
    // window에 등록된 경우, 이벤트 타겟이 차트 캔버스가 아닐 수 있음
    if (this.isDrawingMode && this.drawingTool) {
      // ... 드로잉 로직 ...
      return;
    }

    if (this.isDragging) {
      this.isDragging = false;
      // mouse-up 시에는 보통 추가적인 렌더링이 필요 없지만,
      // 관성 스크롤 등을 구현한다면 여기서 상태 변경 및 구독 유지가 필요할 수 있음
      // 현재 로직에서는 특별한 동작 없음. Idle 타이머가 구독 해제를 처리하도록 함.
    }
  }

  handleMouseLeave(e) {
    if (this.isDragging) {
      // 드래그 중에 캔버스를 벗어난 경우 드래그 중지
      this.isDragging = false;
      // 이 경우에도 Idle 타이머가 구독 해제를 처리하도록 둘 수 있음
      // 또는 여기서 바로 해제 시도:
      // this.unsubscribeChartUpdate("mouse-leave-drag");
    }
    // *** 마우스가 영역을 떠나면 Ticker를 멈추도록 구독 해제 시도 ***
    // 참조 카운트가 0이 될 때만 실제 구독 해제됨
    this.unsubscribeChartUpdate("mouse-leave");

    if (this.chartInstance.crosshair) {
      this.chartInstance.crosshair.mouseLeave(); // 크로스헤어 숨김 처리
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

  // 차트 업데이트 구독 (Idle 타이머 클리어 추가)
  subscribeChartUpdate(source = "unknown") {
    if (this.idleUnsubscribeTimer) {
      clearTimeout(this.idleUnsubscribeTimer);
      this.idleUnsubscribeTimer = null;
    }

    this.chartUpdateRefCount++;

    if (!this.isChartUpdateSubscribed && this.chartUpdateRefCount > 0) {
      try {
        tickerInstance.subscribe(this.boundUpdateCharts, {
          eventType: "chartUpdate",
          priority: 0, // 높은 우선순위
        });
        this.isChartUpdateSubscribed = true;
      } catch (error) {
        console.error("Error subscribing to ticker:", error);
        this.isChartUpdateSubscribed = false;
        this.chartUpdateRefCount = Math.max(0, this.chartUpdateRefCount - 1);
      }
    }
  }

  // 차트 업데이트 구독 해제 (참조 카운트 기반, Idle 타이머 클리어 추가)
  unsubscribeChartUpdate(source = "unknown") {
    if (this.chartUpdateRefCount > 0) {
      this.chartUpdateRefCount--;
    }

    if (this.chartUpdateRefCount === 0 && this.isChartUpdateSubscribed) {
      try {
        const unsubscribed = tickerInstance.unsubscribe(this.boundUpdateCharts);
        if (unsubscribed) {
          this.isChartUpdateSubscribed = false;
        } else {
          this.isChartUpdateSubscribed = false; // 상태 동기화
        }
      } catch (error) {
        console.error("Error unsubscribing from ticker:", error);
      } finally {
        // *** 구독 해제 후 Idle 타이머 정리 ***
        if (this.idleUnsubscribeTimer) {
          clearTimeout(this.idleUnsubscribeTimer);
          this.idleUnsubscribeTimer = null;
        }
      }
    }
  }

  // 차트 업데이트 메서드 (Ticker 콜백, Idle 타이머 설정 로직 포함)
  updateCharts(timestamp) {
    if (this.idleUnsubscribeTimer) {
      clearTimeout(this.idleUnsubscribeTimer);
      this.idleUnsubscribeTimer = null;
    }

    if (!this.chartInstance || !this.chartInstance.chart) {
      this.unsubscribeChartUpdate("chart-destroyed-in-tick");
      return;
    }

    let didRender = false; // 렌더링 발생 여부 플래그
    try {
      if (!this.chartInstance.chart.data?.datasets?.[0]) {
        console.warn("Chart data invalid in updateCharts");
        return;
      }

      if (this.chartInstance.chartNeedsUpdate) {
        this.chartInstance.renderAllCharts();
        this.chartInstance.chartNeedsUpdate = false;
        didRender = true; // 렌더링 발생 표시
      } else {
        // 크로스헤어만 업데이트해야 하는 경우 등 (renderAllCharts 호출 안 함)
        // 예: this.chartInstance.crosshair?.draw(); // 필요하다면 여기서 크로스헤어만 다시 그림
      }
    } catch (error) {
      console.error("차트 업데이트 중 오류 발생:", error);
      this.unsubscribeChartUpdate("update-error"); // 오류 시 구독 해제 시도
      return; // 오류 발생 시 타이머 설정 방지
    } finally {
      // *** Idle 타이머 설정: 렌더링이 발생했거나, 아직 구독 해제되지 않았다면 다음 유휴 상태 감지 예약 ***
      // 참조 카운트가 0보다 크면 아직 다른 곳에서 구독 해제를 기다리고 있을 수 있음
      if (this.chartUpdateRefCount > 0 || this.isChartUpdateSubscribed) {
        // 구독 중일 때만 타이머 설정
        this.idleUnsubscribeTimer = setTimeout(() => {
          this.unsubscribeChartUpdate("idle-timer");
          this.idleUnsubscribeTimer = null;
        }, this.IDLE_TIMEOUT_MS);
      }
    }
  }

  // 리소스 해제
  dispose() {
    // Ticker 구독 해제
    if (this.isChartUpdateSubscribed) {
      tickerInstance.unsubscribe(this.boundUpdateCharts);
    }
    // 타이머 해제
    if (this.idleUnsubscribeTimer) {
      clearTimeout(this.idleUnsubscribeTimer);
    }
    this.isChartUpdateSubscribed = false;
    this.chartUpdateRefCount = 0;
    this.idleUnsubscribeTimer = null;

    if (this.chart?.canvas) {
      const canvas = this.chart.canvas;
      // 이벤트 리스너 제거
      canvas.removeEventListener("wheel", this.handleWheel);
      canvas.removeEventListener("mousedown", this.handleMouseDown);
      canvas.removeEventListener("mousemove", this.handleMouseMove);
      // window에 등록했다면 window에서 제거
      window.removeEventListener("mouseup", this.handleMouseUp);
      canvas.removeEventListener("mouseleave", this.handleMouseLeave);
    }
    // 다른 리소스 해제 코드...
  }
}
