class Ticker {
  constructor() {
    this.subscribers = new Map();
    this.isRunning = false;
    this.tick = this.tick.bind(this);
    this.currentTick = 0;
  }

  subscribe(fn, options = {}) {
    const {
      eventType = "default",
      priority = 0,
      throttleMs = 0, // 0이면 제한 없음
    } = typeof options === "string" ? { eventType: options } : options;

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
    // 구독자가 없거나 실행 중이 아닌 경우 루프 중단
    if (!this.isRunning || this.subscribers.size === 0) {
      this.isRunning = false;
      return; // 더 이상 RAF 호출하지 않음
    }

    this.currentTick++;

    const executedEventTypes = new Set();

    for (const [fn, info] of this.subscribers) {
      const { eventType, throttleMs, lastExecutedTime } = info;

      // 이벤트 유형 중복 실행 방지
      if (eventType !== "default" && executedEventTypes.has(eventType)) {
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
  }
}
export const tickerInstance = new Ticker();
