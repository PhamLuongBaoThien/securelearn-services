import { NotificationPreference } from '../models/notificationPreference.model';
export type RecipientType = 'USER' | 'ADMIN';
export type NotificationCategory = 'SYSTEM' | 'PAYMENT' | 'COURSE' | 'LEARNING' | 'INBOX' | 'CAMPAIGN';
const CATEGORIES: NotificationCategory[] = ['SYSTEM', 'PAYMENT', 'COURSE', 'LEARNING', 'INBOX', 'CAMPAIGN'];
const defaults = () => Object.fromEntries(CATEGORIES.map(category => [category, { email: true, inApp: true }]));
class PreferenceService {
  async get(recipientType: RecipientType, userId: string) {
    const record = await NotificationPreference.findOne({ recipientType, userId }).lean();
    return { recipientType, userId, categories: { ...defaults(), ...(record?.categories || {}) } };
  }
  async update(recipientType: RecipientType, userId: string, input: any) {
    const current: any = await this.get(recipientType, userId);
    for (const category of CATEGORIES) {
      const next = input?.categories?.[category];
      if (!next) continue;
      if (typeof next.email === 'boolean') current.categories[category].email = next.email;
      if (typeof next.inApp === 'boolean') current.categories[category].inApp = next.inApp;
    }
    current.categories.PAYMENT.inApp = true;
    current.categories.COURSE.inApp = true;
    return NotificationPreference.findOneAndUpdate(
      { recipientType, userId },
      { $set: { categories: current.categories } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean();
  }
  async channelEnabled(recipientType: RecipientType, userId: string, category: NotificationCategory, channel: 'email' | 'inApp') {
    if (channel === 'inApp' && (category === 'PAYMENT' || category === 'COURSE')) return true;
    const preference: any = await this.get(recipientType, userId);
    return preference.categories[category][channel];
  }
}
export default new PreferenceService();