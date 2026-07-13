import { Pin, PinOff } from 'lucide-react';
import { useState } from 'react';
import { usePins } from '../../context/PinsContext';
import type { PinObjectType } from '../../utils/pins';

type PinActionButtonProps = {
  objectType: PinObjectType;
  objectId: string;
  className?: string;
  iconSize?: number;
  showLabel?: boolean;
  title?: string;
  ariaLabel?: string;
  onPinnedChange?: (isPinned: boolean) => void;
  onClick?: () => void;
};

export const PinActionButton = ({
  objectType,
  objectId,
  className = '',
  iconSize = 14,
  showLabel = true,
  title,
  ariaLabel,
  onPinnedChange,
  onClick,
}: PinActionButtonProps) => {
  const { isPinned, toggleObjectPin } = usePins();
  const [isBusy, setIsBusy] = useState(false);
  const pinned = isPinned(objectType, objectId);

  const handleClick = async () => {
    if (isBusy) return;
    onClick?.();
    setIsBusy(true);
    try {
      const next = await toggleObjectPin({ objectType, objectId });
      onPinnedChange?.(Boolean(next));
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        void handleClick();
      }}
      aria-pressed={pinned}
      aria-label={ariaLabel ?? (pinned ? 'Unpin' : 'Pin')}
      title={title ?? (pinned ? 'Unpin' : 'Pin')}
      disabled={isBusy}
      className={className}
    >
      {pinned ? <PinOff size={iconSize} /> : <Pin size={iconSize} />}
      {showLabel ? <span>{pinned ? 'Unpin' : 'Pin'}</span> : null}
    </button>
  );
};
