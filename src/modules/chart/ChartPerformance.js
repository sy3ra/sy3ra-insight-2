export class ChartPerformance {
  constructor() {
    // 성능 모니터링 변수
    this.refreshRate = 60; // 기본값
    this.frameIntervals = [];
    this.renderThrottleDelay = Math.floor((1000 / this.refreshRate) * 0.9);
    this.lastRenderTimestamp = 0;
  }

  // 렌더링 스로틀 딜레이 업데이트
  updateRenderThrottleDelay() {
    // 주사율 기반 최적 지연시간 설정
    // 기존: 90%에서 100%로 변경하여 모든 프레임을 활용
    this.renderThrottleDelay = Math.floor(1000 / this.refreshRate);
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
