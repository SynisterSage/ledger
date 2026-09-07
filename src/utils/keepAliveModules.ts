export const MAX_KEEP_ALIVE_MODULES = 3;

/** Touches the active module and evicts the least-recently-used inactive modules. */
export const touchKeepAliveModules = <T>(modules: T[], active: T, max = MAX_KEEP_ALIVE_MODULES) => {
  const boundedMax = Math.max(1, Math.floor(max));
  return [...modules.filter((module) => module !== active), active].slice(-boundedMax);
};
