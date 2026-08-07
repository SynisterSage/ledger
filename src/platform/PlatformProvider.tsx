import { createContext, useContext, type PropsWithChildren } from 'react';
import { createDesktopPlatform } from './desktop/desktopPlatform';
import { createWebPlatform } from './web/webPlatform';
import type { LedgerPlatform } from './types/capabilities';

const platform = typeof window !== 'undefined' && window.desktopWindow
  ? createDesktopPlatform()
  : createWebPlatform();

const PlatformContext = createContext<LedgerPlatform>(platform);

export const PlatformProvider = ({ children }: PropsWithChildren) => (
  <PlatformContext.Provider value={platform}>{children}</PlatformContext.Provider>
);

export const usePlatform = () => useContext(PlatformContext);
