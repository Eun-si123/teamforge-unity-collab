# TeamForge hoạt động như thế nào

Trang này giải thích **những gì xảy ra khi làm Host, tham gia, truyền dự án, sửa Scene, mất kết nối hoặc phục hồi lỗi**. Đây là giải thích có hướng dẫn, không phải đặc tả giao thức đầy đủ hay bản đồ tệp nguồn.

Khả năng/trở ngại: [Trạng thái](STATUS.vi.md); cấu trúc và ranh giới tin cậy: [architecture](architecture.md); tệp: [CODEMAP](../CODEMAP.md); lý do thiết kế: [architecture-decisions](architecture-decisions.md). Chi tiết chưa dịch là tiếng Anh; [English](HOW_IT_WORKS.md) quyết định ngữ nghĩa.

## Mô hình trong 60 giây

Hai đường dữ liệu được chủ động tách:

- Host/Guest Unity Editor gửi thao tác realtime qua WebSocket tới Session Authority của Server.
- Host Unity dùng Host Project Peer/Seed; Guest Launcher dùng Guest Project Peer. Peer truyền payload dự án trực tiếp qua HTTP; Guest Peer bàn giao Active đã xác minh cho Guest Unity.
- Server điều phối siêu dữ liệu ký với hai bên, không trở thành relay tệp dự án.
- Guest chỉ mở nội dung sau kiểm tra tin cậy, toàn vẹn, kích hoạt và bàn giao Unity.

Truyền lớn tách khỏi lưu lượng cộng tác nhạy độ trễ, đồng thời giữ một thẩm quyền realtime rõ ràng.

## Các tiến trình chính

### Gói Unity Editor

Cung cấp luồng Host, vòng đời kết nối, Presence, Transform/Lock và Hierarchy cùng Scene được hỗ trợ, giao diện chẩn đoán/khôi phục, áp dụng trạng thái từ xa được chấp thuận vào Scene cục bộ. Client **quan sát thẩm quyền**; giá trị cục bộ không có thẩm quyền chỉ vì nó tồn tại trong một Editor.

### TeamForge Server

**Session Authority** quản lý thành viên, revision/thứ tự chung, lock/lease, trạng thái Scene được hỗ trợ lưu giữ, chống replay/idempotency và hiệu ứng realtime. **Project Coordinator** quản lý siêu dữ liệu ký Project/Publisher/baseline/Peer. Server không lưu hoặc relay payload Manifest/File/Chunk thông thường.

### Project Peer

Phụ trách kiểm tra lời mời ký, manifest/hash xác định, HTTP trực tiếp, tiếp tục có xác minh, staging, revision Active bất biến, an toàn hệ thống tệp/đường dẫn và tin cậy Project/Publisher. Tải thành công chưa đủ để kích hoạt; toàn bộ đường kiểm tra/tin cậy phải đạt.

### Windows Guest Launcher

Guest mới bắt đầu ngoài Unity vì có thể chưa có dự án. Launcher xác minh Runtime kèm gói, lời mời/tin cậy, nhận qua Peer, kiểm tra Active cuối và phiên bản Unity cần thiết rồi bàn giao. Guest dùng gói thông thường không cần cài hay thao tác thủ công Node.js/npm hệ thống.

Nguồn Launcher hiện có thể tạo **gói hỗ trợ cục bộ thủ công**: ZIP quan sát giới hạn, đã che dữ liệu nhạy cảm. Không tự tải lên, cấp thẩm quyền hay bỏ qua kiểm tra lời mời, tin cậy, kích hoạt, Runtime, đường dẫn, Unity. Gói phát hành có chức năng đó hay không tùy hiện vật chính xác; [Trạng thái](STATUS.vi.md) và [builds](../builds/README.md) tách nguồn/gói.

## Host bắt đầu cộng tác

1. Chọn **Publish & Start**.
2. Unity kiểm tra dự án cục bộ và điều kiện Scene đã lưu.
3. Peer tạo baseline xác định; tệp/chunk nhận định danh toàn vẹn.
4. Host Peer khởi động Seed truyền trực tiếp.
5. Điều phối siêu dữ liệu Project/Publisher/baseline/Peer với Server.
6. Tạo Collaboration Invite có chữ ký; Host sẵn sàng cho Guest.

Còn có kiểm tra fail-closed bổ sung. **Host Ready không chỉ là mở cổng**: hợp đồng truyền và phiên realtime cần cho Guest đã được thiết lập. Lời mời không nhằm mang mã truy cập, khóa ký riêng hay đường dẫn dự án cục bộ tùy ý. Nếu dùng mã truy cập thì chia sẻ riêng.

## Guest mới tham gia

1. Mở Windows Guest Launcher; xác minh Runtime kèm gói.
2. Nạp/dán lời mời; kiểm tra cấu trúc/chữ ký.
3. Kiểm tra định danh và tin cậy Project/Owner/Publisher.
4. Liên hệ Host/Seed được điều phối; nhận descriptor/manifest/inventory.
5. Chỉ tải chunk cần thiết; xác minh toàn vẹn chunk/tệp/manifest/dự án.
6. Dựng trong staging và xác minh ứng viên đầy đủ.
7. Tạo revision Active bất biến; chuyển con trỏ dự án hiện tại nhỏ.
8. Kiểm tra tệp thực thi Unity cần thiết và bàn giao cuối; mở dự án đã xác minh.

Thư mục tải dở tùy ý không được coi là dự án hiện tại. Active trước đã xác minh có thể tiếp tục sẵn có trong lúc nhận bản mới hoặc khi kích hoạt thất bại.

### Tiếp tục có xét xác minh

Có thể tái dùng nội dung đã xác minh khi hợp đồng truyền cho phép. Không có nghĩa tin mọi tệp sẵn trên đĩa: hash và hợp đồng kích hoạt vẫn quyết định.

## Sửa đối tượng Scene được hỗ trợ

1. Người dùng di chuyển GameObject; dịch vụ Transform Unity quan sát thay đổi.
2. Phân giải định danh đối tượng chuẩn theo thẩm quyền.
3. Kiểm tra lock/lease và thẩm quyền kết nối; gửi Transform qua WebSocket.
4. Server xác nhận thao tác, áp dụng thứ tự/revision/idempotency.
5. Phát hiệu ứng được duyệt tới client khác.
6. Bên nhận cập nhật Authority View; Unity áp dụng Transform từ xa được duyệt an toàn.

**Định danh:** hai Editor phải chỉ cùng đối tượng logic, không chỉ cùng tên/đường Hierarchy. Đối tượng Scene đã lưu dùng định danh Unity ổn định; đối tượng tạo trong phiên được hỗ trợ có thể nhận định danh TeamForge sau ràng buộc có thẩm quyền. Mơ hồ thì fail-closed, không đoán theo tên, chỉ số anh em hay đường dẫn.

**Thẩm quyền:** Server quyết định trạng thái realtime chung được chấp nhận. Client báo ý định và áp dụng kết quả, không giữ các sự thật cạnh tranh.

**Revision/thứ tự:** thao tác được nhận tiến thứ tự chung. Revision giúp xét trạng thái cũ, tham gia muộn, replay và thao tác có được đánh giá trên trạng thái mong đợi không.

**Lock/lease:** do thẩm quyền kiểm soát để tránh hai người âm thầm ghi đè cùng đối tượng. Lease hết hạn khi client biến mất, không thành lock vĩnh viễn.

**Replay/idempotency:** phân biệt retry hợp lệ cùng thao tác với thao tác khác tái dùng định danh; thông điệp giao hai lần không được sửa trạng thái hai lần.

## Thay đổi Hierarchy

Tạo/xóa/đổi tên/đổi cha/thứ tự anh em trong cùng Scene dùng đường thẩm quyền riêng, không giả làm Transform. Transform phụ thuộc cấu trúc; cha/định danh khác có thể tạo Scene khác dù số cục bộ giống nhau. Không suy ra đồng bộ Component/Inspector/Prefab/Asset tổng quát hoặc cấu trúc tùy ý qua Scene; xem [Trạng thái](STATUS.vi.md).

## Kết nối lại và epoch kết nối

Nối lại không chứng minh thẩm quyền cũ còn đúng: mất kết nối → ngừng tin thẩm quyền gắn kết nối → reconnect/handshake → nhận khả năng đã thương lượng và trạng thái có thẩm quyền hiện tại → ràng buộc lại đối tượng cho epoch mới → chỉ tiếp tục khi trạng thái bắt buộc sẵn sàng. Alias lưu bền/cache định danh có thể hỗ trợ phân giải, không tự cấp thẩm quyền.

## Lỗi và khôi phục

Giữ trạng thái xác minh thay vì ép qua trạng thái chưa biết:

- Runtime hỏng: dừng trước khi chạy mã chưa xác minh;
- lời mời sai/xung đột: giữ nguyên ràng buộc Project;
- truyền lỗi: giữ tiến độ xác minh được phép tái dùng;
- kích hoạt lỗi: không thay Active trước đã xác minh;
- lỗi đường Unity: chỉ dùng chiến lược đường dẫn của TeamForge đã kiểm tra riêng;
- baseline/định danh lệch: yêu cầu đối soát/cập nhật, không đoán;
- tiến trình lạ chiếm cổng: không giết chỉ vì TeamForge muốn cổng đó.

Khôi phục **phụ thuộc trạng thái**. Retry, Paste New Invite, Use Latest Project, Open Existing Verified Project, Choose Unity chỉ hiện ở trạng thái có ý nghĩa an toàn đã định nghĩa.

**Chẩn đoán là quan sát, không phải thẩm quyền khôi phục.** Sao chép chẩn đoán và ZIP thủ công mô tả lần chạy. Lưu không đổi Project, retry, tin Publisher, kích hoạt nội dung hay nới kiểm tra. Chỉ thu góc nhìn trạng thái an toàn giới hạn, không gom dữ liệu dự án/máy rộng; vẫn cần rà trước khi chia sẻ công khai.

## Vì sao tách truyền và realtime

Realtime hưởng lợi từ thông điệp thẩm quyền nhỏ, có thứ tự. Bootstrap gồm nhiều tệp, luồng byte lớn, retry, tiếp tục, hash, staging và đĩa. Tách tránh nút thắt Server ẩn và làm rõ ranh giới an toàn/lỗi.

Đổi lại, Guest phải thực sự tới được Host Peer. Hiện phù hợp cùng PC, LAN tới được hoặc VPN có quản lý. Discovery Internet/NAT traversal/relay tự động là vấn đề truyền tải tương lai riêng, không phải cam kết ngầm của chữ P2P.

## Nơi lưu và thời gian sống

| Trạng thái | Chủ sở hữu/thời gian |
| --- | --- |
| Session Authority realtime | Bộ nhớ Server trong phiên sống |
| Sổ điều phối Project | Bộ nhớ Server |
| Authority View client | Kết nối Unity hiện tại |
| Nội dung truyền/staging | Kho quản lý Project Peer |
| Revision Active xác minh | Kho Project quản lý bền vững |
| Con trỏ Active hiện tại | Siêu dữ liệu nhỏ bền vững |
| Lịch sử chẩn đoán Launcher | Giới hạn trong lần chạy hiện tại |
| Gói hỗ trợ thủ công | ZIP cục bộ giới hạn/che dữ liệu do người dùng tạo; không tự tải lên |

Dự án tải bền vững không đồng nghĩa lịch sử authority realtime bền vững; hiện vật chẩn đoán không trở thành thẩm quyền. Phân biệt này quan trọng với restart, nối lại, tiếp tục và khôi phục.

## Từ hành vi tới mã nguồn

[CODEMAP](../CODEMAP.md) giữ tên tệp/test chính xác. Đường đi thường gặp: kết nối → Unity `TeamForgeConnectionService` + host WebSocket Server; Transform/Lock → dịch vụ Transform + Authority View + Session Authority; Hierarchy → dịch vụ Unity + mô hình Hierarchy Server/Session Authority; bootstrap/truyền → bộ điều phối Host/Guest Peer + nguồn trực tiếp + content store; Guest khởi động/khôi phục → Windows Launcher + Launcher Core + bộ điều phối Guest; hỗ trợ → UI chẩn đoán + gói/che dữ liệu Core; chịu lỗi đường → Launcher Core + hợp đồng chung Project Peer. Dẫn bản đồ mã thay vì chép tên tệp giữ giải thích hữu ích qua tái cấu trúc.
