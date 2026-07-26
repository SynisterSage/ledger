export function GoogleDriveIcon({ size = 16, className = '' }: { size?: number; className?: string }) {
  return <img src="/drive.svg" alt="" aria-hidden="true" width={size} height={size} className={`object-contain ${className}`.trim()} />;
}
