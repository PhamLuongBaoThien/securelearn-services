// File này chứa model QuizAttempt.
// Nó lưu từng lượt làm bài của học viên cho một quiz cụ thể.
import mongoose, { Document, Schema, Types } from 'mongoose';

export enum QuizAttemptStatus {
  IN_PROGRESS = 'IN_PROGRESS',
  SUBMITTED = 'SUBMITTED',
}

export interface IQuizAttemptAnswer {
  questionId: string;
  selectedIndexes: number[];
}

export interface IQuizAttempt extends Document {
  quizId: Types.ObjectId;
  lessonId: Types.ObjectId;
  courseId: Types.ObjectId;
  userId: string;
  answers: IQuizAttemptAnswer[];
  score: number;
  passed: boolean;
  status: QuizAttemptStatus;
  startedAt: Date;
  completedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// Schema đại diện cho 1 câu trả lời của học viên
const quizAttemptAnswerSchema = new Schema<IQuizAttemptAnswer>(
  {
    questionId: { type: String, required: true, trim: true }, // Id của câu hỏi
    selectedIndexes: { type: [Number], required: true, default: [], validate: [(value: number[]) => value.length > 0, 'Phải có ít nhất 1 đáp án được chọn.'] }, // Index của đáp án được chọn
  },
  { _id: false }
);

// Schema chính của QuizAttempt
const quizAttemptSchema = new Schema<IQuizAttempt>(
  {
    quizId: { type: Schema.Types.ObjectId, ref: 'Quiz', required: true, index: true }, // Id của quiz
    lessonId: { type: Schema.Types.ObjectId, ref: 'Lesson', required: true, index: true }, // Id của lesson
    courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true }, // Id của course
    userId: { type: String, required: true, index: true }, // Id từ auth-service
    answers: { type: [quizAttemptAnswerSchema], default: [] }, // Lưu đáp án của học viên, array theo thứ tự questionId
    score: { type: Number, default: 0, min: 0, max: 100 }, // Điểm số của học viên
    passed: { type: Boolean, default: false }, // Đã qua bài quiz hay chưa
    status: { type: String, enum: Object.values(QuizAttemptStatus), default: QuizAttemptStatus.IN_PROGRESS, index: true }, // Trạng thái của bài làm
    startedAt: { type: Date, default: Date.now }, // Thời gian bắt đầu làm bài
    completedAt: { type: Date, default: null }, // Thời gian nộp bài
  },
  {
    timestamps: true,
  }
);

quizAttemptSchema.index({ quizId: 1, userId: 1, startedAt: -1 });
quizAttemptSchema.index({ courseId: 1, userId: 1 });

export const QuizAttempt = mongoose.model<IQuizAttempt>('QuizAttempt', quizAttemptSchema);
