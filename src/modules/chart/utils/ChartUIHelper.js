export class ChartUIHelper {
  constructor() {
    this.spinner = null;
  }

  // 로딩 스피너 표시
  showLoadingSpinner(parentElement) {
    if (!this.spinner) {
      this.createSpinner(parentElement);
    }
    this.spinner.style.display = "block";
  }

  // 로딩 스피너 숨기기
  hideLoadingSpinner() {
    if (this.spinner) {
      this.spinner.style.display = "none";
    }
  }

  // 로딩 스피너 생성
  createSpinner(parentElement) {
    this.spinner = document.createElement("div");
    this.setupSpinnerStyles();
    this.createSpinnerKeyframes();
    parentElement.appendChild(this.spinner);
  }

  // 스피너 스타일 설정
  setupSpinnerStyles() {
    const styles = {
      position: "absolute",
      left: "20px",
      top: "50%",
      transform: "translateY(-50%)",
      width: "40px",
      height: "40px",
      border: "4px solid rgba(255, 255, 255, 0.3)",
      borderTop: "4px solid #fff",
      borderRadius: "50%",
      animation: "spin 1s linear infinite",
    };
    Object.assign(this.spinner.style, styles);
  }

  // 스피너 애니메이션 키프레임 생성
  createSpinnerKeyframes() {
    if (!document.getElementById("spinner-keyframes")) {
      const style = document.createElement("style");
      style.id = "spinner-keyframes";
      style.innerHTML = `
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }`;
      document.head.appendChild(style);
    }
  }

  // 리소스 해제
  dispose() {
    if (this.spinner && this.spinner.parentNode) {
      this.spinner.parentNode.removeChild(this.spinner);
    }
    this.spinner = null;
  }
}
