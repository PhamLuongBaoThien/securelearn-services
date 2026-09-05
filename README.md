# SecureLearn Services

Backend của SecureLearn được tổ chức theo kiến trúc microservices với 8 service Node.js/Express.js. Kong cung cấp một cổng API thống nhất; gRPC và RabbitMQ đảm nhiệm giao tiếp nội bộ đồng bộ và bất đồng bộ.

- Repository hệ thống: [securelearn-deploy](https://github.com/PhamLuongBaoThien/securelearn-deploy)
- Repository frontend: [securelearn-web](https://github.com/PhamLuongBaoThien/securelearn-web)

## Kiến trúc tổng thể

![Kiến trúc tổng thể SecureLearn](https://raw.githubusercontent.com/PhamLuongBaoThien/securelearn-deploy/main/readme-assets/system-architecture.png)

## Các microservice

| Service | Trách nhiệm chính |
| --- | --- |
| `identity-service` | Đăng ký, OTP, JWT access/refresh token, Google OAuth 2.0, phiên đăng nhập và RBAC |
| `course-service` | Khóa học, giáo trình, phiên bản, phê duyệt, ghi danh, quiz, đánh giá và thảo luận |
| `media-service` | Multipart upload, xử lý FFmpeg, HLS đa chất lượng, AES-128 và cấp quyền phát video |
| `payment-service` | Mua khóa học, thuê bao, coupon, MoMo/VNPay, webhook và báo cáo doanh thu |
| `progress-service` | Tiến độ bài học, thời lượng xem, trạng thái hoàn thành và đồng bộ học tập |
| `notification-service` | Email, thông báo web, mẫu thông báo và cập nhật thời gian thực |
| `content-service` | Cấu hình website, banner, chính sách và nội dung quản trị |
| `inbox-service` | Ticket hỗ trợ, báo cáo, góp ý, tin nhắn và tệp đính kèm |

Thư mục `shared/` chứa protobuf/gRPC, event bus RabbitMQ, kiểu lỗi và response format dùng chung giữa các service.

## Công nghệ sử dụng

- **Runtime:** Node.js, TypeScript, Express.js.
- **Dữ liệu:** MongoDB/Mongoose, Redis.
- **Giao tiếp:** REST API, gRPC, RabbitMQ, Socket.IO.
- **Xác thực:** JWT, Google OAuth 2.0, RBAC, bcrypt.
- **Media:** Cloudflare R2, AWS S3 SDK, FFmpeg, HLS, AES-128.
- **Tích hợp:** MoMo, VNPay, Gemini API, Cloudinary, Nodemailer.
- **Gateway và triển khai:** Kong API Gateway, Docker, Kubernetes, Helm.

## Luồng xử lý và bảo vệ video

Video gốc được tải trực tiếp từ frontend lên Cloudflare R2 bằng multipart presigned URL. Media Service xử lý nền bằng FFmpeg, tạo các playlist HLS ở tối đa ba mức chất lượng `360p`, `720p`, `1080p` và mã hóa nội dung bằng AES-128.

![Luồng tải và xử lý video](https://raw.githubusercontent.com/PhamLuongBaoThien/securelearn-deploy/main/readme-assets/video-upload-flow.png)

Khi học viên phát video, backend kiểm tra quyền học và cấp playback token dùng một lần. Playlist, khóa giải mã và từng phân đoạn được bảo vệ bằng session/ticket có thời hạn trước khi Media Service tạo liên kết R2 ngắn hạn.

![Luồng cấp quyền phát video](https://raw.githubusercontent.com/PhamLuongBaoThien/securelearn-deploy/main/readme-assets/protected-playback-flow.png)

### Cấu trúc HLS đa chất lượng

![Cấu trúc HLS đa chất lượng](https://raw.githubusercontent.com/PhamLuongBaoThien/securelearn-deploy/main/readme-assets/hls-multi-quality-structure.png)

### Kết quả lưu trữ trên Cloudflare R2

![Các phân đoạn HLS trên Cloudflare R2](https://raw.githubusercontent.com/PhamLuongBaoThien/securelearn-deploy/main/readme-assets/cloudflare-r2-hls.png)

## Cấu trúc repository

```text
securelearn-services/
├── identity-service/
├── course-service/
├── media-service/
├── payment-service/
├── progress-service/
├── notification-service/
├── content-service/
├── inbox-service/
├── shared/             # gRPC, RabbitMQ và mã dùng chung
└── api-gateway/        # Cấu hình Kong phục vụ môi trường Compose
```

Mỗi service có `package.json`, `Dockerfile`, mã nguồn trong `src/` và có thể build/triển khai độc lập.

## Chạy backend

### Cách khuyến nghị

Sử dụng repository [securelearn-deploy](https://github.com/PhamLuongBaoThien/securelearn-deploy) để khởi tạo đầy đủ Kong, Redis, RabbitMQ và 8 service:

```powershell
docker compose up -d --build
```

Hoặc triển khai backend trên Kubernetes local theo hướng dẫn trong [`infra/README.md`](https://github.com/PhamLuongBaoThien/securelearn-deploy/blob/main/infra/README.md).

### Phát triển một service riêng

Ví dụ với `identity-service`:

```powershell
npm install --prefix shared
npm run build --prefix shared
npm install --prefix identity-service
npm run dev --prefix identity-service
```

Service cần được cung cấp các biến môi trường tương ứng cho MongoDB, Redis, RabbitMQ, JWT và dịch vụ bên thứ ba. Không commit file `.env` hoặc thông tin xác thực thật.

## Tác giả

**Phạm Lương Bảo Thiện** — [GitHub](https://github.com/PhamLuongBaoThien)
