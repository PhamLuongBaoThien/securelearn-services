// ========================
// Learning Interaction Service
// Mục đích:
// - kiểm tra quyền trước khi đọc/ghi ghi chú và thảo luận bài học
// - cung cấp dữ liệu tương tác thật cho màn học
// ========================
import { Types } from 'mongoose';
import { Course } from '../models/course.model';
import { CourseVersion } from '../models/courseVersion.model';
import { Lesson } from '../models/lesson.model';
import { ILearningNote, LearningNote } from '../models/learningNote.model';
import { LessonDiscussion } from '../models/lessonDiscussion.model';
import { LessonDiscussionReaction } from '../models/lessonDiscussionReaction.model';
import { Exchange, RoutingKey, publishMessage, type CourseDiscussionEventPayload } from '@securelearn/common';
import { emitDiscussionCreated, emitDiscussionDeleted, emitDiscussionHidden, emitDiscussionUpdated } from './discussionRealtime.service';
import subscriptionAccessService from './subscriptionAccess.service';
import { identityGrpcClient } from '../grpc/identity.client';
import { buildInteractionLessonScope, resolveLessonIdentityId } from '../utils/lessonIdentity.utils';

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

  private async assertAccess(userId: string, userRole: string, courseId: string, requestedLessonId: string) {
    const course = await Course.findById(courseId).select('_id title instructorId currentVersionId').lean();
    if (!course?.currentVersionId) throw new Error('Khóa học không tồn tại.');

    let lesson = Types.ObjectId.isValid(requestedLessonId)
      ? await Lesson.findOne({
          _id: requestedLessonId,
          courseId: course.currentVersionId,
        }).select('_id courseId sourceLessonId title').lean()
      : null;

    // Deep link thông báo có thể giữ lessonId của version cũ. Quy đổi nó về lesson
    // hiện tại thông qua sourceLessonId ổn định, nhưng chỉ khi version cũ thuộc đúng course.
    if (!lesson && Types.ObjectId.isValid(requestedLessonId)) {
      const historicalLesson = await Lesson.findById(requestedLessonId)
        .select('_id courseId sourceLessonId')
        .lean();
      if (historicalLesson) {
        const belongsToCourse = await CourseVersion.exists({
          _id: historicalLesson.courseId,
          courseId: course._id,
        });
        if (belongsToCourse) {
          const historicalIdentityId = historicalLesson.sourceLessonId || historicalLesson._id;
          lesson = await Lesson.findOne({
            courseId: course.currentVersionId,
            $or: [
              { _id: historicalIdentityId },
              { sourceLessonId: historicalIdentityId },
            ],
          }).select('_id courseId sourceLessonId title').lean();
        }
      }
    }
    if (!lesson) throw new Error('Bài học không thuộc khóa học này.');

    const lessonIdentityId = resolveLessonIdentityId(lesson);
    const courseVersionIds = await CourseVersion.find({ courseId: course._id }).distinct('_id');
    const compatibleLessons = await Lesson.find({
      courseId: { $in: courseVersionIds },
      $or: [
        { _id: lessonIdentityId },
        { sourceLessonId: lessonIdentityId },
      ],
    }).select('_id').lean();
    const compatibleLessonIds = compatibleLessons.map((item) => new Types.ObjectId(item._id));

    const isOwner = userRole === 'INSTRUCTOR' && course.instructorId === userId;
    if (!isOwner) {
      const access = await subscriptionAccessService.entitlement(userId, courseId);
      if (!access.allowed) throw new Error('Bạn không có quyền truy cập khóa học này.');
    }

    return {
      courseId: new Types.ObjectId(course._id),
      lessonId: new Types.ObjectId(lesson._id),
      lessonIdentityId,
      compatibleLessonIds,
      isOwner,
      instructorId: course.instructorId,
      courseTitle: course.title || 'Khóa học',
      lessonTitle: lesson.title || 'Bài học',
    };
  }

  private interactionLessonScope(access: {
    lessonIdentityId: Types.ObjectId;
    compatibleLessonIds: Types.ObjectId[];
  }) {
    return buildInteractionLessonScope(
      access.lessonIdentityId,
      access.compatibleLessonIds,
    );
  }

  private discussionFilter(
    access: {
      courseId: Types.ObjectId;
      lessonIdentityId: Types.ObjectId;
      compatibleLessonIds: Types.ObjectId[];
    },
    filter: Record<string, unknown> = {},
  ) {
    return {
      courseId: access.courseId,
      ...filter,
      $and: [this.interactionLessonScope(access)],
    };
  }

  private async getOrMigrateNoteDocument(
    userId: string,
    access: {
      courseId: Types.ObjectId;
      lessonId: Types.ObjectId;
      lessonIdentityId: Types.ObjectId;
      compatibleLessonIds: Types.ObjectId[];
    },
  ) {
    const documents = await LearningNote.find({
      userId,
      courseId: access.courseId,
      $and: [this.interactionLessonScope(access)],
    }).sort({ updatedAt: -1 });
    if (!documents.length) return null;

    const canonical = documents.find((item) => item.lessonId.equals(access.lessonId)) || documents[0];
    const noteIds = new Set<string>();
    const mergedNotes: ILearningNote['notes'] = [];

    for (const document of documents) {
      const hasLegacyNote = this.stripHtml(document.content || '');
      if (!document.notes.length && hasLegacyNote) {
        document.notes.push({
          _id: new Types.ObjectId(),
          content: document.content!,
          timestampSec: this.normalizeTimestamp(document.timestampSec || 0),
          createdAt: document.createdAt,
          updatedAt: document.updatedAt,
        });
      }
      for (const note of document.notes) {
        const noteId = String(note._id);
        if (noteIds.has(noteId)) continue;
        noteIds.add(noteId);
        mergedNotes.push(note);
      }
    }

    canonical.lessonId = access.lessonId;
    canonical.lessonIdentityId = access.lessonIdentityId;
    canonical.notes = mergedNotes;
    canonical.content = '';
    canonical.timestampSec = 0;
    await canonical.save();

    const duplicateIds = documents
      .filter((item) => !item._id.equals(canonical._id))
      .map((item) => item._id);
    if (duplicateIds.length) {
      await LearningNote.deleteMany({ _id: { $in: duplicateIds } });
    }

    return canonical;
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
    const document = await this.getOrMigrateNoteDocument(userId, access);
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
    let document = await this.getOrMigrateNoteDocument(userId, access);

    if (!document) {
      document = await LearningNote.create({
        userId,
        courseId: access.courseId,
        lessonId: access.lessonId,
        lessonIdentityId: access.lessonIdentityId,
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
    const document = await this.getOrMigrateNoteDocument(userId, access);
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
    const document = await this.getOrMigrateNoteDocument(userId, access);
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

  private async hydrateDiscussionReactions(items: any[], viewerId: string) {
    const ids = items.map(item => item._id).filter(Boolean);
    if (!ids.length) return;
    const reactions = await LessonDiscussionReaction.find({ discussionId: { $in: ids }, userId: viewerId })
      .select('discussionId').lean();
    const likedIds = new Set(reactions.map(item => String(item.discussionId)));
    items.forEach(item => { item.likedByViewer = likedIds.has(String(item._id)); });
  }

  private popularDiscussionCursor(cursor?: string) {
    if (!cursor) return {};
    const separator = cursor.indexOf('_');
    const likeCount = Number(cursor.slice(0, separator));
    const id = cursor.slice(separator + 1);
    if (separator < 1 || !Number.isFinite(likeCount) || !Types.ObjectId.isValid(id)) {
      throw new Error('Cursor thảo luận không hợp lệ.');
    }
    return { $or: [
      { likeCount: { $lt: likeCount } },
      { likeCount, _id: { $lt: new Types.ObjectId(id) } },
    ] };
  }

  private serializeDiscussion(item: any, viewerId: string, isOwner: boolean, currentLessonId?: string) {
    const hiddenForViewer = Boolean(item.hiddenAt) && !isOwner;
    const deleted = Boolean(item.deletedAt);
    return {
      ...item,
      _id: String(item._id),
      courseId: String(item.courseId),
      lessonId: currentLessonId || String(item.lessonId),
      parentId: item.parentId ? String(item.parentId) : null,
      replyToId: item.replyToId ? String(item.replyToId) : undefined,
      content: deleted ? 'Bình luận đã bị xóa' : hiddenForViewer ? 'Bình luận đã bị người giảng dạy ẩn' : item.content,
      canEdit: item.authorId === viewerId && !deleted,
      canDelete: item.authorId === viewerId && !deleted,
      canModerate: isOwner,
      hiddenForViewer,
    };
  }

  private async normalizeDiscussionLessonReferences(
    items: any[],
    access: {
      courseId: Types.ObjectId;
      lessonId: Types.ObjectId;
      lessonIdentityId: Types.ObjectId;
    },
  ) {
    const discussionIds = items.map((item) => item?._id).filter(Boolean);
    if (!discussionIds.length) return;

    await Promise.all([
      LessonDiscussion.updateMany(
        { _id: { $in: discussionIds } },
        { $set: { lessonId: access.lessonId, lessonIdentityId: access.lessonIdentityId } },
      ),
      LessonDiscussionReaction.updateMany(
        { discussionId: { $in: discussionIds } },
        {
          $set: {
            courseId: access.courseId,
            lessonId: access.lessonId,
            lessonIdentityId: access.lessonIdentityId,
          },
        },
      ),
    ]);

    for (const item of items) {
      item.lessonId = access.lessonId;
      item.lessonIdentityId = access.lessonIdentityId;
    }
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

  public async listDiscussions(userId: string, userRole: string, courseId: string, lessonId: string, query: { cursor?: string; limit?: number; focusId?: string; sort?: string } = {}) {
    const access = await this.assertAccess(userId, userRole, courseId, lessonId);
    const limit = Math.min(50, Math.max(1, Number(query.limit) || 20));
    const sort = query.sort === 'popular' ? 'popular' : 'latest';
    const pinnedRows = query.cursor ? [] : await LessonDiscussion.find(this.discussionFilter(access, {
      parentId: null, pinnedAt: { $ne: null },
    })).sort({ pinnedAt: -1 }).limit(3).lean();
    const cursorFilter = sort === 'popular'
      ? this.popularDiscussionCursor(query.cursor)
      : this.discussionCursor(query.cursor);
    const rows = await LessonDiscussion.find(this.discussionFilter(access, {
      parentId: null, pinnedAt: null, ...cursorFilter,
    })).sort(sort === 'popular' ? { likeCount: -1, _id: -1 } : { _id: -1 }).limit(limit + 1).lean();
    const hasMore = rows.length > limit;
    const unpinnedRows = rows.slice(0, limit);
    const pageRows: any[] = [...pinnedRows, ...unpinnedRows];
    const lastUnpinned = unpinnedRows[unpinnedRows.length - 1];
    const nextCursor = hasMore && lastUnpinned
      ? sort === 'popular' ? `${Number(lastUnpinned.likeCount) || 0}_${lastUnpinned._id}` : String(lastUnpinned._id)
      : null;
    if (!query.cursor && query.focusId && Types.ObjectId.isValid(query.focusId)) {
      const focused: any = await LessonDiscussion.findOne(this.discussionFilter(access, {
        _id: query.focusId,
      })).lean();
      const rootId = focused?.parentId || focused?._id;
      if (rootId) {
        let root: any = pageRows.find(item => String(item._id) === String(rootId));
        if (!root) {
          root = await LessonDiscussion.findOne(this.discussionFilter(access, {
            _id: rootId, parentId: null,
          })).lean();
          if (root) pageRows.splice(pinnedRows.length, 0, root);
        }
        if (root && focused?.parentId) root.focusReplyId = String(focused._id);
      }
    }
    await this.normalizeDiscussionLessonReferences(pageRows, access);
    await Promise.all([this.hydrateDiscussionAuthors(pageRows), this.hydrateDiscussionReactions(pageRows, userId)]);
    const items = pageRows.map(item => this.serializeDiscussion(item, userId, access.isOwner, String(access.lessonId)));
    return { items, nextCursor, hasMore };
  }
  public async listDiscussionReplies(userId: string, userRole: string, courseId: string, lessonId: string, discussionId: string, query: { cursor?: string; limit?: number; focusId?: string } = {}) {
    const access = await this.assertAccess(userId, userRole, courseId, lessonId);
    if (!Types.ObjectId.isValid(discussionId)) throw new Error('Bình luận không hợp lệ.');
    const root = await LessonDiscussion.findOne(this.discussionFilter(access, {
      _id: discussionId, parentId: null,
    })).select('_id').lean();
    if (!root) throw new Error('Bình luận không tồn tại.');
    const limit = Math.min(30, Math.max(1, Number(query.limit) || 10));
    const rows = await LessonDiscussion.find(this.discussionFilter(access, {
      parentId: root._id, ...this.discussionCursor(query.cursor, 'after'),
    })).sort({ _id: 1 }).limit(limit + 1).lean();
    const hasMore = rows.length > limit;
    const pageRows = rows.slice(0, limit);
    await this.normalizeDiscussionLessonReferences(pageRows, access);
    await this.hydrateDiscussionAuthors(pageRows);
    const items = pageRows.map(item => this.serializeDiscussion(item, userId, access.isOwner, String(access.lessonId)));
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
      const requestedParent: any = await LessonDiscussion.findOne(this.discussionFilter(access, {
        _id: parentId,
      }));
      if (!requestedParent) throw new Error('Bình luận cha không tồn tại.');
      parent = requestedParent.parentId
        ? await LessonDiscussion.findOne(this.discussionFilter(access, {
          _id: requestedParent.parentId, parentId: null,
        }))
        : requestedParent;
      if (!parent) throw new Error('Bình luận gốc không tồn tại.');

      const targetId = replyToId || requestedParent._id.toString();
      if (!Types.ObjectId.isValid(targetId)) throw new Error('Bình luận được trả lời không hợp lệ.');
      replyTarget = await LessonDiscussion.findOne(this.discussionFilter(access, {
        _id: targetId,
        $or: [{ _id: parent._id }, { parentId: parent._id }],
      }));
      if (!replyTarget) throw new Error('Bình luận được trả lời không thuộc cuộc thảo luận này.');
    }

    const discussion = await LessonDiscussion.create({
      courseId: access.courseId, lessonId: access.lessonId, lessonIdentityId: access.lessonIdentityId,
      parentId: parent?._id || null,
      authorId: user.id, authorName: author.name || (access.isOwner ? 'Người giảng dạy' : 'Học viên'),
      authorAvatarUrl: author.avatarUrl,
      authorRole: access.isOwner ? 'INSTRUCTOR' : 'STUDENT',
      content: normalizedContent,
      replyToId: replyTarget?._id,
      replyToAuthorName: replyTarget?.authorName,
    });
    if (parent) await LessonDiscussion.updateOne({ _id: parent._id }, { $inc: { replyCount: 1 } });

    const serialized = this.serializeDiscussion(discussion.toObject(), user.id, access.isOwner, String(access.lessonId));
    emitDiscussionCreated(courseId, String(access.lessonId), serialized, access.instructorId);
    const payload: CourseDiscussionEventPayload = {
      eventId: new Types.ObjectId().toString(), discussionId: discussion.id,
      parentId: parent ? String(parent._id) : undefined,
      courseId, courseTitle: access.courseTitle, lessonId: String(access.lessonId), lessonTitle: access.lessonTitle,
      actorId: user.id, actorName: discussion.authorName,
      recipientId: replyTarget ? replyTarget.authorId : access.instructorId,
      contentPreview: normalizedContent.slice(0, 240), occurredAt: new Date().toISOString(),
      actionUrl: `/student/courses/${courseId}/learn?lessonId=${access.lessonId}&discussionId=${discussion.id}`,
    };
    await this.publishDiscussionNotification(parent ? RoutingKey.DISCUSSION_REPLIED : RoutingKey.DISCUSSION_CREATED, payload);
    return serialized;
  }

  public async setDiscussionReaction(userId: string, userRole: string, courseId: string, lessonId: string, discussionId: string, liked: boolean) {
    const access = await this.assertAccess(userId, userRole, courseId, lessonId);
    if (!Types.ObjectId.isValid(discussionId)) throw new Error('Thảo luận không hợp lệ.');
    const item: any = await LessonDiscussion.findOne(this.discussionFilter(access, {
      _id: discussionId, deletedAt: null, hiddenAt: null,
    }));
    if (!item) throw new Error('Thảo luận không tồn tại hoặc đã bị ẩn.');
    await this.normalizeDiscussionLessonReferences([item], access);

    if (liked) {
      try {
        await LessonDiscussionReaction.create({
          discussionId: item._id, courseId: access.courseId, lessonId: access.lessonId,
          lessonIdentityId: access.lessonIdentityId, userId,
        });
        item.likeCount = (Number(item.likeCount) || 0) + 1;
        await item.save();
      } catch (error: any) {
        if (error?.code !== 11000) throw error;
      }
    } else {
      const removed = await LessonDiscussionReaction.findOneAndDelete({ discussionId: item._id, userId });
      if (removed) {
        item.likeCount = Math.max(0, (Number(item.likeCount) || 0) - 1);
        await item.save();
      }
    }

    const updated = await LessonDiscussion.findById(item._id).lean();
    const serialized = this.serializeDiscussion({ ...updated, likedByViewer: liked }, userId, access.isOwner, String(access.lessonId));
    emitDiscussionUpdated(courseId, String(access.lessonId), serialized, access.instructorId);
    return serialized;
  }
  public async updateDiscussion(userId: string, userRole: string, courseId: string, lessonId: string, discussionId: string, content: string) {
    const access = await this.assertAccess(userId, userRole, courseId, lessonId);
    if (!Types.ObjectId.isValid(discussionId)) throw new Error('Bình luận không hợp lệ.');
    const normalized = content.trim();
    if (!normalized) throw new Error('Vui lòng nhập nội dung thảo luận.');
    if (normalized.length > 2_000) throw new Error('Nội dung thảo luận tối đa 2.000 ký tự.');
    const item: any = await LessonDiscussion.findOne(this.discussionFilter(access, {
      _id: discussionId, authorId: userId, deletedAt: null,
    }));
    if (!item) throw new Error('Bạn không có quyền sửa bình luận này.');
    await this.normalizeDiscussionLessonReferences([item], access);
    item.content = normalized; item.editedAt = new Date(); await item.save();
    const serialized = this.serializeDiscussion(item.toObject(), userId, access.isOwner, String(access.lessonId));
    emitDiscussionUpdated(courseId, String(access.lessonId), serialized, access.instructorId);
    return serialized;
  }

  public async deleteDiscussion(userId: string, userRole: string, courseId: string, lessonId: string, discussionId: string) {
    const access = await this.assertAccess(userId, userRole, courseId, lessonId);
    if (!Types.ObjectId.isValid(discussionId)) throw new Error('Bình luận không hợp lệ.');
    const item: any = await LessonDiscussion.findOne(this.discussionFilter(access, {
      _id: discussionId, authorId: userId, deletedAt: null,
    }));
    if (!item) throw new Error('Bạn không có quyền xóa bình luận này.');
    await this.normalizeDiscussionLessonReferences([item], access);
    item.deletedAt = new Date(); await item.save();
    const serialized = this.serializeDiscussion(item.toObject(), userId, access.isOwner, String(access.lessonId));
    emitDiscussionDeleted(courseId, String(access.lessonId), serialized, access.instructorId);
    return serialized;
  }

  public async moderateDiscussion(userId: string, userRole: string, courseId: string, lessonId: string, discussionId: string, hidden: boolean) {
    const access = await this.assertAccess(userId, userRole, courseId, lessonId);
    if (!access.isOwner) throw new Error('Chỉ chủ khóa học được quản lý bình luận.');
    if (!Types.ObjectId.isValid(discussionId)) throw new Error('Bình luận không hợp lệ.');
    const item: any = await LessonDiscussion.findOne(this.discussionFilter(access, { _id: discussionId }));
    if (!item) throw new Error('Bình luận không tồn tại.');
    await this.normalizeDiscussionLessonReferences([item], access);
    item.hiddenAt = hidden ? new Date() : undefined;
    item.hiddenBy = hidden ? userId : undefined;
    if (hidden) {
      item.pinnedAt = undefined;
      item.pinnedBy = undefined;
    }
    await item.save();
    const serialized = this.serializeDiscussion(item.toObject(), userId, true, String(access.lessonId));
    emitDiscussionHidden(courseId, String(access.lessonId), serialized, access.instructorId);
    return serialized;
  }

  public async pinDiscussion(userId: string, userRole: string, courseId: string, lessonId: string, discussionId: string, pinned: boolean) {
    const access = await this.assertAccess(userId, userRole, courseId, lessonId);
    if (!access.isOwner) throw new Error('Chỉ chủ khóa học được ghim thảo luận.');
    if (!Types.ObjectId.isValid(discussionId)) throw new Error('Thảo luận không hợp lệ.');

    const item: any = await LessonDiscussion.findOne(this.discussionFilter(access, {
      _id: discussionId, parentId: null, deletedAt: null, hiddenAt: null,
    }));
    if (!item) throw new Error('Chỉ có thể ghim thảo luận gốc đang hiển thị.');
    await this.normalizeDiscussionLessonReferences([item], access);

    if (pinned && !item.pinnedAt) {
      const pinnedCount = await LessonDiscussion.countDocuments(this.discussionFilter(access, {
        parentId: null, pinnedAt: { $ne: null },
      }));
      if (pinnedCount >= 3) throw new Error('Mỗi bài học chỉ được ghim tối đa 3 thảo luận.');
      item.pinnedAt = new Date();
      item.pinnedBy = userId;
    } else if (!pinned && item.pinnedAt) {
      item.pinnedAt = undefined;
      item.pinnedBy = undefined;
    }

    await item.save();
    const serialized = this.serializeDiscussion(item.toObject(), userId, true, String(access.lessonId));
    emitDiscussionUpdated(courseId, String(access.lessonId), serialized, access.instructorId);
    return serialized;
  }

  public async resolveDiscussionContext(
    userId: string,
    userRole: string,
    courseId: string,
    discussionId: string,
  ) {
    if (!Types.ObjectId.isValid(courseId) || !Types.ObjectId.isValid(discussionId)) {
      throw new Error('Thảo luận không hợp lệ.');
    }
    const discussion = await LessonDiscussion.findOne({
      _id: discussionId,
      courseId: new Types.ObjectId(courseId),
    });
    if (!discussion) throw new Error('Thảo luận không tồn tại.');

    const access = await this.assertAccess(
      userId,
      userRole,
      courseId,
      String(discussion.lessonId),
    );
    await this.normalizeDiscussionLessonReferences([discussion], access);

    return {
      courseId,
      lessonId: String(access.lessonId),
      discussionId,
    };
  }

  public async listInstructorDiscussions(
    userId: string,
    query: { cursor?: string; limit?: number; courseId?: string; lessonId?: string; search?: string; hidden?: string } = {},
  ) {
    const courses = await Course.find({ instructorId: userId }).select('_id title').lean();
    const courseIds = courses.map(course => course._id);
    const courseNames = new Map(courses.map(course => [String(course._id), course.title]));
    const filter: any = {
      courseId: { $in: courseIds },
      parentId: null,
      ...this.discussionCursor(query.cursor),
    };
    if (query.courseId) {
      if (!courseNames.has(String(query.courseId))) throw new Error('Khóa học không thuộc quyền quản lý của bạn.');
      filter.courseId = new Types.ObjectId(String(query.courseId));
    }
    if (query.lessonId) filter.lessonId = new Types.ObjectId(String(query.lessonId));
    if (query.search?.trim()) filter.content = { $regex: query.search.trim().replace(/[.*+?^$()|[\]\\]/g, '\\$&'), $options: 'i' };
    if (query.hidden === 'true') filter.hiddenAt = { $ne: null };
    if (query.hidden === 'false') filter.hiddenAt = null;
    const limit = Math.min(50, Math.max(1, Number(query.limit) || 20));
    const rows = await LessonDiscussion.find(filter).sort({ _id: -1 }).limit(limit + 1).lean();
    const pageRows = rows.slice(0, limit); await this.hydrateDiscussionAuthors(pageRows);
    const items = pageRows.map(item => ({ ...this.serializeDiscussion(item, userId, true), courseTitle: courseNames.get(String(item.courseId)) || '' }));
    return { items, nextCursor: rows.length > limit ? String(items[items.length - 1]?._id || '') : null, hasMore: rows.length > limit };
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
    const filter: any = {
      courseId: new Types.ObjectId(courseId),
      parentId: null,
      ...this.discussionCursor(query.cursor),
    };
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





