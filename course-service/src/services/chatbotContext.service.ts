import { Types } from 'mongoose';
import { Category } from '../models/category.model';
import { Course, CourseStatus, SubscriptionCatalogStatus } from '../models/course.model';
import { CourseVersion } from '../models/courseVersion.model';

export interface ChatbotCourseContext {
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
}

const clampLimit = (value: unknown) => {
  const parsed = Number(value || 8);
  if (Number.isNaN(parsed)) return 8;
  return Math.min(Math.max(parsed, 1), 8);
};

const stripHtml = (value = '') =>
  value
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();

const truncate = (value: string, max = 700) => (value.length > max ? `${value.slice(0, max).trim()}...` : value);

class ChatbotContextService {
  async getCategories(): Promise<Array<{ name: string; slug: string; description: string }>> {
    const categories = await Category.find({ isActive: true }).sort({ sortOrder: 1, name: 1 }).lean();
    return categories.map((cat) => ({
      name: cat.name,
      slug: cat.slug,
      description: cat.description || '',
    }));
  }

  async searchCourses(query: unknown, limitValue: unknown): Promise<ChatbotCourseContext[]> {
    const rawQ = String(query || '').trim();
    const limit = clampLimit(limitValue);
    if (!rawQ) return this.popularCourses(limit);

    // 1. Tìm các category khớp với query
    const matchedCategories = await Category.find({
      isActive: true,
      $or: [
        { name: { $regex: rawQ, $options: 'i' } },
        { description: { $regex: rawQ, $options: 'i' } },
      ],
    }).select('_id').lean();
    const matchedCategoryIds = matchedCategories.map((c) => c._id);

    // 2. Tách từ khóa tìm kiếm tự nhiên (bỏ qua các từ nghi vấn hỏi giá như bao nhiêu, tiền, giá...)
    const noiseWordsRegex = /(bao nhiêu|bao nhieu|bao|nhiêu|nhieu|tiền|tien|giá|gia|khóa học|khoa hoc|khóa|khoa|học|hoc|cho|tôi|mình|em|bạn|nhé|hỏi)/gi;
    const cleanQuery = rawQ.replace(noiseWordsRegex, ' ').replace(/\s+/g, ' ').trim();

    const keywords = (cleanQuery || rawQ)
      .split(/\s+/)
      .map((k) => k.trim())
      .filter((k) => k.length >= 2);

    const searchPattern = keywords.length > 0 ? keywords.join('|') : rawQ;

    let results = await this.findCourses({
      limit,
      filter: {
        $or: [
          { title: { $regex: searchPattern, $options: 'i' } },
          { shortDescription: { $regex: searchPattern, $options: 'i' } },
          ...(matchedCategoryIds.length ? [{ categoryId: { $in: matchedCategoryIds } }] : []),
        ],
      },
      sort: { ratingAverage: -1, enrollmentCount: -1, updatedAt: -1 },
    });

    // Bổ sung các khóa học cùng danh mục (Category) liên quan để gợi ý phong phú đúng chủ đề
    if (results.length > 0 && results.length < limit) {
      const foundCategoryNames = results.map((r) => r.category).filter(Boolean);
      if (foundCategoryNames.length > 0) {
        const relatedCategories = await Category.find({ name: { $in: foundCategoryNames } }).select('_id').lean();
        const relatedCatIds = relatedCategories.map((c) => c._id);
        if (relatedCatIds.length > 0) {
          const sameCategoryCourses = await this.findCourses({
            limit: limit - results.length,
            filter: { categoryId: { $in: relatedCatIds } },
            sort: { ratingAverage: -1, enrollmentCount: -1 },
          });
          const existingSlugs = new Set(results.map((r) => r.slug));
          for (const course of sameCategoryCourses) {
            if (!existingSlugs.has(course.slug)) {
              results.push(course);
              existingSlugs.add(course.slug);
            }
          }
        }
      }
    }

    if (results.length > 0) return results;

    // 3. Nếu không tìm thấy khóa học khớp từ khóa, trả về danh sách khóa học phong phú trong CSDL làm ngữ cảnh cho AI
    return this.popularCourses(limit);
  }

  async popularCourses(limitValue: unknown): Promise<ChatbotCourseContext[]> {
    return this.findCourses({
      limit: clampLimit(limitValue),
      filter: {},
      sort: { enrollmentCount: -1, ratingAverage: -1, updatedAt: -1 },
    });
  }

  private async findCourses(input: {
    limit: number;
    filter: Record<string, unknown>;
    sort: Record<string, 1 | -1>;
  }): Promise<ChatbotCourseContext[]> {
    const shells = await Course.find({
      ...input.filter,
      status: CourseStatus.PUBLISHED,
      currentVersionId: { $ne: null },
    })
      .sort(input.sort)
      .limit(input.limit)
      .lean();

    const versionIds = shells
      .map((course) => course.currentVersionId)
      .filter(Boolean) as Types.ObjectId[];
    const versions = versionIds.length
      ? await CourseVersion.find({ _id: { $in: versionIds }, status: CourseStatus.PUBLISHED })
          .select('title shortDescription description level price categoryId instructorName totalLessons totalDuration')
          .lean()
      : [];
    const versionById = new Map(versions.map((version) => [version._id.toString(), version]));
    const categoryIds = versions.map((version) => version.categoryId).filter(Boolean) as Types.ObjectId[];
    const categories = categoryIds.length
      ? await Category.find({ _id: { $in: categoryIds }, isActive: true }).select('name').lean()
      : [];
    const categoryById = new Map(categories.map((category) => [category._id.toString(), category.name]));

    return shells
      .map((shell) => {
        const version = shell.currentVersionId ? versionById.get(shell.currentVersionId.toString()) : undefined;
        if (!version) return null;
        return {
          title: version.title,
          slug: shell.slug,
          url: `/course/${shell.slug}`,
          shortDescription: version.shortDescription || '',
          plainDescription: truncate(stripHtml(version.description || '')),
          level: String(version.level),
          price: version.price,
          category: version.categoryId ? categoryById.get(version.categoryId.toString()) || '' : '',
          instructorName: version.instructorName || shell.instructorName || '',
          totalLessons: version.totalLessons || shell.totalLessons || 0,
          totalDuration: version.totalDuration || shell.totalDuration || 0,
          rating: shell.ratingAverage || 0,
          ratingCount: shell.ratingCount || 0,
          enrollmentCount: shell.enrollmentCount || 0,
          isSubscriptionIncluded: shell.subscriptionStatus === SubscriptionCatalogStatus.APPROVED,
        };
      })
      .filter(Boolean) as ChatbotCourseContext[];
  }
}

export default new ChatbotContextService();


