// 좌표 변환 최적화를 위한 클래스
export class TypedCoordinateTransformer {
  constructor(capacity = 1000) {
    this.xCoords = new Float32Array(capacity);
    this.yCoords = new Float32Array(capacity);
    this.capacity = capacity;
    this.size = 0;
  }

  // 용량 조정
  ensureCapacity(requiredCapacity) {
    if (requiredCapacity <= this.capacity) return;

    const newCapacity = Math.max(this.capacity * 2, requiredCapacity);
    const newXCoords = new Float32Array(newCapacity);
    const newYCoords = new Float32Array(newCapacity);

    newXCoords.set(this.xCoords.subarray(0, this.size));
    newYCoords.set(this.yCoords.subarray(0, this.size));

    this.xCoords = newXCoords;
    this.yCoords = newYCoords;
    this.capacity = newCapacity;
  }

  // 데이터 변환 및 저장
  transformPoints(xValues, yValues, xScale, yScale, count) {
    this.ensureCapacity(count);
    this.size = count;

    // 일괄 변환
    for (let i = 0; i < count; i++) {
      this.xCoords[i] = xScale.getPixelForValue(xValues[i]);
      this.yCoords[i] = yScale.getPixelForValue(yValues[i]);
    }
  }

  // 배열 전체 접근자
  getXCoords() {
    return this.xCoords.subarray(0, this.size);
  }

  getYCoords() {
    return this.yCoords.subarray(0, this.size);
  }

  // 특정 인덱스의 좌표 가져오기
  getCoord(index) {
    if (index < 0 || index >= this.size) return null;
    return { x: this.xCoords[index], y: this.yCoords[index] };
  }

  // 좌표 배열 초기화
  clear() {
    this.size = 0;
  }
}
