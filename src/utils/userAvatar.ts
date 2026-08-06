import type { UserAvatarUser } from '../types/userProfile';

export const getUserInitials = (displayName?: string | null): string => {
  const words = String(displayName ?? '')
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return '?';
  if (words.length === 1) return Array.from(words[0])[0]?.toUpperCase() || '?';
  return `${Array.from(words[0])[0] ?? ''}${Array.from(words[words.length - 1])[0] ?? ''}`.toUpperCase();
};

export const getUserAvatarUrl = (user: Pick<UserAvatarUser, 'avatarUrl' | 'avatarUpdatedAt'>): string | null => {
  const raw = user.avatarUrl?.trim();
  if (!raw) return null;
  try {
    if (raw.startsWith('avatars/')) return null;
    const url = new URL(raw, typeof window === 'undefined' ? 'https://ledger.invalid' : window.location.origin);
    if (!/^https?:$/.test(url.protocol)) return null;
    url.searchParams.set('v', user.avatarUpdatedAt ?? '1');
    return url.origin === 'https://ledger.invalid' ? `${url.pathname}${url.search}` : url.toString();
  } catch {
    return null;
  }
};

export const USER_AVATAR_SIZE_PX = { xs: 20, sm: 28, md: 36, lg: 48, xl: 72 } as const;
