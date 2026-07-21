export const OPENAI_APPS_CHALLENGE_PATH = '/.well-known/openai-apps-challenge';

export const getOpenAiAppsChallengeToken = (env = process.env) => {
  const token = String(env.OPENAI_APPS_CHALLENGE_TOKEN ?? '').trim();
  return token || null;
};
