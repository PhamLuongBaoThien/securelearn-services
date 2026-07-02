import mongoose, { Schema } from 'mongoose';
const activitySchema = new Schema({ ticketId: { type: Schema.Types.ObjectId, ref: 'InboxTicket', required: true, index: true }, actor: { id: String, name: String, type: { type: String, enum: ['USER','ADMIN','SYSTEM'] } }, action: { type: String, required: true }, fromValue: String, toValue: String, metadata: { type: Schema.Types.Mixed, default: {} } }, { timestamps: true });
activitySchema.index({ ticketId: 1, createdAt: 1 });
export const TicketActivity = mongoose.model('InboxTicketActivity', activitySchema);
