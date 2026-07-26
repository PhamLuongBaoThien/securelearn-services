import mongoose, { Schema } from 'mongoose';
const messageSchema = new Schema({ ticketId: { type: Schema.Types.ObjectId, ref: 'InboxTicket', required: true, index: true }, author: { id: String, name: String, role: String, avatarUrl: String, type: { type: String, enum: ['USER','ADMIN'] } }, content: { type: String, trim: true, maxlength: 5000, default: '' }, internal: { type: Boolean, default: false }, attachmentIds: { type: [Schema.Types.ObjectId], default: [] } }, { timestamps: true });
messageSchema.index({ ticketId: 1, createdAt: 1 });
export const TicketMessage = mongoose.model('InboxTicketMessage', messageSchema);
