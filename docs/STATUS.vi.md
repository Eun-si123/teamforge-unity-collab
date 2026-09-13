# Trạng thái hiện tại của TeamForge

[English](STATUS.md) · [Cách hoạt động](HOW_IT_WORKS.vi.md)

_Lần rà soát tài liệu gốc: 2026-09-10 UTC. Đối chiếu mã nguồn trên `main`, gồm các thay đổi sau r5 về mạng Windows, chẩn đoán và định danh Project, với gói r5 đã phát hành và kết quả thử nghiệm vật lý đúng r5 ngày 2026-08-31. Bằng chứng của gói và của mã nguồn mới hơn vẫn tách biệt._

> **Bản xem trước công khai giai đoạn đầu — không dùng TeamForge làm bản sao duy nhất hoặc cơ chế khôi phục duy nhất cho dự án Unity quan trọng.** Các trở ngại Windows WP5.1 ban đầu đã được kiểm tra vật lý đáng kể trên đúng r5, nhưng `main` mới hơn có thêm hành vi mạng/định danh chưa được kiểm tra cùng nhau trong một gói thay thế chính xác trên PC vật lý. Giữ bản sao lưu và ưu tiên dự án thử có thể bỏ đi.

[English](STATUS.md) là nguồn chính thống dành cho người đọc về khả năng và mức sẵn sàng phát hành. Tài liệu khác nên dẫn đến đây thay vì giữ danh sách trở ngại cạnh tranh. Lựa chọn phiên bản chính xác: [release-contract.json](../release-contract.json); định danh byte và quy tắc bản dựng bị thay thế: [builds/README.md](../builds/README.md); thảo luận lỗi/tái hiện lịch sử: GitHub Issues. Tài liệu chuyên sâu chưa dịch vẫn bằng tiếng Anh.

## Tổng quan

- Dòng sản phẩm: `0.5.1`; dòng mã nguồn: `0.5.1-wp5.1-path-resilience`.
- Gói ứng viên được phát hành gần nhất: `v0.5.1-prealpha-wp5.1-r5`.
- Commit mã nguồn/tag r5: `a97b6ba5649e2888b909bf3c99c64acfd7042ba6`.
- ZIP Windows: `Unity-TeamForge-0.5.1-WP5.1-path-resilience-candidate-r5-win-x64.zip`.
- SHA-256: `5944abf2263502ee40f49d0ac2c8a9826a809dc4cd1b20c9edf82f94ba35f8cc`.
- Đích gói: Windows x64; trạng thái phát hành: **FIELD BLOCKED**, chưa đáp ứng hết điều kiện kiểm chứng thực địa.
- Dòng Unity: `6000.3`; Editor thử ứng viên đã ghi nhận: `6000.3.21f1`.
- Realtime Protocol, Project Transfer Protocol và Project Manifest Schema: mỗi loại **v1**.

## Mã nguồn và gói ứng viên

Các sửa lỗi WP5.1 ban đầu cho #67, #68/#74, #69, #70 và #71 được hợp nhất qua PR #81. r5 từ commit trên bao gồm chúng và phần tích hợp Launcher **Save support bundle** bổ sung sau r4.

Ngày 2026-08-31, đúng r5 được chạy trên hai PC Windows vật lý: Guest đã lưu kết nối lại, Guest mới tham gia muộn nhận snapshot Transform, nhiều lần ngắt nhận/tiếp tục, bàn giao đường dẫn dài/sâu qua execution alias và phục hồi xung đột được bảo vệ do tranh chấp lock cũ. Khi có quyền tường lửa cần thiết, Host Stop/Start gắn lại Seed TCP `5091` và truyền Project thật tới Guest cũng được xác nhận vật lý.

Các tình huống này không còn chờ lần chạy lại vật lý r5 đầu tiên. Điều đó không đưa thay đổi mã mới vào r5, cũng không biến sản phẩm thành alpha có thể cài đặt rộng rãi. Phát biểu về gói phải dùng r5 và bằng chứng ngày 2026-08-31; không coi r5 tương đương `main` về byte hay hành vi. Không liệt kê lại các tình huống r5 đã đóng chỉ vì văn bản cũ còn ghi chờ. Nếu phân phối `main`, cần xuất bản ứng viên bất biến mới rồi kiểm tra hành vi thực sự thêm sau r5 trên đúng hiện vật đó.

## Gia cố sau r5 chưa có trong gói r5

- Thiết lập tường lửa LAN Windows có thể tạo quy tắc vào Coordinator/Seed hẹp sau đồng ý rõ ràng của người dùng và UAC, giới hạn ở hồ sơ Private và LocalSubnet, cùng đối soát/dọn quy tắc thuộc TeamForge. Thử r5 còn cần cấp quyền thủ công; luồng mới cần bằng chứng vật lý trên đúng gói.
- Cổng Seed ưu tiên/mặc định bận hoặc không dùng được, kể cả `EACCES` khi bind Windows: Host thử lại một lần với cổng OS cấp và công bố endpoint đã chọn. Có kiểm thử tự động Windows Project Peer; hành vi này mới hơn r5.
- Tuần tự hóa tạo định danh Project và khôi phục crash Windows bằng live lock named-pipe do OS sở hữu, kèm hàng rào tương thích vĩnh viễn cho trình ghi cũ. Bộ thử crash/đồng thời Windows Node 22/24 đã đạt; chưa gói phát hành nào chứa thay đổi này có bằng chứng vật lý chính xác.
- Dọn khi Coordinator từ chối, gia cố hủy/hạn HTTP, ngữ cảnh chẩn đoán Host, log vai trò client WebSocket và phân biệt lời mời Launcher với mã kết nối `TF1`.

Đây là sự thật về nguồn/tự động hóa, không phải hành vi gói r5. Phục hồi lock định danh Project cũ trên Linux/macOS cũng nằm ngoài thay đổi riêng Windows này.

## Khả năng

| Lĩnh vực | Trạng thái nguồn | Giới hạn bằng chứng |
| --- | --- | --- |
| Presence người dùng kết nối | Đã triển khai/thử | Luồng cơ sở hai PC vật lý hoạt động; thử ngoài rộng hơn vẫn hữu ích |
| Lựa chọn/nhận biết Editor | Đã triển khai/thử | Thử ngoài rộng hơn vẫn hữu ích |
| Đồng bộ Transform | Đã triển khai/đang ổn định | r5 tham gia muộn và phục hồi tranh chấp PASS; còn mở rộng thực địa và UX |
| Lock/ownership cơ bản | Đã triển khai/đang ổn định | r5 tranh chấp/phục hồi PASS; UX chỉnh sửa khi người khác giữ lock: #79 |
| Hierarchy cùng Scene: tạo/xóa/đổi tên/đổi cha/thứ tự | Đã triển khai/đang ổn định | Tập con hỗ trợ đã thử vật lý; cần thêm độ bao phủ |
| Bootstrap Project/Collaboration Invite | Đã triển khai/đang ổn định | r5 Guest đã lưu PASS; khôi phục định danh mới thiếu bằng chứng gói/thực địa |
| Truyền Project P2P trực tiếp | Đã triển khai/đang ổn định | r5 `5091` Stop/Start và truyền PASS; tường lửa/cổng mới thiếu chứng cứ gói thay thế |
| Chẩn đoán/UX khôi phục | Đã triển khai/đang ổn định | r5 có gói hỗ trợ bảo vệ riêng tư; cải tiến sau chỉ ở nguồn so với r5 |
| Chịu lỗi đường dẫn Windows/execution alias | Đã triển khai/đang ổn định | r5 bàn giao dài/sâu PASS; từ chối alias độc hại/không liên quan là kiểm thử fail-closed tự động |
| Component/Inspector | Dự kiến | Chưa hỗ trợ thêm/xóa Component tổng quát hay đồng bộ `SerializedProperty` |
| Prefab/Asset tổng quát | Dự kiến | Không phải luồng đang được hỗ trợ |
| Khôi phục bền vững sau restart server/session | Dự kiến | Authority/session vẫn trong bộ nhớ |
| NAT traversal Internet/relay tự động | Nghiên cứu/tương lai | Không có WebRTC, ICE, STUN, TURN, relay, discovery hay NAT traversal tự động |

## Kết quả đóng trên đúng r5 vật lý

Bảng thay thế cách diễn đạt cũ rằng các trở ngại ban đầu vẫn chờ kiểm tra vật lý.

| Issue | Kết quả và ranh giới hiện tại |
| --- | --- |
| [#67](https://github.com/Eun-si123/teamforge-unity-collab/issues/67) | **PASS**: chỉnh sửa/lưu hợp lệ cùng nhau → đóng Guest Unity → mở lại cùng Active Project đã xác minh → vào realtime không có `guest_handoff_mismatch`. Định danh mới/chưa xác minh vẫn bị từ chối bởi triển khai nghiêm ngặt và hồi quy tự động |
| [#68](https://github.com/Eun-si123/teamforge-unity-collab/issues/68) | **PASS**: Guest mới nhận Hierarchy/Transform/Lock có thẩm quyền và Transform về sau mà không có xung đột được bảo vệ giả. Thêm tình huống vẫn hữu ích; trở ngại gốc đã đóng |
| [#74](https://github.com/Eun-si123/teamforge-unity-collab/issues/74) | **PASS**: bên thua tranh chấp về trạng thái có thẩm quyền, cộng tác vẫn dùng được. UX lock người khác theo dõi riêng ở #79 |
| [#69](https://github.com/Eun-si123/teamforge-unity-collab/issues/69) | **PASS**: buộc tắt Launcher nhiều lần khi nhận; tái dùng phần đã xác minh, tiếp tục hoàn tất không tái hiện lỗi CLR/ứng dụng ban đầu. Giữ hồi quy khi Runtime thay đổi |
| [#70](https://github.com/Eun-si123/teamforge-unity-collab/issues/70) | **MỘT PHẦN CHO MỤC TIÊU r5 / PASS CHO SEED ỔN ĐỊNH**: Host Stop/Start gắn lại TCP `5091`; truyền thật thành công sau quyền tường lửa. Thiết lập tự động mới và fallback cổng cần chứng cứ vật lý đúng gói thay thế |
| [#71](https://github.com/Eun-si123/teamforge-unity-collab/issues/71) | **PASS**: đích dài/sâu kích hoạt tối ưu đường dẫn, Unity mở và cộng tác chạy. Từ chối alias độc hại/không liên quan/đổi đích vẫn là bằng chứng fail-closed tự động |

Mốc thời gian chi tiết thuộc Issues; tác động phát hành hiện tại thuộc STATUS.

## Bằng chứng tự động và cục bộ

Trước khi hợp nhất PR #81, head tích hợp cuối vượt các cổng ghi ở `docs/MAIN_PATCH_STATUS_2026-08-27.md`:

- CI #216: Server, Project Peer, bộ nạp Runtime Launcher, Windows Launcher, hợp đồng nguồn công khai **PASS**.
- Dependency Review #140 **PASS**.
- Unity Tests #73: Unity Lock Contention E2E, Unity Realtime Authority E2E, Realtime Authority Chaos E2E, Project Transfer Resume E2E **PASS**.
- Unity Test Runner cục bộ trước đó: **143/143 bài có thể chạy cục bộ PASS**; hai bài server thật chỉ cho CI cố ý bỏ qua ở máy cục bộ.
- Phục hồi tranh chấp A/B cùng máy **PASS**; hội tụ Hierarchy/Transform A/B/C tham gia muộn **PASS**, không có xung đột được bảo vệ trong lần ghi nhận.

Thay đổi sau được thử bằng Project Peer/Launcher/Unity tập trung và các cổng thông thường. Bộ crash/đồng thời định danh Windows đạt trên Node 22/24 được hỗ trợ; hồi quy cổng Seed không dùng được đạt toàn bộ bộ thử Project Peer ở môi trường Windows tái hiện. Chúng tăng tin cậy nguồn hiện tại, không tạo bằng chứng cho byte gói phát hành trước sửa lỗi.

## Bằng chứng hai PC vật lý

Cơ sở 2026-08-22: Host → lời mời ký → Guest mới → xác thực → truyền trực tiếp → tin cậy Publisher → Active xác minh → Unity realtime; Presence và Transform hai chiều; tranh chấp lock thường; tạo/đổi tên/cha/thứ tự anh em/xóa cùng Scene. Guest thoát/mở lại chưa lưu phục hồi Hierarchy/Transform/Lock từ phiên vẫn chạy. Mất TCP Coordinator → retry → tự nối lại không restart Unity.

Ngày 2026-08-31, cặp ZIP/SHA đúng r5 đóng các tình huống mục tiêu trên hai PC Windows vật lý. Seed `5091` Stop/Start và truyền LAN thật cũng đạt; quyền tường lửa ban đầu lúc đó vẫn thủ công.

## Ranh giới bằng chứng

Kết quả chỉ chứng minh điều đã chạy. CI nguồn không chứng minh ZIP. Tự động hóa Unity không tái hiện mọi thứ tự input SceneView, trạng thái tiến trình Windows, LAN/tường lửa hay thời điểm máy thứ hai. Thử cùng máy dùng chung OS, ngăn xếp mạng, môi trường thời gian và phần cứng. Bằng chứng r5 không chứng minh `main` về sau. Phiên bản không phải định danh byte: cần tên hiện vật và SHA-256 chính xác. Lỗi đã đóng không tự chứng minh thay đổi tiếp theo ở cùng phân hệ đã được thử gói/thực địa. Ghi chép lịch sử đúng cho snapshot của chúng, không thay STATUS hiện tại.

## Điều kiện phát hành còn lại

Trước khi quảng bá alpha có thể cài rộng rãi:

1. Giữ kết quả vật lý r5 #67/#68/#69/#71/#74 là đã hoàn thành.
2. Nếu chọn phân phối `main`, xuất bản ứng viên bất biến mới.
3. Trên đúng hiện vật thay thế, thử thiết lập tường lửa mới, phạm vi/vòng đời quy tắc hẹp, fallback cổng ưu tiên bận/không dùng được, Seed công bố thực sự tới được, Host Stop/Start và truyền Guest mới.
4. Thử khôi phục định danh Windows sau mất tiến trình, restart an toàn và tiếp tục fail-closed với định danh mơ hồ/xung đột trên hiện vật đó.
5. Smoke Host vừa giải nén → Guest mới → cộng tác realtime trên gói thay thế, không mặc nhiên kế thừa bằng chứng r5.
6. Giữ tên/SHA/định danh nguồn chính xác và chỉ ghi tình huống thực sự chạy.
7. Tiếp tục hướng dẫn cài/cập nhật/gỡ và lấy thử nghiệm/rà soát từ người khác ngoài tác giả trước các tuyên bố tin cậy rộng.

Restart tiến trình server hiện là **ngắt kết nối/fail-closed/khôi phục bằng phiên mới**, không phải thử tính bền vững: chưa triển khai khôi phục authority/session bền vững sau restart.

## Nguồn sở hữu thông tin

Khả năng/trở ngại: [English](STATUS.md); phiên bản: [hợp đồng](../release-contract.json); byte hiện tại/bị thay thế: [builds](../builds/README.md) + SHA Release; luồng: [Cách hoạt động](HOW_IT_WORKS.vi.md); kế hoạch: [ROADMAP](ROADMAP.md); cấu trúc: [architecture](architecture.md); lý do: [architecture-decisions](architecture-decisions.md); tình huống: [TEST_LAB](TEST_LAB.md); lỗi: Issues; lần thử cũ: ghi chép có ngày. Chi tiết chưa dịch vẫn là tiếng Anh.
