class Ticker {
  constructor() {
    this.subscribers = new Set();
    this.isRunning = false;
    this.tick = this.tick.bind(this);
  }

  subscribe(fn) {
    this.subscribers.add(fn);
    if (!this.isRunning) {
      this.isRunning = true;
      requestAnimationFrame(this.tick);
    }
  }

  unsubscribe(fn) {
    // console.log("구독취소dd");
    this.subscribers.delete(fn);
    if (this.subscribers.size === 0) {
      this.isRunning = false;
    }
  }

  tick(timestamp) {
    if (!this.isRunning) return;
    console.log(this.subscribers.size);
    this.subscribers.forEach((fn) => fn(timestamp));
    requestAnimationFrame(this.tick);
  }
}
export const tickerInstance = new Ticker();
