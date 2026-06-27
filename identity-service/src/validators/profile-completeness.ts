/**
 * Xác định các thông tin giảng viên còn thiếu trước khi gửi khóa học để duyệt.
 * Kết quả được identity-service cung cấp cho course-service qua gRPC.
 * Email phải được xác minh; số điện thoại chỉ cần tồn tại vì hệ thống không còn OTP SMS.
 */
export type InstructorProfileCandidate = {
  fullName?: string;
  email?: string;
  emailVerifiedAt?: unknown;
  phone?: string;
  profile?: {
    avatarUrl?: string;
    headline?: string;
    bio?: string;
  };
};

export const getMissingInstructorFields = (user: InstructorProfileCandidate): string[] => {
  const missing: string[] = [];
  if (!user.fullName?.trim()) missing.push('fullName');
  if (!user.email || !user.emailVerifiedAt) missing.push('email');
  if (!user.phone?.trim()) missing.push('phone');
  if (!user.profile?.avatarUrl?.trim()) missing.push('avatar');
  if (!user.profile?.headline?.trim()) missing.push('headline');
  if (!user.profile?.bio?.trim()) missing.push('bio');
  return missing;
};
