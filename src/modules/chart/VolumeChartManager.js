import { chartColors } from "../theme.js";
import { createVolumeChartOptions } from "./ChartOptions.js";

export class VolumeChartManager {
  constructor(volumeChartCtx, dataManager) {
    this.volumeChartCtx = volumeChartCtx;
    this.dataManager = dataManager;
    this.volumeChart = null;
    this._colorCache = {};
  }

  // 볼륨 차트 생성
  createVolumeChart(earliestX, latestX, chartInstance) {
    if (!this.volumeChartCtx) {
      console.warn("볼륨 차트 컨텍스트가 제공되지 않았습니다.");
      return null;
    }

    try {
      // 볼륨 차트 데이터 준비
      const volumeData = this.dataManager.getVolumeChartData(
        undefined,
        undefined,
        chartColors.upBody,
        chartColors.downBody,
        0.4
      );

      // 볼륨 차트 옵션 생성
      const volumeChartOptions = createVolumeChartOptions(earliestX, latestX);

      // Chart.js 인스턴스 생성
      const { Chart } = chartInstance;
      this.volumeChart = new Chart(this.volumeChartCtx, {
        type: "bar",
        data: volumeData,
        options: volumeChartOptions,
      });

      console.log("볼륨 차트 인스턴스가 생성되었습니다.");
      return this.volumeChart;
    } catch (err) {
      console.error("볼륨 차트 생성 중 오류:", err);
      return null;
    }
  }

  // 완전히 정밀한 X축 동기화 메서드 - 줌 레벨에 따른 바 너비 유지 추가
  exactSyncWithMainChart(mainChart) {
    if (!this.volumeChart || !mainChart) return;

    // 메인 차트에서 정확한 값만 가져와 직접 할당
    const mainXScale = mainChart.scales.x;
    const volumeXScale = this.volumeChart.scales.x;

    // 스케일 옵션 완전 동기화
    this.volumeChart.options.scales.x.min = mainXScale.min;
    this.volumeChart.options.scales.x.max = mainXScale.max;
    this.volumeChart.options.scales.x.offset =
      mainChart.options.scales.x.offset;
    this.volumeChart.options.scales.x.alignToPixels =
      mainChart.options.scales.x.alignToPixels;

    // 시간 단위 동기화
    if (
      mainChart.options.scales.x.time &&
      this.volumeChart.options.scales.x.time
    ) {
      this.volumeChart.options.scales.x.time.unit =
        mainChart.options.scales.x.time.unit;
      this.volumeChart.options.scales.x.time.stepSize =
        mainChart.options.scales.x.time.stepSize;
    }

    // 바 관련 옵션 동기화 - 줌 레벨에 따른 최적화 추가
    if (!this.volumeChart.options.elements)
      this.volumeChart.options.elements = {};
    if (!this.volumeChart.options.elements.bar)
      this.volumeChart.options.elements.bar = {};

    // 메인 차트의 캔들스틱 설정 가져오기
    if (mainChart.options.elements?.candlestick) {
      this.volumeChart.options.elements.bar.barPercentage =
        mainChart.options.elements.candlestick.barPercentage;
    } else {
      // 기본값 설정
      this.volumeChart.options.elements.bar.barPercentage = 0.9;
    }

    // 줌 레벨에 따른 바 너비 조정
    const xRange = mainXScale.max - mainXScale.min;
    const visibleDays = xRange / (24 * 60 * 60 * 1000); // 밀리초 단위를 일 단위로 변환

    // 볼륨 바 최소 너비 설정 (픽셀)
    if (!this.volumeChart.options.elements.bar.minBarLength) {
      this.volumeChart.options.elements.bar.minBarLength = 2;
    }

    // 줌 레벨에 따른 동적 바 퍼센티지 조정
    if (visibleDays < 30) {
      // 1달 이하로 줌인 했을 때
      // 좁은 범위에서는 더 넓은 바 사용
      this.volumeChart.options.elements.bar.barPercentage = 0.95;
      this.volumeChart.options.elements.bar.categoryPercentage = 1.0;
    } else {
      // 넓은 범위에서는 기본 설정 사용
      this.volumeChart.options.elements.bar.barPercentage = 0.9;
      this.volumeChart.options.elements.bar.categoryPercentage = 1.0;
    }

    // 그리드 옵션 동기화
    if (
      mainChart.options.scales.x.grid &&
      this.volumeChart.options.scales.x.grid
    ) {
      this.volumeChart.options.scales.x.grid.tickLength =
        mainChart.options.scales.x.grid.tickLength;
      this.volumeChart.options.scales.x.grid.offset =
        mainChart.options.scales.x.grid.offset;
    }

    // 틱 옵션 동기화
    if (
      mainChart.options.scales.x.ticks &&
      this.volumeChart.options.scales.x.ticks
    ) {
      this.volumeChart.options.scales.x.ticks.autoSkip =
        mainChart.options.scales.x.ticks.autoSkip;
      this.volumeChart.options.scales.x.ticks.maxRotation =
        mainChart.options.scales.x.ticks.maxRotation;
      this.volumeChart.options.scales.x.ticks.minRotation =
        mainChart.options.scales.x.ticks.minRotation;
      this.volumeChart.options.scales.x.ticks.align =
        mainChart.options.scales.x.ticks.align;
      this.volumeChart.options.scales.x.ticks.source =
        mainChart.options.scales.x.ticks.source;
    }

    // 중요: 스케일 위치 정보 직접 동기화 (픽셀 단위 정렬)
    try {
      // 스케일 위치 속성 모두 복사
      volumeXScale.left = mainXScale.left;
      volumeXScale.right = mainXScale.right;
      volumeXScale.top = volumeXScale.top; // 이 값은 변경하지 않음
      volumeXScale.bottom = volumeXScale.bottom; // 이 값은 변경하지 않음
      volumeXScale.width = mainXScale.width;

      // 내부 상태도 동기화 (필요한 경우)
      volumeXScale.paddingLeft = mainXScale.paddingLeft;
      volumeXScale.paddingRight = mainXScale.paddingRight;
      volumeXScale.paddingTop = mainXScale.paddingTop;
      volumeXScale.paddingBottom = mainXScale.paddingBottom;

      // 내부 계산값도 동기화
      volumeXScale._startPixel = mainXScale._startPixel;
      volumeXScale._endPixel = mainXScale._endPixel;
      volumeXScale._length = mainXScale._length;
    } catch (e) {
      console.warn("스케일 위치 동기화 중 오류:", e);
    }
  }

  // Y축 범위 조정 (볼륨 데이터에 맞게)
  adjustYAxisRange(xMin, xMax) {
    if (!this.volumeChart) return;

    try {
      // 가시 영역 데이터 인덱스 찾기
      const visibleRegion = this.dataManager.getVisibleData(xMin, xMax);

      // 가시 영역의 최대 볼륨 찾기
      let maxVolume = 0;
      const volumes = this.dataManager.volumes;

      for (let i = visibleRegion.startIdx; i < visibleRegion.endIdx; i++) {
        const volume = volumes[i];
        if (volume > maxVolume) {
          maxVolume = volume;
        }
      }

      // 최대 바 높이 및 패딩 계산
      const maxBarHeight = 100;
      const padding = maxBarHeight * 0.1;

      // 스케일링 계수 적용
      const scalingFactor = maxVolume > 0 ? maxBarHeight / maxVolume : 1;
      const suggestedMax = maxVolume * scalingFactor + padding;

      // Y축 범위 설정
      this.volumeChart.options.scales.y.suggestedMax = suggestedMax;
      this.volumeChart.options.scales.y.min = 0;
    } catch (error) {
      console.warn("볼륨 차트 Y축 범위 조정 중 오류:", error);
      // 오류 발생 시 기본값 설정
      this.volumeChart.options.scales.y.suggestedMax = 110;
    }
  }

  // 볼륨 차트 업데이트
  updateChart(shouldAnimate = false) {
    if (!this.volumeChart) return;

    const animationMode = shouldAnimate ? undefined : "none";
    this.volumeChart.update(animationMode);
  }

  // 리소스 해제
  dispose() {
    if (this.volumeChart) {
      this.volumeChart.destroy();
      this.volumeChart = null;
    }
  }
}
