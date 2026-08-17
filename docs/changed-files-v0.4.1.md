# v0.4.1 변경 파일

현재 작업 디렉터리는 Git 저장소가 아니므로 `git diff`/Commit 목록을 사용할 수 없다. 아래 목록은 보존된 `Unity-TeamForge-Phase3-v0.4.0.zip`을 임시 폴더에 풀고 현재 Source와 `diff -qr`로 비교해 작성했다. v0.4.0 ZIP/Checksum/기존 Test Report는 변경하지 않았다.

## 신규 파일

- `docs/phase-3-v0.4.1-patch-report.md`
- `docs/phase-3-v0.4.1-manual-test-checklist.md`
- `docs/phase-3-v0.4.1-test-report.md`
- `docs/changed-files-v0.4.1.md`
- `docs/rollback-v0.4.1.md`
- `unity-package/com.eunsung.teamforge/Tests/Editor/TeamForgeEditorSurfaceTests.cs`
- `unity-package/com.eunsung.teamforge/Tests/Editor/TeamForgeEditorSurfaceTests.cs.meta`

Release 생성 뒤 Root에 다음 두 파일이 추가된다.

- `Unity-TeamForge-Phase3-v0.4.1.zip`
- `Unity-TeamForge-Phase3-v0.4.1.zip.sha256`

## Root/검증

- `README.md` — v0.4.1 상태, Embedded/Retry 범위, 새 Checklist 링크
- `package.json` — Product Version 0.4.1
- `scripts/validate-repository.mjs` — Version, 새 Unity Test Source, Progress API 부재 검증

## Project Peer 구현

- `project-peer/src/path-policy.mjs` — direct Embedded/internal file Package 탐색, lock/realpath/symlink/Secret 방어, Package kind
- `project-peer/src/manifest.mjs` — Embedded 요약과 독립 Coverage 검사
- `project-peer/src/direct-transfer-client.mjs` — HTTP/Network 오류 분류, Retry-After, raw body 제거
- `project-peer/src/direct-transfer-server.mjs` — 429/503 Retry-After
- `project-peer/src/swarm-downloader.mjs` — pacing, bounded retry, Backoff/Jitter, Peer failover, secret-free 진단
- `project-peer/src/managed-project.mjs` — packages-lock Activation 필수화
- `project-peer/src/project-peer.mjs` — Retry 설정 연결, DirectTransferUnavailable Staging 상태
- `project-peer/src/cli.mjs` — 기본 concurrency 4, Retry 옵션/진단, Embedded Publish Preview
- `project-peer/src/constants.mjs` — Product Version 0.4.1
- `project-peer/scripts/smoke.mjs` — 정상 Package Lock Fixture
- `project-peer/package.json`
- `project-peer/package-lock.json`
- `project-peer/README.md`

## Project Peer 테스트

- `project-peer/test/manifest-path.test.mjs`
- `project-peer/test/direct-transfer.test.mjs`
- `project-peer/test/swarm-downloader.test.mjs`
- `project-peer/test/managed-project.test.mjs`
- `project-peer/test/project-transfer-integration.test.mjs`
- `project-peer/test/project-engine.test.mjs`

추가 범위는 direct/unlisted Embedded, internal/external Local Package, symlink/junction/traversal/Secret/lock, 150개 이상 Chunk, 실제 429 Retry-After, 503/Reset/Timeout, metadata retry, Peer 전환, Resume, Active/Staging, 실제 TeamForge Package Publish→Sync다.

## Server

- `server/src/protocol.mjs` — Server Version 0.4.1
- `server/src/project-coordinator.mjs` — Project Product Version 0.4.1
- `server/test/project-coordinator.test.mjs` — v0.4.1 Canonical Descriptor Hash
- `server/package.json`
- `server/package-lock.json`
- `server/README.md`

Coordinator의 Payload 저장/Relay 동작은 추가하지 않았다.

## Unity Package

- `unity-package/com.eunsung.teamforge/package.json` — 0.4.1
- `unity-package/com.eunsung.teamforge/Editor/ProjectTransfer/TeamForgeProjectModel.cs` — Contract Version 0.4.1
- `unity-package/com.eunsung.teamforge/Tests/Editor/TeamForgeEditorSurfaceTests.cs` 및 `.meta` — PackageInfo/Assembly/Menu/Descriptor 호환 Test Source
- `unity-package/com.eunsung.teamforge/CHANGELOG.md`
- `unity-package/com.eunsung.teamforge/README.md`
- `unity-package/com.eunsung.teamforge/Documentation~/index.md`

Unity Editor가 없어 새 C# Test Source를 실제 Compile/EditMode 통과로 기록하지 않는다.

## 기존 유지 문서의 갱신

- `docs/roadmap.md`
- `docs/project-state.md`
- `docs/architecture-decisions.md`
- `docs/known-issues.md`
- `docs/deployment.md`
- `docs/compatibility.md`
- `docs/protocol-v1.md`
- `docs/protocol-project-transfer-v1.md`
- `docs/phases/phase-3.md`

## 의도적으로 변경하지 않은 역사적 자료

- `Unity-TeamForge-Phase3-v0.4.0.zip`
- `Unity-TeamForge-Phase3-v0.4.0.zip.sha256`
- `docs/phase-3-test-report.md`
- `docs/phase-3-manual-test-checklist.md`
- Phase 0~2 ZIP/보고서/수동 Checklist

Phase 4 Hierarchy Source는 추가하거나 수정하지 않았다.


## 2026-08-04 Unity field hotfix addendum

- `Editor/ProjectTransfer/TeamForgeProjectModel.cs` — add a distinct retained-baseline/no-seed state and availability policy.
- `Editor/ProjectTransfer/TeamForgeProjectService.cs` — return the new state after the last selectable seed exits while retaining verified baseline metadata.
- `Editor/UI/TeamForgeWindow.cs` — display precise baseline-missing versus seed-offline status and guidance.
- `Tests/Editor/TeamForgeEditorSurfaceTests.cs` — fully qualify Package Manager `PackageInfo`; add state/text regressions.
- `scripts/validate-repository.mjs` — statically prevent the CS0104 reference from returning and verify enum/status wiring.
- `scripts/validate-hotfix-windows.ps1` — clean Windows Node + Unity Batch/EditMode gate runner; writes only ignored validation evidence.
- `docs/phase-3-v0.4.1-unity-hotfix-report.md` and work-state records — capture field evidence, decisions, tests, and remaining gates.

Hotfix delta: **3 files added, 21 modified, 0 deleted** relative to the supplied final archive.
