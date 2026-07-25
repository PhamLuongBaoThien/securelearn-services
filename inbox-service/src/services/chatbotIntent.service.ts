export type ChatbotIntent = "COURSE" | "OUT_OF_SCOPE" | "SMALL_TALK";
export type CoursePromptMode = "SEARCH" | "ADVISOR" | "FOLLOW_UP";

export type ChatbotClassification = {
  intent: ChatbotIntent;
  courseMode: CoursePromptMode;
  searchQuery: string;
  smallTalkReply: string;
};

const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0111/g, "d")
    .replace(/\u0110/g, "D")
    .toLowerCase();

const includesAny = (text: string, keywords: string[]) => keywords.some((keyword) => text.includes(keyword));

const isSmallTalkFallback = (message: string) => {
  const text = normalize(message).replace(/[!?.,;:]+/g, " ").replace(/\s+/g, " ").trim();
  const courseKeywords = ["khoa", "hoc", "course", "photoshop", "adobe", "figma", "web", "nodejs", "react", "frontend", "backend", "lap trinh", "thiet ke", "giao dien", "tieng anh", "python"];
  if (includesAny(text, courseKeywords)) return false;

  const greetingWords = ["hi", "hello", "hey", "chao", "xin chao", "alo"];
  return greetingWords.some((word) => text === word || text.startsWith(`${word} `)) || includesAny(text, ["cam on", "thanks", "thank you", "tam biet", "bye", "goodbye"]);
};

export const buildSmallTalkReply = (message: string) => {
  const text = normalize(message);
  if (includesAny(text, ["cam on", "thanks", "thank you"])) {
    return "Không có gì đâu, mình ở đây để giúp bạn chọn khóa học phù hợp hơn trên SecureLearn.";
  }
  if (includesAny(text, ["tam biet", "bye", "goodbye"])) {
    return "Hẹn gặp lại bạn nhé. Khi nào cần tìm khóa học hoặc lộ trình học, cứ nhắn mình.";
  }
  return "Chào bạn, mình đây. Bạn đang muốn học chủ đề gì để mình gợi ý khóa học phù hợp trên SecureLearn?";
};

export const fallbackClassify = (message: string, hasPreviousCourses = false): ChatbotClassification => {
  const text = normalize(message);

  if (isSmallTalkFallback(message)) {
    return {
      intent: "SMALL_TALK",
      courseMode: "SEARCH",
      searchQuery: "",
      smallTalkReply: buildSmallTalkReply(message),
    };
  }

  // Tự động bóc tách từ khóa tìm kiếm sạch (bỏ từ thừa như "bên mình có", "tôi muốn tìm", "cho tôi xin"...)
  const cleanSearchQuery = message
    .replace(/(bên mình có|ben minh co|tôi muốn tìm|toi muon tim|cho tôi xin|cho toi xin|bạn có khóa|ban co khoa|gợi ý cho tôi|goi y cho toi|cho mình hỏi|cho minh hoi|khóa học|khoa hoc|khóa|khoa|học|hoc|bạn ơi|ban oi|nhé|nhi|được không|duoc khong)/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Nếu câu hỏi liên quan tới Doanh thu, Giảng viên, Liên hệ Admin, Thanh toán, Tài khoản, Chính sách -> OUT_OF_SCOPE
  const isOutOfScope = includesAny(text, [
    "doanh thu", "giang vien", "rut tien", "hoa don", "nap tien", "thanh toan", "momo", "vnpay",
    "lien he", "admin", "quan tri", "support", "ho tro", "chinh sach", "dieu khoan", "tai khoan", "doi mat khau", "quen mat khau"
  ]);

  if (isOutOfScope || includesAny(text, ["so sanh", "khac nhau", "chon khoa nao"])) {
    return {
      intent: "OUT_OF_SCOPE",
      courseMode: "SEARCH",
      searchQuery: "",
      smallTalkReply: "",
    };
  }

  const isFollowUp = hasPreviousCourses && includesAny(text, ["khoa do", "khoa nay", "khoa dau", "no", "gia", "bao lau", "thoi luong", "noi them", "giai thich them", "bao nhieu"]);
  const isCategoryQuery = includesAny(text, ["the loai", "danh muc", "chu de", "co nhung khoa hoc gi", "co nhung the loai"]);
  const isCourse = includesAny(text, ["hoc", "khoa", "course", "lap trinh", "frontend", "backend", "goi y", "can biet", "nhung gi", "lan dau", "bat dau", "chinh sua", "figma", "photoshop", "node", "web", "react", "python", "tim"]) || isFollowUp || isCategoryQuery;

  if (!isCourse && cleanSearchQuery.length < 2) {
    return {
      intent: "OUT_OF_SCOPE",
      courseMode: "SEARCH",
      searchQuery: "",
      smallTalkReply: "",
    };
  }

  const isRoadmapAdvice = includesAny(text, ["lo trinh", "can biet", "can hieu", "bat dau tu dau", "cho nguoi moi bat dau", "can hoc nhung gi"]);
  
  const courseMode: CoursePromptMode = isFollowUp
    ? "FOLLOW_UP"
    : isRoadmapAdvice
      ? "ADVISOR"
      : "SEARCH";

  return {
    intent: "COURSE",
    courseMode,
    searchQuery: cleanSearchQuery || message,
    smallTalkReply: "",
  };
};


