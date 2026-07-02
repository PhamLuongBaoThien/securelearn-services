import mongoose, { Schema } from "mongoose";
export const TICKET_TYPES = ["REPORT", "SUPPORT", "FEEDBACK"] as const;
export const TICKET_STATUSES = [
  "OPEN",
  "IN_PROGRESS",
  "WAITING_USER",
  "RESOLVED",
  "CLOSED",
] as const;
const snapshotSchema = new Schema(
  { id: String, name: String, email: String, role: String },
  { _id: false },
);
const targetSchema = new Schema(
  {
    type: { type: String, enum: ["COURSE", "LESSON", "REVIEW", "USER"] },
    id: String,
    title: String,
    courseId: String,
    ownerUserId: String,
    actionUrl: String,
  },
  { _id: false },
);
const ticketSchema = new Schema(
  {
    type: { type: String, enum: TICKET_TYPES, required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, required: true, trim: true, maxlength: 5000 },
    sender: { type: snapshotSchema, required: true },
    target: { type: targetSchema, default: null },
    status: {
      type: String,
      enum: TICKET_STATUSES,
      default: "OPEN",
      index: true,
    },
    lastActivityAt: { type: Date, default: Date.now, index: true },
    lastMessageAt: { type: Date, default: Date.now, index: true },
    lastPublicMessageAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true },
);
ticketSchema.index({ "sender.id": 1, lastActivityAt: -1 });
export const Ticket = mongoose.model("InboxTicket", ticketSchema);
