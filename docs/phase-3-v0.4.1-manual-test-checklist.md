# Phase 3 v0.4.1 수동 시험 체크리스트

목표 Editor는 Unity `6000.3.21f1`, 제품은 `0.4.1`, Realtime/Transfer/Manifest Protocol은 모두 `1`이다. 이 문서의 항목은 v0.4.1 새 ZIP에서 직접 확인하기 전까지 모두 미통과다. v0.4.0의 성공 결과를 v0.4.1 통과로 복사하지 않는다.

## 1. 시험 기록

- [ ] 시험 날짜, Windows 버전, Unity Hub/Editor 경로를 기록했다.
- [ ] Node `v24.18.1`과 npm 버전을 기록했다.
- [ ] Coordinator 주소, `/ws`, Seed Endpoint는 Launch Settings/환경 설정에서 읽었으며 Source에 하드코딩하지 않았다.
- [ ] v0.4.1 ZIP SHA-256을 확인하고 새 폴더에 풀었다.
- [ ] Server, Project Peer, Unity Package가 모두 `0.4.1`이며 Protocol은 `1`이다.
- [ ] v0.4.0 ZIP/Checksum/보고서와 기존 Unity Project/Active Revision/Owner Key Backup이 보존돼 있다.

## 2. 시험 Source Project

- [ ] Unity `6000.3.21f1` 새 Project를 만들었다.
- [ ] `SampleScene`을 저장하고 `Cube`를 생성한 뒤 저장했다.
- [ ] `Packages/com.eunsung.teamforge`에 v0.4.1 Package를 Embedded로 복사했다.
- [ ] `Packages/com.eunsung.teamforge/package.json`의 name/version이 `com.eunsung.teamforge`/`0.4.1`이다.
- [ ] `Packages/manifest.json`, `Packages/packages-lock.json`, 모든 필요한 `.meta`가 있다.
- [ ] Source Project Compile Error가 0개다.
- [ ] Unity를 저장 후 정상 종료했다. Import/Compile 중 Publish하지 않았다.

## 3. Publish Revision 1

Bearer Token은 명령줄 인자나 Launch Settings에 넣지 않고 로컬 환경 변수로 설정한다.

```powershell
$env:TEAMFORGE_AUTH_TOKEN = "<local-server-token>"
node project-peer/src/cli.mjs publish `
  --launch-settings "C:\path\to\teamforge-project-peer.launch.json" `
  --host 0.0.0.0 --port 5091 `
  --endpoint "http://<seed-host>:5091/teamforge-transfer/v1"
```

- [ ] Publish Preview에 `com.eunsung.teamforge 0.4.1`이 표시된다.
- [ ] Embedded Package File/Byte/Chunk 수가 0보다 크다.
- [ ] Preview File에 `Packages/com.eunsung.teamforge/package.json`, Editor/Runtime/Tests/Documentation 및 `.meta`가 포함된다.
- [ ] `Packages/manifest.json`과 `Packages/packages-lock.json`이 포함된다.
- [ ] `.env`, Owner Private Key, Bearer/Transfer Token, `Library`, `UserSettings`가 포함되지 않는다.
- [ ] 명시 확인 뒤 Revision 1 Publish가 성공한다.
- [ ] Signed Invite를 만들고 Bearer Token은 Invite와 다른 안전 채널로 전달한다.

## 4. 완전히 새 Receiver Root Sync

기존 Source Project나 이전 Active를 Receiver Root로 사용하지 않는다.

```powershell
$env:TEAMFORGE_AUTH_TOKEN = "<local-server-token>"
node project-peer/src/cli.mjs sync `
  --managed-root "C:\TeamForge-v041-Receiver" `
  --invite "C:\path\to\teamforge-invite.json"
```

- [ ] Publisher Fingerprint와 출처를 확인하고 신뢰를 명시 승인했다.
- [ ] Sync 출력이 `state: Complete`다.
- [ ] Manifest, 모든 File Hash, 모든 Chunk Hash 검증이 성공했다.
- [ ] Active 생성 전/직후 아래 PowerShell 검사가 모두 기대값이다.

```powershell
$Active = "C:\TeamForge-v041-Receiver\<project-uuid>\active\<revision>-<hash>"
Test-Path "$Active\Assets"
Test-Path "$Active\Packages"
Test-Path "$Active\ProjectSettings"
Test-Path "$Active\Packages\com.eunsung.teamforge\package.json"
Test-Path "$Active\Library"
Test-Path "$Active\UserSettings"
Get-ChildItem $Active -Recurse -Force | Where-Object {
  $_.Name -match '^\.env' -or $_.Name -match 'owner-key|auth-token|bearer-token'
}
```

기대값은 앞의 네 항목 `True`, `Library`/`UserSettings` `False`, Secret 검색 결과 0개다.

- [ ] `ProjectSettings/TeamForgeProject.json`의 UUID/Revision/Manifest/Descriptor/Unity/Package/Protocol 값이 서명 Descriptor와 일치한다.
- [ ] Source Project와 기존 Receiver Project, 이전 Active Pointer가 변경되지 않았다.
- [ ] Coordinator Server Disk/Volume에 Assets/Package/Scene/Archive/Chunk가 생성되지 않았다.

## 5. Unity에서 Active 열기

Unity Hub에서 출력된 정확한 `active/<revision>-<hash>` 폴더를 연다.

- [ ] 첫 실행 전 `Library`와 `UserSettings`가 없었음을 기록했다.
- [ ] Unity가 새 `Library`를 생성한 뒤 Compile Error는 0개다.
- [ ] SampleScene과 Cube가 존재한다.
- [ ] Package Manager/PackageInfo에서 TeamForge `0.4.1`이 보인다.
- [ ] `Window > TeamForge > Collaboration` 메뉴와 창이 정상이다.
- [ ] 사용자가 TeamForge Package를 수동 재설치하지 않았다.
- [ ] Token을 로컬 설정에 입력하고 Coordinator가 `Connected`다.
- [ ] RTT가 표시된다.
- [ ] 동일 Project ID/Session ID의 참가자/Presence와 Phase 2 기능에 새 회귀가 없다.

## 6. Unity Compile/EditMode Batch

```powershell
$Unity = "C:\Program Files\Unity\Hub\Editor\6000.3.21f1\Editor\Unity.exe"
$Out = "C:\TeamForge-v041-TestResults"
New-Item -ItemType Directory -Force $Out | Out-Null

& $Unity -batchmode -nographics `
  -projectPath $Active `
  -quit `
  -logFile "$Out\compile.log"

& $Unity -batchmode -nographics `
  -projectPath $Active `
  -runTests `
  -testPlatform EditMode `
  -testResults "$Out\editmode-results.xml" `
  -logFile "$Out\editmode.log"
```

- [ ] 두 Process Exit Code가 0이다.
- [ ] Compile Error 0이다.
- [ ] EditMode Fail 0이다.
- [ ] `TeamForgeEditorSurfaceTests`가 Package name/version, Editor Assembly, MenuItem과 v0.4.0 Descriptor 거부를 통과한다.

## 7. 중단·재개와 일시 오류

- [ ] 새 Receiver Root에서 기본 `--concurrency 4`로 다운로드를 시작한다.
- [ ] 일부 Chunk 뒤 Receiver Process를 종료하거나 Network를 일시 차단한다.
- [ ] Failure Staging과 기존 Active가 보존된다.
- [ ] 같은 Receiver Root로 다시 Sync한다.
- [ ] 로그에 `resumed=<N>`이 0보다 크고 기존 검증 Chunk를 다시 요청하지 않는다.
- [ ] 남은 Chunk만 받아 Complete/Active가 된다.
- [ ] 가능하면 Seed가 의도적으로 429 또는 일시 503을 반환하도록 안전한 Test 환경을 구성하고 Attempt/RetryMs/Status를 확인한다.
- [ ] Seed A를 종료한 뒤 Seed B가 남은 Chunk를 완료한다.
- [ ] 로그의 Chunk Hash는 Prefix만 보이고 Bearer Token/Invite Secret/Transfer Token/Private Key/raw body는 없다.
- [ ] 모든 Direct Peer가 영구 오류면 Server Disk Relay로 바뀌지 않고 명확히 실패한다.

## 8. `(GetStatus)` 비교 시험

TeamForge Source에는 Unity Progress API 사용이 없으므로 현재 판정은 `원인 미확정, 기능 영향 없음으로 관측`이다. 다음 비교 전 Unity 버그나 TeamForge 버그로 확정하지 않는다.

- [ ] Active의 일회용 복사본 A는 TeamForge Package를 유지한다.
- [ ] 일회용 복사본 B는 Package dependency와 Embedded Package를 안전하게 제거한다.
- [ ] A/B 모두 첫 실행 전 `Library`와 `UserSettings`가 없다.
- [ ] A/B의 첫 실행에서 Search Index/Import 종료 시각과 Console/Editor.log를 저장한다.
- [ ] A/B의 두 번째 실행에서도 같은 메시지가 재발하는지 기록한다.
- [ ] 메시지가 있어도 Compile/Menu/Connect/RTT/Scene 기능 영향을 별도로 기록한다.

참고 정황으로 Unity Issue Tracker에는 새 Project의 첫 Background Task 종료 때 같은 계열 메시지가 보고돼 있지만, 해당 보고는 Unity 6000.3.21f1의 이번 사례 원인을 확정하지 않는다.

## 9. Phase 4 Gate

아래가 모두 확인되기 전 Phase 4를 시작하지 않는다.

- [ ] 새 ZIP Embedded Package Publish→Sync 후 package.json 존재
- [ ] 다운로드 Active의 Unity Compile 성공
- [ ] TeamForge 창 실행과 Coordinator Connected/RTT
- [ ] Retry 또는 안전한 Resume 실기 성공
- [ ] 기존 Active/Project 보존
- [ ] 치명적·높음 등급 회귀 0
- [ ] 사용자에게 결과 보고 후 Phase 4 별도 승인


## Unity field hotfix checks

- [ ] Package tests are enabled in the validation project and Unity 6000.3.21f1 reports no CS0104 for `PackageInfo`.
- [ ] EditMode `BootstrapAvailabilityAndStatusTextSeparateMissingBaselineFromOfflineSeed` passes.
- [ ] Before first Publish, Bootstrap State says `No verified baseline has been published`.
- [ ] With matching baseline and Seed online, Bootstrap State says `Identity and baseline metadata match`.
- [ ] After stopping the final Seed sidecar, the same project says `Verified baseline exists · no direct seed is online`.
- [ ] Stopping the Seed does not disconnect Presence, Transform, Lock, or Coordinator RTT.
- [ ] Restarting `seed`/`publish` restores the Ready state without changing Project UUID, baseline revision, or manifest hash.


### Bundled clean-host gate

With all Unity Editor instances for the validation Project closed, run from the extracted repository root:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\validate-hotfix-windows.ps1
```

- [ ] Script summary says PASS.
- [ ] Node install/test/smoke/audit all exit 0.
- [ ] Unity compile log has no compiler errors.
- [ ] EditMode XML reports Failed 0.
- [ ] `validation-output` contains logs/results only and is not included in Publish or a release ZIP.


### Hotfix3 Unity EditMode rerun

- [ ] EditMode `Run All` reports Failed 0 on Unity 6000.3.21f1.
- [ ] No `Unloading the last loaded scene ... is not supported` message is emitted by TeamForge scene fixtures.
- [ ] `SavedSceneObjectIdSurvivesReparentAndReloadWhileDuplicateGetsNewId` reaches and passes its post-reload GlobalObjectId assertion.
- [ ] `CleanSceneBaselineExcludesObjectsCreatedAfterCapture` rejects an explicitly dirty Scene and still excludes post-baseline objects after save.
- [ ] `RemoteApplyClearsOnlyTargetUndoAndCannotResurrectStaleTransform` never resurrects the stale target value even if a cleared target Undo group remains as a no-op.
- [ ] `RemoteApplyToPrefabInstanceRecordsOverrideAndSurvivesReload` reaches and passes the post-reload Prefab override assertions.
