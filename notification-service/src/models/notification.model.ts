import mongoose, { Schema } from 'mongoose';
const schema = new Schema({ userId: { type: String, required: true, index: true }, type: { type: String, required: true, index: true }, title: { type: String, required: true }, body: { type: String, required: true }, data: { type: Schema.Types.Mixed, default: {} }, readAt: { type: Date, default: null, index: true }, sourceKey: { type: String, required: true } }, { timestamps: true });
schema.index({ userId: 1, sourceKey: 1 }, { unique: true });
schema.index({ userId: 1, createdAt: -1 });
export const Notification = mongoose.model('Notification', schema);

