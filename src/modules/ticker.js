class Ticker {
  constructor() {
    this.subscribers = new Map();
    this.isRunning = false;
    this.tick = this.tick.bind(this);
    this.currentTick = 0;

    // 성능 모니터링 추가
    this.lastTickTime = 0;
    this.frameTimeHistory = [];
    this.frameTimeHistoryMaxLength = 60; // 1초 분량 (60fps 기준)
    this.monitoringEnabled = false;
  }

  subscribe(fn, options = {}) {
    const {
      eventType = "default",
      priority = 0,
      throttleMs = 0, // 0이면 제한 없음
    } = typeof options === "string" ? { eventType: options } : options;

    // console.log("구독 추가");
    this.subscribers.set(fn, {
      eventType,
      priority,
      throttleMs,
      lastExecutedTick: -1,
      lastExecutedTime: 0,
    });

    if (!this.isRunning) {
      this.isRunning = true;
      requestAnimationFrame(this.tick);
    }

    return this; // 메서드 체이닝 지원
  }

  unsubscribe(fn) {
    const result = this.subscribers.delete(fn);

    // 구독자가 없으면 실행 중지 플래그 설정
    if (this.subscribers.size === 0) {
      this.isRunning = false;
    }

    return result; // 구독 해제 성공 여부 반환
  }

  tick(timestamp) {
    // console.time("tick start");
    // 구독자가 없거나 실행 중이 아닌 경우 루프 중단
    if (!this.isRunning || this.subscribers.size === 0) {
      this.isRunning = false;
      return; // 더 이상 RAF 호출하지 않음
    }

    // 성능 모니터링
    if (this.monitoringEnabled) {
      if (this.lastTickTime > 0) {
        const frameTime = timestamp - this.lastTickTime;
        this.frameTimeHistory.push(frameTime);

        // 히스토리 크기 제한
        if (this.frameTimeHistory.length > this.frameTimeHistoryMaxLength) {
          this.frameTimeHistory.shift();
        }

        // 프레임 드롭 감지 (33ms = 약 30fps 이하)
        if (frameTime > 33) {
          // console.warn(`프레임 드롭 감지: ${frameTime.toFixed(2)}ms`);
        }
      }
      this.lastTickTime = timestamp;
    }

    this.currentTick++;

    // 우선순위별로 구독자 정렬
    const sortedSubscribers = Array.from(this.subscribers.entries()).sort(
      (a, b) => b[1].priority - a[1].priority
    );

    // 디버깅: 구독자 정보 출력 (100틱마다)
    if (this.monitoringEnabled && this.currentTick % 100 === 0) {
      console.log(
        `Ticker 구독자 (${this.subscribers.size}개):`,
        Array.from(this.subscribers.entries()).map(([fn, info]) => ({
          eventType: info.eventType,
          throttleMs: info.throttleMs,
          lastExecuted: info.lastExecutedTime
            ? Math.round(timestamp - info.lastExecutedTime) + "ms 전"
            : "never",
        }))
      );
    }

    const executedEventTypes = new Set();

    for (const [fn, info] of sortedSubscribers) {
      const { eventType, throttleMs, lastExecutedTime } = info;

      // 이벤트 유형 중복 실행 방지
      if (eventType !== "default" && executedEventTypes.has(eventType)) {
        // 디버깅: 중복 이벤트 타입 스킵 로그 (100틱마다)
        if (this.monitoringEnabled && this.currentTick % 100 === 0) {
          console.log(`이벤트 타입 중복 스킵: ${eventType}`);
        }
        continue;
      }

      // 실행 빈도 제한 적용
      if (throttleMs > 0 && timestamp - lastExecutedTime < throttleMs) {
        continue;
      }

      try {
        fn(timestamp);

        // 정보 업데이트
        this.subscribers.set(fn, {
          ...info,
          lastExecutedTick: this.currentTick,
          lastExecutedTime: timestamp,
        });

        executedEventTypes.add(eventType);
      } catch (error) {
        console.error("Ticker 구독자 실행 중 오류:", error);
      }
    }

    // 구독자가 있을 때만 다음 프레임 예약
    if (this.subscribers.size > 0 && this.isRunning) {
      requestAnimationFrame(this.tick);
    } else {
      this.isRunning = false;
    }
    // console.timeEnd("tick start");
  }

  // 모니터링 활성화/비활성화 메서드
  enableMonitoring(enabled = true) {
    this.monitoringEnabled = enabled;
    if (!enabled) {
      this.frameTimeHistory = [];
    }
    return this;
  }

  // 성능 통계 얻기
  getPerformanceStats() {
    if (!this.monitoringEnabled || this.frameTimeHistory.length === 0) {
      return null;
    }

    const sum = this.frameTimeHistory.reduce((a, b) => a + b, 0);
    const avg = sum / this.frameTimeHistory.length;
    const max = Math.max(...this.frameTimeHistory);
    const min = Math.min(...this.frameTimeHistory);

    return {
      averageFrameTime: avg.toFixed(2),
      maxFrameTime: max.toFixed(2),
      minFrameTime: min.toFixed(2),
      fps: (1000 / avg).toFixed(1),
      sampleCount: this.frameTimeHistory.length,
    };
  }
}
export const tickerInstance = new Ticker();
