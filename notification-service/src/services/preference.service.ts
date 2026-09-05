import { NotificationPreference } from '../models/notificationPreference.model';

export type RecipientType = 'USER' | 'ADMIN';
export type NotificationCategory = 'PAYMENT' | 'COURSE' | 'LEARNING' | 'INBOX' | 'CAMPAIGN';
export type PreferenceChannel = 'email' | 'inApp';
export type PreferenceChannels = Record<PreferenceChannel, boolean>;
export type PreferenceCategories = Record<NotificationCategory, PreferenceChannels>;

export const NOTIFICATION_CATEGORIES: NotificationCategory[] = ['PAYMENT', 'COURSE', 'LEARNING', 'INBOX', 'CAMPAIGN'];

/**
 * Chính sách cấu hình thông báo là nguồn sự thật phía server.
 * `configurable: false` nghĩa là người dùng vẫn nhìn thấy kênh trên UI nhưng không thể tắt nó.
 * PAYMENT và COURSE luôn giữ thông báo web để các cập nhật giao dịch/quyền học quan trọng không bị bỏ lỡ.
 */
export const NOTIFICATION_PREFERENCE_POLICY: Record<NotificationCategory, Record<PreferenceChannel, { configurable: boolean; forcedValue?: boolean }>> = {
  PAYMENT: { email: { configurable: true }, inApp: { configurable: false, forcedValue: true } },
  COURSE: { email: { configurable: true }, inApp: { configurable: false, forcedValue: true } },
  LEARNING: { email: { configurable: true }, inApp: { configurable: true } },
  INBOX: { email: { configurable: true }, inApp: { configurable: true } },
  CAMPAIGN: { email: { configurable: true }, inApp: { configurable: true } },
};

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** Chuẩn hóa dữ liệu cũ/thiếu field và luôn áp lại các kênh bắt buộc trước khi trả hoặc lưu. */
export const normalizePreferenceCategories = (value: unknown): PreferenceCategories => {
  const source = isRecord(value) ? value : {};
  return Object.fromEntries(NOTIFICATION_CATEGORIES.map((category) => {
    const stored = isRecord(source[category]) ? source[category] : {};
    const policy = NOTIFICATION_PREFERENCE_POLICY[category];
    const channels = {
      email: typeof stored.email === 'boolean' ? stored.email : true,
      inApp: typeof stored.inApp === 'boolean' ? stored.inApp : true,
    };
    for (const channel of ['email', 'inApp'] as const) {
      if (policy[channel].forcedValue !== undefined) channels[channel] = policy[channel].forcedValue;
    }
    return [category, channels];
  })) as PreferenceCategories;
};

/** PUT /preferences cho phép cập nhật từng phần, nhưng từ chối category/channel lạ và giá trị không phải boolean. */
export const validatePreferenceUpdate = (input: unknown): Partial<Record<NotificationCategory, Partial<PreferenceChannels>>> => {
  if (!isRecord(input) || !isRecord(input.categories)) throw new Error('Dữ liệu cấu hình thông báo không hợp lệ.');
  const result: Partial<Record<NotificationCategory, Partial<PreferenceChannels>>> = {};
  for (const [category, rawChannels] of Object.entries(input.categories)) {
    if (!NOTIFICATION_CATEGORIES.includes(category as NotificationCategory)) throw new Error(`Danh mục thông báo không hợp lệ: ${category}.`);
    if (!isRecord(rawChannels)) throw new Error(`Cấu hình kênh của ${category} không hợp lệ.`);
    const channels: Partial<PreferenceChannels> = {};
    for (const [channel, enabled] of Object.entries(rawChannels)) {
      if (channel !== 'email' && channel !== 'inApp') throw new Error(`Kênh thông báo không hợp lệ: ${channel}.`);
      if (typeof enabled !== 'boolean') throw new Error(`Trạng thái kênh ${channel} phải là boolean.`);
      channels[channel] = enabled;
    }
    result[category as NotificationCategory] = channels;
  }
  return result;
};

class PreferenceService {
  async get(recipientType: RecipientType, userId: string) {
    const record = await NotificationPreference.findOne({ recipientType, userId }).lean();
    return { recipientType, userId, categories: normalizePreferenceCategories(record?.categories) };
  }
  async update(recipientType: RecipientType, userId: string, input: unknown) {
    const updates = validatePreferenceUpdate(input);
    const current = await this.get(recipientType, userId);
    for (const category of NOTIFICATION_CATEGORIES) {
      const next = updates[category];
      if (typeof next?.email === 'boolean') current.categories[category].email = next.email;
      if (typeof next?.inApp === 'boolean') current.categories[category].inApp = next.inApp;
    }
    const categories = normalizePreferenceCategories(current.categories);
    return NotificationPreference.findOneAndUpdate(
      { recipientType, userId },
      { $set: { categories } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean();
  }
  /** Điểm kiểm tra duy nhất mà event và campaign gọi trước khi phân phối từng kênh. */
  async channelEnabled(recipientType: RecipientType, userId: string, category: NotificationCategory, channel: PreferenceChannel) {
    const forcedValue = NOTIFICATION_PREFERENCE_POLICY[category][channel].forcedValue;
    if (forcedValue !== undefined) return forcedValue;
    const preference = await this.get(recipientType, userId);
    return preference.categories[category][channel];
  }
}
export default new PreferenceService();
