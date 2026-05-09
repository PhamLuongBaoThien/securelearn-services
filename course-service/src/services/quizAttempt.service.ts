// File này chứa flow làm quiz của học viên.
// Ghi nhớ:
// - startAttempt tạo lượt làm bài
// - submitAttempt chấm điểm và khóa lượt làm bài
// - logic hiện tại phù hợp nhất với kiểu 1 đáp án chọn duy nhất
import { QuizAttempt, QuizAttemptStatus } from '../models/quizAttempt.model';
import { Quiz } from '../models/quiz.model';

class QuizAttemptService {
  public async startAttempt(courseId: string, lessonId: string, quizId: string, userId: string) {
    const quiz = await Quiz.findOne({ _id: quizId, lessonId, courseId }).lean();
    if (!quiz) throw new Error('Quiz không tồn tại.');

    const attempt = await QuizAttempt.create({
      quizId: quiz._id,
      lessonId: quiz.lessonId,
      courseId,
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
    const [quiz, attempt] = await Promise.all([
      Quiz.findOne({ _id: quizId, lessonId, courseId }).lean(),
      QuizAttempt.findOne({ _id: attemptId, quizId, courseId, lessonId, userId }),
    ]);

    if (!quiz) throw new Error('Quiz không tồn tại.');
    if (!attempt) throw new Error('Lượt làm bài không tồn tại.');
    if (attempt.status === QuizAttemptStatus.SUBMITTED) {
      throw new Error('Lượt làm bài này đã được nộp.');
    }

    const normalizedAnswers = answers.map((answer) => ({
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
    }));

    const answersByQuestionId = new Map(
      normalizedAnswers.map((answer) => [answer.questionId, answer.selectedIndexes] as const)
    );

    let earnedPoints = 0;
    let maxPoints = 0;

    for (const question of quiz.questions) {
      maxPoints += question.points;
      const selectedIndexes = answersByQuestionId.get(question.questionId);
      if (!selectedIndexes || selectedIndexes.length === 0) continue;

      const correctIndexes = [...question.correctOptionIndexes].sort((a, b) => a - b);
      const isExactMatch =
        correctIndexes.length === selectedIndexes.length &&
        correctIndexes.every((value, index) => value === selectedIndexes[index]);

      if (isExactMatch) {
        earnedPoints += question.points;
      }
    }

    const score = maxPoints > 0 ? Math.round((earnedPoints / maxPoints) * 100) : 0;

    attempt.answers = normalizedAnswers;
    attempt.score = score;
    attempt.passed = score >= quiz.passingScore;
    attempt.status = QuizAttemptStatus.SUBMITTED;
    attempt.completedAt = new Date();
    await attempt.save();

    return attempt;
  }
}

export default new QuizAttemptService();
