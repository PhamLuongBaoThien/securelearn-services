// - cấu hình tỷ lệ phân chia lợi nhuận giữa nền tảng (Admin) và Giảng viên
// - thiết lập thông số tài chính cho hệ thống
import { Schema, model, Document } from 'mongoose';

export interface IFinanceConfig extends Document {
  configKey: string;
  adminPercent: number;
  instructorPercent: number;
  createdAt: Date;
  updatedAt: Date;
}

const financeConfigSchema = new Schema<IFinanceConfig>(
  {
    configKey: { type: String, required: true, unique: true, index: true },
    adminPercent: { type: Number, required: true, min: 0, max: 100 },
    instructorPercent: { type: Number, required: true, min: 0, max: 100 },
  },
  { timestamps: true }
);

export const FinanceConfig = model<IFinanceConfig>('FinanceConfig', financeConfigSchema);
