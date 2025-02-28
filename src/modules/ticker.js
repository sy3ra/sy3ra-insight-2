class Ticker {
  constructor() {
    this.subscribers = new Map();
    this.isRunning = false;
    this.tick = this.tick.bind(this);
    this.currentTick = 0;
  }

  subscribe(fn, eventType = "default") {
    this.subscribers.set(fn, {
      eventType,
      lastExecutedTick: -1,
    });

    if (!this.isRunning) {
      this.isRunning = true;
      requestAnimationFrame(this.tick);
    }
  }

  unsubscribe(fn) {
    this.subscribers.delete(fn);
    if (this.subscribers.size === 0) {
      this.isRunning = false;
    }
  }

  tick(timestamp) {
    if (!this.isRunning) return;
    this.currentTick++;

    const executedEventTypes = new Set();

    this.subscribers.forEach((info, fn) => {
      const { eventType, lastExecutedTick } = info;

      if (eventType === "default" || !executedEventTypes.has(eventType)) {
        fn(timestamp);

        this.subscribers.set(fn, {
          eventType,
          lastExecutedTick: this.currentTick,
        });

        executedEventTypes.add(eventType);
      }
    });
    // console.log(this.tick);
    // console.log(
    //   `활성 구독자 수: ${this.subscribers.size}, 현재 틱: ${this.currentTick}`
    // );
    requestAnimationFrame(this.tick);
  }
}
export const tickerInstance = new Ticker();
