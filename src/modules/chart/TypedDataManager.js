/**
 * TypedDataManager Class
 * Manages chart data using TypedArrays for better performance and memory efficiency.
 * Assumes timestamp data is sorted in ascending order.
 */
export class TypedDataManager {
  /**
   * Creates an instance of TypedDataManager.
   * @param {number} [initialCapacity=1000] - The initial capacity for the data arrays.
   */
  constructor(initialCapacity = 1000) {
    if (initialCapacity <= 0) {
      throw new Error("Initial capacity must be a positive number.");
    }
    // 캔들스틱 데이터용 TypedArray 생성
    this.timestamps = new Float64Array(initialCapacity); // Use Float64 for precision with timestamps
    this.opens = new Float32Array(initialCapacity);
    this.highs = new Float32Array(initialCapacity);
    this.lows = new Float32Array(initialCapacity);
    this.closes = new Float32Array(initialCapacity);
    this.volumes = new Float32Array(initialCapacity); // Consider Float64 if volumes can be very large

    // 인덱스 및 상태 관리
    this.size = 0;
    this.capacity = initialCapacity;

    // 캐시 (필요에 따라 유지 또는 제거/관리 방식 변경)
    // pixel cache는 차트 스케일이 변경될 때마다 무효화될 가능성이 높으므로,
    // data manager에서 직접 관리하는 것보다 차트 렌더링 시 계산하는 것이 나을 수 있음.
    // 여기서는 일단 제거하여 클래스 역할 명확화.
    // this.xPixelCache = new Float32Array(initialCapacity);
    // this.yPixelCache = new Float32Array(initialCapacity);

    // 색상 캐시 (유틸리티 메서드용)
    this._colorCache = {};
  }

  /**
   * Adds an array of candle data objects to the end of the storage.
   * @param {Array<object>} candleArray - Array of candle objects {x, o, h, l, c, v}.
   */
  addCandlesFromArray(candleArray) {
    if (!Array.isArray(candleArray) || candleArray.length === 0) {
      return;
    }

    const count = candleArray.length;
    const requiredCapacity = this.size + count;

    // 필요시 용량 확장
    if (requiredCapacity > this.capacity) {
      this._expandCapacity(Math.max(this.capacity * 2, requiredCapacity));
    }

    // 데이터 일괄 추가
    for (let i = 0; i < count; i++) {
      const candle = candleArray[i];
      if (!candle) continue; // Skip null/undefined entries

      const index = this.size + i;

      // API 응답 필드명에 따라 't' 또는 'x' 사용 (nullish coalescing)
      this.timestamps[index] = candle.x ?? candle.t;
      this.opens[index] = candle.o;
      this.highs[index] = candle.h;
      this.lows[index] = candle.l;
      this.closes[index] = candle.c;
      this.volumes[index] = candle.v || 0; // Handle potential missing volume
    }

    this.size += count;
  }

  /**
   * Prepends an array of candle data objects to the beginning of the storage.
   * Assumes the input candleArray is sorted chronologically (oldest first).
   * @param {Array<object>} candleArray - Array of candle objects {x, o, h, l, c, v}.
   */
  prependCandles(candleArray) {
    if (!Array.isArray(candleArray) || candleArray.length === 0) {
      return;
    }

    const count = candleArray.length;
    const newSize = this.size + count;

    // 필요시 용량 확장
    if (newSize > this.capacity) {
      this._expandCapacity(Math.max(this.capacity * 2, newSize));
    }

    // 기존 데이터를 오른쪽으로 효율적으로 이동
    // subarray(start, end)는 end 인덱스를 포함하지 않음
    this.timestamps.set(this.timestamps.subarray(0, this.size), count);
    this.opens.set(this.opens.subarray(0, this.size), count);
    this.highs.set(this.highs.subarray(0, this.size), count);
    this.lows.set(this.lows.subarray(0, this.size), count);
    this.closes.set(this.closes.subarray(0, this.size), count);
    this.volumes.set(this.volumes.subarray(0, this.size), count);
    // Pixel cache는 보통 스케일 변경 시 무효화되므로 이동 생략 가능

    // 새 데이터를 앞부분에 추가 (candleArray가 시간순 정렬 가정)
    for (let i = 0; i < count; i++) {
      const candle = candleArray[i];
      if (!candle) continue;

      this.timestamps[i] = candle.x ?? candle.t;
      this.opens[i] = candle.o;
      this.highs[i] = candle.h;
      this.lows[i] = candle.l;
      this.closes[i] = candle.c;
      this.volumes[i] = candle.v || 0;
    }

    // 크기 업데이트
    this.size = newSize;
  }

  /**
   * Finds the start and end indices for data points within the given time range.
   * Uses efficient binary search methods.
   * @param {number} minTimestamp - The minimum timestamp of the visible range.
   * @param {number} maxTimestamp - The maximum timestamp of the visible range.
   * @returns {{startIndex: number, endIndex: number}} Object containing start and end indices (-1 if not found or invalid range).
   */
  getVisibleIndices(minTimestamp, maxTimestamp) {
    if (this.size === 0 || minTimestamp > maxTimestamp) {
      return { startIndex: -1, endIndex: -1 };
    }

    // minTimestamp보다 크거나 같은 첫 번째 인덱스 찾기
    // 데이터 로딩/표시 여유를 위해 시작 인덱스를 조금 더 앞으로 잡을 수 있음 (예: startIndex - 1)
    let startIndex = this.findFirstIndexGreaterEqual(minTimestamp);
    // startIndex = startIndex > 0 ? startIndex - 1 : 0; // 약간의 여유분 추가 (선택 사항)

    // maxTimestamp보다 작거나 같은 마지막 인덱스 찾기
    // 데이터 로딩/표시 여유를 위해 종료 인덱스를 조금 더 뒤로 잡을 수 있음 (예: endIndex + 1)
    let endIndex = this.findLastIndexLessEqual(maxTimestamp);
    // endIndex = endIndex < this.size - 1 ? endIndex + 1 : this.size - 1; // 약간의 여유분 추가 (선택 사항)

    // 유효하지 않은 인덱스 처리 (데이터가 아예 없는 경우 등)
    if (startIndex === -1 || endIndex === -1 || startIndex > endIndex) {
      // 시각적으로 보이는 범위 내에 데이터가 없을 수도 있음 (예: 미래 영역 패닝)
      // 이 경우 빈 범위를 나타내도록 -1 반환
      return { startIndex: -1, endIndex: -1 };
    }

    // 시작 인덱스가 0보다 작아지지 않도록 보정 (여유분 추가 시)
    if (startIndex < 0) startIndex = 0;
    // 종료 인덱스가 배열 크기를 넘지 않도록 보정 (여유분 추가 시)
    if (endIndex >= this.size) endIndex = this.size - 1;

    return { startIndex, endIndex };
  }

  /**
   * Finds the index of the first element whose timestamp is greater than or equal to the target timestamp.
   * Assumes timestamps are sorted in ascending order.
   * @param {number} timestamp - The target timestamp.
   * @returns {number} The found index, or -1 if no such element exists.
   */
  findFirstIndexGreaterEqual(timestamp) {
    if (this.size === 0 || timestamp > this.timestamps[this.size - 1]) {
      return -1; // No data or timestamp is beyond the last element
    }
    // If timestamp is less than or equal to the first element, return 0
    if (timestamp <= this.timestamps[0]) {
      return 0;
    }

    let low = 0;
    let high = this.size - 1;
    let result = -1; // Initialize result to -1 (not found)

    while (low <= high) {
      const mid = Math.floor(low + (high - low) / 2); // Avoid potential overflow
      if (this.timestamps[mid] >= timestamp) {
        result = mid; // Found a potential candidate
        high = mid - 1; // Try to find an earlier index in the left half
      } else {
        low = mid + 1; // Target is in the right half
      }
    }
    return result; // Returns the first index found, or -1 if none >= timestamp (should be covered by initial checks)
  }

  /**
   * Finds the index of the last element whose timestamp is less than or equal to the target timestamp.
   * Assumes timestamps are sorted in ascending order.
   * @param {number} timestamp - The target timestamp.
   * @returns {number} The found index, or -1 if no such element exists.
   */
  findLastIndexLessEqual(timestamp) {
    if (this.size === 0 || timestamp < this.timestamps[0]) {
      return -1; // No data or timestamp is before the first element
    }
    // If timestamp is greater than or equal to the last element, return the last index
    if (timestamp >= this.timestamps[this.size - 1]) {
      return this.size - 1;
    }

    let low = 0;
    let high = this.size - 1;
    let result = -1; // Initialize result to -1 (not found)

    while (low <= high) {
      const mid = Math.floor(low + (high - low) / 2); // Avoid potential overflow
      if (this.timestamps[mid] <= timestamp) {
        result = mid; // Found a potential candidate
        low = mid + 1; // Try to find a later index in the right half
      } else {
        high = mid - 1; // Target is in the left half
      }
    }
    return result; // Returns the last index found, or -1 if none <= timestamp (should be covered by initial checks)
  }

  /**
   * Expands the capacity of the internal TypedArrays.
   * @param {number} newCapacity - The desired new capacity.
   * @private
   */
  _expandCapacity(newCapacity) {
    const oldCapacity = this.capacity;
    // Ensure new capacity is actually larger and sufficient
    if (newCapacity <= oldCapacity) {
      newCapacity = Math.max(oldCapacity * 2, this.size + 100); // Default expansion factor
    }
    this.capacity = newCapacity;

    // Create new arrays with the new capacity
    const newTimestamps = new Float64Array(newCapacity);
    const newOpens = new Float32Array(newCapacity);
    const newHighs = new Float32Array(newCapacity);
    const newLows = new Float32Array(newCapacity);
    const newCloses = new Float32Array(newCapacity);
    const newVolumes = new Float32Array(newCapacity);

    // Copy data from old arrays to new arrays
    if (this.size > 0) {
      newTimestamps.set(this.timestamps.subarray(0, this.size));
      newOpens.set(this.opens.subarray(0, this.size));
      newHighs.set(this.highs.subarray(0, this.size));
      newLows.set(this.lows.subarray(0, this.size));
      newCloses.set(this.closes.subarray(0, this.size));
      newVolumes.set(this.volumes.subarray(0, this.size));
    }

    // Replace old arrays with new ones
    this.timestamps = newTimestamps;
    this.opens = newOpens;
    this.highs = newHighs;
    this.lows = newLows;
    this.closes = newCloses;
    this.volumes = newVolumes;
  }

  /**
   * Gets statistics about the data manager.
   * @returns {object} An object containing size, capacity, and memory usage details.
   */
  getStats() {
    return {
      size: this.size,
      capacity: this.capacity,
      memoryUsage: this._calculateMemoryUsage(), // Calculate current memory usage
    };
  }

  /**
   * Calculates the total memory usage of the managed TypedArrays in bytes.
   * @returns {{total: number, timestamps: number, priceData: number, volumes: number}} Memory usage details.
   * @private
   */
  _calculateMemoryUsage() {
    const timestampBytes = this.timestamps.byteLength;
    const priceBytes = this.opens.byteLength * 4; // o, h, l, c
    const volumeBytes = this.volumes.byteLength;
    const totalBytes = timestampBytes + priceBytes + volumeBytes;

    return {
      total: totalBytes,
      timestamps: timestampBytes,
      priceData: priceBytes, // Combined size for OHLC
      volumes: volumeBytes,
    };
  }

  /**
   * Applies transparency to a color string. Caches results.
   * @param {string} color - The color string (rgb, rgba, hex).
   * @param {number} alpha - The alpha value (0 to 1).
   * @returns {string} The color string with transparency applied.
   * @private
   */
  _applyTransparency(color, alpha) {
    if (typeof color !== "string" || color === "transparent")
      return "transparent";
    alpha = Math.max(0, Math.min(1, alpha)); // Clamp alpha between 0 and 1

    const cacheKey = `${color}_${alpha}`;
    if (this._colorCache[cacheKey]) {
      return this._colorCache[cacheKey];
    }

    let result = color; // Default to original color if parsing fails
    try {
      if (color.startsWith("rgba")) {
        result = color.replace(/,\s*[\d\.]+\)$/, `, ${alpha})`);
      } else if (color.startsWith("rgb")) {
        result = color.replace("rgb", "rgba").replace(")", `, ${alpha})`);
      } else if (color.startsWith("#")) {
        let r = 0,
          g = 0,
          b = 0;
        if (color.length === 4) {
          // #RGB format
          r = parseInt(color[1] + color[1], 16);
          g = parseInt(color[2] + color[2], 16);
          b = parseInt(color[3] + color[3], 16);
        } else if (color.length === 7) {
          // #RRGGBB format
          r = parseInt(color.slice(1, 3), 16);
          g = parseInt(color.slice(3, 5), 16);
          b = parseInt(color.slice(5, 7), 16);
        }
        if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
          result = `rgba(${r}, ${g}, ${b}, ${alpha})`;
        }
      }
      // Add support for color names if needed (would require a lookup table or canvas context)
    } catch (e) {
      result = color; // Fallback to original color on error
    }

    this._colorCache[cacheKey] = result;
    return result;
  }
}
