// File này chứa domain Quiz cho lesson loại QUIZ.
// Ghi nhớ:
// - mỗi lesson quiz hiện có tối đa 1 quiz
// - API cho instructor và API cho học viên tách riêng
// - API cho học viên không được lộ đáp án đúng
import { Types } from 'mongoose';
import { Lesson, LessonStatus, LessonType } from '../models/lesson.model';
import { IQuizQuestion, Quiz, QuizQuestionType } from '../models/quiz.model';
import courseService from './course.service';
import lessonService from './lesson.service';

interface QuizPayload {
  title?: string;
  passingScore?: number;
  shuffleQuestions?: boolean;
  shuffleOptions?: boolean;
  timeLimitSec?: number | null;
  questions?: Array<{
    questionId?: string;
    type?: QuizQuestionType;
    prompt?: string;
    options?: Array<{ text?: string }>;
    correctOptionIndexes?: number[];
    explanation?: string;
    points?: number;
  }>;
}

class QuizService {
  // Tạo quiz xong sẽ bind trạng thái READY vào lesson tương ứng.
  public async createQuiz(courseId: string, lessonId: string, instructorId: string, payload: QuizPayload) {
    const lesson = await this.assertQuizLesson(courseId, lessonId, instructorId);
    const existingQuiz = await Quiz.findOne({ lessonId: lesson._id }).select('_id').lean();
    if (existingQuiz) {
      throw new Error('Bài học này đã có quiz. Vui lòng dùng cập nhật.');
    }

    const normalizedQuestions = this.normalizeQuestions(payload.questions || []);
    const quiz = await Quiz.create({
      courseId: lesson.courseId,
      lessonId: lesson._id,
      title: payload.title?.trim() || lesson.title,
      passingScore: payload.passingScore ?? 70, // điểm chuẩn
      shuffleQuestions: Boolean(payload.shuffleQuestions), //xáo trộn câu hỏi
      shuffleOptions: Boolean(payload.shuffleOptions), // xáo trộn đáp án
      timeLimitSec: payload.timeLimitSec ?? null, // giới hạn thời gian
      questions: normalizedQuestions, // câu hỏi
    });

    await lessonService.bindQuiz(courseId, lessonId, instructorId);
    return quiz;
  }

  public async updateQuiz(courseId: string, lessonId: string, instructorId: string, payload: QuizPayload) {
    const lesson = await this.assertQuizLesson(courseId, lessonId, instructorId);
    const quiz = await Quiz.findOne({ lessonId: lesson._id, courseId: lesson.courseId });
    if (!quiz) throw new Error('Quiz không tồn tại.');

    if (payload.title !== undefined) quiz.title = payload.title.trim() || lesson.title;
    if (payload.passingScore !== undefined) quiz.passingScore = payload.passingScore;
    if (payload.shuffleQuestions !== undefined) quiz.shuffleQuestions = Boolean(payload.shuffleQuestions);
    if (payload.shuffleOptions !== undefined) quiz.shuffleOptions = Boolean(payload.shuffleOptions);
    if (payload.timeLimitSec !== undefined) quiz.timeLimitSec = payload.timeLimitSec ?? null;
    if (payload.questions !== undefined) quiz.questions = this.normalizeQuestions(payload.questions);

    await quiz.save();
    lesson.status = quiz.questions.length > 0 ? LessonStatus.READY : LessonStatus.DRAFT;
    await lesson.save();
    return quiz;
  }

  // Khi instructor làm bài test/editor, dùng API manage để lấy đầy đủ quiz.
  public async getQuizForManage(courseId: string, lessonId: string, instructorId: string) {
    const lesson = await this.assertQuizLesson(courseId, lessonId, instructorId);
    return Quiz.findOne({ lessonId: lesson._id, courseId: lesson.courseId }).lean();
  }

  // Đây là payload dành cho học viên làm bài, đã ẩn đáp án đúng.
  public async getQuizForAttempt(courseId: string, lessonId: string, _userId: string) {
    const lesson = await Lesson.findOne({ courseId, _id: lessonId }).lean();
    if (!lesson) throw new Error('Bài học không tồn tại.');
    if (lesson.type !== LessonType.QUIZ) throw new Error('Bài học này chưa có quiz.');

    const quiz = await Quiz.findOne({ lessonId: lesson._id, courseId: lesson.courseId }).lean();
    if (!quiz) throw new Error('Quiz không tồn tại.');

    return {
      _id: quiz._id.toString(),
      title: quiz.title,
      passingScore: quiz.passingScore,
      shuffleQuestions: quiz.shuffleQuestions,
      shuffleOptions: quiz.shuffleOptions,
      timeLimitSec: quiz.timeLimitSec,
      questions: quiz.questions.map((question) => ({
        questionId: question.questionId,
        type: question.type,
        prompt: question.prompt,
        options: question.options,
        explanation: '',
        points: question.points,
      })),
    };
  }
  // kiểm tra quyền của instructor và bài học có phải là QUIZ không.
  private async assertQuizLesson(courseId: string, lessonId: string, _instructorId: string) {
    await courseService.getOwnedCourseOrThrow(courseId, _instructorId);
    const lesson = await Lesson.findOne({ _id: lessonId, courseId });
    if (!lesson) throw new Error('Bài học không tồn tại.');
    if (lesson.type !== LessonType.QUIZ) throw new Error('Bài học này không phải loại quiz.');
    return lesson;
  }

  // Chuẩn hóa và validate bộ câu hỏi trước khi lưu.
  private normalizeQuestions(questions: QuizPayload['questions']): IQuizQuestion[] {
    if (!questions || questions.length === 0) return [];

    return questions.map((question, index) => {
      const prompt = question.prompt?.trim();
      if (!prompt) throw new Error(`Câu hỏi #${index + 1} chưa có nội dung.`);

      const type = question.type && Object.values(QuizQuestionType).includes(question.type)
        ? question.type
        : QuizQuestionType.SINGLE_CHOICE;

      const options = (question.options || [])
        .map((option) => ({ text: option.text?.trim() || '' }))
        .filter((option) => option.text.length > 0);

      if (options.length < 2) {
        throw new Error(`Câu hỏi #${index + 1} phải có ít nhất 2 lựa chọn.`);
      }

      const correctOptionIndexes = Array.from(new Set(question.correctOptionIndexes || []));
      if (correctOptionIndexes.length === 0) {
        throw new Error(`Câu hỏi #${index + 1} phải có ít nhất 1 đáp án đúng.`);
      }

      const maxIndex = options.length - 1;
      if (correctOptionIndexes.some((value) => value < 0 || value > maxIndex)) {
        throw new Error(`Câu hỏi #${index + 1} có đáp án đúng không hợp lệ.`);
      }

      if (type === QuizQuestionType.SINGLE_CHOICE || type === QuizQuestionType.TRUE_FALSE) {
        if (correctOptionIndexes.length !== 1) {
          throw new Error(`Câu hỏi #${index + 1} chỉ được có 1 đáp án đúng.`);
        }
      }

      return {
        questionId: question.questionId?.trim() || new Types.ObjectId().toString(),
        type,
        prompt,
        options,
        correctOptionIndexes,
        explanation: question.explanation?.trim() || '',
        points: question.points ?? 1,
      };
    });
  }
}

export default new QuizService();
