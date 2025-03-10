// TypedArray 활용 데이터 관리 클래스
export class TypedDataManager {
  constructor(initialCapacity = 1000) {
    // 캔들스틱 데이터용 TypedArray 생성
    this.timestamps = new Float64Array(initialCapacity);
    this.opens = new Float32Array(initialCapacity);
    this.highs = new Float32Array(initialCapacity);
    this.lows = new Float32Array(initialCapacity);
    this.closes = new Float32Array(initialCapacity);
    this.volumes = new Float32Array(initialCapacity);

    // 좌표 변환용 캐시 배열
    this.xPixelCache = new Float32Array(initialCapacity);
    this.yPixelCache = new Float32Array(initialCapacity);

    // 인덱스 및 상태 관리
    this.size = 0;
    this.capacity = initialCapacity;
    this.modifiedFlag = false;
  }

  // Chart.js 호환 데이터 형식으로 변환 (필요한 범위만)
  getChartJsData(startIdx, endIdx) {
    if (this.size === 0) {
      return { labels: [], datasets: [{ label: "BTC/USDT Chart", data: [] }] };
    }

    if (startIdx === undefined) startIdx = 0;
    if (endIdx === undefined) endIdx = this.size;

    const count = endIdx - startIdx;
    const labels = new Array(count);
    const data = new Array(count);

    for (let i = startIdx, j = 0; i < endIdx; i++, j++) {
      labels[j] = this.timestamps[i];
      data[j] = {
        x: this.timestamps[i],
        o: this.opens[i],
        h: this.highs[i],
        l: this.lows[i],
        c: this.closes[i],
        v: this.volumes[i],
      };
    }

    return {
      labels,
      datasets: [
        {
          label: "BTC/USDT Chart",
          data: data,
        },
      ],
    };
  }

  // 가시 영역 데이터 계산 (뷰포트에 보이는 데이터만)
  getVisibleData(minTimestamp, maxTimestamp) {
    if (this.size === 0) {
      return { startIdx: 0, endIdx: 0, count: 0 };
    }

    // 이진 검색으로 시작/종료 인덱스 찾기
    const startIdx = this._binarySearchIndex(minTimestamp);
    const endIdx = this._binarySearchIndex(maxTimestamp, true);

    return {
      startIdx,
      endIdx,
      count: endIdx - startIdx,
    };
  }

  // 이진 검색으로 타임스탬프에 해당하는 인덱스 찾기
  _binarySearchIndex(timestamp, findUpper = false) {
    if (this.size === 0) return 0;

    let low = 0;
    let high = this.size - 1;

    // 경계 검사
    if (timestamp <= this.timestamps[0]) return 0;
    if (timestamp >= this.timestamps[high]) return this.size;

    // 이진 검색
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const midValue = this.timestamps[mid];

      if (midValue === timestamp) {
        return findUpper ? mid + 1 : mid;
      } else if (midValue < timestamp) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    return findUpper ? low : high;
  }

  addCandlesFromArray(candleArray) {
    if (
      !candleArray ||
      !Array.isArray(candleArray) ||
      candleArray.length === 0
    ) {
      return;
    }

    const count = candleArray.length;

    // 필요시 용량 확장
    if (this.size + count > this.capacity) {
      this._expandCapacity(Math.max(this.capacity * 2, this.size + count));
    }

    // 데이터 일괄 추가
    for (let i = 0; i < count; i++) {
      const candle = candleArray[i];
      if (!candle) continue;

      const index = this.size + i;

      this.timestamps[index] = candle.x;
      this.opens[index] = candle.o;
      this.highs[index] = candle.h;
      this.lows[index] = candle.l;
      this.closes[index] = candle.c;
      this.volumes[index] = candle.v || 0;

      this.xPixelCache[index] = -1;
      this.yPixelCache[index] = -1;
    }

    this.size += count;
    this.modifiedFlag = true;
  }

  _expandCapacity(newCapacity) {
    const oldCapacity = this.capacity;
    this.capacity = newCapacity;

    // 각 배열 확장
    const newTimestamps = new Float64Array(newCapacity);
    const newOpens = new Float32Array(newCapacity);
    const newHighs = new Float32Array(newCapacity);
    const newLows = new Float32Array(newCapacity);
    const newCloses = new Float32Array(newCapacity);
    const newVolumes = new Float32Array(newCapacity);
    const newXPixelCache = new Float32Array(newCapacity);
    const newYPixelCache = new Float32Array(newCapacity);

    // 기존 데이터 복사
    newTimestamps.set(this.timestamps.subarray(0, this.size));
    newOpens.set(this.opens.subarray(0, this.size));
    newHighs.set(this.highs.subarray(0, this.size));
    newLows.set(this.lows.subarray(0, this.size));
    newCloses.set(this.closes.subarray(0, this.size));
    newVolumes.set(this.volumes.subarray(0, this.size));

    // 기존 배열 대체
    this.timestamps = newTimestamps;
    this.opens = newOpens;
    this.highs = newHighs;
    this.lows = newLows;
    this.closes = newCloses;
    this.volumes = newVolumes;
    this.xPixelCache = newXPixelCache;
    this.yPixelCache = newYPixelCache;

    console.log(`배열 용량 확장: ${oldCapacity} → ${newCapacity}`);
  }

  getStats() {
    return {
      size: this.size,
      capacity: this.capacity,
      memoryUsage: {
        total: this._calculateMemoryUsage(),
        timestamps: this.timestamps.byteLength,
        priceData: this.opens.byteLength * 4, // opens, highs, lows, closes
        volumes: this.volumes.byteLength,
        cache: this.xPixelCache.byteLength * 2, // xPixelCache, yPixelCache
      },
    };
  }

  _calculateMemoryUsage() {
    return (
      this.timestamps.byteLength +
      this.opens.byteLength +
      this.highs.byteLength +
      this.lows.byteLength +
      this.closes.byteLength +
      this.volumes.byteLength +
      this.xPixelCache.byteLength +
      this.yPixelCache.byteLength
    );
  }

  // 볼륨 차트 데이터 포맷팅 함수
  getVolumeChartData(startIdx, endIdx, upColor, downColor, alpha = 0.4) {
    if (this.size === 0) {
      return { labels: [], datasets: [{ data: [] }] };
    }

    if (startIdx === undefined) startIdx = 0;
    if (endIdx === undefined) endIdx = this.size;

    const count = endIdx - startIdx;
    const labels = new Array(count);
    const data = new Array(count);
    const backgroundColor = new Array(count);

    // 최대 볼륨 찾기
    let maxVolume = 0;
    for (let i = startIdx; i < endIdx; i++) {
      const volume = this.volumes[i];
      if (volume > maxVolume) maxVolume = volume;
    }

    // 스케일링 계수 계산
    const scalingFactor = maxVolume > 0 ? 100 / maxVolume : 1;

    for (let i = startIdx, j = 0; i < endIdx; i++, j++) {
      labels[j] = this.timestamps[i];

      // 스케일링된 볼륨
      const scaledVolume = this.volumes[i] * scalingFactor;
      data[j] = Math.max(scaledVolume, this.volumes[i] > 0 ? 3 : 0);

      // 색상 결정
      const isUp = this.opens[i] <= this.closes[i];
      backgroundColor[j] = this._applyTransparency(
        isUp ? upColor : downColor,
        alpha
      );
    }

    return {
      labels,
      datasets: [
        {
          data,
          backgroundColor,
          borderColor: backgroundColor,
          borderWidth: 0,
          minBarLength: 3,
        },
      ],
    };
  }

  // 색상에 투명도 적용
  _applyTransparency(color, alpha) {
    if (!this._colorCache) this._colorCache = {};
    const cacheKey = `${color}_${alpha}`;

    if (this._colorCache[cacheKey]) {
      return this._colorCache[cacheKey];
    }

    let result;
    if (color.startsWith("rgba")) {
      result = color.replace(/,\s*[\d\.]+\)$/, `, ${alpha})`);
    } else if (color.startsWith("rgb")) {
      const rgbValues = color.substring(4, color.length - 1);
      result = `rgba(${rgbValues}, ${alpha})`;
    } else if (color.startsWith("#")) {
      const hexMatch = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(color);
      if (hexMatch) {
        const r = parseInt(hexMatch[1], 16);
        const g = parseInt(hexMatch[2], 16);
        const b = parseInt(hexMatch[3], 16);
        result = `rgba(${r}, ${g}, ${b}, ${alpha})`;
      } else {
        result = color;
      }
    } else {
      result = color;
    }

    this._colorCache[cacheKey] = result;
    return result;
  }

  // 새 데이터를 앞부분에 추가 (이전 데이터)
  prependCandles(candleArray) {
    if (
      !candleArray ||
      !Array.isArray(candleArray) ||
      candleArray.length === 0
    ) {
      return;
    }

    const count = candleArray.length;
    const newSize = this.size + count;

    // 필요시 용량 확장
    if (newSize > this.capacity) {
      this._expandCapacity(Math.max(this.capacity * 2, newSize));
    }

    // 기존 데이터를 뒤로 이동
    this._shiftDataRight(count);

    // 새 데이터를 앞부분에 추가
    for (let i = 0; i < count; i++) {
      const candle = candleArray[i];
      this.timestamps[i] = candle.t || candle.x;
      this.opens[i] = candle.o;
      this.highs[i] = candle.h;
      this.lows[i] = candle.l;
      this.closes[i] = candle.c;
      this.volumes[i] = candle.v;
    }

    // 크기 업데이트
    this.size = newSize;
    this.modifiedFlag = true;
  }

  // 기존 데이터를 오른쪽으로 이동
  _shiftDataRight(count) {
    for (let i = this.size - 1; i >= 0; i--) {
      const newIndex = i + count;
      this.timestamps[newIndex] = this.timestamps[i];
      this.opens[newIndex] = this.opens[i];
      this.highs[newIndex] = this.highs[i];
      this.lows[newIndex] = this.lows[i];
      this.closes[newIndex] = this.closes[i];
      this.volumes[newIndex] = this.volumes[i];
    }
  }
}
