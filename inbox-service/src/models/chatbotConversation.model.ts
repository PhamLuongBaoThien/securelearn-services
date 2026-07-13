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

const conversationSchema = new Schema(
  {
    userId: { type: String, index: true, default: "" },
    guestTokenHash: { type: String, default: "" },
    lastIntent: { type: String, enum: ["COURSE", "OUT_OF_SCOPE", "SMALL_TALK"], default: "OUT_OF_SCOPE" },
    lastSources: { type: [sourceSchema], default: [] },
    expiresAt: { type: Date, default: () => new Date(Date.now() + 1000 * 60 * 60 * 24 * 30), index: true },
  },
  { timestamps: true },
);

conversationSchema.index({ updatedAt: -1 });

export const ChatbotConversation = mongoose.model("ChatbotConversation", conversationSchema);

