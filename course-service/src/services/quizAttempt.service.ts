// File này chứa flow làm quiz của học viên.
// Ghi nhớ:
// - startAttempt tạo lượt làm bài
// - submitAttempt chấm điểm và khóa lượt làm bài
// - logic hiện tại phù hợp nhất với kiểu 1 đáp án chọn duy nhất
import { Types } from 'mongoose';
import { QuizAttempt, QuizAttemptStatus } from '../models/quizAttempt.model';
import { Quiz } from '../models/quiz.model';
import { Course, CourseStatus } from '../models/course.model';
import { CourseVersion } from '../models/courseVersion.model';
import { Lesson } from '../models/lesson.model';
import { resolveLessonIdentityId } from '../utils/lessonIdentity.utils';

class QuizAttemptService {
  public async listAttempts(courseId: string, lessonId: string, quizId: string, userId: string) {
    const context = await this.resolveCourseQuizContext(courseId);
    const [quiz, currentLesson] = await Promise.all([
      Quiz.findOne({ _id: quizId, lessonId, courseId: context.versionId }).select('_id').lean(),
      Lesson.findOne({ _id: lessonId, courseId: context.versionId })
        .select('_id sourceLessonId')
        .lean(),
    ]);
    if (!quiz || !currentLesson) throw new Error('Quiz không tồn tại.');

    // Mỗi lần tạo phiên bản khóa học, Lesson và Quiz nhận _id mới. sourceLessonId
    // giữ định danh logic của bài học để có thể truy xuất các lượt làm ở phiên bản cũ
    // mà không chuyển chúng sang quiz hiện tại hoặc dùng chúng để chấm điểm hiện tại.
    const lessonIdentityId = resolveLessonIdentityId(currentLesson);
    const courseVersionIds = await CourseVersion.find({ courseId: context.courseId }).distinct('_id');
    const compatibleLessons = await Lesson.find({
      courseId: { $in: courseVersionIds },
      $or: [
        { _id: lessonIdentityId },
        { sourceLessonId: lessonIdentityId },
      ],
    })
      .select('_id')
      .lean();
    const compatibleLessonIds = compatibleLessons.map((lesson) => new Types.ObjectId(lesson._id));

    const attempts = await QuizAttempt.find({
      courseId: context.courseId,
      lessonId: { $in: compatibleLessonIds },
      userId,
    })
      .sort({ startedAt: -1 })
      .select('_id score passed status startedAt completedAt createdAt updatedAt')
      .lean();

    return {
      totalAttempts: attempts.length,
      submittedAttempts: attempts.filter((attempt) => attempt.status === QuizAttemptStatus.SUBMITTED).length,
      bestScore: attempts.reduce((best, attempt) => Math.max(best, attempt.score || 0), 0),
      attempts: attempts.map((attempt, index) => ({
        attemptId: attempt._id.toString(),
        attemptNumber: attempts.length - index,
        score: attempt.score || 0,
        passed: Boolean(attempt.passed),
        status: attempt.status,
        startedAt: attempt.startedAt,
        completedAt: attempt.completedAt,
      })),
    };
  }

  // Xác minh quiz thuộc phiên bản khóa học hiện tại và tạo một lượt làm mới
  // ở trạng thái IN_PROGRESS trước khi người học bắt đầu trả lời câu hỏi.
  public async startAttempt(courseId: string, lessonId: string, quizId: string, userId: string) {
    const context = await this.resolveCourseQuizContext(courseId);
    const quiz = await Quiz.findOne({ _id: quizId, lessonId, courseId: context.versionId }).lean();
    if (!quiz) throw new Error('Quiz không tồn tại.');

    const attempt = await QuizAttempt.create({
      quizId: quiz._id,
      lessonId: quiz.lessonId,
      courseId: context.courseId,
      courseVersionId: context.versionId,
      userId,
      answers: [],
      score: 0,
      passed: false,
      status: QuizAttemptStatus.IN_PROGRESS,
      startedAt: new Date(),
      completedAt: null,
    });

    return attempt;
  }

  // Lưu ý: answers hiện là 1 selectedIndex cho mỗi questionId.
  // Hàm này nhận cả selectedIndex cũ và selectedIndexes mới để hỗ trợ tương thích ngược.
  public async submitAttempt(
    courseId: string,
    lessonId: string,
    quizId: string,
    attemptId: string,
    userId: string,
    answers: Array<{ questionId: string; selectedIndex?: number; selectedIndexes?: number[] }>
  ) {
    const context = await this.resolveCourseQuizContext(courseId);
    const [quiz, attempt] = await Promise.all([
      Quiz.findOne({ _id: quizId, lessonId, courseId: context.versionId }).lean(),
      QuizAttempt.findOne({ _id: attemptId, quizId, courseId: context.courseId, courseVersionId: context.versionId, lessonId, userId }),
    ]);

    if (!quiz) throw new Error('Quiz không tồn tại.');
    if (!attempt) throw new Error('Lượt làm bài không tồn tại.');
    if (attempt.status === QuizAttemptStatus.SUBMITTED) {
      throw new Error('Lượt làm bài này đã được nộp.');
    }

    const normalizedAnswers = answers
      .map((answer) => ({
        questionId: answer.questionId,
        selectedIndexes: Array.from(
          new Set(
            Array.isArray(answer.selectedIndexes)
              ? answer.selectedIndexes
              : typeof answer.selectedIndex === 'number'
                ? [answer.selectedIndex]
                : []
          )
        ).sort((a, b) => a - b),
      }))
      .filter((answer) => answer.selectedIndexes.length > 0);

    const answersByQuestionId = new Map(
      normalizedAnswers.map((answer) => [answer.questionId, answer.selectedIndexes] as const)
    );

    let earnedPoints = 0;
    let maxPoints = 0;

    const results = quiz.questions.map((question) => {
      maxPoints += question.points;
      const selectedIndexes = answersByQuestionId.get(question.questionId) || [];

      const correctIndexes = [...question.correctOptionIndexes].sort((a, b) => a - b);
      const isExactMatch =
        correctIndexes.length === selectedIndexes.length &&
        correctIndexes.every((value, index) => value === selectedIndexes[index]);

      if (isExactMatch) {
        earnedPoints += question.points;
      }

      return {
        questionId: question.questionId,
        type: question.type,
        prompt: question.prompt,
        options: question.options,
        selectedIndexes,
        correctOptionIndexes: correctIndexes,
        isCorrect: isExactMatch,
        points: question.points,
        earnedPoints: isExactMatch ? question.points : 0,
        explanation: question.explanation || '',
      };
    });

    const score = maxPoints > 0 ? Math.round((earnedPoints / maxPoints) * 100) : 0;

    attempt.answers = normalizedAnswers;
    attempt.score = score;
    attempt.passed = score >= quiz.passingScore;
    attempt.status = QuizAttemptStatus.SUBMITTED;
    attempt.completedAt = new Date();
    await attempt.save();

    return {
      attemptId: attempt._id.toString(),
      score: attempt.score,
      passed: attempt.passed,
      status: attempt.status,
      completedAt: attempt.completedAt,
      results,
    };
  }

  private async resolveCourseQuizContext(courseId: string): Promise<{ courseId: string; versionId: string }> {
    const shell = await Course.findById(courseId).select('_id status currentVersionId').lean();
    if (shell) {
      if (shell.status !== CourseStatus.PUBLISHED || !shell.currentVersionId) {
        throw new Error('Khóa học chưa được xuất bản.');
      }
      return { courseId: shell._id.toString(), versionId: shell.currentVersionId.toString() };
    }

    const version = await CourseVersion.findById(courseId).select('_id courseId status').lean();
    if (!version) throw new Error('Khóa học không tồn tại.');
    return { courseId: version.courseId.toString(), versionId: version._id.toString() };
  }
}

export default new QuizAttemptService();
