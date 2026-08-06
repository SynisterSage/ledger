import { useEffect, useState } from 'react';
import { supabase } from '../services/supabase';
import type { UserAvatarUser } from '../types/userProfile';
import { getUserAvatarUrl } from '../utils/userAvatar';

const SIGNED_URL_TTL_MS = 55 * 60 * 1000;
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();
const signedUrlPending = new Map<string, Promise<string | null>>();

const getSignedAvatarUrl = (path: string, version: string | null | undefined) => {
  const key = `${path}|${version ?? '1'}`;
  const cached = signedUrlCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.url);
  const pending = signedUrlPending.get(key);
  if (pending) return pending;
  const request = supabase.storage.from('avatars').createSignedUrl(path, 3600).then(({ data }) => {
    if (!data?.signedUrl) return null;
    const url = new URL(data.signedUrl);
    url.searchParams.set('v', version ?? '1');
    const resolved = url.toString();
    signedUrlCache.set(key, { url: resolved, expiresAt: Date.now() + SIGNED_URL_TTL_MS });
    return resolved;
  }).catch(() => null).finally(() => signedUrlPending.delete(key));
  signedUrlPending.set(key, request);
  return request;
};

export const useUserAvatarUrl = (user: Pick<UserAvatarUser, 'avatarUrl' | 'avatarUpdatedAt'>) => {
  const directUrl = getUserAvatarUrl(user);
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(directUrl);

  useEffect(() => {
    let active = true;
    setResolvedUrl(directUrl);
    const path = user.avatarUrl?.trim();
    if (!path || directUrl || !path.startsWith('avatars/')) return () => { active = false; };

    getSignedAvatarUrl(path.slice('avatars/'.length), user.avatarUpdatedAt).then((url) => {
      if (active && url) setResolvedUrl(url);
    });
    return () => { active = false; };
  }, [directUrl, user.avatarUrl, user.avatarUpdatedAt]);

  return resolvedUrl;
};
