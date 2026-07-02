import mongoose, { Schema } from "mongoose";
const schema = new Schema(
  {
    ticketId: {
      type: Schema.Types.ObjectId,
      ref: "InboxTicket",
      required: true,
      index: true,
    },
    identityType: { type: String, enum: ["USER", "ADMIN"], required: true },
    identityId: { type: String, required: true },
    lastReadMessageId: {
      type: Schema.Types.ObjectId,
      ref: "InboxTicketMessage",
      default: null,
    },
    lastReadAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true },
);
schema.index({ ticketId: 1, identityType: 1, identityId: 1 }, { unique: true });
export const TicketReadState = mongoose.model("InboxTicketReadState", schema);
