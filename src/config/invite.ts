const DEFAULT_INVITE_BASE_URL = 'https://ledgerworkspace.com';

export const getInviteBaseUrl = () => {
  const explicit = import.meta.env.VITE_INVITE_BASE_URL?.trim();
  return (explicit || DEFAULT_INVITE_BASE_URL).replace(/\/$/, '');
};

export const buildInviteUrl = (token: string) => {
  const safeToken = encodeURIComponent(String(token ?? '').trim());
  return `${getInviteBaseUrl()}/invite/${safeToken}`;
};
