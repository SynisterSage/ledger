import type { ProjectLensResult } from './projectLens';
import { LensCache } from '../lens/lensCache.ts';

export class ProjectLensCache extends LensCache<ProjectLensResult> {
  constructor() {
    super({
      storageKey: 'ledger:project-lens-cache:v2',
      maxEntries: 24,
      maxAgeMs: 30 * 60 * 1000,
    });
  }

}
