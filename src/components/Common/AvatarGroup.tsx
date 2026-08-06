import { UserAvatar } from './UserAvatar';
import type { UserAvatarUser } from '../../types/userProfile';
import type { UserAvatarSize } from './UserAvatar';
import type { MouseEvent as ReactMouseEvent } from 'react';

type AvatarGroupProps = {
  users: UserAvatarUser[];
  maxVisible?: number;
  size?: UserAvatarSize;
  onUserContextMenu?: (user: UserAvatarUser, event: ReactMouseEvent<HTMLElement>) => void;
  className?: string;
};

export const AvatarGroup = ({ users, maxVisible = 4, size = 'xs', onUserContextMenu, className = '' }: AvatarGroupProps) => {
  const visible = users.slice(0, maxVisible);
  return (
    <div className={`flex items-center ${className}`} aria-label={`${users.length} people`}>
      {visible.map((user, index) => (
        <span key={user.id ?? `${user.displayName}-${index}`} className="relative rounded-full border border-[color:var(--ledger-surface-card)]" style={{ marginLeft: index === 0 ? 0 : -6 }} onContextMenu={onUserContextMenu ? (event) => { event.preventDefault(); onUserContextMenu(user, event); } : undefined}>
          <UserAvatar user={user} size={size} showTooltip />
        </span>
      ))}
      {users.length > visible.length ? (
        <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-[color:var(--ledger-border-subtle)] bg-[var(--ledger-surface-muted)] px-1 text-[9px] font-medium text-[var(--ledger-text-secondary)]" aria-label={`${users.length - visible.length} more people`}>
          +{users.length - visible.length}
        </span>
      ) : null}
    </div>
  );
};

export default AvatarGroup;
