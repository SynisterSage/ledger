import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

type FloatingTabBarScrollContextValue = {
  isCompact: boolean;
  handleScrollOffset: (offset: number) => void;
  resetScrollState: () => void;
};

export function getFloatingTabBarScrollOffset(event: unknown) {
  const value = event as { nativeEvent?: { contentOffset?: { y?: number } } };
  return typeof value.nativeEvent?.contentOffset?.y === 'number' ? value.nativeEvent.contentOffset.y : 0;
}

const FloatingTabBarScrollContext = createContext<FloatingTabBarScrollContextValue | null>(null);

export function FloatingTabBarScrollProvider({ children }: { children: ReactNode }) {
  const previousOffsetRef = useRef(0);
  const directionDistanceRef = useRef(0);
  const [isCompact, setIsCompact] = useState(false);

  const handleScrollOffset = useCallback((offset: number) => {
    const previousOffset = previousOffsetRef.current;
    const delta = offset - previousOffset;
    previousOffsetRef.current = Math.max(0, offset);

    if (Math.abs(delta) < 1) return;

    const direction = delta > 0 ? 1 : -1;
    directionDistanceRef.current = directionDistanceRef.current * direction + delta;

    if (offset <= 8) {
      directionDistanceRef.current = 0;
      setIsCompact(false);
    } else if (directionDistanceRef.current > 4) {
      directionDistanceRef.current = 0;
      setIsCompact(true);
    } else if (directionDistanceRef.current < -4) {
      directionDistanceRef.current = 0;
      setIsCompact(false);
    }
  }, []);

  const resetScrollState = useCallback(() => {
    previousOffsetRef.current = 0;
    directionDistanceRef.current = 0;
    setIsCompact(false);
  }, []);

  return (
    <FloatingTabBarScrollContext.Provider value={{ isCompact, handleScrollOffset, resetScrollState }}>
      {children}
    </FloatingTabBarScrollContext.Provider>
  );
}

export function useFloatingTabBarScroll() {
  const context = useContext(FloatingTabBarScrollContext);
  if (!context) throw new Error('useFloatingTabBarScroll must be used inside FloatingTabBarScrollProvider');
  return context;
}
