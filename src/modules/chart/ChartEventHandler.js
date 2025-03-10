import { tickerInstance } from "../ticker.js";

export class ChartEventHandler {
  constructor(chart, volumeChart, chartInstance) {
    this.chart = chart;
    this.volumeChart = volumeChart;
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
  }

  setupEventHandlers(canvas) {
    // 이벤트 리스너 등록
    canvas.addEventListener("wheel", this.handleWheel.bind(this), {
      passive: false,
    });
    canvas.addEventListener("mousedown", this.handleMouseDown.bind(this));
    document.addEventListener("mousemove", this.handleMouseMove.bind(this));
    document.addEventListener("mouseup", this.handleMouseUp.bind(this));
    canvas.addEventListener("mouseleave", this.handleMouseLeave.bind(this));
  }

  handleWheel(e) {
    e.preventDefault();

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
    // 오른쪽 마우스 클릭 무시
    if (e.button === 2) return;

    const rect = e.currentTarget.getBoundingClientRect();
    this.lastMouseX = e.clientX - rect.left;
    this.lastMouseY = e.clientY - rect.top;

    // 차트 영역 확인
    if (!this.isPointInChartArea({ x: this.lastMouseX, y: this.lastMouseY })) {
      return;
    }

    this.isDragging = true;
    this.subscribeChartUpdate("mouse-down");
    e.preventDefault();
  }

  handleMouseMove(e) {
    if (!this.isDragging || !this.chart) return;

    const rect = this.chart.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const deltaX = x - this.lastMouseX;
    const deltaY = y - this.lastMouseY;

    // 차트 패닝
    this.chartInstance.panChart(deltaX, deltaY);

    this.lastMouseX = x;
    this.lastMouseY = y;
  }

  handleMouseUp() {
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
    const chartArea = this.chart.chartArea;
    return (
      point.x >= chartArea.left &&
      point.x <= chartArea.right &&
      point.y >= chartArea.top &&
      point.y <= chartArea.bottom
    );
  }

  // 차트 업데이트 구독
  subscribeChartUpdate(source = "unknown") {
    console.log(`차트 업데이트 구독 시도 (소스: ${source})`);
    this.chartUpdateRefCount++;

    if (!this.isChartUpdateSubscribed) {
      tickerInstance.subscribe(this.boundUpdateCharts);
      this.isChartUpdateSubscribed = true;
      console.log("차트 업데이트 구독 시작");
    }

    console.log(`현재 구독 참조 수: ${this.chartUpdateRefCount}`);
  }

  // 차트 업데이트 구독 해제
  unsubscribeChartUpdate(source = "unknown") {
    console.log(`차트 업데이트 구독 해제 시도 (소스: ${source})`);

    if (source === "mouse-leave") {
      console.log("마우스가 차트 영역을 벗어남: 모든 구독 강제 해제");
      this.chartUpdateRefCount = 0;
      if (this.isChartUpdateSubscribed) {
        tickerInstance.unsubscribe(this.boundUpdateCharts);
        this.isChartUpdateSubscribed = false;
        console.log("구독 완전히 해제됨 (mouse-leave)");
      }
      return;
    }

    if (source === "wheel-timer") {
      this.chartUpdateRefCount = Math.max(0, this.chartUpdateRefCount - 1);
      console.log(`휠 타이머 종료 후 참조 수: ${this.chartUpdateRefCount}`);
      if (this.chartUpdateRefCount === 0 && this.isChartUpdateSubscribed) {
        tickerInstance.unsubscribe(this.boundUpdateCharts);
        this.isChartUpdateSubscribed = false;
        console.log("구독 완전히 해제됨 (wheel-timer)");
      }
      return;
    }

    if (this.chartUpdateRefCount > 0) {
      this.chartUpdateRefCount--;
    }

    console.log(`구독 해제 후 참조 수: ${this.chartUpdateRefCount}`);
    if (this.chartUpdateRefCount === 0 && this.isChartUpdateSubscribed) {
      tickerInstance.unsubscribe(this.boundUpdateCharts);
      this.isChartUpdateSubscribed = false;
      console.log("구독 완전히 해제됨 (일반 케이스)");
    }
  }

  // 차트 업데이트 메서드
  updateCharts(timestamp) {
    if (!this.chartInstance || !this.chart) return;

    if (this.chartInstance.chartNeedsUpdate) {
      // 즉시 렌더링 (스로틀링 제거)
      this.chartInstance.renderAllCharts();
    }
  }

  // 이벤트 종료 후 차트 동기화를 보장하는 메서드 - 개선 버전
  synchronizeChartsAfterEvent() {
    if (!this.chart || !this.volumeChart || !this.chartInstance) return;

    // 이벤트 종료 후 동기화를 위해 짧은 지연 적용
    setTimeout(() => {
      // 볼륨 차트 매니저의 정밀 동기화 사용
      this.chartInstance.volumeChartManager.exactSyncWithMainChart(this.chart);

      // 차트 업데이트 플래그 설정
      this.chartInstance.chartNeedsUpdate = true;

      // 즉시 렌더링하여 동기화 적용
      requestAnimationFrame(() => {
        this.chartInstance.renderAllCharts();
      });
    }, 10); // 짧은 딜레이로 Chart.js의 내부 계산 완료 기다림
  }

  // 리소스 해제
  dispose() {
    this.unsubscribeChartUpdate("dispose");
  }
}
