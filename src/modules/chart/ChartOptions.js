import { chartColors } from "../theme.js";

// 캔들 차트 옵션 생성
export function createCandleChartOptions(earliestX, latestX) {
  return {
    maintainAspectRatio: false,
    animation: false,
    responsive: false,
    layout: {
      padding: {
        right: 8,
      },
    },
    elements: {
      candlestick: {
        colors: {
          up: chartColors.upBorder,
          down: chartColors.downBorder,
          unchanged: chartColors.upBorder,
        },
        borderColors: {
          up: chartColors.upBorder,
          down: chartColors.downBorder,
          unchanged: chartColors.upBorder,
        },
        backgroundColors: {
          up: chartColors.upBody,
          down: chartColors.downBody,
          unchanged: chartColors.upBody,
        },
        borderWidth: 0,
        barPercentage: 0.9,
      },
    },
    scales: {
      x: {
        type: "time",
        time: {
          tooltipFormat: "MM/dd",
          displayFormats: {
            millisecond: "HH:mm:ss.SSS",
            second: "HH:mm:ss",
            minute: "HH:mm",
            hour: "MM/dd",
            day: "MM/dd",
            week: "MM/dd",
            month: "MM/dd",
            quarter: "MM/dd",
            year: "MM/dd",
          },
        },
        ticks: {
          color: "#d4d4d4",
          autoSkip: false,
          source: "auto",
          font: {
            family: "'Helvetica Neue', 'Helvetica', 'Arial', sans-serif",
            size: 12,
          },
        },
        grid: {
          color: "rgba(255, 255, 255, 0.1)",
          display: true,
          drawOnChartArea: true,
          drawTicks: false,
        },
        min: earliestX,
        max: latestX,
        offset: true,
        alignToPixels: true,
      },
      y: {
        position: "right",
        beginAtZero: false,
        ticks: {
          color: "#d4d4d4",
          callback: function (value) {
            return value.toLocaleString("ko-KR", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            });
          },
          padding: 8,
          maxTicksLimit: 8,
          font: {
            family: "'Helvetica Neue', 'Helvetica', 'Arial', sans-serif",
            size: 12,
          },
        },
        grid: {
          color: "rgba(255, 255, 255, 0.1)",
          display: true,
          drawOnChartArea: true,
        },
        afterFit: function (scaleInstance) {
          scaleInstance.width = 90;
        },
      },
    },
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        enabled: false,
      },
      title: {
        display: false,
      },
    },
  };
}

// 볼륨 차트 옵션 생성
export function createVolumeChartOptions(earliestX, latestX) {
  return {
    maintainAspectRatio: false,
    animation: { duration: 0 },
    responsive: false,
    layout: {
      padding: {
        top: 10,
        right: 8,
      },
    },
    elements: {
      bar: {
        barPercentage: 0.9,
        categoryPercentage: 1.0,
        borderWidth: 0,
        minBarLength: 2,
      },
    },
    datasets: {
      bar: {
        barThickness: "flex",
        maxBarThickness: 50,
        minBarLength: 2,
      },
    },
    scales: {
      x: {
        type: "time",
        time: {
          displayFormats: {
            millisecond: "HH:mm:ss.SSS",
            second: "HH:mm:ss",
            minute: "HH:mm",
            hour: "MM/dd",
            day: "MM/dd",
            week: "MM/dd",
            month: "MM/dd",
            quarter: "MM/dd",
            year: "MM/dd",
          },
          unit: "day",
        },
        display: false,
        min: earliestX,
        max: latestX,
        grid: {
          display: false,
          drawBorder: false,
          drawOnChartArea: false,
        },
        offset: true,
        alignToPixels: true,
        afterFit: function (scaleInstance) {
          scaleInstance.height = 30;
        },
        border: {
          display: false,
        },
      },
      y: {
        position: "right",
        display: false,
        beginAtZero: true,
        min: 0,
        suggestedMax: 5,
        grid: {
          display: false,
        },
        afterFit: function (scaleInstance) {
          scaleInstance.width = 90;
        },
      },
    },
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        enabled: false,
      },
      title: {
        display: false,
      },
    },
  };
}

// 캔들차트와 볼륨차트가 통합된 차트 옵션 생성
export function createCombinedChartOptions(earliestX, latestX) {
  // 기본 캔들차트 옵션 확장
  const options = createCandleChartOptions(earliestX, latestX);

  // 차트 레이아웃 설정 수정
  options.layout = {
    padding: {
      top: 20,
      right: 20,
      bottom: 20,
      left: 10,
    },
  };

  // 볼륨 차트를 위한 Y축 추가
  options.scales.volume = {
    type: "linear",
    position: "right",
    display: false,
    beginAtZero: true,
    min: 0,
    grid: {
      display: false,
    },
    // 볼륨 차트의 높이를 전체 차트의 20%로 제한
    weight: 20,
  };

  // 캔들차트의 Y축 설정 조정
  options.scales.y.weight = 80; // 캔들 차트의 높이를 전체 차트의 80%로 설정

  // 엘리먼트 설정 추가
  options.elements.bar = {
    barPercentage: 0.9,
    categoryPercentage: 1.0,
    borderWidth: 0,
    minBarLength: 2,
  };

  // 데이터셋 기본 설정 추가
  options.datasets = {
    bar: {
      barThickness: "flex",
      maxBarThickness: 50,
      minBarLength: 2,
      backgroundColor: function (context) {
        // 기본값 설정
        if (!context || !context.dataIndex) return chartColors.upBody;

        // 동적 색상 로직 (아래는 예시로 실제 로직은 실행 시 제공됨)
        // 상승/하락 색상을 위한 기본 로직
        return chartColors.upBody; // 기본 색상
      },
      order: 0, // 먼저 렌더링 (아래에 그려짐)
      yAxisID: "volume",
    },
    candlestick: {
      order: 1, // 나중에 렌더링 (위에 그려짐)
      yAxisID: "y",
    },
  };

  return options;
}
