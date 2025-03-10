export class ChartPerformance {
  constructor() {
    // 성능 모니터링 변수
    this.refreshRate = 60; // 기본값
    this.frameIntervals = [];
    this.renderThrottleDelay = Math.floor((1000 / this.refreshRate) * 0.9);
    this.lastRenderTimestamp = 0;

    // 모니터 주사율 감지 실행
    this.detectRefreshRate();
  }

  // 모니터 주사율 감지
  detectRefreshRate() {
    if ("screen" in window && "refresh" in window.screen) {
      // 모던 API 사용
      window.screen.refresh?.addEventListener("change", () => {
        this.refreshRate = window.screen.refresh?.rate || 60;
        console.log(`모니터 주사율 감지: ${this.refreshRate}Hz`);
        this.updateRenderThrottleDelay();
      });

      // 초기값 설정
      if (window.screen.refresh?.getState) {
        window.screen.refresh
          .getState()
          .then((state) => {
            this.refreshRate = state.rate || 60;
            this.updateRenderThrottleDelay();
          })
          .catch(() => this.measureRefreshRateWithRAF());
      } else {
        this.measureRefreshRateWithRAF();
      }
    } else {
      this.measureRefreshRateWithRAF();
    }
  }

  // requestAnimationFrame으로 주사율 측정
  measureRefreshRateWithRAF() {
    const frameIntervals = new Float32Array(20);
    let lastTime = performance.now();
    let frameCount = 0;
    const framesToMeasure = 10;
    let intervalIndex = 0;

    const measureFrame = (timestamp) => {
      const now = performance.now();
      const delta = now - lastTime;

      if (delta > 5) {
        // 노이즈 필터링
        frameIntervals[intervalIndex++] = delta;
        lastTime = now;
        frameCount++;

        // 버퍼 끝에 도달하면 처음부터 다시 시작
        if (intervalIndex >= frameIntervals.length) {
          intervalIndex = 0;
        }
      }

      if (frameCount < framesToMeasure) {
        requestAnimationFrame(measureFrame);
      } else {
        // 사용된 버퍼 부분만 복사
        const usedIntervals = frameIntervals.slice(0, intervalIndex);

        // Float32Array를 일반 배열로 변환하여 정렬
        const sortedIntervals = Array.from(usedIntervals).sort((a, b) => a - b);

        // 중간값 계산
        const medianInterval =
          sortedIntervals[Math.floor(sortedIntervals.length / 2)];
        this.refreshRate = Math.round(1000 / medianInterval);

        console.log(
          `측정된 모니터 주사율: ${
            this.refreshRate
          }Hz (${medianInterval.toFixed(2)}ms 간격)`
        );
        this.updateRenderThrottleDelay();
      }
    };

    requestAnimationFrame(measureFrame);
  }

  // 렌더링 스로틀 딜레이 업데이트
  updateRenderThrottleDelay() {
    // 주사율 기반 최적 지연시간 설정
    // 기존: 90%에서 100%로 변경하여 모든 프레임을 활용
    this.renderThrottleDelay = Math.floor(1000 / this.refreshRate);
    console.log(`렌더링 스로틀 딜레이 업데이트: ${this.renderThrottleDelay}ms`);
  }

  // 성능 통계 정보 수집
  getPerformanceStats(dataManager, chart) {
    return {
      dataStats: dataManager?.getStats() || { size: 0 },
      renderStats: {
        lastRenderTime: this.lastRenderTimestamp,
        throttleDelay: this.renderThrottleDelay,
        refreshRate: this.refreshRate,
      },
      chartState: chart
        ? {
            dataPoints: chart.data.datasets[0].data.length,
            visibleMin: chart.scales.x.min,
            visibleMax: chart.scales.x.max,
            visibleRange: chart.scales.x.max - chart.scales.x.min,
          }
        : null,
    };
  }

  // 렌더링 타임스탬프 업데이트
  updateRenderTimestamp() {
    this.lastRenderTimestamp = performance.now();
  }
}
