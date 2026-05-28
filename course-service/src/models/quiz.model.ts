// File này chứa model Quiz.
// Quiz là domain riêng gắn 1-1 với lesson type QUIZ.
import mongoose, { Document, Schema, Types } from 'mongoose';

export enum QuizQuestionType {
  SINGLE_CHOICE = 'SINGLE_CHOICE', // Chọn 1 đáp án
  MULTIPLE_CHOICE = 'MULTIPLE_CHOICE', // Chọn nhiều đáp án
  TRUE_FALSE = 'TRUE_FALSE',
}

export interface IQuizQuestionOption {
  text: string;
}

export interface IQuizQuestion {
  questionId: string;
  type: QuizQuestionType;
  prompt: string; // Nội dung câu hỏi
  options: IQuizQuestionOption[]; // Đáp án
  correctOptionIndexes: number[]; // Index của đáp án đúng
  explanation?: string; // Giải thích đáp án đúng
  points: number; // Điểm cho mỗi câu hỏi
}

export interface IQuiz extends Document {
  courseId: Types.ObjectId;
  lessonId: Types.ObjectId;
  title: string;
  passingScore: number;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  timeLimitSec?: number | null;
  questions: IQuizQuestion[];
  createdAt: Date;
  updatedAt: Date;
}

// quizOptionSchema: Schema con không có _id để nhúng vào quizQuestionSchema
// Đại diện cho 1 đáp án của câu hỏi
const quizOptionSchema = new Schema<IQuizQuestionOption>(
  {
    text: { type: String, required: true, trim: true },
  },
  { _id: false }
);

// quizQuestionSchema: Schema con không có _id để nhúng vào quizSchema
// Đại diện cho 1 câu hỏi trong bài quiz
const quizQuestionSchema = new Schema<IQuizQuestion>(
  {
    questionId: { type: String, required: true, trim: true }, // Id của câu hỏi
    type: { type: String, enum: Object.values(QuizQuestionType), default: QuizQuestionType.SINGLE_CHOICE }, // Loại câu hỏi
    prompt: { type: String, required: true, trim: true }, // Nội dung câu hỏi
    options: { type: [quizOptionSchema], default: [] }, // Đáp án
    correctOptionIndexes: { type: [Number], default: [] },
    explanation: { type: String, default: '', trim: true },
    points: { type: Number, default: 1, min: 1 },
  },
  { _id: false }
);

// quizSchema: Model chính của Quiz
const quizSchema = new Schema<IQuiz>(
  {
    courseId: { type: Schema.Types.ObjectId, ref: 'CourseVersion', required: true, index: true },
    lessonId: { type: Schema.Types.ObjectId, ref: 'Lesson', required: true, unique: true, index: true },// unique -> Mỗi lesson chỉ có 1 quiz
    title: { type: String, required: true, trim: true }, // Tiêu đề bài quiz
    passingScore: { type: Number, default: 70, min: 0, max: 100 }, // Điểm tối thiểu để qua bài quiz (%)
    shuffleQuestions: { type: Boolean, default: false }, // Trộn thứ tự câu hỏi
    shuffleOptions: { type: Boolean, default: false }, // Trộn thứ tự đáp án
    timeLimitSec: { type: Number, default: null, min: 0 }, // Thời gian làm bài (giây)
    questions: { type: [quizQuestionSchema], default: [] }, // Danh sách câu hỏi
  },
  {
    timestamps: true,
  }
);

quizSchema.index({ courseId: 1, lessonId: 1 }, { unique: true });

export const Quiz = mongoose.model<IQuiz>('Quiz', quizSchema);
