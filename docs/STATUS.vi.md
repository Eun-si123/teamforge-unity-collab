# Trạng thái hiện tại của TeamForge

[English](STATUS.md) · [Cách hoạt động](HOW_IT_WORKS.vi.md)

_Bản dịch xem trước này đã được đối chiếu với `STATUS.md` tiếng Anh chuẩn ngày 2026-10-03. Với bằng chứng chi tiết, Issues và quyết định hiện tại, bản tiếng Anh là nguồn chuẩn._

> **Bản xem trước công khai sớm: không dùng TeamForge làm bản sao duy nhất hoặc cơ chế khôi phục duy nhất cho một Unity Project quan trọng.** Hãy giữ backup và ưu tiên Project thử nghiệm có thể bỏ đi.

## Tóm tắt hiện tại

- Dòng sản phẩm: `0.5.1`
- Source lineage: `0.5.1-wp5.1-path-resilience`
- Candidate mới nhất đã phát hành: `v0.5.1-prealpha-wp5.1-r6`
- Source commit r6: `b479244a40ebf3f1e56787edd044d06b2d050e2b`
- Windows ZIP: `Unity-TeamForge-0.5.1-WP5.1-path-resilience-candidate-r6-win-x64.zip`
- SHA-256: `4a411e8769fd39a2cfa46feaf0bb6e711e8fbd1b5c0d98b5e74a93d7ebf3a64a`
- Target: Windows x64
- Trạng thái sẵn sàng phát hành: **FIELD BLOCKED**
- Dòng Unity: `6000.3` (Editor thử nghiệm đã ghi nhận: `6000.3.21f1`)
- Realtime / Project Transfer / Project Manifest: **v1**

## Giới hạn bằng chứng của r6

r6 được phát hành ngày 2026-10-03 từ commit trên và sau đó vượt qua **Exact Release Validation** trên Windows. Quy trình tự động tải lại ZIP Release, xác minh SHA-256 và từng hash trong release manifest, giải nén mới vào path có ký tự tiếng Hàn và khoảng trắng từ một working directory khác, rồi xác minh Runtime/Node đóng gói, hành vi fail-closed của Launcher, Windows path resilience và junction thực.

Đây là **bằng chứng tự động cho đúng gói đã phát hành**. Nó chưa chứng minh Firewall/UAC trên hai PC vật lý, khả năng truy cập LAN thực, Project identity recovery sau mất process bất thường hay luồng đầy đủ Host → Guest → realtime. Vì vậy trạng thái vẫn là FIELD BLOCKED.

Bằng chứng vật lý r5 ngày 2026-08-31 vẫn hợp lệ cho các kịch bản thực sự đã chạy: reconnect, late join, receive/resume, long path, lock contention và Seed `5091`/transfer. Việc phát hành r6 không thay đổi bytes hay kết quả lịch sử của r5.

## Phạm vi hiện tại

Presence, Selection, đồng bộ Transform, lock/ownership cơ bản, các thao tác Same-Scene Hierarchy được hỗ trợ, Project transfer P2P trực tiếp, UX chẩn đoán/phục hồi và Windows path resilience đã được triển khai hoặc đang ổn định hóa. r6 còn bao gồm Windows firewall onboarding post-r5, fallback khi Seed port bận/không khả dụng, Windows Project identity crash recovery, diagnostics bổ sung và feedback SceneView `TeamForge · Locked by <owner>`.

Đồng bộ Component/Inspector tổng quát, Prefab/Asset tổng quát, persistent server/session restart recovery và Internet NAT traversal/relay tự động hiện chưa được hỗ trợ.

## Kiểm chứng vật lý còn lại

1. Giải nén mới **đúng r6** trên hai PC Windows và kiểm tra Firewall onboarding/UAC, rule giới hạn Private + `LocalSubnet` cùng lifecycle.
2. Tạo xung đột/không khả dụng cho Seed port ưu tiên; xác nhận endpoint thực sự được quảng bá sau fallback có thể truy cập, cùng Host Stop/Start và Fresh Guest transfer.
3. Mô phỏng mất process bất thường trong Project identity và xác nhận recovery an toàn, đồng thời identity mơ hồ/xung đột vẫn fail closed.
4. Chạy Fresh Host → Fresh Guest → Unity realtime smoke; kiểm tra feedback foreign-lock dễ hiểu và biến mất sau release/takeover.
5. Giữ #182 là theo dõi CI gián đoạn, không che bằng retry/skip; #79 tiếp tục theo dõi UX cho chuyển động SceneView tạm thời.

## Nguồn tham chiếu

Chi tiết capability, blocker và bằng chứng: [English STATUS](STATUS.md); lựa chọn chính xác: [`release-contract.json`](../release-contract.json); byte identity đã phát hành: [`builds/README.md`](../builds/README.md) và SHA-256 của GitHub Release.
