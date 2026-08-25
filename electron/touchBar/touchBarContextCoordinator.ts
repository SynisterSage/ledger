import {
  DEFAULT_TOUCH_BAR_CONTEXT,
  normalizeLedgerTouchBarContext,
  type LedgerTouchBarContext,
  type LedgerTouchBarWindowContext,
} from './touchBarContext.ts';

type ContextCandidate = {
  role: LedgerTouchBarWindowContext;
  context: LedgerTouchBarContext;
  focused: boolean;
  sequence: number;
};
const rolePriority: Record<LedgerTouchBarWindowContext, number> = {
  workspace: 4,
  module: 3,
  sidebar: 2,
  unknown: 1,
};

export function createTouchBarContextCoordinator(
  onContext: (context: LedgerTouchBarContext) => void
) {
  const candidates = new Map<string, ContextCandidate>();
  let meeting: LedgerTouchBarContext['meeting'];
  let sequence = 0;
  let current = { ...DEFAULT_TOUCH_BAR_CONTEXT };

  const select = () => {
    const selected =
      [...candidates.values()]
        .filter((candidate) => candidate.focused)
        .sort(
          (left, right) =>
            rolePriority[right.role] - rolePriority[left.role] || right.sequence - left.sequence
        )[0] ?? [...candidates.values()].sort((left, right) => right.sequence - left.sequence)[0];
    const next = selected
      ? { ...selected.context, windowContext: selected.role, ...(meeting ? { meeting } : {}) }
      : { ...DEFAULT_TOUCH_BAR_CONTEXT, ...(meeting ? { meeting } : {}) };
    if (JSON.stringify(next) === JSON.stringify(current)) return;
    current = next;
    onContext(current);
  };

  return {
    update(sourceKey: string, role: LedgerTouchBarWindowContext, value: unknown, focused: boolean) {
      candidates.set(sourceKey, {
        role,
        context: { ...normalizeLedgerTouchBarContext(value), windowContext: role },
        focused,
        sequence: ++sequence,
      });
      select();
    },
    setFocused(sourceKey: string, focused: boolean) {
      const candidate = candidates.get(sourceKey);
      if (!candidate) return;
      candidate.focused = focused;
      candidate.sequence = ++sequence;
      select();
    },
    setMeeting(nextMeeting: LedgerTouchBarContext['meeting']) {
      meeting = nextMeeting;
      select();
    },
    remove(sourceKey: string) {
      candidates.delete(sourceKey);
      select();
    },
    reset() {
      candidates.clear();
      meeting = undefined;
      current = { ...DEFAULT_TOUCH_BAR_CONTEXT };
      onContext(current);
    },
    getContext: () => current,
  };
}
