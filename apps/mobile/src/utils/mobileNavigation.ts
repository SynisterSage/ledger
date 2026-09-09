const PUBLIC_PATHS = new Set(['/auth/welcome', '/auth/sign-in', '/auth/sign-up']);

export function isPublicMobilePath(pathname: string) {
  return PUBLIC_PATHS.has(pathname);
}

/** Push payloads are untrusted input. Keep this allowlist intentionally small. */
export function getSafeNotificationPath(value: unknown) {
  if (value === '/notifications' || value === '/(tabs)/notifications') {
    return '/notifications' as const;
  }

  return '/notifications' as const;
}
