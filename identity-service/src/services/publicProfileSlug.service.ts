import type { IUser } from '../models/user.model';
import { User } from '../models/user.model';
import { PublicProfileSlug } from '../models/publicProfileSlug.model';
import { buildPublicSlugCandidate, normalizePublicSlugBase } from '../utils/identity.utils';

const isDuplicateKeyError = (error: unknown): error is { code: number } =>
  typeof error === 'object' && error !== null && 'code' in error && (error as { code?: number }).code === 11000;

class PublicProfileSlugService {
  public async reserve(userId: string, fullName: string): Promise<string> {
    const base = normalizePublicSlugBase(fullName);
    for (let suffix = 1; suffix <= 10_000; suffix += 1) {
      const slug = buildPublicSlugCandidate(base, suffix);
      try {
        await PublicProfileSlug.create({ slug, userId, isCurrent: false, isTombstone: false });
        return slug;
      } catch (error) {
        if (isDuplicateKeyError(error)) continue;
        throw error;
      }
    }
    throw new Error('Không thể tạo URL hồ sơ công khai. Vui lòng thử lại.');
  }

  public async activate(userId: string, slug: string, previousSlug?: string): Promise<void> {
    await PublicProfileSlug.updateMany({ userId, isCurrent: true }, { $set: { isCurrent: false } });
    await PublicProfileSlug.updateOne({ slug, userId }, { $set: { isCurrent: true, isTombstone: false } });
    if (previousSlug && previousSlug !== slug) {
      await PublicProfileSlug.updateOne({ slug: previousSlug, userId }, { $set: { isCurrent: false, isTombstone: false } });
    }
  }

  public async releaseReservation(userId: string, slug: string): Promise<void> {
    await PublicProfileSlug.deleteOne({ userId, slug, isCurrent: false });
  }

  public async ensureForUser(user: IUser): Promise<string> {
    if (user.publicSlug) {
      await PublicProfileSlug.updateOne(
        { slug: user.publicSlug },
        { $setOnInsert: { userId: user._id.toString() }, $set: { isCurrent: true, isTombstone: false } },
        { upsert: true },
      );
      return user.publicSlug;
    }
    const slug = await this.reserve(user._id.toString(), user.fullName);
    try {
      user.publicSlug = slug;
      await user.save();
      await this.activate(user._id.toString(), slug);
      return slug;
    } catch (error) {
      await this.releaseReservation(user._id.toString(), slug);
      throw error;
    }
  }

  public async resolve(slug: string): Promise<{ user: IUser; canonicalSlug: string } | null> {
    const registry = await PublicProfileSlug.findOne({ slug: slug.trim().toLowerCase(), isTombstone: false }).lean();
    if (!registry) return null;
    const user = await User.findOne({ _id: registry.userId, isLocked: false });
    if (!user) return null;
    return { user, canonicalSlug: await this.ensureForUser(user) };
  }

  public async tombstoneUser(userId: string): Promise<void> {
    await PublicProfileSlug.updateMany({ userId }, { $set: { isCurrent: false, isTombstone: true } });
  }

  public async ensureExistingUsers(): Promise<void> {
    const users = await User.find({ $or: [{ publicSlug: { $exists: false } }, { publicSlug: '' }] }).sort({ createdAt: 1, _id: 1 });
    for (const user of users) await this.ensureForUser(user);
  }
}

export default new PublicProfileSlugService();