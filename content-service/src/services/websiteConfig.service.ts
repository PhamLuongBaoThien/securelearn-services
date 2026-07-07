import cloudinary from '../config/cloudinary';
import WebsiteConfig, { IWebsiteConfig } from '../models/websiteConfig.model';

export interface WebsiteConfigInput {
  siteUrl?: unknown;
  logoUrl?: unknown;
  faviconUrl?: unknown;
  contactEmail?: unknown;
  contactPhone?: unknown;
  address?: unknown;
  facebookUrl?: unknown;
  youtubeUrl?: unknown;
  githubUrl?: unknown;
  linkedinUrl?: unknown;
}

type UploadedWebsiteFiles = {
  logo?: Array<{ path?: string; filename?: string }>;
  favicon?: Array<{ path?: string; filename?: string }>;
};

export const DEFAULT_WEBSITE_CONFIG = {
  siteUrl: 'https://securelearn.vn',
  logoUrl: '',
  faviconUrl: '/favicon.svg',
  contactEmail: 'plbthien2004@gmail.com',
  contactPhone: '+84 343613222',
  address: '',
  facebookUrl: '',
  youtubeUrl: '',
  githubUrl: '',
  linkedinUrl: '',
};

const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const optionalText = (value: unknown, fallback = '') => value === undefined ? fallback : text(value);
const isEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const isHttpsUrl = (value: string) => {
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
};
const isSafeAssetUrl = (value: string) => value === '' || value.startsWith('/') || isHttpsUrl(value);
const isOptionalHttpsUrl = (value: string) => value === '' || isHttpsUrl(value);

class WebsiteConfigService {
  async getConfig(): Promise<IWebsiteConfig> {
    const existing = await WebsiteConfig.findOne().sort({ createdAt: 1 });
    if (existing) return existing;
    return WebsiteConfig.create(DEFAULT_WEBSITE_CONFIG);
  }

  async updateConfig(input: WebsiteConfigInput, files?: UploadedWebsiteFiles): Promise<IWebsiteConfig> {
    const config = await this.getConfig();
    const oldLogoPublicId = config.logoPublicId;
    const oldFaviconPublicId = config.faviconPublicId;
    const logoFile = files?.logo?.[0];
    const faviconFile = files?.favicon?.[0];

    const next = this.normalize(input, config, logoFile, faviconFile);
    Object.assign(config, next);
    await config.save();

    if (oldLogoPublicId && oldLogoPublicId !== config.logoPublicId && (logoFile || text(input.logoUrl))) {
      await this.destroyAsset(oldLogoPublicId);
    }
    if (oldFaviconPublicId && oldFaviconPublicId !== config.faviconPublicId && (faviconFile || text(input.faviconUrl))) {
      await this.destroyAsset(oldFaviconPublicId);
    }
    return config;
  }

  private normalize(
    input: WebsiteConfigInput,
    current: IWebsiteConfig,
    logoFile?: { path?: string; filename?: string },
    faviconFile?: { path?: string; filename?: string },
  ) {
    const siteUrl = optionalText(input.siteUrl, current.siteUrl || DEFAULT_WEBSITE_CONFIG.siteUrl);
    const contactEmail = optionalText(input.contactEmail, current.contactEmail || DEFAULT_WEBSITE_CONFIG.contactEmail);
    const contactPhone = optionalText(input.contactPhone, current.contactPhone || DEFAULT_WEBSITE_CONFIG.contactPhone);
    const address = optionalText(input.address, current.address || '');
    const facebookUrl = optionalText(input.facebookUrl, current.facebookUrl || '');
    const youtubeUrl = optionalText(input.youtubeUrl, current.youtubeUrl || '');
    const githubUrl = optionalText(input.githubUrl, current.githubUrl || '');
    const linkedinUrl = optionalText(input.linkedinUrl, current.linkedinUrl || '');

    const suppliedLogoUrl = text(input.logoUrl);
    const suppliedFaviconUrl = text(input.faviconUrl);
    const logoUrl = logoFile?.path || suppliedLogoUrl || current.logoUrl || '';
    const faviconUrl = faviconFile?.path || suppliedFaviconUrl || current.faviconUrl || DEFAULT_WEBSITE_CONFIG.faviconUrl;
    const logoPublicId = logoFile?.filename || (suppliedLogoUrl && suppliedLogoUrl !== current.logoUrl ? undefined : current.logoPublicId);
    const faviconPublicId = faviconFile?.filename || (suppliedFaviconUrl && suppliedFaviconUrl !== current.faviconUrl ? undefined : current.faviconPublicId);

    if (!isHttpsUrl(siteUrl)) throw Object.assign(new Error('URL website phải là địa chỉ HTTPS hợp lệ.'), { status: 400 });
    if (!contactEmail || !isEmail(contactEmail)) throw Object.assign(new Error('Email liên hệ không hợp lệ.'), { status: 400 });
    if (contactPhone.length > 30) throw Object.assign(new Error('Số điện thoại tối đa 30 ký tự.'), { status: 400 });
    if (address.length > 300) throw Object.assign(new Error('Địa chỉ tối đa 300 ký tự.'), { status: 400 });
    if (suppliedLogoUrl && !isSafeAssetUrl(suppliedLogoUrl)) throw Object.assign(new Error('URL logo phải là HTTPS hoặc đường dẫn nội bộ.'), { status: 400 });
    if (suppliedFaviconUrl && !isSafeAssetUrl(suppliedFaviconUrl)) throw Object.assign(new Error('URL favicon phải là HTTPS hoặc đường dẫn nội bộ.'), { status: 400 });
    if (!isOptionalHttpsUrl(facebookUrl)) throw Object.assign(new Error('Facebook URL phải là HTTPS hợp lệ.'), { status: 400 });
    if (!isOptionalHttpsUrl(youtubeUrl)) throw Object.assign(new Error('YouTube URL phải là HTTPS hợp lệ.'), { status: 400 });
    if (!isOptionalHttpsUrl(githubUrl)) throw Object.assign(new Error('GitHub URL phải là HTTPS hợp lệ.'), { status: 400 });
    if (!isOptionalHttpsUrl(linkedinUrl)) throw Object.assign(new Error('LinkedIn URL phải là HTTPS hợp lệ.'), { status: 400 });

    return { siteUrl, logoUrl, logoPublicId, faviconUrl, faviconPublicId, contactEmail, contactPhone, address, facebookUrl, youtubeUrl, githubUrl, linkedinUrl };
  }

  private async destroyAsset(publicId: string) {
    try { await cloudinary.uploader.destroy(publicId, { resource_type: 'image' }); }
    catch (error) { console.error('[WebsiteConfig] Không thể xóa ảnh Cloudinary:', publicId, error); }
  }
}

export default new WebsiteConfigService();
