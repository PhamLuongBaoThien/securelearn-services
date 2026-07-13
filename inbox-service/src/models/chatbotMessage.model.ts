import mongoose, { Schema } from "mongoose";

const sourceSchema = new Schema(
  {
    type: { type: String, enum: ["COURSE"], required: true },
    title: { type: String, default: "" },
    url: { type: String, default: "" },
    price: { type: Number, default: undefined },
  },
  { _id: false },
);

const messageSchema = new Schema(
  {
    conversationId: { type: Schema.Types.ObjectId, ref: "ChatbotConversation", required: true, index: true },
    role: { type: String, enum: ["USER", "ASSISTANT"], required: true },
    content: { type: String, required: true, trim: true, maxlength: 4000 },
    intent: { type: String, enum: ["COURSE", "OUT_OF_SCOPE", "SMALL_TALK"], default: undefined },
    sources: { type: [sourceSchema], default: [] },
  },
  { timestamps: true },
);

messageSchema.index({ conversationId: 1, createdAt: -1 });

export const ChatbotMessage = mongoose.model("ChatbotMessage", messageSchema);

