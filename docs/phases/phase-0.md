# Phase 0 — Connection MVP

## 범위

Unity 창 → 주소/사용자 입력 → Connect → Hello → Ping/Pong/RTT → Disconnect → 주소 변경 → 재연결.

## 결과

- Editor 전용 UPM, UI Toolkit 창, 표준 ClientWebSocket
- Node.js 세션 호스트, Health, 선택적 Bearer Token
- Timeout, 제한된 Backoff, Assembly Reload 연결 의도 복원
- Protocol v1, 입력/크기/빈도 제한

## 검증

- 최초 자동 테스트 7/7 통과
- Phase 1 실제 검증에서 Unity 6000.3.21f1 패키지/창/미니 PC Docker/Bearer/재연결이 확인되어 Phase 0 실기 Gate도 충족

## 남은 항목

WSS/Reverse Proxy 제품별 행렬과 macOS/Linux Unity Editor는 미확인이다. 상세 기록은 [Phase 0 보고서](../phase-0-test-report.md)에 있다.
