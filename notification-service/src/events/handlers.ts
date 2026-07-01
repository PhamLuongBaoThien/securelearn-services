import {
  Exchange, RoutingKey, subscribeMessage,
  type UserRegisteredPayload, type PaymentCourseSucceededPayload, type PaymentCourseFailedPayload,
  type CoursePublishedPayload, type CourseRejectedPayload, type CourseSubmittedForReviewPayload,
  type EnrollmentCreatedPayload, type NotificationCampaignRequestedPayload,
} from '@securelearn/common';
import notificationService, { type Recipient } from '../services/notification.service';
const user = (userId: string, email: string, fullName: string, role: string): Recipient => ({ userId, email, fullName, role, recipientType: 'USER' });
export const registerEventHandlers = async () => {
  await subscribeMessage<UserRegisteredPayload>(Exchange.IDENTITY, RoutingKey.USER_REGISTERED, 'notification-service.user-registered', async p =>
    notificationService.sendEvent('WELCOME', user(p.userId, p.email, p.fullName, p.role), { userName: p.fullName }, `event:${RoutingKey.USER_REGISTERED}:${p.userId}`, { category: 'SYSTEM', actionUrl: '/student/dashboard', actionLabel: 'Bắt đầu học' }));
  await subscribeMessage<PaymentCourseSucceededPayload>(Exchange.PAYMENT, RoutingKey.PAYMENT_COURSE_SUCCEEDED, 'notification-service.payment-succeeded', async p =>
    notificationService.sendEvent('PAYMENT_SUCCESS', user(p.userId, p.email, p.fullName, p.userRole), { userName: p.fullName, amount: p.amount, transactionId: p.transactionCode, courseName: p.items.map(i => i.title).join(', '), createdAt: p.paidAt }, `event:${RoutingKey.PAYMENT_COURSE_SUCCEEDED}:${p.transactionId}`, { category: 'PAYMENT', priority: 'HIGH', actionUrl: '/student/dashboard', actionLabel: 'Học ngay' }));
  await subscribeMessage<PaymentCourseFailedPayload>(Exchange.PAYMENT, RoutingKey.PAYMENT_COURSE_FAILED, 'notification-service.payment-failed', async p => {
    const [recipient] = await notificationService.getRecipients({ userId: p.userId, recipientType: 'USER' });
    if (recipient) await notificationService.sendEvent('PAYMENT_FAILED', recipient, { userName: recipient.fullName, amount: p.amount, transactionId: p.transactionCode, reason: p.reason, createdAt: p.failedAt }, `event:${RoutingKey.PAYMENT_COURSE_FAILED}:${p.transactionId}`, { category: 'PAYMENT', priority: 'HIGH', actionUrl: '/cart', actionLabel: 'Thử lại' });
  });
  await subscribeMessage<CoursePublishedPayload>(Exchange.COURSE, RoutingKey.COURSE_PUBLISHED, 'notification-service.course-published', async p => {
    const [recipient] = await notificationService.getRecipients({ userId: p.instructorId, recipientType: 'USER' });
    if (recipient) await notificationService.sendEvent('COURSE_APPROVED', recipient, { instructorName: recipient.fullName, courseName: p.title, courseUrl: p.slug ? `/course/${p.slug}` : '' }, `event:${RoutingKey.COURSE_PUBLISHED}:${p.versionId || p.courseId}`, { category: 'COURSE', priority: 'HIGH', actionUrl: p.slug ? `/course/${p.slug}` : '/instructor/courses', actionLabel: 'Xem khóa học' });
  });
  await subscribeMessage<CourseRejectedPayload>(Exchange.COURSE, RoutingKey.COURSE_REJECTED, 'notification-service.course-rejected', async p => {
    const [recipient] = await notificationService.getRecipients({ userId: p.instructorId, recipientType: 'USER' });
    if (recipient) await notificationService.sendEvent('COURSE_REJECTED', recipient, { instructorName: recipient.fullName, courseName: p.title, reason: p.reason }, `event:${RoutingKey.COURSE_REJECTED}:${p.versionId}`, { category: 'COURSE', priority: 'HIGH', actionUrl: `/instructor/courses/${p.courseId}/edit`, actionLabel: 'Chỉnh sửa' });
  });
  await subscribeMessage<CourseSubmittedForReviewPayload>(Exchange.COURSE, RoutingKey.COURSE_SUBMITTED_FOR_REVIEW, 'notification-service.course-submitted', async p => {
    const admins = await notificationService.getRecipients({ recipientType: 'ADMIN', permission: 'course:approve' });
    await Promise.all(admins.map(admin => notificationService.sendEvent('COURSE_SUBMITTED_FOR_REVIEW', admin, { courseName: p.title, instructorName: p.instructorName }, `event:${RoutingKey.COURSE_SUBMITTED_FOR_REVIEW}:${p.versionId}`, { category: 'COURSE', priority: 'HIGH', actionUrl: `/admin/courses/review?versionId=${p.versionId}`, actionLabel: 'Kiểm duyệt', data: { courseId: p.courseId, versionId: p.versionId } })));
  });
  await subscribeMessage<EnrollmentCreatedPayload>(Exchange.COURSE, RoutingKey.ENROLLMENT_CREATED, 'notification-service.enrollment-created', async p => {
    const [recipient] = await notificationService.getRecipients({ userId: p.instructorId, recipientType: 'USER' });
    if (recipient) await notificationService.sendEvent('ENROLLMENT_CREATED', recipient, { courseName: p.courseTitle, learnerName: p.learnerName || 'Một học viên' }, `event:${RoutingKey.ENROLLMENT_CREATED}:${p.enrollmentId}`, { category: 'LEARNING', actionUrl: '/instructor/students', actionLabel: 'Xem học viên' });
  });
  await subscribeMessage<NotificationCampaignRequestedPayload>(Exchange.NOTIFICATION, RoutingKey.NOTIFICATION_CAMPAIGN_REQUESTED, 'notification-service.campaign-requested', async p => notificationService.processCampaign(p.campaignId));
};