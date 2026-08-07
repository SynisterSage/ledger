import type { ReactNode } from 'react';

type WebModuleLayoutProps = {
  children: ReactNode;
  className?: string;
};

/** Shared available-width boundary for browser-rendered Ledger modules. */
export const WebModuleLayout = ({ children, className = '' }: WebModuleLayoutProps) => (
  <div className={`web-module-layout ${className}`.trim()}>{children}</div>
);

