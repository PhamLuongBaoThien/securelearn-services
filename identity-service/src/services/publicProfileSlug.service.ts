import type { IUser } from '../models/user.model';
import { User } from '../models/user.model';
import { buildPublicSlugCandidate, normalizePublicSlugBase } from '../utils/identity.utils';

const isDuplicateKeyError = (error: unknown): error is { code: number } =>
  typeof error === 'object' && error !== null && 'code' in error && (error as { code?: number }).code === 11000;

class PublicProfileSlugService {
  public async buildUniqueSlug(userId: string, fullName: string): Promise<string> {
    const base = normalizePublicSlugBase(fullName);
    for (let suffix = 1; suffix <= 10_000; suffix += 1) {
      const slug = buildPublicSlugCandidate(base, suffix);
      const exists = await User.exists({ publicSlug: slug, _id: { $ne: userId } });
      if (!exists) return slug;
    }
    throw new Error('Không thể tạo URL hồ sơ công khai. Vui lòng thử lại.');
  }

  public async ensureForUser(user: IUser): Promise<string> {
    if (user.publicSlug) return user.publicSlug;

    const userId = user._id.toString();
    const base = normalizePublicSlugBase(user.fullName);
    for (let suffix = 1; suffix <= 10_000; suffix += 1) {
      const slug = buildPublicSlugCandidate(base, suffix);
      if (await User.exists({ publicSlug: slug, _id: { $ne: userId } })) continue;

      user.publicSlug = slug;
      try {
        await user.save();
        return slug;
      } catch (error) {
        if (isDuplicateKeyError(error)) continue;
        throw error;
      }
    }

    throw new Error('Không thể tạo URL hồ sơ công khai. Vui lòng thử lại.');
  }

  public async resolve(slug: string): Promise<{ user: IUser; canonicalSlug: string } | null> {
    const user = await User.findOne({ publicSlug: slug.trim().toLowerCase(), isLocked: false });
    if (!user) return null;
    return { user, canonicalSlug: await this.ensureForUser(user) };
  }

  public async ensureExistingUsers(): Promise<void> {
    const users = await User.find({ $or: [{ publicSlug: { $exists: false } }, { publicSlug: '' }] }).sort({ createdAt: 1, _id: 1 });
    for (const user of users) await this.ensureForUser(user);
  }
}

export default new PublicProfileSlugService();
