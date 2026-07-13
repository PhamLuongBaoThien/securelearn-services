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
  async searchCourses(query: unknown, limitValue: unknown): Promise<ChatbotCourseContext[]> {
    const q = String(query || '').trim();
    if (!q) return this.popularCourses(limitValue);
    return this.findCourses({
      limit: clampLimit(limitValue),
      filter: {
        $or: [
          { title: { $regex: q, $options: 'i' } },
          { shortDescription: { $regex: q, $options: 'i' } },
          { description: { $regex: q, $options: 'i' } },
        ],
      },
      sort: { ratingAverage: -1, enrollmentCount: -1, updatedAt: -1 },
    });
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


