export type UserProfile = {
  id: string;
  displayName: string;
  email: string;
  avatarUrl: string | null;
  avatarUpdatedAt: string | null;
};

/** The smallest normalized identity shape accepted by shared avatar surfaces. */
export type UserAvatarUser = {
  id?: string;
  displayName?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
  avatarUpdatedAt?: string | null;
};

export type UserProfileRow = {
  id: string;
  full_name?: string | null;
  email?: string | null;
  avatar_url?: string | null;
  avatar_updated_at?: string | null;
};

export const serializeUserProfile = (profile: UserProfile): UserProfileRow => ({
  id: profile.id,
  full_name: profile.displayName || null,
  email: profile.email || null,
  avatar_url: profile.avatarUrl,
  avatar_updated_at: profile.avatarUpdatedAt,
});

export const deserializeUserProfile = (row: UserProfileRow): UserProfile => ({
  id: String(row.id),
  displayName: String(row.full_name ?? '').trim(),
  email: String(row.email ?? '').trim(),
  avatarUrl: typeof row.avatar_url === 'string' && row.avatar_url.trim() ? row.avatar_url.trim() : null,
  avatarUpdatedAt: typeof row.avatar_updated_at === 'string' && row.avatar_updated_at.trim() ? row.avatar_updated_at : null,
});
