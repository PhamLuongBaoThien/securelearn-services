import crypto from 'crypto';
import { Types } from 'mongoose';
import { RoutingKey, type CourseAnnouncementPublishedPayload } from '@securelearn/common';
import { Course } from '../models/course.model';
import { CourseAnnouncement } from '../models/courseAnnouncement.model';
import { CourseAnnouncementReadState } from '../models/courseAnnouncementReadState.model';
import subscriptionAccessService from './subscriptionAccess.service';
import { enqueueCourseEvent } from './courseOutbox.service';
import { emitAnnouncementEvent } from './discussionRealtime.service';

const cleanHtml = (value: string) => value
  .replace(/<(script|style|iframe|object|embed|form)[^>]*>[\s\S]*?<\/\1>/gi, '')
  .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
  .replace(/javascript\s*:/gi, '')
  .slice(0, 20_000);
const plain = (value: string) => value.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
const cursorFilter = (cursor?: string) => {
  if (!cursor) return {};
  if (!Types.ObjectId.isValid(cursor)) throw new Error('Cursor thông báo không hợp lệ.');
  return { _id: { $lt: new Types.ObjectId(cursor) } };
};

class CourseAnnouncementService {
  private async owner(userId: string, courseId: string) {
    if (!Types.ObjectId.isValid(courseId)) throw new Error('Khóa học không hợp lệ.');
    const course = await Course.findOne({ _id: courseId, instructorId: userId }).select('_id title instructorId instructorName instructorAvatarUrl currentVersionId').lean();
    if (!course) throw new Error('Chỉ chủ khóa học được quản lý thông báo.');
    return course;
  }

  private serialize(row: any, unread = false, courseTitle?: string) {
    const data = { ...row };
    delete data.lessonId;
    return { ...data, _id: String(row._id), courseId: String(row.courseId), unread, courseTitle: courseTitle || row.courseTitle || '' };
  }
  private async queueNotification(row: any, course: any) {
    const eventId = crypto.randomUUID();
    const actionUrl = `/student/courses/${course._id}/learn?tab=announcements&announcementId=${row._id}`;
    const payload: CourseAnnouncementPublishedPayload = {
      eventId, announcementId: String(row._id), revision: row.revision,
      courseId: String(course._id), courseTitle: course.title,
      instructorId: row.instructorId, instructorName: row.instructorName,
      title: row.title, contentPreview: plain(row.content).slice(0, 240),
      actionUrl, occurredAt: new Date().toISOString(),
    };
    await enqueueCourseEvent(RoutingKey.COURSE_ANNOUNCEMENT_PUBLISHED, payload as unknown as Record<string, unknown>);
  }
  async create(user: { id: string; name: string }, courseId: string, input: any) {
    const course = await this.owner(user.id, courseId);
    const title = String(input.title || '').trim().slice(0, 180);
    const content = cleanHtml(String(input.content || ''));
    if (!title) throw new Error('Tiêu đề thông báo là bắt buộc.');
    if (!plain(content)) throw new Error('Nội dung thông báo là bắt buộc.');
    const row: any = await CourseAnnouncement.create({
      courseId: course._id, instructorId: user.id,
      instructorName: user.name || course.instructorName || 'Giảng viên',
      instructorAvatarUrl: course.instructorAvatarUrl || '', title, content,
      status: 'PUBLISHED', revision: 1, publishedAt: new Date(),
    });
    await this.queueNotification(row, course);
    const data = this.serialize(row.toObject(), false, course.title);
    emitAnnouncementEvent('published', String(course._id), user.id, data);
    return data;
  }
  async update(userId: string, courseId: string, announcementId: string, input: any) {
    const course = await this.owner(userId, courseId);
    if (!Types.ObjectId.isValid(announcementId)) throw new Error('Thông báo không hợp lệ.');
    const row: any = await CourseAnnouncement.findOne({ _id: announcementId, courseId: course._id, instructorId: userId });
    if (!row) throw new Error('Thông báo không tồn tại.');
    if (input.title !== undefined) { const title = String(input.title).trim().slice(0, 180); if (!title) throw new Error('Tiêu đề là bắt buộc.'); row.title = title; }
    if (input.content !== undefined) { const content = cleanHtml(String(input.content)); if (!plain(content)) throw new Error('Nội dung là bắt buộc.'); row.content = content; }
    if (Boolean(input.notifyAgain)) {
      if (row.status !== 'PUBLISHED') throw new Error('Chỉ có thể thông báo lại nội dung đang hiển thị.');
      row.revision += 1;
      await row.save();
      await this.queueNotification(row, course);
      await CourseAnnouncementReadState.deleteMany({ announcementId: row._id });
    } else await row.save();
    const data = this.serialize(row.toObject(), false, course.title);
    emitAnnouncementEvent('updated', courseId, userId, data);
    return data;
  }
  async visibility(userId: string, courseId: string, announcementId: string, visible: boolean) {
    const course = await this.owner(userId, courseId);
    const row: any = await CourseAnnouncement.findOne({ _id: announcementId, courseId: course._id, instructorId: userId });
    if (!row) throw new Error('Thông báo không tồn tại.');
    row.status = visible ? 'PUBLISHED' : 'HIDDEN'; row.hiddenAt = visible ? null : new Date();
    if (!visible) row.pinnedAt = null;
    await row.save(); const data = this.serialize(row.toObject(), false, course.title);
    emitAnnouncementEvent(visible ? 'updated' : 'hidden', courseId, userId, data); return data;
  }
  async pin(userId: string, courseId: string, announcementId: string, pinned: boolean) {
    const course = await this.owner(userId, courseId);
    const row: any = await CourseAnnouncement.findOne({ _id: announcementId, courseId: course._id, instructorId: userId, status: 'PUBLISHED' });
    if (!row) throw new Error('Chỉ có thể ghim thông báo đang hiển thị.');
    if (pinned && !row.pinnedAt) { const count = await CourseAnnouncement.countDocuments({ courseId: course._id, status: 'PUBLISHED', pinnedAt: { $ne: null } }); if (count >= 3) throw new Error('Mỗi khóa học chỉ được ghim tối đa 3 thông báo.'); row.pinnedAt = new Date(); }
    if (!pinned) row.pinnedAt = null;
    await row.save(); const data = this.serialize(row.toObject(), false, course.title);
    emitAnnouncementEvent('pinned', courseId, userId, data); return data;
  }
  async listForLearner(userId: string, userRole: string, courseId: string, query: any = {}) {
    const access = await subscriptionAccessService.entitlement(userId, courseId);
    const course = await Course.findById(courseId).select('_id title instructorId').lean();
    const owner = userRole === 'INSTRUCTOR' && course?.instructorId === userId;
    if (!course || (!owner && !access.allowed)) throw new Error('Bạn không có quyền xem thông báo khóa học.');
    const limit = Math.min(50, Math.max(1, Number(query.limit) || 20));
    const pinned = query.cursor ? [] : await CourseAnnouncement.find({ courseId, status: 'PUBLISHED', pinnedAt: { $ne: null } }).sort({ pinnedAt: -1 }).limit(3).lean();
    const rows = await CourseAnnouncement.find({ courseId, status: 'PUBLISHED', pinnedAt: null, ...cursorFilter(query.cursor) }).sort({ _id: -1 }).limit(limit + 1).lean();
    const pageRows: any[] = [...pinned, ...rows.slice(0, limit)];
    if (!query.cursor && query.focusId && Types.ObjectId.isValid(String(query.focusId)) && !pageRows.some(item => String(item._id) === String(query.focusId))) {
      const focused = await CourseAnnouncement.findOne({ _id: query.focusId, courseId, status: 'PUBLISHED' }).lean();
      if (focused) pageRows.splice(pinned.length, 0, focused);
    }
    const reads = owner ? [] : await CourseAnnouncementReadState.find({ userId, announcementId: { $in: pageRows.map(x => x._id) } }).distinct('announcementId');
    const readSet = new Set(reads.map(String));
    return { items: pageRows.map(x => this.serialize(x, !owner && !readSet.has(String(x._id)), course.title)), hasMore: rows.length > limit, nextCursor: rows.length > limit ? String(rows[limit - 1]._id) : null };
  }
  async unreadCount(userId: string, courseId: string, userRole = '') {
    const course = await Course.findById(courseId).select('instructorId').lean();
    if (userRole === 'INSTRUCTOR' && course?.instructorId === userId) return 0;
    const access = await subscriptionAccessService.entitlement(userId, courseId); if (!access.allowed) throw new Error('Bạn không có quyền xem thông báo khóa học.');
    const total = await CourseAnnouncement.countDocuments({ courseId, status: 'PUBLISHED' });
    const read = await CourseAnnouncementReadState.countDocuments({ courseId, userId, announcementId: { $in: await CourseAnnouncement.find({ courseId, status: 'PUBLISHED' }).distinct('_id') } });
    return Math.max(0, total - read);
  }
  async read(userId: string, courseId: string, announcementId: string, userRole = '') {
    const course = await Course.findById(courseId).select('instructorId').lean();
    const owner = userRole === 'INSTRUCTOR' && course?.instructorId === userId;
    const access = owner ? { allowed: true } : await subscriptionAccessService.entitlement(userId, courseId); if (!access.allowed) throw new Error('Bạn không có quyền xem thông báo khóa học.');
    const row = await CourseAnnouncement.findOne({ _id: announcementId, courseId, status: 'PUBLISHED' }).select('_id').lean(); if (!row) throw new Error('Thông báo không còn khả dụng.');
    if (!owner) await CourseAnnouncementReadState.updateOne({ announcementId: row._id, userId }, { $set: { courseId, readAt: new Date() } }, { upsert: true });
    const count = owner ? 0 : await this.unreadCount(userId, courseId, userRole); emitAnnouncementEvent('read', courseId, '', { announcementId, userId, unreadCount: count }); return { announcementId, unreadCount: count };
  }
  async listForInstructor(userId: string, query: any = {}) {
    const courses = await Course.find({ instructorId: userId }).select('_id title').lean(); const ids = courses.map(c => c._id); const names = new Map(courses.map(c => [String(c._id), c.title]));
    const filter: any = { courseId: { $in: ids }, ...cursorFilter(query.cursor) };
    if (query.courseId) filter.courseId = new Types.ObjectId(String(query.courseId));
    if (query.status) filter.status = String(query.status);
    if (query.search?.trim()) filter.$or = [{ title: { $regex: query.search.trim(), $options: 'i' } }, { content: { $regex: query.search.trim(), $options: 'i' } }];
    const limit = Math.min(50, Math.max(1, Number(query.limit) || 20)); const rows = await CourseAnnouncement.find(filter).sort({ _id: -1 }).limit(limit + 1).lean();
    return { items: rows.slice(0, limit).map(x => this.serialize(x, false, names.get(String(x.courseId)))), hasMore: rows.length > limit, nextCursor: rows.length > limit ? String(rows[limit - 1]._id) : null };
  }
}
export default new CourseAnnouncementService();