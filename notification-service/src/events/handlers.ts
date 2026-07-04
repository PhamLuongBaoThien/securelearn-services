import {
  Exchange,
  RoutingKey,
  subscribeMessage,
  type UserRegisteredPayload,
  type PaymentCourseSucceededPayload,
  type PaymentCourseFailedPayload,
  type CoursePublishedPayload,
  type CourseRejectedPayload,
  type CourseSubmittedForReviewPayload,
  type EnrollmentCreatedPayload,
  type NotificationCampaignRequestedPayload,
  type InboxItemCreatedPayload,
  type InboxTicketEventPayload,
  type CourseDiscussionEventPayload,
  type CourseAnnouncementPublishedPayload,
} from '@securelearn/common';
import notificationService, { type Recipient } from '../services/notification.service';

const user = (userId: string, email: string, fullName: string, role: string): Recipient => ({ userId, email, fullName, role, recipientType: 'USER' });
const reliable = {
  retryLimit: Math.max(0, Number(process.env.RABBITMQ_RETRY_LIMIT || 3)),
  retryDelaysMs: [5000, 30000, 300000],
  enableDeadLetter: true,
};

const handleInboxEvent = async (event: 'REPORT_CREATED' | 'SUPPORT_REQUEST_CREATED' | 'FEEDBACK_CREATED', payload: InboxItemCreatedPayload) => {
  const admins = await notificationService.getRecipients({ recipientType: 'ADMIN', permission: 'inbox:manage' });
  const actionUrl = payload.actionUrl || `/admin/notifications/inbox?type=${payload.type}&id=${payload.resourceId}`;
  await Promise.all(admins.map(admin => notificationService.sendEvent(
    event,
    admin,
    { senderName: payload.senderName, title: payload.title, summary: payload.summary || '', createdAt: payload.createdAt },
    `event:${event}:${payload.resourceId}`,
    { category: 'INBOX', priority: 'HIGH', actionUrl, actionLabel: 'Xem chi tiết', data: { resourceId: payload.resourceId, inboxType: payload.type }, channels: ['IN_APP'] },
  )));
};

const handleTicketEvent = async (event: 'INBOX_USER_REPLIED' | 'INBOX_ADMIN_REPLIED' | 'INBOX_STATUS_CHANGED', payload: InboxTicketEventPayload) => {
  const values = { senderName: payload.senderName, title: payload.title, summary: payload.summary || '', status: payload.status || '' };
  if (event === 'INBOX_USER_REPLIED') {
    const recipients = await notificationService.getRecipients({ recipientType: 'ADMIN', permission: 'inbox:manage' });
    await Promise.all(recipients.map(recipient => notificationService.sendEvent(
      event,
      recipient,
      values,
      `event:${event}:${payload.eventId}`,
      { category: 'INBOX', priority: 'HIGH', actionUrl: `/admin/notifications/inbox?id=${payload.ticketId}`, actionLabel: 'Mở yêu cầu', data: { ticketId: payload.ticketId }, channels: ['IN_APP', 'EMAIL'] },
    )));
    return;
  }

  const [recipient] = await notificationService.getRecipients({ recipientType: 'USER', userId: payload.senderId });
  if (!recipient) return;
  const emailStatuses = new Set(['WAITING_USER', 'RESOLVED', 'CLOSED']);
  const channels: Array<'IN_APP' | 'EMAIL'> = event === 'INBOX_ADMIN_REPLIED'
    || (event === 'INBOX_STATUS_CHANGED' && emailStatuses.has(payload.status || ''))
    ? ['IN_APP', 'EMAIL']
    : ['IN_APP'];
  await notificationService.sendEvent(
    event,
    recipient,
    values,
    `event:${event}:${payload.eventId}`,
    { category: 'INBOX', priority: 'HIGH', actionUrl: `/support/tickets/${payload.ticketId}`, actionLabel: 'Xem phản hồi', data: { ticketId: payload.ticketId }, channels },
  );
};

const handleDiscussionEvent = async (
  event: 'DISCUSSION_CREATED' | 'DISCUSSION_REPLIED',
  payload: CourseDiscussionEventPayload,
) => {
  const [recipient] = await notificationService.getRecipients({ recipientType: 'USER', userId: payload.recipientId });
  if (!recipient || payload.recipientId === payload.actorId) return;
  await notificationService.sendEvent(
    event,
    recipient,
    {
      actorName: payload.actorName,
      courseName: payload.courseTitle,
      lessonName: payload.lessonTitle,
      contentPreview: payload.contentPreview,
    },
    'event:' + event + ':' + payload.eventId,
    {
      category: 'LEARNING',
      actionUrl: payload.actionUrl,
      actionLabel: 'Xem thảo luận',
      data: {
        discussionId: payload.discussionId,
        parentId: payload.parentId,
        courseId: payload.courseId,
        lessonId: payload.lessonId,
      },
      channels: ['IN_APP'],
    },
  );
};
const handleCourseAnnouncement = async (payload: CourseAnnouncementPublishedPayload) => {
  const recipients = await notificationService.getCourseRecipients(payload.courseId);
  await Promise.all(recipients.map(recipient => notificationService.sendEvent(
    'COURSE_ANNOUNCEMENT_PUBLISHED',
    recipient,
    {
      instructorName: payload.instructorName,
      courseName: payload.courseTitle,
      title: payload.title,
      contentPreview: payload.contentPreview,
    },
    `announcement:${payload.announcementId}:revision:${payload.revision}`,
    {
      category: 'LEARNING',
      actionUrl: payload.actionUrl,
      actionLabel: 'Xem thông báo',
      data: { announcementId: payload.announcementId, courseId: payload.courseId },
      channels: ['IN_APP'],
    },
  )));
};

export const registerEventHandlers = async () => {
  await subscribeMessage<UserRegisteredPayload>(Exchange.IDENTITY, RoutingKey.USER_REGISTERED, 'notification-service.user-registered', async p =>
    notificationService.sendEvent('WELCOME', user(p.userId, p.email, p.fullName, p.role), { userName: p.fullName }, `event:${RoutingKey.USER_REGISTERED}:${p.userId}`, { category: 'SYSTEM', actionUrl: '/student/dashboard', actionLabel: 'Bắt đầu học' }), reliable);

  await subscribeMessage<PaymentCourseSucceededPayload>(Exchange.PAYMENT, RoutingKey.PAYMENT_COURSE_SUCCEEDED, 'notification-service.payment-succeeded', async p =>
    notificationService.sendEvent('PAYMENT_SUCCESS', user(p.userId, p.email, p.fullName, p.userRole), { userName: p.fullName, amount: p.amount, transactionId: p.transactionCode, courseName: p.items.map(i => i.title).join(', '), createdAt: p.paidAt }, `event:${RoutingKey.PAYMENT_COURSE_SUCCEEDED}:${p.transactionId}`, { category: 'PAYMENT', priority: 'HIGH', actionUrl: '/student/dashboard', actionLabel: 'Học ngay' }), reliable);

  await subscribeMessage<PaymentCourseFailedPayload>(Exchange.PAYMENT, RoutingKey.PAYMENT_COURSE_FAILED, 'notification-service.payment-failed', async p => {
    const [recipient] = await notificationService.getRecipients({ userId: p.userId, recipientType: 'USER' });
    if (recipient) await notificationService.sendEvent('PAYMENT_FAILED', recipient, { userName: recipient.fullName, amount: p.amount, transactionId: p.transactionCode, reason: p.reason, createdAt: p.failedAt }, `event:${RoutingKey.PAYMENT_COURSE_FAILED}:${p.transactionId}`, { category: 'PAYMENT', priority: 'HIGH', actionUrl: '/cart', actionLabel: 'Thử lại' });
  }, reliable);

  await subscribeMessage<CoursePublishedPayload>(Exchange.COURSE, RoutingKey.COURSE_PUBLISHED, 'notification-service.course-published', async p => {
    const [recipient] = await notificationService.getRecipients({ userId: p.instructorId, recipientType: 'USER' });
    if (recipient) await notificationService.sendEvent('COURSE_APPROVED', recipient, { instructorName: recipient.fullName, courseName: p.title, courseUrl: p.slug ? `/course/${p.slug}` : '' }, `event:${RoutingKey.COURSE_PUBLISHED}:${p.versionId || p.courseId}`, { category: 'COURSE', priority: 'HIGH', actionUrl: p.slug ? `/course/${p.slug}` : '/instructor/courses', actionLabel: 'Xem khóa học' });
  }, reliable);

  await subscribeMessage<CourseRejectedPayload>(Exchange.COURSE, RoutingKey.COURSE_REJECTED, 'notification-service.course-rejected', async p => {
    const [recipient] = await notificationService.getRecipients({ userId: p.instructorId, recipientType: 'USER' });
    if (recipient) await notificationService.sendEvent('COURSE_REJECTED', recipient, { instructorName: recipient.fullName, courseName: p.title, reason: p.reason }, `event:${RoutingKey.COURSE_REJECTED}:${p.versionId}`, { category: 'COURSE', priority: 'HIGH', actionUrl: `/instructor/courses/${p.courseId}/edit`, actionLabel: 'Chỉnh sửa' });
  }, reliable);

  await subscribeMessage<CourseSubmittedForReviewPayload>(Exchange.COURSE, RoutingKey.COURSE_SUBMITTED_FOR_REVIEW, 'notification-service.course-submitted', async p => {
    const admins = await notificationService.getRecipients({ recipientType: 'ADMIN', permission: 'course:approve' });
    await Promise.all(admins.map(admin => notificationService.sendEvent('COURSE_SUBMITTED_FOR_REVIEW', admin, { courseName: p.title, instructorName: p.instructorName }, `event:${RoutingKey.COURSE_SUBMITTED_FOR_REVIEW}:${p.versionId}`, { category: 'COURSE', priority: 'HIGH', actionUrl: `/admin/courses/review?versionId=${p.versionId}`, actionLabel: 'Kiểm duyệt', data: { courseId: p.courseId, versionId: p.versionId } })));
  }, reliable);

  await subscribeMessage<EnrollmentCreatedPayload>(Exchange.COURSE, RoutingKey.ENROLLMENT_CREATED, 'notification-service.enrollment-created', async p => {
    const [recipient] = await notificationService.getRecipients({ userId: p.instructorId, recipientType: 'USER' });
    if (recipient) await notificationService.sendEvent('ENROLLMENT_CREATED', recipient, { courseName: p.courseTitle, learnerName: p.learnerName || 'Một học viên' }, `event:${RoutingKey.ENROLLMENT_CREATED}:${p.enrollmentId}`, { category: 'LEARNING', actionUrl: '/instructor/students', actionLabel: 'Xem học viên' });
  }, reliable);

  await subscribeMessage<CourseDiscussionEventPayload>(Exchange.COURSE, RoutingKey.DISCUSSION_CREATED, 'notification-service.discussion-created', p => handleDiscussionEvent('DISCUSSION_CREATED', p), reliable);
  await subscribeMessage<CourseDiscussionEventPayload>(Exchange.COURSE, RoutingKey.DISCUSSION_REPLIED, 'notification-service.discussion-replied', p => handleDiscussionEvent('DISCUSSION_REPLIED', p), reliable);
  await subscribeMessage<CourseAnnouncementPublishedPayload>(Exchange.COURSE, RoutingKey.COURSE_ANNOUNCEMENT_PUBLISHED, 'notification-service.course-announcement-published', handleCourseAnnouncement, reliable);
  await subscribeMessage<NotificationCampaignRequestedPayload>(Exchange.NOTIFICATION, RoutingKey.NOTIFICATION_CAMPAIGN_REQUESTED, 'notification-service.campaign-requested', async p => notificationService.processCampaign(p.campaignId), reliable);
  await subscribeMessage<InboxItemCreatedPayload>(Exchange.INBOX, RoutingKey.REPORT_CREATED, 'notification-service.report-created', p => handleInboxEvent('REPORT_CREATED', p), reliable);
  await subscribeMessage<InboxItemCreatedPayload>(Exchange.INBOX, RoutingKey.SUPPORT_REQUEST_CREATED, 'notification-service.support-created', p => handleInboxEvent('SUPPORT_REQUEST_CREATED', p), reliable);
  await subscribeMessage<InboxItemCreatedPayload>(Exchange.INBOX, RoutingKey.FEEDBACK_CREATED, 'notification-service.feedback-created', p => handleInboxEvent('FEEDBACK_CREATED', p), reliable);
  await subscribeMessage<InboxTicketEventPayload>(Exchange.INBOX, RoutingKey.INBOX_USER_REPLIED, 'notification-service.inbox-user-replied', p => handleTicketEvent('INBOX_USER_REPLIED', p), reliable);
  await subscribeMessage<InboxTicketEventPayload>(Exchange.INBOX, RoutingKey.INBOX_ADMIN_REPLIED, 'notification-service.inbox-admin-replied', p => handleTicketEvent('INBOX_ADMIN_REPLIED', p), reliable);
  await subscribeMessage<InboxTicketEventPayload>(Exchange.INBOX, RoutingKey.INBOX_STATUS_CHANGED, 'notification-service.inbox-status-changed', p => handleTicketEvent('INBOX_STATUS_CHANGED', p), reliable);
};

