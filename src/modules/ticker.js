class Ticker {
  constructor() {
    this.subscribers = new Set();
    this.isRunning = false;
    this.tick = this.tick.bind(this);
  }

  subscribe(fn) {
    this.subscribers.add(fn);
    console.log(this.subscribers);
    if (!this.isRunning) {
      this.isRunning = true;
      requestAnimationFrame(this.tick);
    }
  }

  unsubscribe(fn) {
    this.subscribers.delete(fn);
    console.log(this.subscribers);
    if (this.subscribers.size === 0) {
      this.isRunning = false;
    }
  }

  tick(timestamp) {
    if (!this.isRunning) return;
    // console.log(this.subscribers);
    // 각 구독자의 업데이트 함수 호출
    this.subscribers.forEach((fn) => fn(timestamp));
    requestAnimationFrame(this.tick);
  }
}
export const tickerInstance = new Ticker();
