(function () {
  // 상태 변수
  let wheelEvents = [];
  let lastWheelTime = 0;
  let inactivityTimer = null;
  let timeData = []; // timeData를 전역 변수로 이동

  // 전체 컨테이너 생성 (모든 요소를 담을 컨테이너)
  const container = document.createElement("div");
  container.style.display = "flex";
  container.style.flexDirection = "column";
  container.style.alignItems = "center";
  container.style.maxWidth = "800px";
  container.style.margin = "0 auto";
  container.style.padding = "20px";

  // 테스트 영역 생성
  const testArea = document.createElement("div");
  testArea.style.width = "100%";
  testArea.style.height = "200px";
  testArea.style.marginBottom = "20px";
  testArea.style.backgroundColor = "#f0f0f0";
  testArea.style.border = "1px solid #ccc";
  testArea.style.padding = "20px";
  testArea.style.boxSizing = "border-box";
  testArea.style.overflow = "hidden";
  testArea.style.position = "relative";
  testArea.innerHTML =
    '<h3 style="text-align: center;">휠 테스트 영역 - 이곳에서 마우스 휠을 움직여보세요</h3>';

  // 결과 표시 영역
  const resultArea = document.createElement("div");
  resultArea.style.width = "100%"; // 전체 너비로 변경
  resultArea.style.marginBottom = "20px"; // 여백 추가
  resultArea.style.padding = "15px"; // 패딩 추가
  resultArea.style.border = "1px solid #ccc"; // 테두리 추가
  resultArea.style.backgroundColor = "#f9f9f9"; // 배경색 추가
  resultArea.style.borderRadius = "5px"; // 모서리 둥글게

  // 현재 상태 표시 영역
  const statusArea = document.createElement("div");
  statusArea.style.width = "100%"; // 전체 너비로 변경
  statusArea.style.marginBottom = "20px"; // 여백 조정
  statusArea.style.padding = "15px"; // 패딩 추가
  statusArea.style.border = "1px solid #ccc";
  statusArea.style.backgroundColor = "#fff";
  statusArea.style.color = "#666";
  statusArea.style.borderRadius = "5px"; // 모서리 둥글게
  statusArea.innerHTML = "대기 중...";

  // 버튼 스타일 함수 생성
  function styleButton(button) {
    button.style.margin = "5px 10px";
    button.style.padding = "8px 15px";
    button.style.backgroundColor = "#4CAF50";
    button.style.color = "white";
    button.style.border = "none";
    button.style.borderRadius = "4px";
    button.style.cursor = "pointer";
    button.style.fontSize = "14px";
    button.style.transition = "background-color 0.3s";

    // 호버 효과
    button.onmouseover = () => {
      button.style.backgroundColor = "#45a049";
    };
    button.onmouseout = () => {
      button.style.backgroundColor = "#4CAF50";
    };
  }

  // 누적 스크롤 그래프 버튼 추가
  const cumulativeButton = document.createElement("button");
  cumulativeButton.textContent = "누적 스크롤 그래프 보기";
  styleButton(cumulativeButton);
  cumulativeButton.addEventListener("click", () => {
    if (timeData.length > 0) {
      drawCumulativeGraph(timeData);
    }
  });

  // 일반 그래프 버튼 추가
  const normalButton = document.createElement("button");
  normalButton.textContent = "일반 그래프 보기";
  styleButton(normalButton);
  normalButton.addEventListener("click", () => {
    if (timeData.length > 0) {
      drawDeltaYGraph(timeData);
    }
  });

  // 버튼 컨테이너
  const buttonContainer = document.createElement("div");
  buttonContainer.style.textAlign = "center";
  buttonContainer.style.width = "100%";
  buttonContainer.style.marginBottom = "20px";
  buttonContainer.appendChild(normalButton);
  buttonContainer.appendChild(cumulativeButton);

  // 캔버스 컨테이너 생성 (비율 유지를 위해)
  const canvasContainer = document.createElement("div");
  canvasContainer.style.position = "relative";
  canvasContainer.style.width = "100%";
  canvasContainer.style.maxWidth = "400px"; // 최대 너비 제한
  canvasContainer.style.marginBottom = "20px";
  canvasContainer.style.border = "1px solid #ccc";
  canvasContainer.style.backgroundColor = "#fff";
  canvasContainer.style.borderRadius = "5px"; // 모서리 둥글게
  canvasContainer.style.aspectRatio = "1/1"; // 1:1 비율 유지

  // 캔버스 설정
  const graphCanvas = document.createElement("canvas");
  graphCanvas.width = 400; // 원래 크기로 복원
  graphCanvas.height = 400;
  graphCanvas.style.position = "absolute";
  graphCanvas.style.top = "0";
  graphCanvas.style.left = "0";
  graphCanvas.style.width = "100%";
  graphCanvas.style.height = "100%";
  graphCanvas.style.display = "block";

  // 캔버스를 컨테이너에 추가
  canvasContainer.appendChild(graphCanvas);

  // 요소들을 컨테이너에 추가하는 순서 변경
  container.appendChild(testArea);
  container.appendChild(statusArea);
  container.appendChild(buttonContainer);
  container.appendChild(canvasContainer);
  container.appendChild(resultArea);

  // 컨테이너를 body에 추가
  document.body.appendChild(container);

  // 휠 이벤트 핸들러
  function handleWheel(e) {
    const currentTime = performance.now();

    // 이벤트 정보 저장
    wheelEvents.push({
      deltaY: e.deltaY,
      timestamp: currentTime,
    });

    // 콘솔에 개별 이벤트 로깅
    console.log(
      `휠 이벤트 감지: deltaY=${e.deltaY}, 시간차=${
        currentTime - lastWheelTime
      }ms`
    );

    // 상태 업데이트
    statusArea.innerHTML = `
            마지막 휠 이벤트: deltaY=${e.deltaY}<br>
            이전 이벤트와 시간차: ${Math.round(
              currentTime - lastWheelTime
            )}ms<br>
            누적 이벤트 수: ${wheelEvents.length}
          `;

    // 타이머 초기화
    if (inactivityTimer) {
      clearTimeout(inactivityTimer);
    }

    // 마지막 휠 시간 업데이트
    lastWheelTime = currentTime;

    // 1초 후 분석 실행
    inactivityTimer = setTimeout(() => {
      analyzeWheelEvents();
    }, 1000);
  }

  // 그래프 그리기 함수 수정
  function drawSpeedGraph(timeDiffs) {
    const ctx = graphCanvas.getContext("2d");
    const width = graphCanvas.width;
    const height = graphCanvas.height;

    // 캔버스 초기화
    ctx.clearRect(0, 0, width, height);

    // 배경 및 테두리 설정
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);

    // 그래프가 그려질 영역 설정 (여백 포함)
    const padding = 40;
    const graphWidth = width - padding * 2;
    const graphHeight = height - padding * 2;

    // 축 그리기
    ctx.strokeStyle = "#333";
    ctx.lineWidth = 1;
    ctx.beginPath();
    // x축
    ctx.moveTo(padding, height - padding);
    ctx.lineTo(width - padding, height - padding);
    // y축
    ctx.moveTo(padding, height - padding);
    ctx.lineTo(padding, padding);
    ctx.stroke();

    // 데이터가 없으면 여기서 종료
    if (timeDiffs.length === 0) {
      ctx.font = "14px Arial";
      ctx.fillStyle = "#666";
      ctx.textAlign = "center";
      ctx.fillText("데이터가 충분하지 않습니다", width / 2, height / 2);
      return;
    }

    // 최대값 계산 (y축 스케일링용)
    const maxTime = Math.max(...timeDiffs);
    const yScale = maxTime > 0 ? graphHeight / (maxTime * 1.1) : 1;

    // 그리드 라인 그리기 (선형 그래프 느낌을 강화)
    ctx.strokeStyle = "rgba(200, 200, 200, 0.3)";
    ctx.setLineDash([1, 2]);

    // 수평 그리드 라인
    const yGridCount = 5;
    for (let i = 1; i <= yGridCount; i++) {
      const y = height - padding - (graphHeight * i) / yGridCount;
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(width - padding, y);
      ctx.stroke();

      // 눈금 값 표시
      const timeValue = (maxTime * i) / yGridCount;
      ctx.fillStyle = "#666";
      ctx.textAlign = "right";
      ctx.font = "10px Arial";
      ctx.fillText(timeValue.toFixed(1) + "ms", padding - 5, y + 3);
    }

    // 9ms 기준선 그리기 (빨간색)
    const y9ms = height - padding - 9 * yScale;
    ctx.strokeStyle = "rgba(255, 0, 0, 0.5)";
    ctx.setLineDash([5, 3]);
    ctx.beginPath();
    ctx.moveTo(padding, y9ms);
    ctx.lineTo(width - padding, y9ms);
    ctx.stroke();
    ctx.setLineDash([]);

    // 9ms 텍스트 표시
    ctx.font = "12px Arial";
    ctx.fillStyle = "red";
    ctx.textAlign = "left";
    ctx.fillText("9ms", padding + 5, y9ms - 5);

    // 그래프 그리기
    const xStep = graphWidth / (timeDiffs.length - 1 || 1);

    // 선 그리기 - 더 굵고 부드러운 선으로 수정
    ctx.strokeStyle = "#0066cc";
    ctx.lineWidth = 3;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();

    // 선 아래 영역 채우기 (그라데이션)
    const gradient = ctx.createLinearGradient(0, padding, 0, height - padding);
    gradient.addColorStop(0, "rgba(0, 102, 204, 0.2)");
    gradient.addColorStop(1, "rgba(0, 102, 204, 0.0)");

    // 선 그리기 (점 없이)
    timeDiffs.forEach((time, i) => {
      const x = padding + i * xStep;
      const y = height - padding - time * yScale;

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });

    // 선 그리기
    ctx.stroke();

    // 영역 채우기를 위한 경로 완성
    const lastX = padding + (timeDiffs.length - 1) * xStep;
    const lastY = height - padding - timeDiffs[timeDiffs.length - 1] * yScale;
    ctx.lineTo(lastX, height - padding);
    ctx.lineTo(padding, height - padding);
    ctx.closePath();

    // 영역 채우기
    ctx.fillStyle = gradient;
    ctx.fill();

    // 모든 포인트 표시 (9ms 이하는 빨간색, 나머지는 파란색)
    timeDiffs.forEach((time, i) => {
      const x = padding + i * xStep;
      const y = height - padding - time * yScale;

      // 9ms 이하는 빨간색, 나머지는 파란색
      ctx.fillStyle = time <= 9 ? "red" : "#0066cc";
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();

      // 포인트 테두리 추가 (더 잘 보이게)
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.stroke();
    });

    // 축 레이블
    ctx.font = "12px Arial";
    ctx.fillStyle = "#333";
    ctx.textAlign = "center";

    // x축 레이블
    ctx.fillText("이벤트 순서", width / 2, height - 10);

    // y축 레이블
    ctx.save();
    ctx.translate(15, height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.fillText("시간 간격 (ms)", 0, 0);
    ctx.restore();

    // 그래프 제목
    ctx.font = "bold 14px Arial";
    ctx.textAlign = "center";
    ctx.fillText("휠 이벤트 간 시간 간격 그래프", width / 2, 20);
  }

  // 휠 이벤트 분석
  function analyzeWheelEvents() {
    if (wheelEvents.length === 0) return;

    // 시간 범위 계산
    const startTime = wheelEvents[0].timestamp;
    const endTime = wheelEvents[wheelEvents.length - 1].timestamp;
    const timeSpan = endTime - startTime;

    // 이벤트 속도 계산
    const eventsPerSecond = wheelEvents.length / (timeSpan / 1000);

    // 평균 델타Y 계산
    const totalAbsDeltaY = wheelEvents.reduce(
      (sum, event) => sum + Math.abs(event.deltaY),
      0
    );
    const avgDeltaY = totalAbsDeltaY / wheelEvents.length;

    // 실제 총 스크롤 양 계산 (방향 고려)
    const totalDeltaY = wheelEvents.reduce(
      (sum, event) => sum + event.deltaY,
      0
    );

    // 이벤트 간 시간 계산
    let totalTimeBetweenEvents = 0;
    let minTimeBetweenEvents = Infinity;
    let maxTimeBetweenEvents = 0;
    let eventsUnder9ms = 0;

    for (let i = 1; i < wheelEvents.length; i++) {
      const timeDiff = wheelEvents[i].timestamp - wheelEvents[i - 1].timestamp;
      totalTimeBetweenEvents += timeDiff;

      // 최소/최대 시간 간격 업데이트
      minTimeBetweenEvents = Math.min(minTimeBetweenEvents, timeDiff);
      maxTimeBetweenEvents = Math.max(maxTimeBetweenEvents, timeDiff);

      // 9ms 이하 간격 카운트
      if (timeDiff <= 9) {
        eventsUnder9ms++;
      }
    }

    const avgTimeBetweenEvents =
      wheelEvents.length > 1
        ? totalTimeBetweenEvents / (wheelEvents.length - 1)
        : 0;

    // 이벤트가 하나뿐이면 최소/최대 시간 간격을 0으로 설정
    if (wheelEvents.length <= 1) {
      minTimeBetweenEvents = 0;
      maxTimeBetweenEvents = 0;
    }

    // 그래프용 데이터 생성 - 시간과 deltaY 값
    timeData = wheelEvents.map((event) => ({
      time: event.timestamp - startTime,
      deltaY: event.deltaY,
    }));

    // 그래프 그리기
    drawDeltaYGraph(timeData);

    // 결과 출력
    const resultHTML = `
            <h4>휠 입력 분석 결과</h4>
            <ul>
              <li>총 휠 이벤트 수: ${wheelEvents.length}</li>
              <li>총 소요 시간: ${Math.round(timeSpan)}ms</li>
              <li>초당 휠 이벤트: ${eventsPerSecond.toFixed(2)}회/초</li>
              <li>총 스크롤 양: ${totalDeltaY.toFixed(2)}</li>
              <li>평균 deltaY 크기: ${avgDeltaY.toFixed(2)}</li>
              <li>이벤트 간 평균 시간: ${avgTimeBetweenEvents.toFixed(2)}ms</li>
              <li>이벤트 간 최소 시간: ${minTimeBetweenEvents.toFixed(2)}ms</li>
              <li>이벤트 간 최대 시간: ${maxTimeBetweenEvents.toFixed(2)}ms</li>
              <li>9ms 이하 간격 이벤트 수: ${eventsUnder9ms}</li>
            </ul>
          `;

    resultArea.innerHTML = resultHTML;
    console.log("-------------------------------------");
    console.log(`휠 입력 분석 결과:`);
    console.log(`총 휠 이벤트 수: ${wheelEvents.length}`);
    console.log(`초당 휠 이벤트: ${eventsPerSecond.toFixed(2)}회/초`);
    console.log(`이벤트 간 평균 시간: ${avgTimeBetweenEvents.toFixed(2)}ms`);
    console.log(`이벤트 간 최소 시간: ${minTimeBetweenEvents.toFixed(2)}ms`);
    console.log(`이벤트 간 최대 시간: ${maxTimeBetweenEvents.toFixed(2)}ms`);
    console.log(`9ms 이하 간격 이벤트 수: ${eventsUnder9ms}`);
    console.log(`총 스크롤 양: ${totalDeltaY.toFixed(2)}`);
    console.log("-------------------------------------");

    // 새 분석 세션을 위해 배열 초기화
    wheelEvents = [];
    statusArea.innerHTML = "대기 중... (새 휠 이벤트 기다리는 중)";
  }

  // 새로운 그래프 그리기 함수 (x축: 시간, y축: deltaY)
  function drawDeltaYGraph(timeData) {
    const ctx = graphCanvas.getContext("2d");
    const width = graphCanvas.width;
    const height = graphCanvas.height;

    // 캔버스 초기화
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);

    // 그래프가 그려질 영역 설정
    const padding = 40;
    const graphWidth = width - padding * 2;
    const graphHeight = height - padding * 2;

    // 축 그리기
    ctx.strokeStyle = "#333";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding, height - padding);
    ctx.lineTo(width - padding, height - padding);
    ctx.moveTo(padding, height - padding);
    ctx.lineTo(padding, padding);
    ctx.stroke();

    // 데이터가 없으면 여기서 종료
    if (timeData.length === 0) {
      ctx.font = "14px Arial";
      ctx.fillStyle = "#666";
      ctx.textAlign = "center";
      ctx.fillText("데이터가 충분하지 않습니다", width / 2, height / 2);
      return;
    }

    // 스케일링을 위한 최대/최소값 계산
    const maxTime = Math.max(...timeData.map((d) => d.time));
    const minDeltaY = Math.min(...timeData.map((d) => d.deltaY));
    const maxDeltaY = Math.max(...timeData.map((d) => d.deltaY));
    const deltaYRange =
      Math.max(Math.abs(minDeltaY), Math.abs(maxDeltaY)) * 1.1;

    // 스케일링 함수
    const timeToX = (time) => padding + (time / maxTime) * graphWidth;
    const deltaYToY = (deltaY) => {
      // 중앙을 0으로 하는 Y축 (양수는 위로, 음수는 아래로)
      const zeroY = height - padding - graphHeight / 2;
      return zeroY - (deltaY / deltaYRange) * (graphHeight / 2);
    };

    // 그리드 라인 그리기
    ctx.strokeStyle = "rgba(200, 200, 200, 0.3)";
    ctx.setLineDash([1, 2]);

    // 수평 그리드 (deltaY = 0 기준선 포함)
    const zeroY = deltaYToY(0);
    ctx.beginPath();
    ctx.moveTo(padding, zeroY);
    ctx.lineTo(width - padding, zeroY);
    ctx.stroke();

    // 수직 그리드 (시간 간격)
    const timeGridCount = 5;
    for (let i = 1; i <= timeGridCount; i++) {
      const x = padding + (graphWidth * i) / timeGridCount;
      ctx.beginPath();
      ctx.moveTo(x, height - padding);
      ctx.lineTo(x, padding);
      ctx.stroke();

      // 시간 눈금 표시
      const timeValue = (maxTime * i) / timeGridCount;
      ctx.fillStyle = "#666";
      ctx.textAlign = "center";
      ctx.font = "10px Arial";
      ctx.fillText(Math.round(timeValue) + "ms", x, height - padding + 15);
    }

    // deltaY 눈금 표시
    const deltaYGridCount = 4; // 0 위아래로 2개씩
    for (let i = -deltaYGridCount / 2; i <= deltaYGridCount / 2; i++) {
      if (i === 0) continue; // 0 기준선은 이미 그림

      const deltaYValue = (i / (deltaYGridCount / 2)) * deltaYRange;
      const y = deltaYToY(deltaYValue);

      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(width - padding, y);
      ctx.stroke();

      // deltaY 값 표시
      ctx.fillStyle = "#666";
      ctx.textAlign = "right";
      ctx.font = "10px Arial";
      ctx.fillText(Math.round(deltaYValue), padding - 5, y + 3);
    }

    ctx.setLineDash([]);

    // 선 그리기
    ctx.strokeStyle = "#0066cc";
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.beginPath();

    timeData.forEach((data, i) => {
      const x = timeToX(data.time);
      const y = deltaYToY(data.deltaY);

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });

    ctx.stroke();

    // 포인트 그리기
    timeData.forEach((data, i) => {
      const x = timeToX(data.time);
      const y = deltaYToY(data.deltaY);

      // 양수 deltaY는 파란색, 음수는 빨간색
      ctx.fillStyle = data.deltaY >= 0 ? "#0066cc" : "#cc0000";
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();

      // 포인트 테두리
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.stroke();
    });

    // 축 레이블
    ctx.font = "12px Arial";
    ctx.fillStyle = "#333";
    ctx.textAlign = "center";

    // x축 레이블
    ctx.fillText("시간 (ms)", width / 2, height - 10);

    // y축 레이블
    ctx.save();
    ctx.translate(15, height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.fillText("deltaY 값", 0, 0);
    ctx.restore();

    // 그래프 제목
    ctx.font = "bold 14px Arial";
    ctx.textAlign = "center";
    ctx.fillText("휠 이벤트 deltaY 값 변화 그래프", width / 2, 20);
  }

  // 누적 스크롤 그래프 그리기 함수
  function drawCumulativeGraph(timeData) {
    const ctx = graphCanvas.getContext("2d");
    const width = graphCanvas.width;
    const height = graphCanvas.height;

    // 캔버스 초기화
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);

    // 그래프가 그려질 영역 설정
    const padding = 40;
    const graphWidth = width - padding * 2;
    const graphHeight = height - padding * 2;

    // 축 그리기
    ctx.strokeStyle = "#333";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding, height - padding);
    ctx.lineTo(width - padding, height - padding);
    ctx.moveTo(padding, height - padding);
    ctx.lineTo(padding, padding);
    ctx.stroke();

    // 데이터가 없으면 여기서 종료
    if (timeData.length === 0) {
      ctx.font = "14px Arial";
      ctx.fillStyle = "#666";
      ctx.textAlign = "center";
      ctx.fillText("데이터가 충분하지 않습니다", width / 2, height / 2);
      return;
    }

    // 누적 deltaY 계산
    let cumulativeData = [];
    let cumulativeSum = 0;

    timeData.forEach((data) => {
      cumulativeSum += data.deltaY;
      cumulativeData.push({
        time: data.time,
        cumulativeDeltaY: cumulativeSum,
      });
    });

    // 스케일링을 위한 최대/최소값 계산
    const maxTime = Math.max(...cumulativeData.map((d) => d.time));
    const minCumulative = Math.min(
      ...cumulativeData.map((d) => d.cumulativeDeltaY)
    );
    const maxCumulative = Math.max(
      ...cumulativeData.map((d) => d.cumulativeDeltaY)
    );
    const cumulativeRange =
      Math.max(Math.abs(minCumulative), Math.abs(maxCumulative)) * 1.1;

    // 스케일링 함수
    const timeToX = (time) => padding + (time / maxTime) * graphWidth;
    const cumulativeToY = (value) => {
      const zeroY = height - padding - graphHeight / 2;
      return zeroY - (value / cumulativeRange) * (graphHeight / 2);
    };

    // 그리드 라인 그리기
    ctx.strokeStyle = "rgba(200, 200, 200, 0.3)";
    ctx.setLineDash([1, 2]);

    // 수평 그리드 (0 기준선 포함)
    const zeroY = cumulativeToY(0);
    ctx.beginPath();
    ctx.moveTo(padding, zeroY);
    ctx.lineTo(width - padding, zeroY);
    ctx.stroke();

    // 수직 그리드
    const timeGridCount = 5;
    for (let i = 1; i <= timeGridCount; i++) {
      const x = padding + (graphWidth * i) / timeGridCount;
      ctx.beginPath();
      ctx.moveTo(x, height - padding);
      ctx.lineTo(x, padding);
      ctx.stroke();

      // 시간 눈금 표시
      const timeValue = (maxTime * i) / timeGridCount;
      ctx.fillStyle = "#666";
      ctx.textAlign = "center";
      ctx.font = "10px Arial";
      ctx.fillText(Math.round(timeValue) + "ms", x, height - padding + 15);
    }

    // 누적값 눈금 표시
    const valueGridCount = 4;
    for (let i = -valueGridCount / 2; i <= valueGridCount / 2; i++) {
      if (i === 0) continue;

      const value = (i / (valueGridCount / 2)) * cumulativeRange;
      const y = cumulativeToY(value);

      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(width - padding, y);
      ctx.stroke();

      ctx.fillStyle = "#666";
      ctx.textAlign = "right";
      ctx.font = "10px Arial";
      ctx.fillText(Math.round(value), padding - 5, y + 3);
    }

    ctx.setLineDash([]);

    // 누적 그래프 선 그리기
    ctx.strokeStyle = "#009900";
    ctx.lineWidth = 3;
    ctx.lineJoin = "round";
    ctx.beginPath();

    cumulativeData.forEach((data, i) => {
      const x = timeToX(data.time);
      const y = cumulativeToY(data.cumulativeDeltaY);

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });

    ctx.stroke();

    // 포인트 그리기
    cumulativeData.forEach((data, i) => {
      const x = timeToX(data.time);
      const y = cumulativeToY(data.cumulativeDeltaY);

      ctx.fillStyle = data.cumulativeDeltaY >= 0 ? "#009900" : "#cc0000";
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.stroke();
    });

    // 축 레이블
    ctx.font = "12px Arial";
    ctx.fillStyle = "#333";
    ctx.textAlign = "center";

    // x축 레이블
    ctx.fillText("시간 (ms)", width / 2, height - 10);

    // y축 레이블
    ctx.save();
    ctx.translate(15, height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.fillText("누적 스크롤 양", 0, 0);
    ctx.restore();

    // 그래프 제목
    ctx.font = "bold 14px Arial";
    ctx.textAlign = "center";
    ctx.fillText("누적 스크롤 양 그래프", width / 2, 20);
  }

  // 이벤트 리스너 등록
  testArea.addEventListener("wheel", handleWheel, { passive: true });

  console.log(
    "휠 테스트 초기화 완료. 테스트 영역에서 마우스 휠을 사용해보세요."
  );
})();
