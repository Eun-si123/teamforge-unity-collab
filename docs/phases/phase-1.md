# Phase 1 — Presence

## 범위

사용자 입장/퇴장, 색상, Scene/선택/Scene View 상태, 원격 선택 표시, Frame Selection, Go to Camera.

## 실제 확인 결과

사용자가 Unity 6000.3.21f1과 미니 PC Docker 서버에서 다음을 확인했다.

- Package/Collaboration 창
- Bearer Token 인증
- 같은 Project/Session의 두 Editor 참가자 목록
- 선택 및 선택 해제 동기화
- Frame Selection과 Go to Camera
- Disconnect/재접속 목록 갱신
- 서버 재시작 후 자동 재접속과 Presence 복구

## 남은 검증

- Unity EditMode 테스트 실제 실행
- Presence만으로 Scene Dirty/Undo가 생기지 않는지 자동/실기 확인
- 수천 Object Scene과 송신 빈도 성능 측정
- 잘못된 입력과 사용자 ID 충돌의 Unity UI 수동 흐름

서버의 잘못된 Presence/ID 위조/동일 안정 ID 교체는 자동 테스트로 확인됐다.

## Phase 2 진입 판단

핵심 Presence 수직 흐름과 Phase 0 회귀가 실제 환경에서 통과했고, 남은 항목은 자동 테스트와 명시적 미확인 목록으로 보강 가능한 성격이어서 사용자의 지시에 따라 Phase 2를 시작했다.
