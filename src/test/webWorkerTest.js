// 보다 안정적인 워커 관리를 위한 고유 ID 시스템
const WORKER_ID_KEY = "btc_chart_worker_id";
let currentWorkerId = Date.now().toString();
let globalWorker = null;

// 초기 로드 시 이전 워커 정리 시도
function cleanupPreviousWorkers() {
  try {
    const previousId = localStorage.getItem(WORKER_ID_KEY);
    if (previousId && previousId !== currentWorkerId) {
      console.log(`이전 워커 세션(${previousId}) 감지됨, 정리 중...`);
      // 현재 ID 저장 (새로운 세션 표시)
      localStorage.setItem(WORKER_ID_KEY, currentWorkerId);
    }
  } catch (e) {
    console.error("워커 정리 중 오류:", e);
  }
}

// 워커 종료 및 정리 함수
function terminateWorker() {
  if (globalWorker) {
    console.log("워커 종료 중...");
    try {
      globalWorker.terminate();
      // 워커 종료 후 로컬 스토리지에서 ID 제거
      localStorage.removeItem(WORKER_ID_KEY);
    } catch (e) {
      console.error("워커 종료 중 오류:", e);
    }
    globalWorker = null;
  }
}

// 페이지 로드 시 실행되는 초기화 함수
function initPageCleanup() {
  if (!window.__workerCleanupInitialized) {
    // 페이지 언로드 이벤트
    window.addEventListener("beforeunload", terminateWorker);

    // 페이지 숨김 이벤트
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        terminateWorker();
      }
    });

    window.addEventListener("pagehide", terminateWorker);

    // 개발 환경의 HMR 처리
    if (import.meta.hot) {
      import.meta.hot.dispose(() => {
        terminateWorker();
        // HMR에서 워커 ID 로컬 스토리지에서 제거
        localStorage.removeItem(WORKER_ID_KEY);
      });
    }

    window.__workerCleanupInitialized = true;

    // 이전 워커 정리 시도
    cleanupPreviousWorkers();
  }
}

// 단일 웹 워커 인스턴스를 관리하는 클래스
class ChartWorkerManager {
  constructor() {
    this.worker = null;
    this.canvas = null;
    this.initialized = false;
  }

  // 워커 초기화 함수
  initialize() {
    // 이미 초기화된 경우 중복 초기화 방지
    if (this.initialized) return;

    // 기존 워커가 있으면 종료
    this.terminate();

    try {
      // 캔버스 생성 및 설정
      this.canvas = document.createElement("canvas");
      this.canvas.style.width = "400px";
      this.canvas.style.height = "400px";
      document.body.appendChild(this.canvas);

      const offscreenCanvas = this.canvas.transferControlToOffscreen();

      // 차트 설정
      const config = {
        type: "line",
        data: {
          labels: [],
          datasets: [
            {
              label: "BTC/USDT",
              data: [],
              borderColor: "rgb(75, 192, 192)",
              tension: 0.1,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
        },
      };

      // 워커 생성
      this.worker = new Worker(
        new URL("../workers/worker-test.js", import.meta.url),
        { type: "module" }
      );

      // 워커에 메시지 전송
      this.worker.postMessage(
        {
          canvas: offscreenCanvas,
          config,
          dimensions: {
            width: this.canvas.width,
            height: this.canvas.height,
          },
        },
        [offscreenCanvas]
      );

      // 워커로부터 메시지 수신
      this.worker.onmessage = (event) => {
        if (event.data.error) {
          console.error("워커 오류:", event.data.error);
        } else if (event.data.status === "success") {
          console.log("차트 생성 성공");
        } else if (event.data.log) {
          console.log("워커 로그:", event.data.log);
        }
      };

      this.initialized = true;
      console.log("워커 초기화 완료");
    } catch (error) {
      console.error("워커 초기화 오류:", error);
      this.terminate();
    }
  }

  // 워커 종료 함수
  terminate() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
      console.log("워커 종료됨");
    }

    if (this.canvas && this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas);
      this.canvas = null;
    }

    this.initialized = false;
  }

  // 워커 테스트 메서드
  testWorker() {
    if (!this.worker) {
      console.error("워커가 초기화되지 않았습니다");
      return false;
    }

    this.worker.postMessage({ type: "ping" });
    return true;
  }
}

// 싱글톤 인스턴스
const workerManager = new ChartWorkerManager();

// 페이지 생명주기 이벤트 처리
function setupLifecycleEvents() {
  // 페이지 언로드시 워커 종료
  window.addEventListener("beforeunload", () => {
    workerManager.terminate();
  });

  // 탭이 보이지 않을 때 워커 종료
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      workerManager.terminate();
    } else if (document.visibilityState === "visible") {
      // 페이지가 다시 보일 때 워커 재초기화 (선택적)
      // workerManager.initialize();
    }
  });

  // 개발 환경의 HMR 처리
  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      workerManager.terminate();
    });
  }
}

// 페이지 로드 시 실행
window.addEventListener("DOMContentLoaded", () => {
  setupLifecycleEvents();
  workerManager.initialize();
  setTimeout(() => {
    console.log("워커 테스트 실행 중...");
    workerManager.testWorker();
  }, 1000);
});

// 기존 로드 이벤트 제거 (중복 방지)
window.onload = null;
