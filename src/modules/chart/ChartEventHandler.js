import { tickerInstance } from "../ticker.js";

export class ChartEventHandler {
  constructor(chart, chartInstance) {
    this.chart = chart;
    this.chartInstance = chartInstance;

    // 상태 변수
    this.isWheelActive = false;
    this.isDragging = false;
    this.lastMouseX = 0;
    this.lastMouseY = 0;
    this.lastWheelTime = 0;
    this.wheelDebounceTimer = null;
    this.accumulatedDeltaY = 0;

    // 바인딩된 메서드
    this.boundUpdateCharts = this.updateCharts.bind(this);

    // 구독 상태 관리
    this.isChartUpdateSubscribed = false;
    this.chartUpdateRefCount = 0;

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
    console.log("드로잉 도구가 차트 이벤트 핸들러에 등록되었습니다.");
  }

  // 드로잉 모드 활성화/비활성화 메서드 추가
  setDrawingMode(isActive) {
    this.isDrawingMode = isActive;

    // 드로잉 모드일 때 차트 패닝/줌 비활성화
    if (isActive) {
      this.originalState = {
        isDragging: this.isDragging,
        isWheelActive: this.isWheelActive,
      };

      this.isDragging = false;
      this.isWheelActive = false;
      console.log("드로잉 모드 활성화: 차트 패닝/줌 비활성화됨");
    } else if (this.originalState) {
      // 원래 상태로 복원
      this.isDragging = this.originalState.isDragging;
      this.isWheelActive = this.originalState.isWheelActive;
      console.log("드로잉 모드 비활성화: 차트 패닝/줌 상태 복원됨");
    }
  }

  setupEventHandlers(canvas) {
    if (!canvas) return;

    // 이벤트 리스너 추가
    canvas.addEventListener("wheel", this.handleWheel, { passive: false });
    canvas.addEventListener("mousedown", this.handleMouseDown);
    canvas.addEventListener("mousemove", this.handleMouseMove);
    canvas.addEventListener("mouseup", this.handleMouseUp);
    canvas.addEventListener("mouseleave", this.handleMouseLeave);
  }

  handleWheel(e) {
    e.preventDefault();

    // 드로잉 모드일 때는 휠 이벤트 무시
    if (this.isDrawingMode) return;

    // 시간 제한 (throttling)
    const now = Date.now();
    if (now - this.lastWheelTime < 8) {
      this.accumulatedDeltaY = (this.accumulatedDeltaY || 0) + e.deltaY;
      return;
    }

    this.lastWheelTime = now;

    // 차트 영역 확인
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const chartArea = this.chart.chartArea;
    if (
      x < chartArea.left ||
      x > chartArea.right ||
      y < chartArea.top ||
      y > chartArea.bottom
    ) {
      return;
    }

    // 수정자 키 확인 및 줌 속도/방향 설정
    const isModifierPressed = e.shiftKey || e.metaKey || e.ctrlKey;
    const speed = 0.1;

    // 줌 방향 반대로 변경 (deltaY > 0이면 확대, deltaY < 0이면 축소)
    const delta = e.deltaY > 0 ? 1 + speed : 1 - speed;
    const direction = isModifierPressed ? "y" : "x";

    // 차트 상태 업데이트
    this.chartInstance.updateChartState(x, y, delta, direction);

    // 구독 관련 코드
    if (!this.isWheelActive) {
      this.isWheelActive = true;
      this.subscribeChartUpdate("wheel");
    }

    // 디바운싱
    if (this.wheelDebounceTimer) {
      clearTimeout(this.wheelDebounceTimer);
    }

    this.wheelDebounceTimer = setTimeout(() => {
      // 이벤트 종료 후 차트 동기화 보장
      this.synchronizeChartsAfterEvent();

      this.isWheelActive = false;
      this.unsubscribeChartUpdate("wheel-timer");
      this.wheelDebounceTimer = null;
    }, 100); // 타임아웃 시간을 증가하여 동기화 시간 확보 (10ms → 100ms)
  }

  handleMouseDown(e) {
    // 드로잉 모드일 때는 드로잉 도구에 이벤트 전달
    if (this.isDrawingMode && this.drawingTool) {
      const rect = e.target.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      // 드로잉 도구에 클릭 이벤트 전달
      this.drawingTool.onMouseClick(x, y);
      return;
    }

    // 오른쪽 마우스 클릭 무시
    if (e.button === 2) return;

    try {
      if (!e.currentTarget) {
        return;
      }

      const rect = e.currentTarget.getBoundingClientRect();
      this.lastMouseX = e.clientX - rect.left;
      this.lastMouseY = e.clientY - rect.top;

      // 차트 영역 확인
      if (
        !this.isPointInChartArea({ x: this.lastMouseX, y: this.lastMouseY })
      ) {
        return;
      }

      this.isDragging = true;
      this.subscribeChartUpdate("mouse-down");
      e.preventDefault();
    } catch (error) {
      console.error("Error in handleMouseDown:", error);
    }
  }

  handleMouseMove(e) {
    const rect = e.target.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // 드로잉 모드일 때는 드로잉 도구에 이벤트 전달
    if (this.isDrawingMode && this.drawingTool) {
      this.drawingTool.onMouseMove(x, y);
      return;
    }

    if (!this.isDragging || !this.chart) return;

    try {
      // canvas가 null인지 확인
      if (!this.chart.canvas) {
        this.isDragging = false; // 드래깅 상태 초기화
        this.unsubscribeChartUpdate("mouse-move-error");
        return;
      }

      const deltaX = x - this.lastMouseX;
      const deltaY = y - this.lastMouseY;

      // 차트 패닝
      this.chartInstance.panChart(deltaX, deltaY);

      if (this.chartInstance.overlayManager) {
        this.chartInstance.overlayManager.panOverlays(deltaX, deltaY);
      }

      this.lastMouseX = x;
      this.lastMouseY = y;
    } catch (error) {
      console.error("Error in handleMouseMove:", error);
      this.isDragging = false; // 드래깅 상태 초기화하여 더 이상의 오류 방지
      this.unsubscribeChartUpdate("mouse-move-error");
    }
  }

  handleMouseUp(e) {
    // 드로잉 모드일 때는 드로잉 도구에 이벤트 전달
    if (this.isDrawingMode && this.drawingTool) {
      // 필요한 경우 드로잉 도구에 마우스 업 이벤트 전달
      return;
    }

    if (this.isDragging) {
      this.isDragging = false;

      // 마우스 드래그 종료 후 차트 동기화
      this.synchronizeChartsAfterEvent();

      this.unsubscribeChartUpdate("mouse-up");
    }
  }

  handleMouseLeave(e) {
    if (this.isDragging) {
      this.isDragging = false;
    }
    this.unsubscribeChartUpdate("mouse-leave");

    // 크로스헤어 숨기기
    if (this.chartInstance.crosshair) {
      this.chartInstance.crosshair.mouseLeave();
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

    if (!this.isChartUpdateSubscribed) {
      tickerInstance.subscribe(this.boundUpdateCharts);
      this.isChartUpdateSubscribed = true;
    }
  }

  // 차트 업데이트 구독 해제
  unsubscribeChartUpdate(source = "unknown") {
    if (source === "mouse-leave") {
      this.chartUpdateRefCount = 0;
      if (this.isChartUpdateSubscribed) {
        tickerInstance.unsubscribe(this.boundUpdateCharts);
        this.isChartUpdateSubscribed = false;
      }
      return;
    }

    if (source === "wheel-timer") {
      this.chartUpdateRefCount = Math.max(0, this.chartUpdateRefCount - 1);
      if (this.chartUpdateRefCount === 0 && this.isChartUpdateSubscribed) {
        tickerInstance.unsubscribe(this.boundUpdateCharts);
        this.isChartUpdateSubscribed = false;
      }
      return;
    }

    if (this.chartUpdateRefCount > 0) {
      this.chartUpdateRefCount--;
    }

    if (this.chartUpdateRefCount === 0 && this.isChartUpdateSubscribed) {
      tickerInstance.unsubscribe(this.boundUpdateCharts);
      this.isChartUpdateSubscribed = false;
    }
  }

  // 차트 업데이트 메서드
  updateCharts(timestamp) {
    if (!this.chartInstance) return;

    this.chartInstance.isUpdating = false;

    try {
      // 차트 인스턴스 유효성 검사
      if (
        !this.chartInstance.chart ||
        !this.chartInstance.chart.data ||
        !this.chartInstance.chart.data.datasets ||
        !this.chartInstance.chart.data.datasets[0]
      ) {
        return;
      }

      // 업데이트 예약 상태이면 차트 렌더링
      if (this.chartInstance.chartNeedsUpdate) {
        this.chartInstance.renderAllCharts();
      }
    } catch (error) {
      console.error("차트 업데이트 중 오류 발생:", error);
    }
  }

  // 이벤트 종료 후 차트 동기화를 보장하는 메서드
  synchronizeChartsAfterEvent() {
    if (!this.chart) return;

    // 차트 업데이트 예약 상태 확인
    if (this.chartInstance.chartNeedsUpdate) {
      // 차트가 아직 렌더링 중이 아니라면 렌더링 시작
      if (!this.chartInstance.isUpdating) {
        this.chartInstance.isUpdating = true;

        // requestAnimationFrame을 사용하여 최적화된 렌더링
        requestAnimationFrame(this.boundUpdateCharts);
      }
    }
  }

  // 리소스 해제
  dispose() {
    if (this.chart && this.chart.canvas) {
      const canvas = this.chart.canvas;

      // 이벤트 리스너 제거
      canvas.removeEventListener("wheel", this.handleWheel);
      canvas.removeEventListener("mousedown", this.handleMouseDown);
      canvas.removeEventListener("mousemove", this.handleMouseMove);
      canvas.removeEventListener("mouseup", this.handleMouseUp);
      canvas.removeEventListener("mouseleave", this.handleMouseLeave);
    }
  }
}
