export type StructuredCourseReply = {
  reply: string;
  recommendedCourseSlugs: string[];
};

type CourseRecommendationCandidate = {
  title: string;
  slug: string;
};

const stripCodeFence = (value: string) =>
  value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

const normalizeForMatch = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0111/g, "d")
    .replace(/\u0110/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const parseStructuredCourseReply = (rawResponse: string): StructuredCourseReply => {
  const raw = rawResponse.trim();
  const jsonText = stripCodeFence(raw);

  try {
    const parsed = JSON.parse(jsonText) as Record<string, unknown>;
    const reply = typeof parsed.reply === "string" ? parsed.reply.trim() : "";
    const recommendedCourseSlugs = Array.isArray(parsed.recommendedCourseSlugs)
      ? parsed.recommendedCourseSlugs
          .filter((slug): slug is string => typeof slug === "string")
          .map((slug) => slug.trim())
          .filter(Boolean)
      : [];

    if (reply) return { reply, recommendedCourseSlugs };
  } catch {
    // A plain-text response is still useful, but it must never create course cards.
  }

  return { reply: raw || "Mình chưa thể tạo câu trả lời phù hợp lúc này.", recommendedCourseSlugs: [] };
};

export const selectRecommendedCourses = <T extends CourseRecommendationCandidate>(
  candidates: T[],
  recommendedCourseSlugs: string[],
  reply: string,
  limit = 5,
) => {
  const requestedSlugs = new Set(recommendedCourseSlugs);
  const normalizedReply = normalizeForMatch(reply);
  const seen = new Set<string>();

  return candidates.filter((course) => {
    if (seen.size >= limit || seen.has(course.slug) || !requestedSlugs.has(course.slug)) return false;

    const normalizedTitle = normalizeForMatch(course.title);
    if (!normalizedTitle || !normalizedReply.includes(normalizedTitle)) return false;

    seen.add(course.slug);
    return true;
  });
};
