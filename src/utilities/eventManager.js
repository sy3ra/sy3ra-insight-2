/**
 * 이벤트 유형 열거형
 */
export const EventTypes = {
  MOUSE_MOVE: "mousemove",
  MOUSE_DOWN: "mousedown",
  MOUSE_UP: "mouseup",
  MOUSE_CLICK: "click",
  MOUSE_LEAVE: "mouseleave",
  RESIZE: "resize",
  DRAWING_START: "drawing:start",
  DRAWING_MOVE: "drawing:move",
  DRAWING_END: "drawing:end",
  TOOL_CHANGE: "drawing:tool-change",
};

export class EventManager {
  constructor(canvas, chartInstance) {
    this.canvas = canvas;
    this.chartInstance = chartInstance;
    this.listeners = new Map();

    // 모든 이벤트 유형에 대한 리스너 맵 초기화
    Object.values(EventTypes).forEach((type) => {
      this.listeners.set(type, new Set());
    });

    // 메서드 바인딩
    this.handleEvent = this.handleEvent.bind(this);
    this.handleResize = this.handleResize.bind(this);

    // 이벤트 초기화
    this.initialize();
  }

  /**
   * 이벤트 리스너 초기화
   */
  initialize() {
    // 마우스 이벤트 등록
    [
      EventTypes.MOUSE_MOVE,
      EventTypes.MOUSE_DOWN,
      EventTypes.MOUSE_UP,
      EventTypes.MOUSE_CLICK,
      EventTypes.MOUSE_LEAVE,
    ].forEach((type) => {
      this.canvas.addEventListener(type, this.handleEvent);
    });

    // 윈도우 리사이즈 이벤트 등록
    window.addEventListener(EventTypes.RESIZE, this.handleResize, false);
  }

  /**
   * 모든 이벤트 핸들러 (마우스 이벤트용)
   */
  handleEvent(event) {
    // 이벤트 타입 추출
    const type = event.type;

    // 마우스 좌표 계산 (mouseleave 제외)
    if (type !== EventTypes.MOUSE_LEAVE) {
      const { x, y } = this.getCoordinatesFromEvent(event);

      // 차트 인스턴스 업데이트 (move, down, up 이벤트만)
      if (
        [
          EventTypes.MOUSE_MOVE,
          EventTypes.MOUSE_DOWN,
          EventTypes.MOUSE_UP,
        ].includes(type) &&
        this.chartInstance
      ) {
        this.chartInstance.updateMousePosition(x, y);
      }

      // 등록된 리스너에게 알림
      this.notifyListeners(type, x, y);
    } else {
      // mouseleave 이벤트 처리
      if (this.chartInstance) {
        this.chartInstance.mouseLeave();
      }
      // 리스너에게 알림 (좌표 없이)
      this.notifyListeners(type);
    }
  }

  /**
   * 리사이즈 이벤트 핸들러
   */
  handleResize() {
    // 등록된 리스너에게 알림
    this.notifyListeners(EventTypes.RESIZE);
  }

  /**
   * 이벤트에서 좌표 추출
   */
  getCoordinatesFromEvent(event) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }

  /**
   * 구독자에게 알림
   */
  notifyListeners(type, ...args) {
    const listenersSet = this.listeners.get(type);
    if (listenersSet) {
      listenersSet.forEach((listener) => {
        if (typeof listener === "function") {
          listener(...args);
        }
      });
    }
  }

  /**
   * 이벤트 리스너 추가
   */
  addEventListener(type, listener) {
    const listenersSet = this.listeners.get(type);
    if (listenersSet) {
      listenersSet.add(listener);
    }
    return this; // 메서드 체이닝 지원
  }

  /**
   * 이벤트 리스너 제거
   */
  removeEventListener(type, listener) {
    const listenersSet = this.listeners.get(type);
    if (listenersSet) {
      listenersSet.delete(listener);
    }
    return this; // 메서드 체이닝 지원
  }

  /**
   * 모든 이벤트 리스너 정리
   */
  cleanup() {
    // 마우스 이벤트 제거
    [
      EventTypes.MOUSE_MOVE,
      EventTypes.MOUSE_DOWN,
      EventTypes.MOUSE_UP,
      EventTypes.MOUSE_CLICK,
      EventTypes.MOUSE_LEAVE,
    ].forEach((type) => {
      this.canvas.removeEventListener(type, this.handleEvent);
    });

    // 윈도우 리사이즈 이벤트 제거
    window.removeEventListener(EventTypes.RESIZE, this.handleResize);

    // 모든 리스너 맵 초기화
    this.listeners.forEach((set) => set.clear());
  }
}
