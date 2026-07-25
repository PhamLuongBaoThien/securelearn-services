import { ChatbotClassification, CoursePromptMode, fallbackClassify, type ChatbotIntent } from "./chatbotIntent.service";

type ClassifyInput = {
  message: string;
  history: Array<{ role: string; content: string }>;
  previousCourseTitles: string[];
};

const intents: ChatbotIntent[] = ["COURSE", "OUT_OF_SCOPE", "SMALL_TALK"];
const modes: CoursePromptMode[] = ["SEARCH", "ADVISOR", "FOLLOW_UP"];

const classifierSystemPrompt = `Bạn là bộ phân loại ý định cho chatbot SecureLearn.
Nhiệm vụ của bạn là hiểu câu người dùng một cách tự nhiên, kể cả chào hỏi, cảm ơn, câu hỏi nối tiếp và câu mơ hồ.
Chỉ trả về JSON hợp lệ, không markdown, không giải thích ngoài JSON.
Chatbot chỉ hỗ trợ: trò chuyện xã giao ngắn, tìm/tư vấn/gợi ý khóa học SecureLearn, hoặc báo ngoài phạm vi.
Không hỗ trợ flow so sánh chi tiết giữa các khóa học. Nếu người dùng yêu cầu so sánh, hãy phân loại OUT_OF_SCOPE trừ khi họ đang hỏi nên học gì theo mục tiêu cá nhân.
Không tự tạo link, không quyết định card, không bịa khóa học.`;

const extractJson = (value: string) => {
  const trimmed = value.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("Classifier did not return JSON.");
  return trimmed.slice(start, end + 1);
};

const asString = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const normalizeClassification = (raw: any, fallback: ChatbotClassification): ChatbotClassification => {
  const intent = intents.includes(raw?.intent) ? raw.intent as ChatbotIntent : fallback.intent;
  const courseMode = modes.includes(raw?.courseMode) ? raw.courseMode as CoursePromptMode : fallback.courseMode;
  const searchQuery = asString(raw?.searchQuery) || fallback.searchQuery;
  const smallTalkReply = asString(raw?.smallTalkReply) || fallback.smallTalkReply;

  if (intent !== "COURSE") {
    return {
      intent,
      courseMode: "SEARCH",
      searchQuery: "",
      smallTalkReply,
    };
  }

  return {
    intent,
    courseMode,
    searchQuery,
    smallTalkReply: "",
  };
};

class ChatbotClassifierService {
  async classify(input: ClassifyInput): Promise<ChatbotClassification> {
    // Phân loại Local siêu tốc (0ms, 0% Gemini Request, tiết kiệm 50% Quota)
    return fallbackClassify(input.message, input.previousCourseTitles.length > 0);
  }
}

export default new ChatbotClassifierService();


