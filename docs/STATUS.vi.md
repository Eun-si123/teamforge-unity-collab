# Trạng thái hiện tại của TeamForge

> Cập nhật mã nguồn ngày 26-11-2026 (không phải bản phát hành mới): #643 sửa lỗi lấy lại khóa Transform, #617 và #618 tăng cường xác minh bằng chứng thực tế. Cả ba PR đã hợp nhất vào main. r11 chứa M1–M4, gồm khôi phục SQLite tùy chọn, và đã vượt qua xác minh tự động ZIP chính xác; r10 không thay đổi. Kiểm thử tính năng mới trên hai Editor Windows vật lý, định danh ZIP đã cài đặt và kiểm thử tải kéo dài vẫn chưa thực hiện. M5 mới triển khai một phần: xem trước thay đổi đã lưu của Host #586 và duyệt cập nhật Guest có chữ ký #578. Tích hợp #620 vẫn là bản nháp chưa hợp nhất; chuyển đổi M4→M5 khi đang chạy và đồng bộ trực tiếp Prefab bất kỳ chưa hoàn tất. Cập nhật này được ưu tiên hơn bản dịch lịch sử bên dưới. Trạng thái: FIELD BLOCKED. [STATUS.md](STATUS.md)

> **Cập nhật mã nguồn ngày 22/11/2026 (không phải bản phát hành mới):** Các PR #578, #611, #610, #613 và #608 đã được hợp nhất vào main. #612 cũng đã được hợp nhất; #607 về chỉnh sửa gốc trong Unity vẫn là bản nháp. Đồng bộ Prefab bên ngoài theo thời gian thực và kiểm thử trên hai máy Windows thực tế vẫn chưa hoàn tất. Tệp ZIP r11 đã phát hành không thay đổi; trạng thái vẫn là **FIELD BLOCKED**. Xem [trạng thái tiếng Anh mới nhất](STATUS.md).

> **r11 release update (2026-11-21):** [r11 Windows test ZIP](https://github.com/Eun-si123/teamforge-unity-collab/releases/tag/v0.5.1-prealpha-wp5.1-r11) passed exact ZIP validation, but new M1–M4 functions have NOT passed two-physical-PC Windows tests; **FIELD BLOCKED** remains. The text below is a dated translation snapshot; refer to the [current English STATUS](STATUS.md) for up-to-date claims.

[English](STATUS.md) · [Cách hoạt động](HOW_IT_WORKS.vi.md)

_Bản dịch xem trước này đã được đối chiếu với `STATUS.md` tiếng Anh chuẩn ngày 2026-11-20. Với bằng chứng chi tiết, Issues và quyết định hiện tại, bản tiếng Anh là nguồn chuẩn._

**Cập nhật mã nguồn 2026-11-20:** M4 (#572) đã hợp nhất khả năng khôi phục Session tùy chọn bằng SQLite. Thử nghiệm r9/r10 trên hai PC Windows thật cho cộng tác cơ bản và kết nối lại đã được thực hiện với báo cáo PASS; chưa kiểm tra M4. Gói r10 đã phát hành không thay đổi và trạng thái vẫn là **FIELD BLOCKED**.


> **Bản xem trước công khai sớm: không dùng TeamForge làm bản sao duy nhất hoặc cơ chế khôi phục duy nhất cho một Unity Project quan trọng.** Hãy giữ backup và ưu tiên Project thử nghiệm có thể bỏ đi.

> **2026-10-20 r9 field evidence:** Published r9 passed exact-release validation; user-reported two-PC basic collaboration and Guest reconnect PASS. Full recovery/negative field gate remains BLOCKED. [Current detail](https://github.com/Eun-si123/teamforge-unity-collab/blob/main/docs/STATUS.md).
> **2026-11-04 r10 user-reported two-PC field signal (not a package certification):** Basic Host/Guest collaboration, receive/reconnect, access-code rejection and one long destination were reported PASS; separate installed ZIP hashes were **not** checked on both machines. The published r10 ZIP passed [automated Exact Release Validation #41630492102](https://github.com/Eun-si123/teamforge-unity-collab/actions/runs/41630492102), but an actual Guest Wi-Fi/NIC outage was **NOT RUN** ([#457](https://github.com/Eun-si123/teamforge-unity-collab/issues/457)) and repeated Launcher startup exposed a defect (fixed in later source [#456](https://github.com/Eun-si123/teamforge-unity-collab/pull/456), **not** in r10). Full field readiness is **FIELD BLOCKED**. [Dated evidence](PHYSICAL_FIELD_EVIDENCE_2026-11-04_R10.md).

## Tóm tắt hiện tại

- Dòng sản phẩm: `0.5.1`
- Source lineage: `0.5.1-wp5.1-path-resilience`
- Candidate mới nhất đã phát hành: `v0.5.1-prealpha-wp5.1-r11`
- Source commit r11: `5868efe02975aa94b2acd79f5dec39a7b830aa26`
- Windows ZIP: `Unity-TeamForge-0.5.1-WP5.1-path-resilience-candidate-r11-win-x64.zip`
- SHA-256: `28774bccb9fb20da0d72fce38d9bab7645dac1b876de182fbd33ee421170a989`
- Target: Windows x64
- Trạng thái sẵn sàng phát hành: **FIELD BLOCKED**
- Dòng Unity: `6000.3` (Editor thử nghiệm đã ghi nhận: `6000.3.21f1`)
- Realtime / Project Transfer / Project Manifest: **v1**

## Tích hợp M1 trong mã nguồn: cùng chỉnh sửa Collider

M1 cần được bật rõ ràng trong mã nguồn và không nằm trong ZIP r10 đã phát hành. Nó chia sẻ trigger, center và size/radius của BoxCollider/SphereCollider trong Scene đã lưu, không phải Prefab, qua luồng thực tế: xác minh byte Scene/meta có chữ ký → Server Authority → WebSocket → Unity Editor. Sau lần tiếp nhận đầu tiên, chỉnh sửa liên tục khi chưa lưu dùng ledger của máy chủ, revision/history chung và khóa GameObject. Cửa sổ Collider Collaboration cung cấp Undo/Redo có điều kiện cho thay đổi của chính mình và hộp khôi phục để xem xét rồi chủ động gửi lại giá trị cục bộ chưa được xác nhận. Commit máy chủ, báo cáo áp dụng của Editor và lưu đĩa là các trạng thái riêng.

Bằng chứng có bốn giai đoạn. **Triển khai**: M1 đã được gộp vào main qua [PR #533](https://github.com/Eun-si123/teamforge-unity-collab/pull/533). **Kiểm chứng tự động**: các thử nghiệm Node WebSocket thực đã đạt. **Tích hợp Unity**: [CI cho mã nguồn chính xác](https://github.com/Eun-si123/teamforge-unity-collab/actions/runs/43329700733) đã đạt cho chỉnh sửa Collider, Undo có điều kiện và kết nối lại bằng một Editor thực cùng peer Node trên ba phiên bản Unity; chạy Unity cục bộ trên Linux vẫn NOT RUN. **Gói và Windows thực tế**: thử nghiệm với hai Editor trên máy vật lý và gói mới vẫn **NOT RUN**. ZIP r10 đã phát hành không thay đổi, trạng thái vẫn **FIELD BLOCKED**. Thêm/xóa M2 [#559](https://github.com/Eun-si123/teamforge-unity-collab/pull/559) cùng bản sửa tham gia muộn [#565](https://github.com/Eun-si123/teamforge-unity-collab/pull/565) đã được gộp vào main ngày 2026-11-18 dưới dạng tính năng mã nguồn phải bật thủ công, mặc định tắt. CI với một Editor thực và peer Node đã đạt ở ba phiên bản Unity; hai Editor trên máy vật lý và gói mới vẫn **NOT RUN**. Bản r10 đã phát hành không có M1/M2. Ngày 2026-11-19, M3 tạo/xóa Cube/Sphere tích hợp dùng chung đã được gộp vào main qua PR #569 dưới dạng tính năng mã nguồn phải bật thủ công. CI với Editor thực và peer Node đạt trên ba phiên bản Unity (40 kiểm tra PR). Hai Editor vật lý và gói mới vẫn NOT RUN; r10 đã phát hành không có M3, trạng thái FIELD BLOCKED.

Giới hạn: một Scene mỗi Session, 128 Session giữ trong bộ nhớ, 512 Collider/1536 thuộc tính và giá trị hữu hạn ±100/0–100. Trường chưa hỗ trợ vẫn chỉ ở cục bộ. Thêm/xóa Component, Prefab và xóa chủ sở hữu Collider đã tham gia hoặc đối tượng tổ tiên cần M2 và bị từ chối trong luồng M1 đang hoạt động. Người chỉnh sửa phải thương lượng và tham gia khả năng tương thích. Ledger vẫn trong bộ nhớ sau khi mọi peer ngắt kết nối nhưng **mất khi máy chủ khởi động lại nếu chưa bật M4**. Chế độ M4 tùy chọn đã hợp nhất lưu trạng thái Session được xác nhận vào SQLite. Hai Unity Editor, late join ba người, lưu/mở lại, tám Editor trong một giờ và đúng gói Windows vẫn là các kiểm chứng riêng chưa hoàn tất. M2/M3/M4 đã được hợp nhất vào mã nguồn; cần kiểm chứng riêng các tính năng mới trên thiết bị thật. Xem [STATUS tiếng Anh](STATUS.md) và [cấu hình](../server/README.md).

## Bản phát hành r8 và phạm vi bằng chứng

r8 được phát hành ngày 2026-10-10, bao gồm các bản sửa PR #209 về kiểm tra trạng thái Direct Seed, mở lại Existing-Active đã xác minh và từ chối thư mục gốc Project lồng nhau. Tệp ZIP đã phát hành vượt qua Windows Exact Release Validation (lần chạy 38019297086), nhưng **r8 chưa được kiểm thử trên hai máy Windows thực tế**; trạng thái vẫn là **FIELD BLOCKED**. Các kết quả r7 dưới đây chỉ là bằng chứng lịch sử, không chứng minh r8 hoạt động trên hai máy. PR #217 và #219 được hợp nhất sau đó nên không nằm trong ZIP r8.

## Giới hạn bằng chứng của r7

r7 được phát hành ngày 2026-10-03 từ commit d88ca4c41ecf1f9cc7aa5d349960f407f158ce9a và sau đó vượt qua **Exact Release Validation** trên Windows. Quy trình tự động tải lại ZIP Release, xác minh SHA-256 và từng hash trong release manifest, giải nén mới vào path có ký tự tiếng Hàn và khoảng trắng từ một working directory khác, rồi xác minh Runtime/Node đóng gói, hành vi fail-closed của Launcher, Windows path resilience và junction thực.

Đây là **bằng chứng tự động cho đúng gói đã phát hành**. Trong lần thử vật lý sau đó với Host r6 và Guest r7 chính xác, Guest đã dùng lại managed root hiện có mà không gặp `destination_contains_unmanaged_content`; sau khi đổi profile LAN tin cậy của Host từ Public sang Private, luồng đã đi qua Publisher trust, Project receive và mở Unity đến khi người dùng báo TeamForge đã kết nối. Điều này vẫn chưa chứng minh exact r7 trên cả hai PC, onboarding UAC mới không nâng quyền, fallback cổng Seed hay Project identity recovery vật lý sau mất process bất thường. Vì vậy trạng thái vẫn là FIELD BLOCKED.

Bằng chứng vật lý r5 ngày 2026-08-31 vẫn hợp lệ cho các kịch bản thực sự đã chạy: reconnect, late join, receive/resume, long path, lock contention và Seed `5091`/transfer. Việc phát hành r7 không thay đổi bytes hay kết quả lịch sử của r5.

## Các trở ngại r7-on-Host tiếp theo và kiểm thử lại r8

Các thử nghiệm vật lý tiếp theo phát hiện `baseline_unavailable` khi Host vẫn hiển thị Ready nhưng không có Direct Project Peer có thể tìm thấy, `DirectoryNotFoundException` do path dài khi mở Project đã xác minh có sẵn. Việc xem xét Source cũng phát hiện nguy cơ UUID lồng nhau khi chọn thư mục của một Project làm Projects root.

PR #209 được hợp nhất vào `main` ngày 2026-10-08; các bản sửa **đã nằm trong ZIP r8 được phát hành**. r8 đạt Windows Exact Release Validation (run 38019297086), nhưng vẫn cần kiểm thử lại trên hai PC Windows thực: thu hồi Ready khi mất Direct Seed, mở lại Existing-Active qua đường dẫn ngắn và từ chối thư mục Project UUID làm Projects root. Nguyên nhân mất Seed ban đầu chưa được xác nhận. PASS mixed r6/r7 trước đó chỉ có giá trị trong phạm vi ban đầu; trạng thái vẫn là **FIELD BLOCKED**.

[PR #209](https://github.com/Eun-si123/teamforge-unity-collab/pull/209) · [English evidence/status](https://eun-si123.github.io/teamforge-unity-collab/status/#later-r7-on-host-blockers-now-packaged-for-r8-retest)

## Phạm vi hiện tại

Presence, Selection, đồng bộ Transform, lock/ownership cơ bản, các thao tác Same-Scene Hierarchy được hỗ trợ, Project transfer P2P trực tiếp, UX chẩn đoán/phục hồi và Windows path resilience đã được triển khai hoặc đang ổn định hóa. r7 còn bao gồm Windows firewall onboarding post-r5, fallback khi Seed port bận/không khả dụng, Windows Project identity crash recovery, diagnostics bổ sung và feedback SceneView `TeamForge · Locked by <owner>`.

Đồng bộ Component/Inspector tổng quát, Prefab/Asset tổng quát và Internet NAT traversal/relay tự động vẫn chưa được hỗ trợ. M4 lưu Session bền vững tùy chọn đã có trong mã nguồn nhưng chưa được kiểm chứng trên hai Editor vật lý hay gói phát hành mới.

## Kiểm chứng vật lý còn lại

1. Giải nén mới **đúng r11** trên hai PC Windows và kiểm tra Firewall onboarding/UAC, rule giới hạn Private + `LocalSubnet` cùng lifecycle.
2. Tạo xung đột/không khả dụng cho Seed port ưu tiên; xác nhận endpoint thực sự được quảng bá sau fallback có thể truy cập, cùng Host Stop/Start và Fresh Guest transfer.
3. Mô phỏng mất process bất thường trong Project identity và xác nhận recovery an toàn, đồng thời identity mơ hồ/xung đột vẫn fail closed.
4. Chạy Fresh Host → Fresh Guest → Unity realtime smoke; kiểm tra feedback foreign-lock dễ hiểu và biến mất sau release/takeover.
5. Giữ #182 là theo dõi CI gián đoạn, không che bằng retry/skip; #79 tiếp tục theo dõi UX cho chuyển động SceneView tạm thời.

## Nguồn tham chiếu

Chi tiết capability, blocker và bằng chứng: [English STATUS](STATUS.md); lựa chọn chính xác: [`release-contract.json`](../release-contract.json); byte identity đã phát hành: [`builds/README.md`](../builds/README.md) và SHA-256 của GitHub Release.
