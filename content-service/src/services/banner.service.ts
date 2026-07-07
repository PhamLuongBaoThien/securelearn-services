import mongoose from 'mongoose';
import cloudinary from '../config/cloudinary';
import Banner, { IBanner } from '../models/banner.model';

export interface BannerInput {
  title?: unknown;
  subtitle?: unknown;
  imageUrl?: unknown;
  linkUrl?: unknown;
  isActive?: unknown;
}
type UploadedBannerImage = { path?: string; filename?: string };
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const isHttpsUrl = (value: string) => {
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
};
const isValidLink = (value: string) => !value || (value.startsWith('/') && !value.startsWith('//')) || isHttpsUrl(value);
const asBoolean = (value: unknown, fallback: boolean) => value === true || value === 'true' ? true : value === false || value === 'false' ? false : fallback;

class BannerService {
  listPublic(): Promise<IBanner[]> { return Banner.find({ isActive: true }).sort({ order: 1, createdAt: 1 }); }
  listAdmin(): Promise<IBanner[]> { return Banner.find().sort({ order: 1, createdAt: 1 }); }

  async create(input: BannerInput, file?: UploadedBannerImage): Promise<IBanner> {
    const payload = this.normalize(input, file);
    const last = await Banner.findOne().sort({ order: -1 }).select('order');
    return Banner.create({ ...payload, isActive: asBoolean(input.isActive, true), order: (last?.order || 0) + 1 });
  }

  async update(id: string, input: BannerInput, file?: UploadedBannerImage): Promise<IBanner> {
    this.assertId(id);
    const banner = await Banner.findById(id);
    if (!banner) throw Object.assign(new Error('Không tìm thấy banner.'), { status: 404 });
    const oldPublicId = banner.imagePublicId;
    Object.assign(banner, this.normalize(input, file, banner));
    if (input.isActive !== undefined) banner.isActive = asBoolean(input.isActive, banner.isActive);
    await banner.save();
    if ((file || text(input.imageUrl)) && oldPublicId && oldPublicId !== banner.imagePublicId) await this.destroyAsset(oldPublicId);
    return banner;
  }

  async setStatus(id: string, value: unknown): Promise<IBanner> {
    this.assertId(id);
    if (typeof value !== 'boolean') throw Object.assign(new Error('Trạng thái banner không hợp lệ.'), { status: 400 });
    const banner = await Banner.findByIdAndUpdate(id, { isActive: value }, { new: true, runValidators: true });
    if (!banner) throw Object.assign(new Error('Không tìm thấy banner.'), { status: 404 });
    return banner;
  }

  async reorder(ids: unknown): Promise<IBanner[]> {
    if (!Array.isArray(ids) || ids.length === 0 || ids.some((id) => typeof id !== 'string' || !mongoose.isValidObjectId(id))) {
      throw Object.assign(new Error('Danh sách thứ tự banner không hợp lệ.'), { status: 400 });
    }
    if (new Set(ids).size !== ids.length) throw Object.assign(new Error('Danh sách banner có ID trùng lặp.'), { status: 400 });
    const current = await Banner.find().select('_id').lean();
    const currentIds = new Set(current.map((item) => item._id.toString()));
    if (currentIds.size !== ids.length || ids.some((id) => !currentIds.has(id))) {
      throw Object.assign(new Error('Danh sách phải chứa đầy đủ và chính xác các banner hiện có.'), { status: 400 });
    }
    await Banner.bulkWrite(ids.map((id, index) => ({ updateOne: { filter: { _id: id }, update: { $set: { order: index + 1 } } } })));
    return this.listAdmin();
  }

  async delete(id: string): Promise<void> {
    this.assertId(id);
    const banner = await Banner.findByIdAndDelete(id);
    if (!banner) throw Object.assign(new Error('Không tìm thấy banner.'), { status: 404 });
    if (banner.imagePublicId) await this.destroyAsset(banner.imagePublicId);
    const remaining = await Banner.find().sort({ order: 1, createdAt: 1 }).select('_id');
    if (remaining.length) await Banner.bulkWrite(remaining.map((item, index) => ({
      updateOne: { filter: { _id: item._id }, update: { $set: { order: index + 1 } } },
    })));
  }

  private normalize(input: BannerInput, file?: UploadedBannerImage, current?: IBanner) {
    const title = input.title === undefined && current ? current.title : text(input.title);
    const subtitle = input.subtitle === undefined && current ? current.subtitle : text(input.subtitle);
    const linkUrl = input.linkUrl === undefined && current ? (current.linkUrl || '') : text(input.linkUrl);
    const suppliedUrl = text(input.imageUrl);
    const imageUrl = file?.path || suppliedUrl || current?.imageUrl || '';
    const replacesExistingUrl = Boolean(suppliedUrl && suppliedUrl !== current?.imageUrl);
    const imagePublicId = file?.filename || (replacesExistingUrl ? undefined : current?.imagePublicId);
    if (!title) throw Object.assign(new Error('Vui lòng nhập tiêu đề banner.'), { status: 400 });
    if (title.length > 120) throw Object.assign(new Error('Tiêu đề banner tối đa 120 ký tự.'), { status: 400 });
    if (subtitle.length > 240) throw Object.assign(new Error('Phụ đề banner tối đa 240 ký tự.'), { status: 400 });
    if (!imageUrl) throw Object.assign(new Error('Vui lòng cung cấp ảnh banner.'), { status: 400 });
    if (!file && suppliedUrl && !isHttpsUrl(suppliedUrl)) throw Object.assign(new Error('URL ảnh phải là địa chỉ HTTPS hợp lệ.'), { status: 400 });
    if (!isValidLink(linkUrl)) throw Object.assign(new Error('Liên kết phải là đường dẫn nội bộ hoặc URL HTTPS hợp lệ.'), { status: 400 });
    return { title, subtitle, imageUrl, imagePublicId, linkUrl: linkUrl || undefined };
  }

  private assertId(id: string) {
    if (!mongoose.isValidObjectId(id)) throw Object.assign(new Error('ID banner không hợp lệ.'), { status: 400 });
  }
  private async destroyAsset(publicId: string) {
    try { await cloudinary.uploader.destroy(publicId, { resource_type: 'image' }); }
    catch (error) { console.error('[Banner] Không thể xóa ảnh Cloudinary:', publicId, error); }
  }
}
export default new BannerService();
