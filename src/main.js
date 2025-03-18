import { ChartTest } from "./modules/chartTest.js";
import { DrawingTool } from "./modules/drawingTool.js";
import { EventManager, EventTypes } from "./utilities/eventManager.js";
import { tickerInstance } from "./modules/ticker.js";

class MainCanvas {
  constructor(parent) {
    this.parent = parent;
    this.overlaysArray = [];

    this.initializeCanvases();
    this.initializeEventManager();
    this.initializeComponents();
    this.setupEventListeners();
    this.resize();
  }

  // 캔버스 초기화
  initializeCanvases() {
    // 필요한 모든 캔버스 생성
    this.canvasElements = {
      chart: this.createCanvas("chartCanvas"),
      crosshair: this.createCanvas("crosshairCanvas"),
      overlay: this.createCanvas("overlayCanvas"),
      drawing: this.createCanvas("drawingCanvas"),
    };

    // 컨텍스트 초기화
    this.contexts = {
      chart: this.canvasElements.chart.getContext("2d"),
      crosshair: this.canvasElements.crosshair.getContext("2d"),
      overlay: this.canvasElements.overlay.getContext("2d"),
      drawing: this.canvasElements.drawing.getContext("2d"),
    };

    // 기존 코드와의 호환성을 위해 별도 변수로도 할당
    this.chartCanvas = this.canvasElements.chart;
    this.chartCtx = this.contexts.chart;
    this.crosshairCanvas = this.canvasElements.crosshair;
    this.crosshairCtx = this.contexts.crosshair;
    this.overlayCanvas = this.canvasElements.overlay;
    this.overlayCtx = this.contexts.overlay;
    this.drawingCanvas = this.canvasElements.drawing;
    this.drawingCtx = this.contexts.drawing;
  }

  // 캔버스 요소 생성 유틸리티
  createCanvas(id) {
    const canvas = document.createElement("canvas");
    canvas.id = id;
    this.parent.appendChild(canvas);
    return canvas;
  }

  // 이벤트 매니저 초기화
  initializeEventManager() {
    this.eventManager = new EventManager(this.chartCanvas, null);
  }

  // 이벤트 리스너 설정
  setupEventListeners() {
    this.eventManager.addEventListener(
      EventTypes.RESIZE,
      this.resize.bind(this)
    );
  }

  // 컴포넌트 초기화
  initializeComponents() {
    // 차트 인스턴스 생성
    this.chartTestInstance = new ChartTest(
      this.chartCtx,
      this.contexts.crosshair,
      this.contexts.overlay,
      null
    );

    // 드로잉 인스턴스 생성
    const toolPanelContainer = document.querySelector("#toolPanel");
    this.drawingInstance = new DrawingTool(
      toolPanelContainer,
      this.chartTestInstance,
      this.canvasElements.drawing,
      this.canvasElements.overlay
    );

    // EventManager에 차트 인스턴스 설정 - 드로잉 인스턴스 생성 후에 설정
    this.eventManager.chartInstance = this.chartTestInstance;

    this.drawingInstance.createToolPanel();
  }

  // 캔버스 크기 조정
  resize() {
    this.stageWidth = this.parent.clientWidth;
    this.stageHeight = this.parent.clientHeight;

    // 모든 캔버스 요소에 대해 크기 설정
    Object.values(this.canvasElements).forEach((canvas) => {
      canvas.width = this.stageWidth * 2;
      canvas.height = this.stageHeight * 2;
    });

    // 모든 컨텍스트 스케일 설정
    Object.values(this.contexts).forEach((ctx) => {
      ctx.scale(2, 2);
    });

    // 차트 재렌더링
    this.renderChartIfReady();
  }

  // 차트 렌더링 조건부 실행
  renderChartIfReady() {
    if (this.chartTestInstance?.render) {
      this.chartTestInstance.render();
    }
  }

  // 이벤트 리스너 관리를 단순화한 통합 메서드
  addEventListener(type, listener) {
    this.eventManager.addEventListener(type, listener);
  }

  removeEventListener(type, listener) {
    this.eventManager.removeEventListener(type, listener);
  }

  // 기존 메서드들 호환성 유지
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
  storeOverlay(startX, startY, endX, endY, lineType) {
    this.overlaysArray.push({
      index: this.overlaysArray.length,
      startX,
      startY,
      endX,
      endY,
      lineType,
    });
  }

  getOverlaysArray() {
    return this.overlaysArray;
  }
}

// 페이지 로드 시 메인 캔버스 초기화
window.onload = () => {
  // 성능 모니터링 활성화 (디버깅 용도)
  tickerInstance.enableMonitoring(true);

  const mainCanvasParent = document.querySelector("#mainCanvas");
  window.mainCanvas = new MainCanvas(mainCanvasParent);

  // 차트 초기화 완료 후 디버그 모드 활성화 (지연 실행)
  setTimeout(() => {
    if (window.mainCanvas?.chartTestInstance?.overlayManager) {
      console.log("오버레이 매니저 디버그 모드 활성화");
      window.mainCanvas.chartTestInstance.overlayManager.toggleCoordinateDebug(
        true
      );

      // 구독 상태 강제 재설정
      window.mainCanvas.chartTestInstance.overlayManager.unsubscribeOverlayUpdate();
      window.mainCanvas.chartTestInstance.overlayManager.subscribeOverlayUpdate(
        true
      );
    } else {
      console.error("오버레이 매니저를 찾을 수 없음");
    }
  }, 1000);
};
