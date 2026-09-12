# Tương thích TeamForge

Trang này mô tả **ranh giới tương thích và cấu trúc mạng cho người đọc**.

- Lựa chọn chính xác sản phẩm/runtime/giao thức → [`../release-contract.json`](../release-contract.json)
- Kiểm chứng/mức sẵn sàng hiện tại → [STATUS.md](STATUS.md) (tiếng Anh)
- Danh tính bản đóng gói → [`../builds/README.md`](../builds/README.md) + SHA-256 chính xác của Release

Không chép số bản vá công cụ/runtime thay đổi nhanh vào nhiều tài liệu. Hợp đồng phát hành quản lý các lựa chọn chính xác đó.

## Trước khi thử

Dùng dự án có thể bỏ đi và giữ bản sao lưu. TeamForge là bản xem trước công khai ban đầu; [STATUS.md](STATUS.md) quy định giới hạn kiểm chứng thực địa. Bảng bên dưới phân biệt nền tảng đóng gói với yêu cầu mã nguồn/biên dịch.

Chưa xác lập yêu cầu tối thiểu về CPU, RAM, GPU, ổ đĩa, băng thông và độ trễ bằng thử nghiệm có kiểm soát. Một lần chạy nguyên mẫu thành công không phải khuyến nghị phần cứng tối thiểu.

Guest phải kết nối được tới Server đã cấu hình và điểm cuối Project Peer do Host công bố. Lời mời có chữ ký không tạo khả năng kết nối mạng. Dùng cùng máy, LAN có thể truy cập hoặc VPN được quản lý; không cung cấp tự động xuyên mạng Internet hay relay.

## Sản phẩm và giao thức

Các thành phần phát triển cùng một dòng sản phẩm tương thích, không tùy ý trộn phiên bản Server/Project Peer/Launcher/gói. Kiến trúc tách biệt:

- thẩm quyền cộng tác thời gian thực qua WebSocket của Server đã cấu hình;
- điều phối khởi tạo dự án và siêu dữ liệu;
- truyền dữ liệu Project Peer trực tiếp;
- tính toàn vẹn Runtime Host/Guest và Launcher đóng gói.

Giao thức/lược đồ chỉ có thể mở rộng theo hướng bổ sung khi giữ tương thích ngữ nghĩa hiện có. Số chính xác thuộc `release-contract.json`. Không trộn bản kê hoặc tệp nhị phân Runtime/Launcher của các ứng viên khác nhau chỉ vì cùng số phiên bản sản phẩm hiển thị.

## Unity

Dòng được hỗ trợ hiện tại là **Unity 6000.3**. Một bản vá Editor chỉ được coi là đã kiểm chứng khi có bằng chứng ghi lại cho mã nguồn/ứng viên tương ứng. Bản vá Unity mới nhất không tự động là đã thử hay được hỗ trợ. Editor đã thử được chọn trong `release-contract.json`; bằng chứng được tóm tắt tại [STATUS.md](STATUS.md).

## Nhà phát triển và runtime

Người phát triển từ mã nguồn cần dùng phạm vi Node/npm/.NET/công cụ trong hợp đồng và cấu hình lock/build của kho mã. Đây là **yêu cầu mã nguồn/biên dịch**, không phải yêu cầu cài đặt thông thường của Host/Guest đóng gói dùng runtime kèm theo/độc lập theo hợp đồng. Dòng runtime/toolchain lớn mới cần quyết định tương thích và kiểm chứng chủ động; cài thành công trên một máy chưa đủ.

## Cấu trúc mạng được hỗ trợ

- WebSocket Server TeamForge đã cấu hình cho thẩm quyền thời gian thực;
- HTTP Project Peer trực tiếp trên cùng PC, LAN truy cập được hoặc VPN được quản lý;
- chế độ cùng PC chỉ loopback được chọn rõ ràng;
- lắng nghe ngoài loopback có xác thực, với địa chỉ máy cụ thể công bố cho Guest;
- quy trình Windows Host/Guest đóng gói với Runtime kèm theo đã xác minh.

Chưa cung cấp dưới dạng cấu trúc được hỗ trợ: WebRTC / RTCDataChannel; ICE / STUN / TURN; tự động xuyên NAT; relay/tự động chuyển phương thức truyền; tự phát hiện peer; thẩm quyền thời gian thực serverless/nhúng; triển khai Internet công cộng không tin cậy với hệ thống danh tính/phân quyền người dùng đầy đủ.

`P2P` nghĩa là **truyền dữ liệu Project Peer trực tiếp**, không phải tự động kết nối P2P qua Internet.

## Bảng nền tảng

| Phạm vi | Trạng thái |
| --- | --- |
| Runtime Windows x64 kèm theo / Guest Launcher | Hướng đóng gói hiện tại; ứng viên cụ thể vẫn theo điều kiện thực địa của STATUS |
| Unity 6000.3 | Dòng Unity hiện tại |
| Bản vá Unity chính xác đã ghi | `release-contract.json` và bằng chứng STATUS |
| Bản vá Unity 6000.3 khác | Cần lập lại mốc/kiểm chứng riêng trước khi gọi là đã thử |
| Launcher độc lập macOS/Linux | Chưa đóng gói thành ứng viên hiện tại tương đương |
| Docker/Compose | Tùy chọn mã nguồn/máy chủ, không phải Host đóng gói thông thường hay điều kiện phát hành hiện tại |
| Authenticode | Trạng thái phân phối/ký thuộc STATUS/tài liệu bản hiện tại |

## Lưu trữ được quản lý Windows trong mã hiện tại

Mã hiện tại cần thư mục gốc được quản lý trên ổ cố định cục bộ NTFS/ReFS để khóa danh tính dự án Windows. Thư mục mạng, không truy cập được hoặc chưa xác minh bị từ chối theo fail-closed. Đây là điều kiện lưu trữ TeamForge, không phải yêu cầu chung của dự án Unity. Xem [STATUS.md](STATUS.md) về ranh giới mã nguồn/ứng viên đã phát hành và [phần triển khai](../project-peer/src/project-identity-lock.mjs).

## Tuyên bố và lịch sử

Báo cáo giai đoạn/công việc/kiểm thử lịch sử chỉ áp dụng cho mã nguồn/bản được ghi lại. Phiên bản sản phẩm tương tự không biến chúng thành bằng chứng hiện tại. Khi cần danh tính byte chính xác, dùng tên tệp Release + SHA-256 thay vì chỉ số phiên bản.
