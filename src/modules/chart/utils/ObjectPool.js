// 객체 풀링을 위한 클래스
export class ObjectPool {
  constructor(objectFactory, resetFunction, initialSize = 20) {
    this.pool = [];
    this.objectFactory = objectFactory;
    this.resetFunction = resetFunction || ((obj) => obj);

    // 초기 객체 생성
    for (let i = 0; i < initialSize; i++) {
      this.pool.push(this.objectFactory());
    }
  }

  get() {
    return this.pool.length > 0 ? this.pool.pop() : this.objectFactory();
  }

  release(object) {
    if (object) {
      // 객체 상태 초기화 및 풀에 반환
      this.resetFunction(object);
      this.pool.push(object);
    }
  }
}

// 자주 사용되는 객체 풀 생성 함수
export function createPointPool(initialSize = 50) {
  return new ObjectPool(
    () => ({ x: 0, y: 0 }),
    (obj) => {
      obj.x = 0;
      obj.y = 0;
      return obj;
    },
    initialSize
  );
}

export function createLineParamPool(initialSize = 30) {
  return new ObjectPool(
    () => ({
      startX: 0,
      startY: 0,
      endX: 0,
      endY: 0,
      color: "red",
      width: 1,
    }),
    (obj) => {
      obj.startX = obj.startY = obj.endX = obj.endY = 0;
      obj.color = "red";
      obj.width = 1;
      return obj;
    },
    initialSize
  );
}

export function createRectPool(initialSize = 10) {
  return new ObjectPool(
    () => ({ x: 0, y: 0, width: 0, height: 0 }),
    (obj) => {
      obj.x = obj.y = obj.width = obj.height = 0;
      return obj;
    },
    initialSize
  );
}

export function createEventInfoPool(initialSize = 20) {
  return new ObjectPool(
    () => ({ x: 0, y: 0, deltaX: 0, deltaY: 0, type: "" }),
    (obj) => {
      obj.x = obj.y = obj.deltaX = obj.deltaY = 0;
      obj.type = "";
      return obj;
    },
    initialSize
  );
}

export function createArrayPool(initialSize = 10) {
  return new ObjectPool(
    () => [],
    (arr) => {
      arr.length = 0;
      return arr;
    },
    initialSize
  );
}
