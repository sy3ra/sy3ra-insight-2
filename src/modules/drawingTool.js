export class DrawingTool {
  constructor(container, chartCanvas, drawingCanvas, overlayCanvas) {
    this.container = container;
    this.chartCtx = chartCanvas;
    this.drawingCtx = drawingCanvas;
    this.overlayCtx = overlayCanvas;
    this.mouseMoveHandler = null;
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
        this[`draw${tool.name}`]();
      });

      toolPanel.appendChild(button);
    });
  }

  onMouseMove(x, y) {
    console.log("현재 마우스 위치 (라인 그리기):", x, y);
  }

  drawLine() {
    if (this.mouseMoveHandler) {
      this.finishLineDraw();
      return;
    }

    console.log("drawLine 호출됨. 마우스 좌표 구독 시작");
    console.log(window);
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
  }

  drawExtendedLine() {
    console.log("drawExtendedLine");
  }

  drawRay() {
    console.log("drawRay");
  }

  drawHorizontalLine() {
    console.log("drawHorizontalLine");
  }

  drawVerticalLine() {
    console.log("drawVerticalLine");
  }

  getPixelForValue(x, y) {
    const chart = this.chartCtx;
    const xPixel = chart.scales.x.getPixelForValue(x);
    const yPixel = chart.scales.y.getPixelForValue(y);
    return { x: xPixel, y: yPixel };
  }

  finishLineDraw() {
    if (
      window.mainCanvas &&
      typeof window.mainCanvas.removeMouseMoveListener === "function" &&
      this.mouseMoveHandler
    ) {
      window.mainCanvas.removeMouseMoveListener(this.mouseMoveHandler);
      console.log("마우스 좌표 구독이 취소되었습니다.");
      this.mouseMoveHandler = null;
    }
  }
}
