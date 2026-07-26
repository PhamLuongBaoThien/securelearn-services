import crypto from "crypto";
import mongoose from "mongoose";
import { ChatbotConversation } from "../models/chatbotConversation.model";
import { ChatbotMessage } from "../models/chatbotMessage.model";
import chatbotClassifierService from "./chatbotClassifier.service";
import chatbotContextClient, { ChatbotCourseContext, ChatbotCategoryContext, ChatbotSource } from "./chatbotContextClient.service";
import { buildSmallTalkReply, type ChatbotIntent, type CoursePromptMode } from "./chatbotIntent.service";
import geminiService from "./gemini.service";

const MAX_MESSAGE_LENGTH = 1000;
const HISTORY_LIMIT = 10;

type Actor = { userId?: string };

type MessageInput = {
  message: unknown;
  conversationId?: unknown;
  guestToken?: unknown;
  actor: Actor;
};

type ConversationAccessInput = {
  conversationId?: unknown;
  guestToken?: unknown;
  actor: Actor;
};

const outOfScopeReply =
  "Mình hiện hỗ trợ chính về tìm và gợi ý khóa học phù hợp trên SecureLearn. Với nội dung chính sách, tài khoản, thanh toán, hỗ trợ hoặc so sánh chi tiết giữa các khóa học, bạn có thể chọn một mục phù hợp bên dưới.";

const noCourseFoundReply =
  "Mình chưa tìm thấy khóa học phù hợp với yêu cầu này trên SecureLearn. Bạn có thể thử mô tả rõ hơn chủ đề muốn học hoặc chọn các thể loại bên dưới.";

const hashToken = (token: string) => crypto.createHash("sha256").update(`${process.env.CHATBOT_GUEST_TOKEN_SECRET || ""}:${token}`).digest("hex");
const makeGuestToken = () => crypto.randomBytes(32).toString("base64url");

const sanitizeMessage = (value: unknown) => {
  const message = String(value || "").trim();
  if (!message) throw Object.assign(new Error("Vui lòng nhập nội dung cần hỏi."), { status: 400 });
  if (message.length > MAX_MESSAGE_LENGTH) throw Object.assign(new Error(`Tin nhắn tối đa ${MAX_MESSAGE_LENGTH} ký tự.`), { status: 400 });
  return message;
};

const isValidObjectId = (value: unknown) => typeof value === "string" && mongoose.isValidObjectId(value);
const toObjectIdString = (value: unknown) => String(value || "");
const summarizeText = (value = "") => {
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return "Cuộc trò chuyện mới";
  return compact.length > 64 ? `${compact.slice(0, 64).trim()}...` : compact;
};

const toCourseSources = (courses: ChatbotCourseContext[]): ChatbotSource[] => courses.map((course) => ({ type: "COURSE", title: course.title, url: course.url, price: course.price }));

const normalizeText = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0111/g, "d")
    .replace(/\u0110/g, "D")
    .toLowerCase();

type CourseCardCandidate = Pick<ChatbotCourseContext, "title" | "slug" | "url" | "price">;

const uniqueCourses = <T extends CourseCardCandidate>(courses: T[]) => {
  const seen = new Set<string>();
  return courses.filter((course) => {
    const key = course.slug || course.url || course.title;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const pickSuggestedCourses = <T extends CourseCardCandidate>(courses: T[], reply: string, shouldShowMultipleCourses: boolean) => {
  if (!courses.length) return [];
  const normalizedReply = normalizeText(reply);

  // Nếu câu reply là câu thông báo sự cố quá tải, không hiện bất kỳ thẻ card nào
  if (normalizedReply.includes("qua tai") || normalizedReply.includes("gian doan")) return [];

  // Bỏ qua các từ dừng phổ biến và từ dừng hệ thống
  const stopWords = new Set([
    "khoa", "hoc", "co", "ban", "can", "cho", "nguoi", "moi", "bat", "dau", "online", "bai", "trinh", "do",
    "truc", "tiep", "tim", "kiem", "he", "thong", "tro", "ly", "chao", "ban", "minh", "tieng", "viet"
  ]);

  const mentionedCourses = courses.filter((course) => {
    const titleNorm = normalizeText(course.title);
    const slugNorm = normalizeText(course.slug || "");
    if (normalizedReply.includes(titleNorm) || (slugNorm && normalizedReply.includes(slugNorm))) return true;

    const coreWords = titleNorm.split(/\s+/).filter((word) => word.length >= 2 && !stopWords.has(word));
    if (!coreWords.length) return false;

    // Nếu tiêu đề chỉ có 1 từ đặc trưng duy nhất (ví dụ: photoshop, figma, nodejs, python...)
    if (coreWords.length === 1 && coreWords[0].length >= 4) {
      return normalizedReply.includes(coreWords[0]);
    }

    // Nếu tiêu đề từ 2 từ đặc trưng trở lên: BẮT BUỘC phải khớp cụm 2 từ liền nhau (Bigram) trong reply
    for (let i = 0; i < coreWords.length - 1; i++) {
      const bigram = `${coreWords[i]} ${coreWords[i + 1]}`;
      if (normalizedReply.includes(bigram)) return true;
    }
    return false;
  });

  // CHỈ HIỂN THỊ THẺ CARD KHI GEMINI AI THỰC SỰ NHẮC TỚI HOẶC GỢI Ý KHÓA HỌC CỤ THỂ
  if (mentionedCourses.length > 0) return uniqueCourses(mentionedCourses).slice(0, 4);

  return [];
};

const formatCoursePrice = (price?: number) => {
  if (!price) return "miễn phí";
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(price);
};

const formatCourseDuration = (seconds?: number) => {
  if (!seconds) return "";
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} phút`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours} giờ ${remainingMinutes} phút` : `${hours} giờ`;
};

const formatCourseLevel = (level = "") => {
  const normalized = normalizeText(level);
  if (normalized.includes("beginner")) return "cơ bản";
  if (normalized.includes("intermediate")) return "trung cấp";
  if (normalized.includes("advanced")) return "nâng cao";
  return level || "chưa rõ cấp độ";
};

const courseSummary = (course: ChatbotCourseContext) => {
  const parts = [
    `giá ${formatCoursePrice(course.price)}`,
    `cấp độ ${formatCourseLevel(course.level)}`,
  ];
  if (course.totalLessons) parts.push(`${course.totalLessons} bài học`);
  const duration = formatCourseDuration(course.totalDuration);
  if (duration) parts.push(`khoảng ${duration}`);
  if (course.instructorName) parts.push(`giảng viên ${course.instructorName}`);
  return parts.join(", ");
};

const courseDescription = (course: ChatbotCourseContext) => {
  const description = course.shortDescription || course.plainDescription;
  if (!description) return "Khóa học này hiện chưa có mô tả chi tiết công khai.";
  return description.length > 220 ? `${description.slice(0, 220).trim()}...` : description;
};

const compactText = (value: string) => normalizeText(value).replace(/[!?.,;:]+/g, " ").replace(/\s+/g, " ").trim();

const didRecentlyOfferCourseSuggestions = (history: Array<{ role: string; content: string }>) =>
  history
    .filter((item) => item.role === "ASSISTANT")
    .slice(-2)
    .some((item) => {
      const text = compactText(item.content);
      return text.includes("goi y") && text.includes("khoa hoc");
    });

const isCourseSuggestionConfirmation = (message: string) => {
  const text = compactText(message);
  const exactReplies = ["ok", "oke", "okay", "duoc", "duoc nha", "co", "co nha", "co nhe", "uh", "u", "um", "goi y di", "goi y cho toi", "goi y cho minh"];
  if (exactReplies.includes(text)) return true;
  return text.includes("goi y") && !["chinh sach", "thanh toan", "tai khoan", "ho tro"].some((keyword) => text.includes(keyword));
};

const inferCourseQueryFromHistory = (history: Array<{ role: string; content: string }>, message: string) => {
  const userText = compactText([...history.filter((item) => item.role === "USER").map((item) => item.content), message].join(" "));
  if (["backend", "back end", "api", "database", "server", "nodejs", "node js"].some((keyword) => userText.includes(keyword))) return "backend";
  if (["frontend", "front end", "html", "css", "javascript", "react", "giao dien"].some((keyword) => userText.includes(keyword))) return "frontend";
  return "khóa học cho người mới bắt đầu";
};

const buildCourseFallbackReply = (
  _courses: ChatbotCourseContext[],
  _categories: ChatbotCategoryContext[],
  _shouldShowMultipleCourses: boolean,
  _mode: CoursePromptMode,
  _message: string
) => {
  return `Chào bạn! Hệ thống Trợ lý AI hiện đang quá tải hoặc tạm thời gián đoạn kết nối. Bạn vui lòng thử lại sau ít phút hoặc tìm kiếm khóa học trực tiếp trên thanh tìm kiếm nhé!`;
};

const systemPrompt = `Bạn là chatbot cố vấn khóa học cho người dùng trên nền tảng SecureLearn.\nGiọng nói tự nhiên, lịch sự, thân thiện và ấm áp.
Chỉ hỗ trợ tìm kiếm, tư vấn lộ trình và gợi ý các khóa học DỰA TRÊN DỮ LIỆU THỰC TẾ (courses và categories) được cung cấp trong context.
ĐẶC BIỆT: Nếu người dùng hỏi xin lộ trình hoặc gợi ý khóa học cho một chủ đề (như chỉnh sửa ảnh, thiết kế, Figma, Photoshop, lập trình...) mà trong context courses chưa có khóa học trực tiếp, BẠN VẪN PHẢI TƯ VẤN LỘ TRÌNH HỌC TỔNG QUAN HỮU ÍCH CHO CHỦ ĐỀ ĐÓ (gồm các bước/kỹ năng cần học). Sau đó, hãy lịch sự thông báo rằng SecureLearn hiện chưa có khóa học riêng cho chủ đề này và gợi ý người dùng tham khảo các thể loại/khóa học hiện có trong context.
Không tự bịa tên khóa học hay link không có trong context.
Trả lời bằng tiếng Việt ngắn gọn, rõ ràng, trình bày đẹp mắt.`;

const buildPrompt = (input: {
  message: string;
  intent: ChatbotIntent;
  mode: CoursePromptMode;
  history: Array<{ role: string; content: string }>;
  courses: ChatbotCourseContext[];
  categories: ChatbotCategoryContext[];
  lastSources: ChatbotSource[];
}) => {
  const enrichedCourses = input.courses.map((c) => ({
    title: c.title,
    slug: c.slug,
    priceText: formatCoursePrice(c.price),
    levelText: formatCourseLevel(c.level),
    durationText: formatCourseDuration(c.totalDuration) || `${c.totalDuration || 0} giây`,
    totalLessonsText: `${c.totalLessons || 0} bài học`,
    instructorName: c.instructorName,
    description: courseDescription(c),
    category: c.category,
  }));

  return JSON.stringify({
    userQuestion: input.message,
    detectedIntent: input.intent,
    courseMode: input.mode,
    recentHistory: input.history,
    context: {
      courses: enrichedCourses,
      categories: input.categories,
      lastSources: input.lastSources,
    },
    instruction: input.mode === "ADVISOR"
      ? "Hãy đóng vai cố vấn học tập. Luôn xây dựng lộ trình học tập ngắn gọn (3-5 bước nền tảng) cho chủ đề người dùng hỏi. Sau đó, dựa vào danh sách courses và categories trong context để giới thiệu các khóa học phù hợp nếu có."
      : input.mode === "FOLLOW_UP"
        ? "Hãy trả lời câu hỏi nối tiếp dựa trên khóa học trong context. Trường durationText (ví dụ: '5 phút', '3 giờ') và totalLessonsText chính là thời lượng và số bài học chuẩn của khóa học. Hãy tự tin trả lời chính xác thông tin thời lượng và số bài học này cho người dùng, không né tránh hay bảo thiếu thông tin."
        : "Hãy tư vấn lộ trình ngắn gọn hoặc gợi ý các khóa học phù hợp từ context (hoặc giới thiệu danh mục categories trong context nếu chưa có khóa học phù hợp). Nhắc tên khóa học tự nhiên nếu có.",
  }, null, 2);
};

class ChatbotService {
  async listConversations(input: { actor: Actor; conversationId?: unknown; guestToken?: unknown }) {
    const userId = input.actor.userId || "";
    let conversations: any[] = [];

    if (userId) {
      conversations = await ChatbotConversation.find({ userId }).sort({ updatedAt: -1 }).limit(30).lean();
    } else if (isValidObjectId(input.conversationId)) {
      const conversation = await this.findAuthorizedConversation({
        conversationId: input.conversationId,
        guestToken: input.guestToken,
        actor: input.actor,
      }).catch(() => null);
      conversations = conversation ? [conversation.toObject ? conversation.toObject() : conversation] : [];
    }

    return Promise.all(conversations.map((conversation) => this.toConversationSummary(conversation)));
  }

  async listMessages(input: ConversationAccessInput) {
    const conversation = await this.findAuthorizedConversation(input);
    const messages = await ChatbotMessage.find({ conversationId: conversation._id }).sort({ createdAt: 1 }).lean();
    return messages.map((message: any) => {
      const contextSources = (message.sources || []).filter((source: ChatbotSource) => source.type === "COURSE");
      const storedSuggestions = Array.isArray(message.suggestedCourses)
        ? message.suggestedCourses as ChatbotSource[]
        : null;

      // Older records only have `sources`. Reconstruct cards from course names
      // actually mentioned in the assistant reply instead of exposing all context.
      const displayedSources: ChatbotSource[] = message.role !== "ASSISTANT" || message.intent !== "COURSE"
        ? []
        : storedSuggestions ?? pickSuggestedCourses(
          contextSources.map((source: ChatbotSource) => ({
            title: source.title,
            slug: source.url?.split("/").filter(Boolean).pop() || "",
            url: source.url,
            price: source.price,
          })),
          message.content,
          true,
        ).map((course) => ({ type: "COURSE", title: course.title, url: course.url, price: course.price }));

      return {
        id: message._id.toString(),
        role: message.role,
        content: message.content,
        intent: message.intent,
        suggestedCourses: displayedSources.map((source) => ({
          title: source.title,
          slug: source.url?.split("/").filter(Boolean).pop() || "",
          url: source.url,
          price: source.price,
        })),
        sources: message.sources || [],
        createdAt: message.createdAt,
      };
    });
  }

  async removeConversation(input: ConversationAccessInput) {
    const conversation = await this.findAuthorizedConversation(input);
    await ChatbotMessage.deleteMany({ conversationId: conversation._id });
    await ChatbotConversation.deleteOne({ _id: conversation._id });
    return { deleted: true };
  }

  async clearConversations(input: { actor: Actor; conversationId?: unknown; guestToken?: unknown }) {
    const userId = input.actor.userId || "";
    if (userId) {
      const conversations = await ChatbotConversation.find({ userId }).select("_id").lean();
      const ids = conversations.map((conversation) => conversation._id);
      if (ids.length) {
        await ChatbotMessage.deleteMany({ conversationId: { $in: ids } });
        await ChatbotConversation.deleteMany({ _id: { $in: ids } });
      }
      return { deletedCount: ids.length };
    }

    if (!input.conversationId) return { deletedCount: 0 };
    await this.removeConversation(input);
    return { deletedCount: 1 };
  }

  async handleMessage(input: MessageInput) {
    const message = sanitizeMessage(input.message);
    const { conversation, guestToken } = await this.getOrCreateConversation(input);
    const historyDocs = await ChatbotMessage.find({ conversationId: conversation._id }).sort({ createdAt: -1 }).limit(HISTORY_LIMIT).lean();
    const history = historyDocs.reverse().map((item) => ({ role: item.role, content: item.content }));
    const previousSources = ((conversation.lastSources || []) as ChatbotSource[]).filter((source) => source.type === "COURSE");
    let classification = await chatbotClassifierService.classify({
      message,
      history,
      previousCourseTitles: previousSources.map((source) => source.title).filter(Boolean),
    });

    if (didRecentlyOfferCourseSuggestions(history) && isCourseSuggestionConfirmation(message)) {
      classification = {
        intent: "COURSE",
        courseMode: "SEARCH",
        searchQuery: inferCourseQueryFromHistory(history, message),
        smallTalkReply: "",
      };
    }

    if (classification.intent === "SMALL_TALK") {
      const reply = classification.smallTalkReply || buildSmallTalkReply(message);
      await this.persistExchange(conversation, message, reply, "SMALL_TALK", [], []);
      return {
        conversationId: conversation._id.toString(),
        ...(guestToken ? { guestToken } : {}),
        reply,
        intent: "SMALL_TALK" as ChatbotIntent,
        suggestedCourses: [],
        sources: [],
      };
    }

    const intent: ChatbotIntent = classification.intent;

    if (intent === "OUT_OF_SCOPE") {
      await this.persistExchange(conversation, message, outOfScopeReply, intent, [], []);
      return {
        conversationId: conversation._id.toString(),
        ...(guestToken ? { guestToken } : {}),
        reply: outOfScopeReply,
        intent,
        suggestedCourses: [],
        sources: [],
      };
    }

    let mode = classification.courseMode;
    let courses: ChatbotCourseContext[] = [];
    let categories: ChatbotCategoryContext[] = [];

    console.log("[ChatbotService] Classification:", JSON.stringify(classification));

    // Luôn lấy danh sách thể loại để sẵn sàng nạp vào context
    categories = await chatbotContextClient.getCategories().catch(() => []);

    if (mode === "FOLLOW_UP") {
      const previousCourseSources = previousSources.slice(0, 8);
      const historyUserText = history.map((h) => h.content).join(" ");
      const topicQuery = inferCourseQueryFromHistory(history, message);

      const [directCourses, topicCourses] = await Promise.all([
        Promise.all(previousCourseSources.map((source) => chatbotContextClient.searchCourses(source.title, 1).catch(() => []))),
        chatbotContextClient.searchCourses(topicQuery, 8).catch(() => []),
      ]);

      let combinedCourses = uniqueCourses([...directCourses.flat(), ...topicCourses]);

      // Nếu câu hỏi có ý hỏi về giá rẻ nhất / thấp nhất, sắp xếp theo giá tăng dần
      const isPriceQuery = normalizeText(message).replace(/\s+/g, "").includes("renhat") || normalizeText(message).includes("thap nhat") || normalizeText(message).includes("gia re");
      if (isPriceQuery && combinedCourses.length > 0) {
        combinedCourses.sort((a, b) => (a.price || 0) - (b.price || 0));
      }

      courses = combinedCourses;
    } else {
      // Dù là SEARCH hay ADVISOR, đều query CSDL để tìm các khóa học phù hợp với từ khóa
      const searchQuery = classification.searchQuery || message;
      courses = await chatbotContextClient.searchCourses(searchQuery, 8).catch(() => []);
    }

    console.log("[ChatbotService] Searched courses count:", courses.length, "categories count:", categories.length);

    const sources = toCourseSources(courses);
    const promptSources = mode === "FOLLOW_UP" ? previousSources : [];
    const prompt = buildPrompt({
      message,
      intent,
      mode,
      history,
      courses,
      categories,
      lastSources: promptSources,
    });
    const shouldShowMultipleCourses = mode === "ADVISOR" || mode === "SEARCH";
    let reply = "";
    try {
      reply = await geminiService.generateReply({ systemPrompt, prompt });
    } catch (error: any) {
      if (![429, 502, 503, 504].includes(Number(error?.status))) throw error;
      reply = buildCourseFallbackReply(courses, categories, shouldShowMultipleCourses, mode, message);
    }
    const suggestedCourses = pickSuggestedCourses(courses, reply, shouldShowMultipleCourses);

    const displayedSources = toCourseSources(suggestedCourses);
    await this.persistExchange(conversation, message, reply, intent, sources, displayedSources);

    return {
      conversationId: conversation._id.toString(),
      ...(guestToken ? { guestToken } : {}),
      reply,
      intent,
      suggestedCourses: suggestedCourses.map((course) => ({ title: course.title, slug: course.slug, url: course.url, price: course.price })),
      sources,
    };
  }

  private async toConversationSummary(conversation: any) {
    const [firstUserMessage, lastMessage] = await Promise.all([
      ChatbotMessage.findOne({ conversationId: conversation._id, role: "USER" }).sort({ createdAt: 1 }).lean(),
      ChatbotMessage.findOne({ conversationId: conversation._id }).sort({ createdAt: -1 }).lean(),
    ]);

    return {
      id: toObjectIdString(conversation._id),
      title: summarizeText(firstUserMessage?.content || lastMessage?.content || "Cuộc trò chuyện mới"),
      lastMessage: summarizeText(lastMessage?.content || ""),
      lastIntent: conversation.lastIntent,
      updatedAt: conversation.updatedAt,
      createdAt: conversation.createdAt,
    };
  }

  private async findAuthorizedConversation(input: ConversationAccessInput) {
    const conversationId = typeof input.conversationId === "string" ? input.conversationId : "";
    if (!isValidObjectId(conversationId)) throw Object.assign(new Error("Cuộc trò chuyện không hợp lệ."), { status: 400 });

    const conversation = await ChatbotConversation.findById(conversationId);
    if (!conversation) throw Object.assign(new Error("Không tìm thấy cuộc trò chuyện."), { status: 404 });

    const userId = input.actor.userId || "";
    if (conversation.userId) {
      if (!userId || conversation.userId !== userId) throw Object.assign(new Error("Bạn không có quyền truy cập cuộc trò chuyện này."), { status: 403 });
      return conversation;
    }

    const guestToken = typeof input.guestToken === "string" ? input.guestToken : "";
    if (!guestToken || hashToken(guestToken) !== conversation.guestTokenHash) throw Object.assign(new Error("Guest token không hợp lệ."), { status: 403 });
    return conversation;
  }

  private async persistExchange(
    conversation: any,
    message: string,
    reply: string,
    intent: ChatbotIntent,
    sources: ChatbotSource[],
    suggestedCourses: ChatbotSource[],
  ) {
    await ChatbotMessage.create({ conversationId: conversation._id, role: "USER", content: message, intent, sources: [] });
    await ChatbotMessage.create({
      conversationId: conversation._id,
      role: "ASSISTANT",
      content: reply,
      intent,
      sources,
      suggestedCourses,
    });
    conversation.lastIntent = intent;
    conversation.lastSources = sources as any;
    conversation.expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30);
    await conversation.save();
  }

  private async getOrCreateConversation(input: MessageInput) {
    const userId = input.actor.userId || "";
    const conversationId = typeof input.conversationId === "string" ? input.conversationId : "";
    if (!conversationId) {
      const guestToken = userId ? "" : makeGuestToken();
      const conversation = await ChatbotConversation.create({ userId, guestTokenHash: guestToken ? hashToken(guestToken) : "" });
      return { conversation, guestToken: guestToken || undefined };
    }

    if (!isValidObjectId(conversationId)) throw Object.assign(new Error("Cuộc trò chuyện không hợp lệ."), { status: 400 });
    const conversation = await ChatbotConversation.findById(conversationId);
    if (!conversation) throw Object.assign(new Error("Không tìm thấy cuộc trò chuyện."), { status: 404 });

    if (conversation.userId) {
      if (!userId || conversation.userId !== userId) throw Object.assign(new Error("Bạn không có quyền truy cập cuộc trò chuyện này."), { status: 403 });
      return { conversation, guestToken: undefined };
    }

    const guestToken = typeof input.guestToken === "string" ? input.guestToken : "";
    if (!guestToken || hashToken(guestToken) !== conversation.guestTokenHash) throw Object.assign(new Error("Guest token không hợp lệ."), { status: 403 });
    return { conversation, guestToken: undefined };
  }
}

export default new ChatbotService();

















