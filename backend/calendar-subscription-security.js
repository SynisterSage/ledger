import crypto from 'node:crypto';

export const createCalendarSubscriptionToken = () => crypto.randomBytes(32).toString('hex');
export const hashCalendarSubscriptionToken = (token) =>
  crypto.createHash('sha256').update(String(token)).digest('hex');
