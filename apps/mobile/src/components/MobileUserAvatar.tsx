import { useEffect, useMemo, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';

import { AppText } from './AppText';

import { getSupabaseClient } from '@/api/client';
import { useLedgerTheme } from '@/theme';

type MobileUserAvatarProps = {
  displayName?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
  avatarUpdatedAt?: string | null;
  size?: number;
};

function getInitials(displayName: string | null | undefined, email: string | null | undefined) {
  const source = displayName?.trim() || email?.split('@')[0]?.trim() || 'Ledger user';
  const words = source.split(/\s+/).filter(Boolean);
  return words.length > 1
    ? `${words[0][0]}${words[1][0]}`.toUpperCase()
    : source.slice(0, 2).toUpperCase();
}

export function MobileUserAvatar({ displayName, email, avatarUrl, avatarUpdatedAt, size = 52 }: MobileUserAvatarProps) {
  const theme = useLedgerTheme();
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);
  const [imageFailed, setImageFailed] = useState(false);
  const initials = useMemo(() => getInitials(displayName, email), [displayName, email]);

  useEffect(() => {
    let active = true;
    setImageFailed(false);
    setResolvedUrl(null);

    const path = avatarUrl?.trim();
    if (!path) return () => { active = false; };

    if (/^https?:\/\//i.test(path)) {
      setResolvedUrl(`${path}${path.includes('?') ? '&' : '?'}v=${encodeURIComponent(avatarUpdatedAt ?? '1')}`);
      return () => { active = false; };
    }

    const storagePath = path.startsWith('avatars/') ? path.slice('avatars/'.length) : path;
    void getSupabaseClient().storage.from('avatars').createSignedUrl(storagePath, 3600).then(({ data }) => {
      if (!active || !data?.signedUrl) return;
      const url = new URL(data.signedUrl);
      url.searchParams.set('v', avatarUpdatedAt ?? '1');
      setResolvedUrl(url.toString());
    }).catch(() => undefined);

    return () => { active = false; };
  }, [avatarUrl, avatarUpdatedAt]);

  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: theme.colors.surfaceMuted, borderColor: theme.colors.borderSubtle }]}>
      {resolvedUrl && !imageFailed ? (
        <Image source={{ uri: resolvedUrl }} style={{ width: size, height: size }} onError={() => setImageFailed(true)} />
      ) : (
        <AppText variant="bodyStrong" style={{ color: theme.colors.textSecondary }}>{initials}</AppText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
  },
});
