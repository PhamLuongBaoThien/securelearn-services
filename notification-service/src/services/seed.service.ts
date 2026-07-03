import { NotificationTemplate } from "../models/notificationTemplate.model";
const seeds = [
  [
    "WELCOME",
    "IN_APP",
    "Chào mừng bạn đến SecureLearn",
    "Chào {{userName}}, tài khoản của bạn đã sẵn sàng.",
  ],
  [
    "PAYMENT_SUCCESS",
    "IN_APP",
    "Thanh toán thành công",
    "Bạn đã thanh toán {{amount}} cho {{courseName}}.",
  ],
  [
    "PAYMENT_FAILED",
    "IN_APP",
    "Thanh toán chưa thành công",
    "Giao dịch {{transactionId}} thất bại: {{reason}}",
  ],
  [
    "COURSE_APPROVED",
    "IN_APP",
    "Khóa học đã được duyệt",
    "Khóa học {{courseName}} đã được xuất bản.",
  ],
  [
    "COURSE_REJECTED",
    "IN_APP",
    "Khóa học cần chỉnh sửa",
    "Khóa học {{courseName}} cần chỉnh sửa: {{reason}}",
  ],
  [
    "WELCOME",
    "EMAIL",
    "Chào mừng đến SecureLearn",
    "Chào {{userName}}, tài khoản SecureLearn của bạn đã sẵn sàng.",
  ],
  [
    "PAYMENT_SUCCESS",
    "EMAIL",
    "Xác nhận thanh toán thành công",
    "Chào {{userName}}, thanh toán {{amount}} cho {{courseName}} đã thành công. Mã giao dịch: {{transactionId}}.",
  ],
  [
    "PAYMENT_FAILED",
    "EMAIL",
    "Thanh toán chưa thành công",
    "Giao dịch {{transactionId}} chưa thành công: {{reason}}",
  ],
  [
    "COURSE_APPROVED",
    "EMAIL",
    "Khóa học đã được duyệt",
    "Khóa học {{courseName}} đã được xuất bản trên SecureLearn.",
  ],
  [
    "COURSE_REJECTED",
    "EMAIL",
    "Khóa học cần chỉnh sửa",
    "Khóa học {{courseName}} cần chỉnh sửa: {{reason}}",
  ],
  [
    "COURSE_SUBMITTED_FOR_REVIEW",
    "IN_APP",
    "Khóa học mới chờ duyệt",
    "{{instructorName}} đã gửi khóa học {{courseName}} để kiểm duyệt.",
  ],
  [
    "ENROLLMENT_CREATED",
    "IN_APP",
    "Học viên mới",
    "{{learnerName}} vừa ghi danh khóa học {{courseName}}.",
  ],
  [
    "COURSE_SUBMITTED_FOR_REVIEW",
    "EMAIL",
    "Khóa học mới chờ duyệt",
    "{{instructorName}} đã gửi khóa học {{courseName}} để kiểm duyệt.",
  ],
  [
    "ENROLLMENT_CREATED",
    "EMAIL",
    "Học viên mới ghi danh",
    "{{learnerName}} vừa ghi danh khóa học {{courseName}}.",
  ],
  [
    "REPORT_CREATED",
    "IN_APP",
    "Báo cáo mới",
    "{{senderName}} đã gửi báo cáo: {{title}}. {{summary}}",
  ],
  [
    "REPORT_CREATED",
    "EMAIL",
    "Báo cáo mới",
    "{{senderName}} đã gửi báo cáo: {{title}}. {{summary}}",
  ],
  [
    "SUPPORT_REQUEST_CREATED",
    "IN_APP",
    "Yêu cầu hỗ trợ mới",
    "{{senderName}} cần hỗ trợ: {{title}}. {{summary}}",
  ],
  [
    "SUPPORT_REQUEST_CREATED",
    "EMAIL",
    "Yêu cầu hỗ trợ mới",
    "{{senderName}} cần hỗ trợ: {{title}}. {{summary}}",
  ],
  [
    "FEEDBACK_CREATED",
    "IN_APP",
    "Góp ý mới",
    "{{senderName}} đã gửi góp ý: {{title}}. {{summary}}",
  ],
  [
    "FEEDBACK_CREATED",
    "EMAIL",
    "Góp ý mới",
    "{{senderName}} đã gửi góp ý: {{title}}. {{summary}}",
  ],
  [
    "INBOX_USER_REPLIED",
    "IN_APP",
    "Yêu cầu có phản hồi mới",
    "{{senderName}} đã phản hồi yêu cầu {{title}}: {{summary}}",
  ],
  [
    "INBOX_ADMIN_REPLIED",
    "IN_APP",
    "Hỗ trợ đã phản hồi",
    "Yêu cầu {{title}} có phản hồi mới: {{summary}}",
  ],
  [
    "INBOX_STATUS_CHANGED",
    "IN_APP",
    "Trạng thái yêu cầu thay đổi",
    "Yêu cầu {{title}} hiện ở trạng thái {{status}}.",
  ],
  [
    "INBOX_USER_REPLIED",
    "EMAIL",
    "Yêu cầu có phản hồi mới",
    "{{senderName}} đã phản hồi yêu cầu {{title}}: {{summary}}",
  ],
  [
    "INBOX_ADMIN_REPLIED",
    "EMAIL",
    "Hỗ trợ đã phản hồi",
    "Yêu cầu {{title}} có phản hồi mới: {{summary}}",
  ],
  [
    "INBOX_STATUS_CHANGED",
    "EMAIL",
    "Trạng thái yêu cầu thay đổi",
    "Yêu cầu {{title}} hiện ở trạng thái {{status}}.",
  ],
];
export const seedTemplates = async () => {
  for (const [event, type, name, body] of seeds)
    await NotificationTemplate.updateOne(
      { event, type },
      {
        $setOnInsert: {
          event,
          type,
          name,
          subject: name,
          body,
          isActive: true,
        },
      },
      { upsert: true },
    );
};
