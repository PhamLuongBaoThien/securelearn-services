export type ChatbotSource = {
  type: "COURSE";
  title: string;
  url: string;
  price?: number;
};

export type ChatbotCourseContext = {
  title: string;
  slug: string;
  url: string;
  shortDescription: string;
  plainDescription: string;
  level: string;
  price: number;
  category: string;
  instructorName: string;
  totalLessons: number;
  totalDuration: number;
  rating: number;
  ratingCount: number;
  enrollmentCount: number;
  isSubscriptionIncluded: boolean;
};

export type ChatbotCategoryContext = {
  name: string;
  slug: string;
  description: string;
};

type ApiResponse<T> = { status: "OK" | "ERR"; data: T; message?: string };

const COURSE_SERVICE_URL = process.env.COURSE_SERVICE_URL || "http://course-service:5002";

const withTimeout = async <T>(url: string, timeoutMs = 4000): Promise<T> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const body = (await response.json().catch(() => ({}))) as ApiResponse<T>;
    if (!response.ok || body.status === "ERR") throw new Error(body.message || "Không thể lấy dữ liệu chatbot context.");
    return body.data;
  } finally {
    clearTimeout(timer);
  }
};

const query = (value: string) => encodeURIComponent(value.trim());

class ChatbotContextClient {
  searchCourses(q: string, limit = 8) {
    return withTimeout<ChatbotCourseContext[]>(`${COURSE_SERVICE_URL}/internal/chatbot/courses/search?q=${query(q)}&limit=${limit}`);
  }
  // Lấy danh sách phổ biến làm dữ liệu dự phòng khi tìm kiếm không có kết quả.
  popularCourses(limit = 8) {
    return withTimeout<ChatbotCourseContext[]>(`${COURSE_SERVICE_URL}/internal/chatbot/courses/popular?limit=${limit}`);
  }

  getCategories() {
    return withTimeout<ChatbotCategoryContext[]>(`${COURSE_SERVICE_URL}/internal/chatbot/categories`);
  }
}

export default new ChatbotContextClient();
