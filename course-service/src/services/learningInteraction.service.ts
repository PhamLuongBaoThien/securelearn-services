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
import subscriptionAccessService from './subscriptionAccess.service';

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

  private async assertAccess(userId: string, userRole: string, courseId: string, lessonId: string) {
    const course = await Course.findById(courseId).select('_id instructorId currentVersionId').lean();
    if (!course?.currentVersionId) throw new Error('Khóa học không tồn tại.');

    const lesson = await Lesson.findOne({
      _id: lessonId,
      courseId: course.currentVersionId,
    }).select('_id').lean();
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

  public async listDiscussions(userId: string, userRole: string, courseId: string, lessonId: string) {
    const access = await this.assertAccess(userId, userRole, courseId, lessonId);
    return LessonDiscussion.find({ courseId: access.courseId, lessonId: access.lessonId })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
  }

  public async createDiscussion(
    user: { id: string; role: string; name: string },
    courseId: string,
    lessonId: string,
    content: string,
    timestampSec: number,
  ) {
    const access = await this.assertAccess(user.id, user.role, courseId, lessonId);
    const normalizedContent = content.trim();
    if (!normalizedContent) throw new Error('Vui lòng nhập nội dung thảo luận.');

    return LessonDiscussion.create({
      courseId: access.courseId,
      lessonId: access.lessonId,
      authorId: user.id,
      authorName: user.name || (access.isOwner ? 'Giảng viên' : 'Học viên'),
      authorRole: access.isOwner ? 'INSTRUCTOR' : 'STUDENT',
      content: normalizedContent,
      timestampSec: this.normalizeTimestamp(timestampSec),
    });
  }
}

export default new LearningInteractionService();
