import mongoose, { Schema } from "mongoose";
import { TICKET_TYPES } from "./ticket.model";
const schema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 120 },
    content: { type: String, required: true, trim: true, maxlength: 5000 },
    ticketType: {
      type: String,
      enum: TICKET_TYPES,
      default: null,
      index: true,
    },
    isActive: { type: Boolean, default: true, index: true },
    createdBy: { type: String, required: true },
    updatedBy: { type: String, required: true },
  },
  { timestamps: true },
);
schema.index({ title: "text", content: "text" });
export const CannedReply = mongoose.model("InboxCannedReply", schema);
