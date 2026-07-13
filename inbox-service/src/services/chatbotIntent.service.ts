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

  if (includesAny(text, ["so sanh", "khac nhau", "chon khoa nao"])) {
    return {
      intent: "OUT_OF_SCOPE",
      courseMode: "SEARCH",
      searchQuery: "",
      smallTalkReply: "",
    };
  }

  const isFollowUp = hasPreviousCourses && includesAny(text, ["khoa do", "khoa nay", "khoa dau", "no", "gia", "bao lau", "thoi luong", "noi them", "giai thich them"]);
  const isCourse = includesAny(text, ["hoc", "khoa", "course", "lap trinh", "frontend", "backend", "goi y", "can biet", "nhung gi", "lan dau", "cham tay", "bat dau"]) || isFollowUp;

  if (!isCourse) {
    return {
      intent: "OUT_OF_SCOPE",
      courseMode: "SEARCH",
      searchQuery: "",
      smallTalkReply: "",
    };
  }

  const courseMode: CoursePromptMode = isFollowUp
    ? "FOLLOW_UP"
    : includesAny(text, ["tu van", "lo trinh", "goi y", "nen", "phu hop", "nguoi moi", "bat dau", "can biet", "nhung gi", "lan dau", "cham tay", "can hieu"])
      ? "ADVISOR"
      : "SEARCH";

  return {
    intent: "COURSE",
    courseMode,
    searchQuery: message,
    smallTalkReply: "",
  };
};


