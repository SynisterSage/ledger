import { TodayItemRow } from './TodayItemRow';

type TodayItemProps = {
  title: string;
  subtitle?: string | null;
  active?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
};

/** Compatibility wrapper for callers outside TodayList. New surfaces should use TodayItemRow. */
export function TodayItem({ title, subtitle, active = false, onPress, onLongPress }: TodayItemProps) {
  return (
    <TodayItemRow
      type="task"
      title={title}
      metadata={subtitle ? [subtitle] : []}
      status={active ? 'active' : 'default'}
      onPress={onPress ?? (() => undefined)}
      onLongPress={onLongPress}
    />
  );
}
