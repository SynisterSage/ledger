import { supabase } from './supabase';

const PRIVATE_BUCKETS = new Set(['note-images', 'note-files']);

export const getStorageObjectUrl = (bucket: string, path: string) => {
  if (PRIVATE_BUCKETS.has(bucket)) return '';
  return supabase.storage.from(bucket).getPublicUrl(path).data?.publicUrl ?? '';
};

export const createSignedStorageUrl = async (
  bucket: string,
  path: string,
  expiresIn = 3600
) => {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresIn);
  if (error) throw error;
  return data.signedUrl;
};
