import React, { useEffect, useState } from 'react';
import type { UserAvatarUser } from '../../types/userProfile';
import { getUserInitials, USER_AVATAR_SIZE_PX } from '../../utils/userAvatar';
import { useUserAvatarUrl } from '../../hooks/useUserAvatarUrl';

export type UserAvatarSize = keyof typeof USER_AVATAR_SIZE_PX;

type UserAvatarProps = {
  user: UserAvatarUser;
  size?: UserAvatarSize;
  showTooltip?: boolean;
  className?: string;
};

export const UserAvatar = ({ user, size = 'sm', showTooltip = false, className = '' }: UserAvatarProps) => {
  const [imageFailed, setImageFailed] = useState(false);
  const resolvedSrc = useUserAvatarUrl(user);
  const src = imageFailed ? null : resolvedSrc;
  useEffect(() => setImageFailed(false), [resolvedSrc]);
  const label = user.displayName?.trim() || user.email?.trim() || 'Unknown user';
  const px = USER_AVATAR_SIZE_PX[size];
  const style = { width: px, height: px, minWidth: px, minHeight: px };

  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-[var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] font-semibold text-[var(--ledger-text-secondary)] ${className}`}
      style={{ ...style, fontSize: Math.max(10, Math.round(px * 0.36)) }}
      title={showTooltip ? label : undefined}
      role="img"
      aria-label={`${label} avatar`}
    >
      {src ? <img src={src} alt={`${label} avatar`} className="h-full w-full object-cover" onError={() => setImageFailed(true)} /> : getUserInitials(user.displayName)}
    </span>
  );
};

export default UserAvatar;
