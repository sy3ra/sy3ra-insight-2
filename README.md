# 고성능 인터랙티브 차트 분석 도구 개발

![화면 기록 2025-04-17 16 03 41](https://github.com/user-attachments/assets/96c74238-c157-4559-9b12-603de50399ea)

### **기간 :** 2025.01 ~ 2025.03

### **역할 :** 1인 개발 (디자인, 설계, 개발, 테스트, 최적화 전 과정 수행)

### **기술스택 :**

Vanilla JavaScript, Canvas API, requestAnimationFrame, Chart.js, Vite.js

### **시연데모 :** https://sy3ra.github.io/sy3ra-insight-2/

### **개요 :**

기존 웹 기반 차트 분석 도구들이 제가 실제 분석에 사용하지 않는 복잡한 기능들을 다수 포함하여 불필요하게 무겁고 사용성이 떨어진다고 느꼈습니다. 이에 분석에 필수적인 핵심 기능(차트 조작, 추세선 그리기 등)이 매끄럽게 작동하는 가볍고 빠른 차트 분석 도구 개발을 목표로 삼았습니다.

개인 사용 환경을 기준으로 프레임 드롭 없는 성능을 목표. 
(1920*1080 Retina(devicePixelRatio : 2), 120Hz)
(requestAnimationFrame측정 기준 8.33ms/frame 이하)

### **구현 기능 :**

- 데이터 시각화: Binance API 연동 및 실시간 캔들스틱/볼륨 차트 렌더링 기능.
- 데이터 로딩: 차트 좌측으로 패닝 시 한계점에 도달하면 과거 데이터 추가 로드 기능. 과도한 요청 방지를 위해 디바운싱 처리
- 차트 인터랙션: 성능 저하 없이 부드럽게 작동하는 맞춤형 줌/패닝 및 크로스헤어 기능.
- Canvas 기반 분석 도구: 선분, 직선, 수평/수직선 등 다양한 그리기 도구 제공

### **작동 구조 :**
기능(캔들스틱 및 볼륨 차트, 크로스헤어, 그리기, 드로잉 오버레이)별 독립적인 Canvas 레이어를 분리 및 중첩을 통해, 불필요한 리페인트 자원 낭비를 방지하도록 설계

chartCanvas에서만 pointer-event: auto 설정하여 인식된 이벤트 -> ChartEventHandler에서 이벤트 관리

ChartEventHandler에서 이벤트 입력에 해당하는 컴포넌트의 콜백 ticker 구독

![layer](https://github.com/user-attachments/assets/32d033b6-1a2f-4c0a-8828-3db7178554f5)


이벤트 핸들러가 단일 Ticker Instance를 참조 -> 구독리스트에 등록

requestAnimationFrame 실행 주기마다 현재 구독중인 콜백들을 모두 실행

이벤트 핸들러에서 구독해제하면 해당 콜백 구독리스트에서 삭제

구독리스트가 비어있으면 rAF 멈춤

![ticker](https://github.com/user-attachments/assets/2885f025-2299-40a4-8379-c4e7ccf0890e)
