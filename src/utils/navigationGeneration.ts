export const isStaleNavigationGeneration = (incoming: number | undefined, latest: number) =>
  typeof incoming === 'number' && incoming < latest;
