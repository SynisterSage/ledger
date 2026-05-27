const DEFAULT_INVITE_BASE_URL = 'https://ledgerworkspace.com';

export const getInviteBaseUrl = () => {
  const explicit = import.meta.env.VITE_INVITE_BASE_URL?.trim();
  const fallback = import.meta.env.DEV ? window.location.origin : DEFAULT_INVITE_BASE_URL;
  return (explicit || fallback).replace(/\/$/, '');
};

export const buildInviteUrl = (token: string) => {
  const safeToken = encodeURIComponent(String(token ?? '').trim());
  return `${getInviteBaseUrl()}/invite/${safeToken}`;
};
