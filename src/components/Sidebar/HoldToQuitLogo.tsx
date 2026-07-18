import { useEffect, useRef, useState, type MouseEventHandler } from 'react';

const HOLD_TO_QUIT_MS = 1200;

const setShutdownOverlay = (active: boolean) => {
  window.dispatchEvent(
    new CustomEvent('ledger:shutdown-state', {
      detail: { active },
    })
  );
};

type HoldToQuitLogoProps = {
  className?: string;
  imageClassName?: string;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  title?: string;
};

export const HoldToQuitLogo = ({
  className = 'relative inline-flex items-center justify-center',
  imageClassName = 'h-7 w-7',
  onClick,
  title = 'Ledger',
}: HoldToQuitLogoProps) => {
  const [progress, setProgress] = useState(0);
  const [isQuitting, setIsQuitting] = useState(false);
  const holdStartedAtRef = useRef<number | null>(null);
  const frameRef = useRef<number | null>(null);
  const suppressClickRef = useRef(false);

  useEffect(() => {
    return () => {
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    };
  }, []);

  const cancelHold = () => {
    if (isQuitting) return;
    holdStartedAtRef.current = null;
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    setProgress(0);
    setShutdownOverlay(false);
  };

  const finishHold = () => {
    holdStartedAtRef.current = null;
    frameRef.current = null;
    suppressClickRef.current = true;
    setProgress(0);
    setIsQuitting(true);
    void window.desktopWindow?.quitApp();
  };

  const updateHoldProgress = (timestamp: number) => {
    const startedAt = holdStartedAtRef.current;
    if (startedAt === null || isQuitting) return;

    const nextProgress = Math.min(1, (timestamp - startedAt) / HOLD_TO_QUIT_MS);
    setProgress(nextProgress);
    if (nextProgress >= 1) {
      finishHold();
      return;
    }
    frameRef.current = window.requestAnimationFrame(updateHoldProgress);
  };

  return (
    <button
      type="button"
      className={className}
      title={isQuitting ? 'Closing Ledger…' : title}
      aria-label={isQuitting ? 'Closing Ledger' : title}
      aria-busy={isQuitting}
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => {
        event.stopPropagation();
        if (isQuitting) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        holdStartedAtRef.current = performance.now();
        setProgress(0);
        setShutdownOverlay(true);
        frameRef.current = window.requestAnimationFrame(updateHoldProgress);
      }}
      onPointerUp={(event) => {
        event.stopPropagation();
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        if (!isQuitting) cancelHold();
      }}
      onPointerCancel={cancelHold}
      onPointerLeave={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) cancelHold();
      }}
      onClick={(event) => {
        if (suppressClickRef.current) {
          suppressClickRef.current = false;
          event.preventDefault();
          return;
        }
        onClick?.(event);
      }}
    >
      <img
        src="./logo-color.svg"
        alt="Ledger"
        className={`${imageClassName} ${progress > 0 ? 'animate-pulse' : ''}`}
        draggable={false}
      />
    </button>
  );
};
