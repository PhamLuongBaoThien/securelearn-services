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
    const fallback = fallbackClassify(input.message, input.previousCourseTitles.length > 0);
    const apiKey = process.env.GEMINI_API_KEY;
    const model = process.env.GEMINI_MODEL;
    if (!apiKey || !model) return fallback;

    const prompt = JSON.stringify({
      userMessage: input.message,
      recentHistory: input.history.slice(-6),
      previousCourseTitles: input.previousCourseTitles.slice(0, 8),
      outputSchema: {
        intent: "COURSE | OUT_OF_SCOPE | SMALL_TALK",
        courseMode: "SEARCH | ADVISOR | FOLLOW_UP",
        searchQuery: "short Vietnamese search query for course-service; empty unless intent is COURSE",
        smallTalkReply: "Warm Vietnamese reply when intent is SMALL_TALK; empty otherwise",
      },
      rules: [
        "SMALL_TALK for greetings, thanks, goodbye, casual chat that does not need course data.",
        "COURSE for finding, advising, pricing, duration, lesson count, or follow-up about courses.",
        "OUT_OF_SCOPE for policies, payments, account support, admin contact, unrelated knowledge, or detailed course comparison requests.",
        "FOLLOW_UP when the user asks about 'khóa đó', 'khóa này', 'nó', or asks more about a previously suggested course.",
        "ADVISOR when the user wants a learning path, asks what to learn, asks what they need to understand before starting, describes first-time/beginner status, current level, goals, or asks for recommendations.",
        "SEARCH only when the user asks for a specific course/topic to find, not when they ask for learning concepts or what to know first.",
        "If the recent assistant message offered to suggest suitable courses and the user replies yes/ok/được/gợi ý đi, classify COURSE with courseMode SEARCH and infer searchQuery from recentHistory.",
        "If the user asks to compare courses, do not use a compare mode; return OUT_OF_SCOPE unless they ask which course fits their personal learning goal.",
        "Return only JSON. No markdown.",
      ],
    }, null, 2);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: classifierSystemPrompt }] },
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 260,
            responseMimeType: "application/json",
          },
        }),
      });

      if (!response.ok) return fallback;
      const data = await response.json().catch(() => ({}));
      const text = data?.candidates?.[0]?.content?.parts?.map((part: any) => part?.text || "").join("\n").trim() || "";
      const parsed = JSON.parse(extractJson(text));
      return normalizeClassification(parsed, fallback);
    } catch {
      return fallback;
    } finally {
      clearTimeout(timer);
    }
  }
}

export default new ChatbotClassifierService();


