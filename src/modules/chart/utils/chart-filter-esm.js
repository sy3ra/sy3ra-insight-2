/**
 * Chart.js Filter Plugin - ES Module Version
 * https://github.com/Pecacheu/chartjs-filter-plugin
 * 데이터 필터링을 통해 Chart.js 성능을 최적화합니다.
 */

// Chart.js 플러그인 정의
const FilterPlugin = {
  id: "filter",

  beforeInit(chart, options) {
    const filterOptions = chart.options.plugins.filter;
    if (!filterOptions || !filterOptions.enabled) return;

    // 플러그인 데이터 초기화
    chart._filterData = {
      lastMin: null,
      lastMax: null,
      lastUpdateRange: 0,
      currentRange: 0,
      needUpdate: false,
    };
  },

  beforeUpdate(chart) {
    console.log("asdf");
    const filterOptions = chart.options.plugins.filter;
    if (!filterOptions || !filterOptions.enabled) return;

    const scales = chart.scales;
    if (!scales || !scales.x) return;

    const xScale = scales.x;
    const min = xScale.min;
    const max = xScale.max;
    const range = max - min;

    // 범위가 유효하지 않으면 건너뜀
    if (range <= 0) return;

    const filterData = chart._filterData;
    const datasets = chart.data.datasets;
    const sameX = filterOptions.sameX;
    const extDiv = filterOptions.extDiv || 4;
    const forceRedraw = filterOptions.forceRedraw || 25;

    // 화면에 표시되는 데이터 범위 계산
    const extRange = range / extDiv;
    const displayMin = min - extRange;
    const displayMax = max + extRange;

    // 마지막 업데이트와 현재 범위를 비교하여 업데이트 필요 여부 결정
    filterData.currentRange = range;
    const lastRange = filterData.lastUpdateRange;

    if (lastRange > 0 && range > 0) {
      const ratio = Math.max(lastRange / range, range / lastRange);
      if (ratio > forceRedraw) {
        filterData.needUpdate = true;
      }
    }

    // 범위가 변경되었거나 강제 업데이트가 필요한 경우에만 필터링 수행
    if (
      filterData.lastMin !== min ||
      filterData.lastMax !== max ||
      filterData.needUpdate
    ) {
      filterData.lastMin = min;
      filterData.lastMax = max;
      filterData.lastUpdateRange = range;
      filterData.needUpdate = false;

      // 모든 데이터셋에 대해 필터링 적용
      if (sameX && datasets.length > 0) {
        // X값이 모두 같은 경우 효율적으로 처리
        const data = datasets[0].data;
        if (!data || !data.length) return;

        // 표시 범위에 있는 인덱스 찾기
        let startIdx = 0,
          endIdx = data.length - 1;

        // 이진 검색으로 시작 인덱스 찾기
        let left = 0,
          right = data.length - 1;
        while (left <= right) {
          const mid = Math.floor((left + right) / 2);
          const x = typeof data[mid] === "object" ? data[mid].x : data[mid];
          if (x < displayMin) {
            left = mid + 1;
          } else {
            startIdx = mid;
            right = mid - 1;
          }
        }

        // 이진 검색으로 끝 인덱스 찾기
        left = startIdx;
        right = data.length - 1;
        while (left <= right) {
          const mid = Math.floor((left + right) / 2);
          const x = typeof data[mid] === "object" ? data[mid].x : data[mid];
          if (x > displayMax) {
            right = mid - 1;
          } else {
            endIdx = mid;
            left = mid + 1;
          }
        }

        // 모든 데이터셋에 동일한 필터링 적용
        for (let i = 0; i < datasets.length; i++) {
          const dataset = datasets[i];
          if (dataset._filterData) {
            dataset._filterData.visible = [startIdx, endIdx];
          } else {
            dataset._filterData = {
              visible: [startIdx, endIdx],
              fullData: dataset.data,
            };
          }
        }
      } else {
        // 각 데이터셋마다 개별적으로 처리
        for (let i = 0; i < datasets.length; i++) {
          const dataset = datasets[i];
          const data = dataset.data;
          if (!data || !data.length) continue;

          // 표시할 데이터 범위 결정
          const visibleData = data.filter((item) => {
            const x = typeof item === "object" ? item.x : item;
            return x >= displayMin && x <= displayMax;
          });

          // 데이터셋에 필터링 정보 저장
          if (dataset._filterData) {
            dataset._filterData.visible = visibleData;
          } else {
            dataset._filterData = {
              visible: visibleData,
              fullData: dataset.data,
            };
          }
        }
      }
    }
  },

  // 차트 그리기 전에 필터링된 데이터 적용
  beforeDraw(chart) {
    const filterOptions = chart.options.plugins.filter;
    if (!filterOptions || !filterOptions.enabled) return;

    const datasets = chart.data.datasets;
    const sameX = filterOptions.sameX;

    for (let i = 0; i < datasets.length; i++) {
      const dataset = datasets[i];
      if (!dataset._filterData) continue;

      // 원본 데이터 임시 저장
      const fullData = dataset._filterData.fullData;

      // sameX 모드에 따라 다르게 처리
      if (sameX) {
        const [startIdx, endIdx] = dataset._filterData.visible;
        // 원본 데이터의 일부만 보이도록 설정
        dataset.data = fullData.slice(startIdx, endIdx + 1);
      } else {
        // 필터링된 데이터로 교체
        dataset.data = dataset._filterData.visible;
      }
    }
  },

  // 차트 그리기 후 원본 데이터 복원
  afterDraw(chart) {
    const filterOptions = chart.options.plugins.filter;
    if (!filterOptions || !filterOptions.enabled) return;

    const datasets = chart.data.datasets;

    for (let i = 0; i < datasets.length; i++) {
      const dataset = datasets[i];
      if (!dataset._filterData) continue;

      // 원본 데이터 복원
      dataset.data = dataset._filterData.fullData;
    }
  },
};

// Chart.js에 플러그인 등록
if (typeof window !== "undefined" && window.Chart) {
  window.Chart.register(FilterPlugin);
}

// ES 모듈 export
export default FilterPlugin;
