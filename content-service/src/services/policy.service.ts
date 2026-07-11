import mongoose from 'mongoose';
import Policy, { IPolicy } from '../models/policy.model';

export interface PolicyInput {
  title?: string;
  slug?: string;
  summary?: string;
  content?: string;
  isActive?: boolean;
}

const text = (value?: unknown) => String(value ?? '').trim();

const asBoolean = (value: unknown, fallback: boolean) => {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
};

const stripHtml = (value: string) => value.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();

const slugify = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 180);

class PolicyService {
  listAdmin(): Promise<IPolicy[]> {
    return Policy.find().sort({ updatedAt: -1, createdAt: -1 });
  }

  listPublic(): Promise<IPolicy[]> {
    return Policy.find({ isActive: true }).sort({ updatedAt: -1 }).select('-content');
  }

  async getPublicBySlug(slug: string): Promise<IPolicy> {
    const policy = await Policy.findOne({ slug, isActive: true });
    if (!policy) throw Object.assign(new Error('Không tìm thấy chính sách.'), { status: 404 });
    return policy;
  }

  async create(input: PolicyInput): Promise<IPolicy> {
    const payload = await this.normalize(input);
    return Policy.create(payload);
  }

  async update(id: string, input: PolicyInput): Promise<IPolicy> {
    this.assertObjectId(id);
    const policy = await Policy.findById(id);
    if (!policy) throw Object.assign(new Error('Không tìm thấy chính sách.'), { status: 404 });

    const payload = await this.normalize(input, policy);
    Object.assign(policy, payload);
    await policy.save();
    return policy;
  }

  async setStatus(id: string, value: unknown): Promise<IPolicy> {
    this.assertObjectId(id);
    if (typeof value !== 'boolean') throw Object.assign(new Error('Trạng thái chính sách không hợp lệ.'), { status: 400 });
    const policy = await Policy.findByIdAndUpdate(id, { isActive: value }, { new: true, runValidators: true });
    if (!policy) throw Object.assign(new Error('Không tìm thấy chính sách.'), { status: 404 });
    return policy;
  }

  async delete(id: string): Promise<void> {
    this.assertObjectId(id);
    const policy = await Policy.findByIdAndDelete(id);
    if (!policy) throw Object.assign(new Error('Không tìm thấy chính sách.'), { status: 404 });
  }

  private async normalize(input: PolicyInput, current?: IPolicy) {
    const title = text(input.title ?? current?.title);
    const summary = text(input.summary ?? current?.summary);
    const content = text(input.content ?? current?.content);
    const rawSlug = text(input.slug);
    const slug = slugify(rawSlug || title);

    if (!title) throw Object.assign(new Error('Vui lòng nhập tiêu đề chính sách.'), { status: 400 });
    if (title.length > 160) throw Object.assign(new Error('Tiêu đề chính sách tối đa 160 ký tự.'), { status: 400 });
    if (!slug) throw Object.assign(new Error('Slug chính sách không hợp lệ.'), { status: 400 });
    if (summary.length > 300) throw Object.assign(new Error('Tóm tắt chính sách tối đa 300 ký tự.'), { status: 400 });
    if (!stripHtml(content)) throw Object.assign(new Error('Vui lòng nhập nội dung chính sách.'), { status: 400 });

    const duplicate = await Policy.findOne({ slug, _id: { $ne: current?._id } }).select('_id');
    if (duplicate) throw Object.assign(new Error('Slug chính sách đã tồn tại.'), { status: 409 });

    return {
      title,
      slug,
      summary,
      content,
      isActive: asBoolean(input.isActive, current?.isActive ?? true),
    };
  }

  private assertObjectId(id: string) {
    if (!mongoose.isValidObjectId(id)) throw Object.assign(new Error('ID chính sách không hợp lệ.'), { status: 400 });
  }
}

export default new PolicyService();
