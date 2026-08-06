import { supabase } from './supabase';
import type { UserProfile } from '../types/userProfile';
import { deserializeUserProfile } from '../types/userProfile';
import type { Database } from '../types/database';
import { DEFAULT_API_URL } from '../config/runtime';
import { buildLedgerSessionHeaders } from '../utils/deviceSession';

const PROFILE_FIELDS = 'id, email, full_name, avatar_url, avatar_updated_at';

export const userProfileService = {
  async get(userId: string): Promise<UserProfile | null> {
    const { data, error } = await supabase.from('users').select(PROFILE_FIELDS).eq('id', userId).maybeSingle();
    if (error) throw error;
    return data ? deserializeUserProfile(data) : null;
  },

  async upload(file: Blob, _userId: string): Promise<UserProfile> {
    if (file.type !== 'image/webp' || file.size > 500 * 1024) throw new Error('Avatar must be a 512 × 512 WebP image under 500 KB.');
    const { data: sessionData } = await supabase.auth.getSession();
    const response = await fetch(`${DEFAULT_API_URL}/api/user/avatar`, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/webp', Authorization: `Bearer ${sessionData.session?.access_token ?? ''}`, ...buildLedgerSessionHeaders() },
      body: file,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Avatar upload failed (${response.status}).`);
    return deserializeUserProfile(payload);
  },

  async remove(userId: string): Promise<UserProfile> {
    const path = `${userId}/profile.webp`;
    const { error: removeError } = await supabase.storage.from('avatars').remove([path]);
    if (removeError && !/not found|object not found|no such file/i.test(removeError.message ?? '')) throw removeError;
    const now = new Date().toISOString();
    const payload: Database['public']['Tables']['users']['Update'] = { avatar_url: null, avatar_updated_at: now, updated_at: now };
    try {
      const { data, error } = await supabase.from('users').update(payload as never).eq('id', userId).select(PROFILE_FIELDS).single();
      if (error) throw error;
      return deserializeUserProfile(data);
    } catch (error) {
      try {
        await supabase.from('users').update(payload as never).eq('id', userId);
      } catch {
        // Preserve the original storage/profile error.
      }
      throw error;
    }
  },
};
