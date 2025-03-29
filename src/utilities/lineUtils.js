// 선 그리기 유틸리티 함수들을 모은 모듈

/**
 * 두 점 사이의 기울기를 계산합니다.
 */
export function calculateSlope(startX, startY, endX, endY) {
  return startX === endX ? Infinity : (endY - startY) / (endX - startX);
}

/**
 * 시작점과 끝점 사이의 방향을 계산합니다.
 */
export function calculateDirection(startX, startY, endX, endY) {
  return {
    x: endX > startX ? 1 : endX < startX ? -1 : 0,
    y: endY > startY ? 1 : endY < startY ? -1 : 0,
  };
}

/**
 * 선을 그립니다. 차트 영역으로 클리핑 옵션이 포함됩니다.
 */
export function drawLine(
  ctx,
  startX,
  startY,
  endX,
  endY,
  color = "white",
  width = 1,
  chartArea = null
) {
  ctx.beginPath();

  // 클리핑 영역 설정 (차트 영역으로 제한)
  if (chartArea) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(
      chartArea.left,
      chartArea.top,
      chartArea.right - chartArea.left,
      chartArea.bottom - chartArea.top
    );
    ctx.clip();
  }

  // 선 그리기
  ctx.beginPath();
  ctx.moveTo(startX, startY);
  ctx.lineTo(endX, endY);
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.stroke();

  // 클리핑 해제
  if (chartArea) {
    ctx.restore();
  }
}

/**
 * 앵커 포인트를 그립니다.
 */
export function drawAnchorPoint(ctx, x, y, radius = 4, color = "white") {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}
