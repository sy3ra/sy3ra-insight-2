import { ChartTest } from "./modules/chartTest.js";
import { DrawingTool } from "./modules/drawingTool.js";
import { EventManager, EventTypes } from "./utilities/eventManager.js";

class MainCanvas {
  constructor(parent) {
    this.parent = parent;
    this.overlaysArray = [];

    // 캔버스 초기화
    this.initializeCanvases();

    // 이벤트 매니저 초기화
    this.eventManager = new EventManager(this.chartCanvas, null);

    // 차트 및 드로잉 도구 초기화
    this.initializeComponents();

    // 스테이지 크기 설정
    this.resize();

    // 리사이즈 이벤트 리스너 등록
    this.eventManager.addEventListener(
      EventTypes.RESIZE,
      this.resize.bind(this)
    );
  }

  // 캔버스 생성 및 초기화
  initializeCanvases() {
    // 차트 캔버스
    this.chartCanvas = this.createCanvas("chartCanvas");
    this.chartCtx = this.chartCanvas.getContext("2d");

    // 크로스헤어 캔버스
    this.crosshairCanvas = this.createCanvas("crosshairCanvas");
    this.crosshairCtx = this.crosshairCanvas.getContext("2d");

    // 오버레이 캔버스
    this.overlayCanvas = this.createCanvas("overlayCanvas");
    this.overlayCtx = this.overlayCanvas.getContext("2d");

    // 그리기 캔버스
    this.drawingCanvas = this.createCanvas("drawingCanvas");
    this.drawingCtx = this.drawingCanvas.getContext("2d");
  }

  // 캔버스 요소 생성 유틸리티
  createCanvas(id) {
    const canvas = document.createElement("canvas");
    canvas.id = id;
    this.parent.appendChild(canvas);
    return canvas;
  }

  // 컴포넌트 초기화
  initializeComponents() {
    // 차트 인스턴스 생성
    this.chartTestInstance = new ChartTest(
      this.chartCtx,
      this.crosshairCtx,
      this.overlayCtx
    );

    // 드로잉 인스턴스 생성
    const toolPanelContainer = document.querySelector("#toolPanel");
    this.drawingInstance = new DrawingTool(
      toolPanelContainer,
      this.chartTestInstance,
      this.drawingCanvas,
      this.overlayCanvas
    );

    // EventManager에 차트 인스턴스 설정 - 드로잉 인스턴스 생성 후에 설정
    this.eventManager.chartInstance = this.chartTestInstance;

    this.drawingInstance.createToolPanel();
  }

  // 캔버스 크기 조정
  resize() {
    this.stageWidth = this.parent.clientWidth;
    this.stageHeight = this.parent.clientHeight;

    // 모든 캔버스의 크기 설정
    [
      this.chartCanvas,
      this.crosshairCanvas,
      this.overlayCanvas,
      this.drawingCanvas,
    ].forEach((canvas) => {
      canvas.width = this.stageWidth * 2;
      canvas.height = this.stageHeight * 2;
    });

    // 모든 컨텍스트의 스케일 설정
    [
      this.chartCtx,
      this.crosshairCtx,
      this.overlayCtx,
      this.drawingCtx,
    ].forEach((ctx) => {
      ctx.scale(2, 2);
    });

    // 차트 재렌더링
    if (this.chartTestInstance?.render) {
      this.chartTestInstance.render();
    }
  }

  // 이벤트 리스너 관리 메서드 - 간소화
  addMouseMoveListener(listener) {
    this.eventManager.addEventListener(EventTypes.MOUSE_MOVE, listener);
  }

  removeMouseMoveListener(listener) {
    this.eventManager.removeEventListener(EventTypes.MOUSE_MOVE, listener);
  }

  addMouseClickListener(listener) {
    this.eventManager.addEventListener(EventTypes.MOUSE_CLICK, listener);
  }

  removeMouseClickListener(listener) {
    this.eventManager.removeEventListener(EventTypes.MOUSE_CLICK, listener);
  }

  // 오버레이 관리 메서드
  storeOverlay(startX, startY, endX, endY) {
    this.overlaysArray.push({
      index: this.overlaysArray.length,
      startX,
      startY,
      endX,
      endY,
    });
  }

  getOverlaysArray() {
    return this.overlaysArray;
  }

  // 이벤트 리스너 관리 메서드에 추가
  addEventListener(type, listener) {
    this.eventManager.addEventListener(type, listener);
  }

  removeEventListener(type, listener) {
    this.eventManager.removeEventListener(type, listener);
  }
}

// 페이지 로드 시 메인 캔버스 초기화
window.onload = () => {
  const mainCanvasParent = document.querySelector("#mainCanvas");
  window.mainCanvas = new MainCanvas(mainCanvasParent);
};
