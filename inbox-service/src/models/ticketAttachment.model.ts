import mongoose, { Schema } from 'mongoose';
const attachmentSchema = new Schema({ ticketId: { type: Schema.Types.ObjectId, ref: 'InboxTicket', required: true, index: true }, messageId: { type: Schema.Types.ObjectId, ref: 'InboxTicketMessage', default: null }, ownerId: { type: String, required: true }, originalName: String, mimeType: String, sizeBytes: Number, objectKey: { type: String, required: true, unique: true } }, { timestamps: true });
export const TicketAttachment = mongoose.model('InboxTicketAttachment', attachmentSchema);
