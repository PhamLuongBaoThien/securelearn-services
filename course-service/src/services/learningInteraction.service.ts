// ========================
// Learning Interaction Service
// Mục đích:
// - kiểm tra quyền trước khi đọc/ghi ghi chú và thảo luận bài học
// - cung cấp dữ liệu tương tác thật cho màn học
// ========================
import { Types } from 'mongoose';
import { Course } from '../models/course.model';
import { Lesson } from '../models/lesson.model';
import { ILearningNote, LearningNote } from '../models/learningNote.model';
import { LessonDiscussion } from '../models/lessonDiscussion.model';
import { Exchange, RoutingKey, publishMessage, type CourseDiscussionEventPayload } from '@securelearn/common';
import { emitDiscussionCreated, emitDiscussionDeleted, emitDiscussionHidden, emitDiscussionUpdated } from './discussionRealtime.service';
import subscriptionAccessService from './subscriptionAccess.service';
import { identityGrpcClient } from '../grpc/identity.client';

class LearningInteractionService {
  private stripHtml(html: string) {
    return html
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private normalizeTimestamp(timestampSec: number) {
    return Math.max(0, Math.floor(timestampSec || 0));
  }

  private normalizeNoteContent(content: string) {
    const normalizedContent = content.slice(0, 10_000);
    if (!this.stripHtml(normalizedContent)) {
      throw new Error('Vui lòng nhập nội dung ghi chú.');
    }
    return normalizedContent;
  }

  private async getDiscussionAuthor(user: { id: string; name?: string }) {
    try {
      const snapshot = await identityGrpcClient.getIdentitySnapshot({
        identityId: user.id,
        identityType: 'USER',
      });
      if (snapshot.found) {
        return {
          name: snapshot.fullName || user.name || '',
          avatarUrl: snapshot.avatarUrl || '',
        };
      }
    } catch (error) {
      console.warn(JSON.stringify({
        event: 'discussion_author_snapshot_failed',
        userId: user.id,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
    return { name: user.name || '', avatarUrl: '' };
  }

  private async hydrateDiscussionAuthors(items: any[]) {
    const authorIds = Array.from(new Set(
      items.filter(item => !item.authorAvatarUrl).map(item => String(item.authorId || '')).filter(Boolean),
    ));
    if (!authorIds.length) return;

    const snapshots = await Promise.all(authorIds.map(async authorId => {
      try {
        const snapshot = await identityGrpcClient.getIdentitySnapshot({ identityId: authorId, identityType: 'USER' });
        return snapshot.found ? snapshot : null;
      } catch {
        return null;
      }
    }));
    const byId = new Map(snapshots.filter(Boolean).map(snapshot => [snapshot!.identityId, snapshot!]));
    for (const item of items) {
      const snapshot = byId.get(String(item.authorId));
      if (!snapshot) continue;
      item.authorName = snapshot.fullName || item.authorName;
      item.authorAvatarUrl = snapshot.avatarUrl || '';
    }
    await Promise.all(Array.from(byId.values()).map(snapshot => LessonDiscussion.updateMany(
      { authorId: snapshot.identityId, authorAvatarUrl: { $in: ['', null] } },
      { $set: { authorName: snapshot.fullName, authorAvatarUrl: snapshot.avatarUrl || '' } },
    )));
  }

  private async assertAccess(userId: string, userRole: string, courseId: string, lessonId: string) {
    const course = await Course.findById(courseId).select('_id title instructorId currentVersionId').lean();
    if (!course?.currentVersionId) throw new Error('Khóa học không tồn tại.');

    const lesson = await Lesson.findOne({
      _id: lessonId,
      courseId: course.currentVersionId,
    }).select('_id title').lean();
    if (!lesson) throw new Error('Bài học không thuộc khóa học này.');

    const isOwner = userRole === 'INSTRUCTOR' && course.instructorId === userId;
    if (!isOwner) {
      const access = await subscriptionAccessService.entitlement(userId, courseId);
      if (!access.allowed) throw new Error('Bạn không có quyền truy cập khóa học này.');
    }

    return {
      courseId: new Types.ObjectId(course._id),
      lessonId: new Types.ObjectId(lesson._id),
      isOwner,
      instructorId: course.instructorId,
      courseTitle: course.title || 'Khóa học',
      lessonTitle: lesson.title || 'Bài học',
    };
  }

  private async getOrMigrateNoteDocument(
    userId: string,
    courseId: Types.ObjectId,
    lessonId: Types.ObjectId,
  ) {
    const document = await LearningNote.findOne({ userId, courseId, lessonId });
    if (!document) return null;

    const hasLegacyNote = this.stripHtml(document.content || '');
    if (!document.notes.length && hasLegacyNote) {
      document.notes = [
        {
          _id: new Types.ObjectId(),
          content: document.content!,
          timestampSec: this.normalizeTimestamp(document.timestampSec || 0),
          createdAt: document.createdAt,
          updatedAt: document.updatedAt,
        },
      ];
      document.content = '';
      document.timestampSec = 0;
      await document.save();
    }

    return document;
  }

  private sortNotesByTimestamp(notes: Array<{ timestampSec: number; createdAt?: Date }>) {
    return [...notes].sort((a, b) => {
      if (a.timestampSec !== b.timestampSec) return a.timestampSec - b.timestampSec;
      return new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
    });
  }

  private serializeNotes(document: ILearningNote | null) {
    if (!document) return [];
    return this.sortNotesByTimestamp(
      document.notes.map((note) => ({
        _id: String(note._id),
        content: note.content,
        timestampSec: note.timestampSec,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
      })),
    );
  }

  public async listNotes(userId: string, userRole: string, courseId: string, lessonId: string) {
    const access = await this.assertAccess(userId, userRole, courseId, lessonId);
    const document = await this.getOrMigrateNoteDocument(userId, access.courseId, access.lessonId);
    return this.serializeNotes(document);
  }

  public async createNote(
    userId: string,
    userRole: string,
    courseId: string,
    lessonId: string,
    content: string,
    timestampSec: number,
  ) {
    const access = await this.assertAccess(userId, userRole, courseId, lessonId);
    const normalizedContent = this.normalizeNoteContent(content);
    const normalizedTimestamp = this.normalizeTimestamp(timestampSec);
    let document = await this.getOrMigrateNoteDocument(userId, access.courseId, access.lessonId);

    if (!document) {
      document = await LearningNote.create({
        userId,
        courseId: access.courseId,
        lessonId: access.lessonId,
        notes: [],
      });
    }

    document.notes.push({
      _id: new Types.ObjectId(),
      content: normalizedContent,
      timestampSec: normalizedTimestamp,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await document.save();

    return this.serializeNotes(document);
  }

  public async updateNote(
    userId: string,
    userRole: string,
    courseId: string,
    lessonId: string,
    noteId: string,
    content: string,
    timestampSec: number,
  ) {
    const access = await this.assertAccess(userId, userRole, courseId, lessonId);
    const document = await this.getOrMigrateNoteDocument(userId, access.courseId, access.lessonId);
    if (!document) throw new Error('Ghi chú không tồn tại.');

    const note = document.notes.find((item) => String(item._id) === noteId);
    if (!note) throw new Error('Ghi chú không tồn tại.');

    note.content = this.normalizeNoteContent(content);
    note.timestampSec = this.normalizeTimestamp(timestampSec);
    await document.save();

    return this.serializeNotes(document);
  }

  public async deleteNote(
    userId: string,
    userRole: string,
    courseId: string,
    lessonId: string,
    noteId: string,
  ) {
    const access = await this.assertAccess(userId, userRole, courseId, lessonId);
    const document = await this.getOrMigrateNoteDocument(userId, access.courseId, access.lessonId);
    if (!document) throw new Error('Ghi chú không tồn tại.');

    const noteIndex = document.notes.findIndex((item) => String(item._id) === noteId);
    const note = noteIndex >= 0 ? document.notes[noteIndex] : null;
    if (!note) throw new Error('Ghi chú không tồn tại.');

    document.notes.splice(noteIndex, 1);
    await document.save();

    return this.serializeNotes(document);
  }

  private discussionCursor(cursor?: string, direction: 'before' | 'after' = 'before') {
    if (!cursor) return {};
    if (!Types.ObjectId.isValid(cursor)) throw new Error('Cursor thảo luận không hợp lệ.');
    return { _id: { [direction === 'before' ? '$lt' : '$gt']: new Types.ObjectId(cursor) } };
  }

  private serializeDiscussion(item: any, viewerId: string, isOwner: boolean) {
    const hiddenForViewer = Boolean(item.hiddenAt) && !isOwner;
    const deleted = Boolean(item.deletedAt);
    return {
      ...item,
      _id: String(item._id),
      courseId: String(item.courseId),
      lessonId: String(item.lessonId),
      parentId: item.parentId ? String(item.parentId) : null,
      replyToId: item.replyToId ? String(item.replyToId) : undefined,
      content: deleted ? 'Bình luận đã bị xóa' : hiddenForViewer ? 'Bình luận đã bị giảng viên ẩn' : item.content,
      canEdit: item.authorId === viewerId && !deleted,
      canDelete: item.authorId === viewerId && !deleted,
      canModerate: isOwner,
      hiddenForViewer,
    };
  }

  private async publishDiscussionNotification(
    routingKey: RoutingKey.DISCUSSION_CREATED | RoutingKey.DISCUSSION_REPLIED,
    payload: CourseDiscussionEventPayload,
  ) {
    if (!payload.recipientId || payload.recipientId === payload.actorId) return;
    try {
      await publishMessage(Exchange.COURSE, routingKey, payload);
    } catch (error) {
      console.error(JSON.stringify({
        event: 'course_discussion_notification_publish_failed',
        eventId: payload.eventId,
        discussionId: payload.discussionId,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  public async listDiscussions(userId: string, userRole: string, courseId: string, lessonId: string, query: { cursor?: string; limit?: number; focusId?: string } = {}) {
    const access = await this.assertAccess(userId, userRole, courseId, lessonId);
    const limit = Math.min(50, Math.max(1, Number(query.limit) || 20));
    const pinnedRows = query.cursor ? [] : await LessonDiscussion.find({
      courseId: access.courseId, lessonId: access.lessonId, parentId: null, pinnedAt: { $ne: null },
    }).sort({ pinnedAt: -1 }).limit(3).lean();
    const rows = await LessonDiscussion.find({
      courseId: access.courseId, lessonId: access.lessonId, parentId: null, pinnedAt: null,
      ...this.discussionCursor(query.cursor),
    }).sort({ _id: -1 }).limit(limit + 1).lean();
    const hasMore = rows.length > limit;
    const pageRows: any[] = [...pinnedRows, ...rows.slice(0, limit)];
    const nextCursor = hasMore ? String(pageRows[pageRows.length - 1]?._id || '') : null;
    if (!query.cursor && query.focusId && Types.ObjectId.isValid(query.focusId)) {
      const focused: any = await LessonDiscussion.findOne({
        _id: query.focusId,
        courseId: access.courseId,
        lessonId: access.lessonId,
      }).lean();
      const rootId = focused?.parentId || focused?._id;
      if (rootId) {
        let root: any = pageRows.find(item => String(item._id) === String(rootId));
        if (!root) {
          root = await LessonDiscussion.findOne({
            _id: rootId,
            courseId: access.courseId,
            lessonId: access.lessonId,
            parentId: null,
          }).lean();
          if (root) pageRows.splice(pinnedRows.length, 0, root);
        }
        if (root && focused?.parentId) root.focusReplyId = String(focused._id);
      }
    }
    await this.hydrateDiscussionAuthors(pageRows);
    const items = pageRows.map(item => this.serializeDiscussion(item, userId, access.isOwner));
    return { items, nextCursor, hasMore };
  }

  public async listDiscussionReplies(userId: string, userRole: string, courseId: string, lessonId: string, discussionId: string, query: { cursor?: string; limit?: number; focusId?: string } = {}) {
    const access = await this.assertAccess(userId, userRole, courseId, lessonId);
    if (!Types.ObjectId.isValid(discussionId)) throw new Error('Bình luận không hợp lệ.');
    const root = await LessonDiscussion.findOne({
      _id: discussionId, courseId: access.courseId, lessonId: access.lessonId, parentId: null,
    }).select('_id').lean();
    if (!root) throw new Error('Bình luận không tồn tại.');
    const limit = Math.min(30, Math.max(1, Number(query.limit) || 10));
    const rows = await LessonDiscussion.find({
      courseId: access.courseId, lessonId: access.lessonId, parentId: root._id, ...this.discussionCursor(query.cursor, 'after'),
    }).sort({ _id: 1 }).limit(limit + 1).lean();
    const hasMore = rows.length > limit;
    const pageRows = rows.slice(0, limit);
    await this.hydrateDiscussionAuthors(pageRows);
    const items = pageRows.map(item => this.serializeDiscussion(item, userId, access.isOwner));
    return { items, nextCursor: hasMore ? String(items[items.length - 1]?._id || '') : null, hasMore };
  }

  public async createDiscussion(
    user: { id: string; role: string; name: string }, courseId: string, lessonId: string,
    content: string, parentId?: string, replyToId?: string,
  ) {
    const access = await this.assertAccess(user.id, user.role, courseId, lessonId);
    const author = await this.getDiscussionAuthor(user);
    const normalizedContent = content.trim();
    if (!normalizedContent) throw new Error('Vui lòng nhập nội dung thảo luận.');
    if (normalizedContent.length > 2_000) throw new Error('Nội dung thảo luận tối đa 2.000 ký tự.');

    let parent: any = null;
    let replyTarget: any = null;
    if (parentId) {
      if (!Types.ObjectId.isValid(parentId)) throw new Error('Bình luận cha không hợp lệ.');
      const requestedParent: any = await LessonDiscussion.findOne({
        _id: parentId, courseId: access.courseId, lessonId: access.lessonId,
      });
      if (!requestedParent) throw new Error('Bình luận cha không tồn tại.');
      parent = requestedParent.parentId
        ? await LessonDiscussion.findOne({
          _id: requestedParent.parentId, courseId: access.courseId, lessonId: access.lessonId, parentId: null,
        })
        : requestedParent;
      if (!parent) throw new Error('Bình luận gốc không tồn tại.');

      const targetId = replyToId || requestedParent._id.toString();
      if (!Types.ObjectId.isValid(targetId)) throw new Error('Bình luận được trả lời không hợp lệ.');
      replyTarget = await LessonDiscussion.findOne({
        _id: targetId, courseId: access.courseId, lessonId: access.lessonId,
        $or: [{ _id: parent._id }, { parentId: parent._id }],
      });
      if (!replyTarget) throw new Error('Bình luận được trả lời không thuộc cuộc thảo luận này.');
    }

    const discussion = await LessonDiscussion.create({
      courseId: access.courseId, lessonId: access.lessonId, parentId: parent?._id || null,
      authorId: user.id, authorName: author.name || (access.isOwner ? 'Giảng viên' : 'Học viên'),
      authorAvatarUrl: author.avatarUrl,
      authorRole: access.isOwner ? 'INSTRUCTOR' : 'STUDENT',
      content: normalizedContent,
      replyToId: replyTarget?._id,
      replyToAuthorName: replyTarget?.authorName,
    });
    if (parent) await LessonDiscussion.updateOne({ _id: parent._id }, { $inc: { replyCount: 1 } });

    const serialized = this.serializeDiscussion(discussion.toObject(), user.id, access.isOwner);
    emitDiscussionCreated(courseId, lessonId, serialized);
    const payload: CourseDiscussionEventPayload = {
      eventId: new Types.ObjectId().toString(), discussionId: discussion.id,
      parentId: parent ? String(parent._id) : undefined,
      courseId, courseTitle: access.courseTitle, lessonId, lessonTitle: access.lessonTitle,
      actorId: user.id, actorName: discussion.authorName,
      recipientId: replyTarget ? replyTarget.authorId : access.instructorId,
      contentPreview: normalizedContent.slice(0, 240), occurredAt: new Date().toISOString(),
      actionUrl: `/student/courses/${courseId}/learn?lessonId=${lessonId}&discussionId=${discussion.id}`,
    };
    await this.publishDiscussionNotification(parent ? RoutingKey.DISCUSSION_REPLIED : RoutingKey.DISCUSSION_CREATED, payload);
    return serialized;
  }

  public async updateDiscussion(userId: string, userRole: string, courseId: string, lessonId: string, discussionId: string, content: string) {
    const access = await this.assertAccess(userId, userRole, courseId, lessonId);
    if (!Types.ObjectId.isValid(discussionId)) throw new Error('Bình luận không hợp lệ.');
    const normalized = content.trim();
    if (!normalized) throw new Error('Vui lòng nhập nội dung thảo luận.');
    if (normalized.length > 2_000) throw new Error('Nội dung thảo luận tối đa 2.000 ký tự.');
    const item: any = await LessonDiscussion.findOne({
      _id: discussionId, courseId: access.courseId, lessonId: access.lessonId, authorId: userId, deletedAt: null,
    });
    if (!item) throw new Error('Bạn không có quyền sửa bình luận này.');
    item.content = normalized; item.editedAt = new Date(); await item.save();
    const serialized = this.serializeDiscussion(item.toObject(), userId, access.isOwner);
    emitDiscussionUpdated(courseId, lessonId, serialized);
    return serialized;
  }

  public async deleteDiscussion(userId: string, userRole: string, courseId: string, lessonId: string, discussionId: string) {
    const access = await this.assertAccess(userId, userRole, courseId, lessonId);
    if (!Types.ObjectId.isValid(discussionId)) throw new Error('Bình luận không hợp lệ.');
    const item: any = await LessonDiscussion.findOne({
      _id: discussionId, courseId: access.courseId, lessonId: access.lessonId, authorId: userId, deletedAt: null,
    });
    if (!item) throw new Error('Bạn không có quyền xóa bình luận này.');
    item.deletedAt = new Date(); await item.save();
    const serialized = this.serializeDiscussion(item.toObject(), userId, access.isOwner);
    emitDiscussionDeleted(courseId, lessonId, serialized);
    return serialized;
  }

  public async moderateDiscussion(userId: string, userRole: string, courseId: string, lessonId: string, discussionId: string, hidden: boolean) {
    const access = await this.assertAccess(userId, userRole, courseId, lessonId);
    if (!access.isOwner) throw new Error('Chỉ chủ khóa học được quản lý bình luận.');
    if (!Types.ObjectId.isValid(discussionId)) throw new Error('Bình luận không hợp lệ.');
    const item: any = await LessonDiscussion.findOne({ _id: discussionId, courseId: access.courseId, lessonId: access.lessonId });
    if (!item) throw new Error('Bình luận không tồn tại.');
    item.hiddenAt = hidden ? new Date() : undefined;
    item.hiddenBy = hidden ? userId : undefined;
    if (hidden) {
      item.pinnedAt = undefined;
      item.pinnedBy = undefined;
    }
    await item.save();
    const serialized = this.serializeDiscussion(item.toObject(), userId, true);
    emitDiscussionHidden(courseId, lessonId, serialized);
    return serialized;
  }

  public async pinDiscussion(userId: string, userRole: string, courseId: string, lessonId: string, discussionId: string, pinned: boolean) {
    const access = await this.assertAccess(userId, userRole, courseId, lessonId);
    if (!access.isOwner) throw new Error('Chỉ chủ khóa học được ghim thảo luận.');
    if (!Types.ObjectId.isValid(discussionId)) throw new Error('Thảo luận không hợp lệ.');

    const item: any = await LessonDiscussion.findOne({
      _id: discussionId, courseId: access.courseId, lessonId: access.lessonId,
      parentId: null, deletedAt: null, hiddenAt: null,
    });
    if (!item) throw new Error('Chỉ có thể ghim thảo luận gốc đang hiển thị.');

    if (pinned && !item.pinnedAt) {
      const pinnedCount = await LessonDiscussion.countDocuments({
        courseId: access.courseId, lessonId: access.lessonId, parentId: null, pinnedAt: { $ne: null },
      });
      if (pinnedCount >= 3) throw new Error('Mỗi bài học chỉ được ghim tối đa 3 thảo luận.');
      item.pinnedAt = new Date();
      item.pinnedBy = userId;
    } else if (!pinned && item.pinnedAt) {
      item.pinnedAt = undefined;
      item.pinnedBy = undefined;
    }

    await item.save();
    const serialized = this.serializeDiscussion(item.toObject(), userId, true);
    emitDiscussionUpdated(courseId, lessonId, serialized);
    return serialized;
  }

  public async listCourseDiscussions(
    userId: string, userRole: string, courseId: string,
    query: { cursor?: string; limit?: number; lessonId?: string; search?: string; hidden?: string } = {},
  ) {
    if (!Types.ObjectId.isValid(courseId)) throw new Error('Khóa học không hợp lệ.');
    const course = await Course.findById(courseId).select('_id instructorId').lean();
    if (!course || userRole !== 'INSTRUCTOR' || course.instructorId !== userId) {
      throw new Error('Chỉ chủ khóa học được xem trang quản lý thảo luận.');
    }
    const filter: any = { courseId: new Types.ObjectId(courseId), ...this.discussionCursor(query.cursor) };
    if (query.lessonId) {
      if (!Types.ObjectId.isValid(query.lessonId)) throw new Error('Bài học không hợp lệ.');
      filter.lessonId = new Types.ObjectId(query.lessonId);
    }
    if (query.search?.trim()) {
      const escaped = query.search.trim().replace(/[.*+?^$()|[\]\\]/g, '\\$&');
      filter.content = { $regex: escaped, $options: 'i' };
    }
    if (query.hidden === 'true') filter.hiddenAt = { $ne: null };
    if (query.hidden === 'false') filter.hiddenAt = null;
    const limit = Math.min(50, Math.max(1, Number(query.limit) || 20));
    const rows = await LessonDiscussion.find(filter).sort({ _id: -1 }).limit(limit + 1).lean();
    const hasMore = rows.length > limit;
    const pageRows = rows.slice(0, limit);
    await this.hydrateDiscussionAuthors(pageRows);
    const items = pageRows.map(item => this.serializeDiscussion(item, userId, true));
    return { items, nextCursor: hasMore ? String(items[items.length - 1]?._id || '') : null, hasMore };
  }
}

export default new LearningInteractionService();





