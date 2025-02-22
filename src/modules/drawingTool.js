export class DrawingTool {
  constructor(container, chartCanvas, drawingCanvas, overlayCanvas) {
    this.container = container;
    this.chartCtx = chartCanvas;
    this.drawingCanvas = drawingCanvas;
    this.drawingCtx = drawingCanvas.getContext("2d");
    this.overlayCanvas = overlayCanvas;
    this.overlayCtx = overlayCanvas.getContext("2d");
    this.mouseMoveHandler = null;
    this.clickHandler = null;
    this.xPixel = null;
    this.yPixel = null;
    this.clickCount = 0; // 클릭 횟수를 기록하기 위한 변수
    this.startX = null;
    this.startY = null;
    this.endX = null;
    this.endY = null;
  }

  createToolPanel() {
    const toolPanel = this.container;
    toolPanel.classList.add("tool-panel");

    const tools = [
      { name: "Line", icon: "public/icons/line.svg" },
      { name: "ExtendedLine", icon: "public/icons/extended line.svg" },
      { name: "Ray", icon: "public/icons/ray.svg" },
      { name: "HorizontalLine", icon: "public/icons/horizontal line.svg" },
      { name: "VerticalLine", icon: "public/icons/vertical line.svg" },
    ];

    tools.forEach((tool) => {
      const button = document.createElement("button");
      const img = document.createElement("img");
      img.src = tool.icon;
      img.alt = tool.name;

      button.appendChild(img);
      button.addEventListener("click", () => {
        this[`clickDraw${tool.name}`]();
      });

      toolPanel.appendChild(button);
    });
  }

  addMouseMoveHandler() {
    console.log("마우스 좌표 및 클릭 이벤트 구독 시작");

    // 마우스 이동 이벤트 구독
    this.mouseMoveHandler = this.onMouseMove.bind(this);
    if (
      window.mainCanvas &&
      typeof window.mainCanvas.addMouseMoveListener === "function"
    ) {
      window.mainCanvas.addMouseMoveListener(this.mouseMoveHandler);
    } else {
      console.error(
        "MainCanvas 인스턴스를 찾을 수 없어 mouseMove 구독에 실패했습니다."
      );
    }

    // 마우스 클릭 이벤트도 함께 구독
    this.clickHandler = this.onMouseClick.bind(this);
    if (
      window.mainCanvas &&
      typeof window.mainCanvas.addMouseClickListener === "function"
    ) {
      window.mainCanvas.addMouseClickListener(this.clickHandler);
    } else {
      console.error(
        "MainCanvas 인스턴스를 찾을 수 없어 mouseClick 구독에 실패했습니다."
      );
    }
  }

  onMouseMove(x, y) {
    const { x: xPixel, y: yPixel } = this.getValueForPixel(x, y);
    this.xPixel = xPixel;
    this.yPixel = yPixel;
    // 필요한 추가 작업 수행 (예: 실시간 그리기 미리보기)
    if (this.clickCount === 1) {
      this.finishDrawLine();
    }
  }

  onMouseClick(x, y) {
    // 첫 번째 클릭이면
    if (this.clickCount === 0) {
      console.log("첫번째 클릭");
      this.clickCount++;
      this.startDrawLine();
    }
    // 두 번째 클릭이면 리스너를 해제하며 종료 처리
    else if (this.clickCount === 1) {
      console.log("두번째 클릭, finish");
      this.clickCount++;
      this.finishDrawLine();
    }
  }

  // drawLine 버튼이 클릭되면 클릭 횟수를 초기화하고 리스너를 등록
  clickDrawLine() {
    this.clickCount = 0;
    this.addMouseMoveHandler();
  }
  startDrawLine() {
    console.log("startDrawLine", this.xPixel, this.yPixel);
    const { x: startX, y: startY } = this.getPixelForValue(
      this.xPixel,
      this.yPixel
    );
    this.startX = startX;
    this.startY = startY;
  }
  finishDrawLine() {
    console.log("finishDrawLine", this.xPixel, this.yPixel);
    const { x: endX, y: endY } = this.getPixelForValue(
      this.xPixel,
      this.yPixel
    );
    this.endX = endX;
    this.endY = endY;
    this.drawingCtx.clearRect(
      0,
      0,
      this.drawingCanvas.width,
      this.drawingCanvas.height
    );
    this.drawingCtx.beginPath();
    this.drawingCtx.moveTo(this.startX, this.startY);
    this.drawingCtx.lineTo(this.endX, this.endY);
    this.drawingCtx.lineWidth = 1;
    this.drawingCtx.strokeStyle = "white";
    this.drawingCtx.stroke();
    if (this.clickCount === 2) {
      this.finishDraw();
    }
  }

  clickDrawExtendedLine() {
    console.log("drawExtendedLine");
  }

  clickDrawRay() {
    console.log("drawRay");
  }

  clickDrawHorizontalLine() {
    console.log("drawHorizontalLine");
  }

  clickDrawVerticalLine() {
    console.log("drawVerticalLine");
  }

  getValueForPixel(x, y) {
    const chart = this.chartCtx.chart;
    const xScale = chart.scales.x;
    const yScale = chart.scales.y;
    const dataX = xScale.getValueForPixel(x);
    const dataY = yScale.getValueForPixel(y);
    return { x: dataX, y: dataY };
  }
  getPixelForValue(x, y) {
    const chart = this.chartCtx.chart;
    const xScale = chart.scales.x;
    const yScale = chart.scales.y;
    const pixelX = xScale.getPixelForValue(x);
    const pixelY = yScale.getPixelForValue(y);
    return { x: pixelX, y: pixelY };
  }

  finishDraw() {
    if (
      window.mainCanvas &&
      typeof window.mainCanvas.removeMouseMoveListener === "function" &&
      this.mouseMoveHandler
    ) {
      window.mainCanvas.removeMouseMoveListener(this.mouseMoveHandler);
      console.log("마우스 좌표 구독이 취소되었습니다.");
      this.mouseMoveHandler = null;
    }
    if (
      window.mainCanvas &&
      typeof window.mainCanvas.removeMouseClickListener === "function" &&
      this.clickHandler
    ) {
      window.mainCanvas.removeMouseClickListener(this.clickHandler);
      console.log("마우스 클릭 구독이 취소되었습니다.");
      this.clickHandler = null;
    }
  }
}
