# v0.4.1 업데이트와 Rollback

## 목적

v0.4.1은 Project Payload Schema나 Coordinator Disk Migration을 추가하지 않는다. Product Version exact match 때문에 Server/Project Peer/Unity Package는 같은 버전으로 운용하고, Rollback은 실행 파일 세트를 함께 되돌린다. 기존 Project, 관리 Chunk, Staging, Active Revision과 Owner Key를 삭제하지 않는다.

## v0.4.1 업데이트 전 보존

1. 모든 Unity Editor와 Sidecar를 Disconnect/종료한다.
2. Source Unity Project와 `.meta`, `TeamForgeProjects`, Owner Key의 Offline Backup을 보존한다.
3. 기존 Active의 `metadata/current.json`, Revision/Manifest Hash와 실제 Active Path를 기록한다.
4. 기존 v0.4.0 Archive를 검증한다.

```text
Unity-TeamForge-Phase3-v0.4.0.zip
SHA-256 f9b134661685bb62bfa5a1a8f8bf9a8adba6c87192c80b0041164d8306a0e808
```

5. v0.4.1을 기존 Source 위에 덮지 말고 새 폴더에 푼다.
6. Server/Project Peer `npm ci`, Test/Smoke/Audit와 Unity Test Project Compile을 확인한다.
7. v0.4.1 Package가 Embedded인 Source에서 새 Baseline을 Preview한다. Package 목록과 변경 내용을 검토한 뒤에만 Publish한다.

## v0.4.1에서 v0.4.0으로 실행 Rollback

v0.4.0에는 direct Embedded Package 누락과 일시 오류 Retry 부족이 있으므로 새 Publish/신규 Bootstrap의 정상 장기 대안으로 권장하지 않는다. v0.4.1에서 치명적 회귀가 발견돼 기존 Scene 협업/기존 검증 Active 접근을 임시 복구할 때만 사용한다.

1. 진행 중 Download/Publish를 중단하고 Failure Staging을 그대로 보존한다.
2. v0.4.1에서 만든 Source/Active/Chunk/Owner Key를 삭제하거나 수정하지 않는다.
3. v0.4.0 ZIP을 별도 새 경로에 풀고 위 SHA-256을 확인한다.
4. v0.4.0 Server, Project Peer, Unity Package를 함께 선택한다. 혼합 Product Version Descriptor는 호환으로 처리하지 않는다.
5. Server를 교체한다. Server에는 Project Payload나 DB Migration이 없고 RAM Registry/Presence/Transform/Lock만 초기화된다.
6. 각 Editor에서 의도한 Scene 상태를 비교한 뒤 v0.4.0 Package로 연다.
7. Project Transfer가 꼭 필요하면 v0.4.0 Embedded 누락 Known Bug를 감수하지 말고, 이전에 완전히 검증된 Active Revision을 직접 열거나 v0.4.1 수정 전까지 Bootstrap을 중단한다. 사용자가 TeamForge를 다운로드 Project에 수동 설치하는 것을 정상 해결책으로 취급하지 않는다.
8. 별도 Test Session에서 Ping/Presence/Transform/Lock을 확인한 뒤 실제 Session을 연다.

## Active Revision Rollback

v0.4.1 Sync는 기존 Active 디렉터리를 덮어쓰지 않는다. 새 Revision에 문제가 있으면 Unity를 종료하고 이전에 기록한 `active/<revision>-<hash>`를 Unity Hub에서 직접 연다. `metadata/current.json`을 수동 편집하지 않는다. 자동 Pointer Rollback 명령은 아직 없으므로 Source Project/이전 Active를 보존한 상태에서 문제를 보고한다.

## Bearer Token Rollback/교체

Bearer Token은 Server 접속 자격일 뿐 Project UUID, Owner Key, Baseline, Manifest, Chunk, Active Project와 무관하다. 노출/분실 시 Server Operator가 새 Random Token으로 `TEAMFORGE_AUTH_TOKEN`을 교체하고 이전 Token을 폐기한다. 각 Client의 로컬 설정만 갱신하며 Invite나 Project Payload를 다시 만들지 않는다.

## Owner Key

Rollback 중 Owner Key를 새로 생성하거나 교체하지 않는다. 기존 서명 Project 증거가 있는데 Key가 없으면 `owner_key_missing`으로 중단하고, Fingerprint가 일치하는 Offline Backup만 복원한다. Rotation/Ownership Transfer는 v0.4.1에서도 미지원이며 기존 Owner 이중 서명 Protocol 전까지 fail-closed다.

## Rollback 확인

- [ ] 기존 Project/Active/Staging/Chunk/Owner Key가 보존됐다.
- [ ] Server Disk에 Project Payload가 없다.
- [ ] Product Version 세트가 혼합되지 않았다.
- [ ] Scene 상태를 사용자들이 비교했다.
- [ ] Ping/Presence/Transform/Lock 회귀가 없다.
- [ ] Rollback 이유와 재현 로그를 기록했다.


## Unity field hotfix rollback unit

Treat the following as one rollback unit:

- `TeamForgeProjectModel.cs`
- `TeamForgeProjectService.cs`
- `TeamForgeWindow.cs`
- `TeamForgeEditorSurfaceTests.cs`
- `scripts/validate-repository.mjs`

Rolling back only the new enum or only the UI creates inconsistent state rendering. Rolling back the PackageInfo qualification reintroduces Unity 6000.3.21f1 CS0104 when the Test Assembly is enabled. After rollback, rerun the repository validator and Unity Compile/EditMode before any release decision.
