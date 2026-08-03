import { Fragment, memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '@/components/AppText';
import { useLedgerTheme } from '@/theme';
import { formatCalendarDateKey, type CalendarMonth } from './calendarMonthGenerator';
import type { CompactDayPresentation } from './compactDayPresentation';

type Props = {
  month: CalendarMonth;
  selectedDate: Date;
  presentations: Record<string, CompactDayPresentation>;
  onSelectDate: (date: Date) => void;
  onOpenDate: (date: Date) => void;
};

export const CompactMonthView = memo(function CompactMonthView({ month, selectedDate, presentations, onSelectDate, onOpenDate }: Props) {
  const theme = useLedgerTheme();
  const selectedKey = formatCalendarDateKey(selectedDate);
  const weeks = month.weeks;

  return <View>
    <View style={[styles.monthLabel, { borderBottomColor: theme.colors.borderSubtle }]}><AppText variant="bodyStrong">{month.label}</AppText></View>
    {weeks.map((week) => <Fragment key={week[0]?.dateKey ?? month.monthKey}>
      <View style={[styles.week, { borderBottomColor: theme.colors.borderSubtle }]}>
        {week.map((day) => {
          const presentation = presentations[day.dateKey] ?? { totalCount: 0, markers: [], categorySummary: '' };
          const selected = day.dateKey === selectedKey;
          const today = day.isToday;
          const stateLabel = selected ? (today ? ', selected, today' : ', selected') : today ? ', today' : '';
          const accessibilityLabel = `${month.label} ${day.dayNumber}${stateLabel}${presentation.totalCount ? `, ${presentation.totalCount} items${presentation.categorySummary ? `: ${presentation.categorySummary}` : ''}` : ', no items'}`;
          return <Pressable
            key={day.dateKey}
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel}
            onPress={() => selected ? onOpenDate(day.date) : onSelectDate(day.date)}
            style={({ pressed }) => [styles.cell, { opacity: pressed ? 0.62 : 1 }]}
          >
            <View style={styles.dateArea}>
              <View style={[styles.number, selected && { backgroundColor: theme.colors.accent }, !selected && today && styles.todayNumber]}>
                <AppText variant="body" style={{ color: selected ? theme.colors.onAccent : day.isCurrentMonth ? today ? theme.colors.accent : theme.colors.textPrimary : theme.colors.textMuted, fontWeight: selected || today ? '700' : '400' }}>{day.dayNumber}</AppText>
              </View>
              <View style={[styles.markers, !day.isCurrentMonth && styles.quietMarkers]}>
                {presentation.markers.map((marker, index) => <View key={`${day.dateKey}-marker-${index}`} style={[marker.strength === 'dot' ? styles.dot : styles.capsule, { backgroundColor: marker.color }]} />)}
              </View>
            </View>
          </Pressable>;
        })}
      </View>
    </Fragment>)}
  </View>;
});

const styles = StyleSheet.create({
  monthLabel: { height: 38, justifyContent: 'flex-end', paddingBottom: 7, paddingHorizontal: 2, borderBottomWidth: StyleSheet.hairlineWidth },
  week: { height: 58, flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth },
  cell: { flex: 1, minWidth: 0, minHeight: 44, alignItems: 'center', justifyContent: 'flex-start', paddingTop: 5 },
  dateArea: { minHeight: 44, alignItems: 'center', justifyContent: 'flex-start' },
  number: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  todayNumber: { backgroundColor: 'transparent' },
  markers: { height: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3, paddingTop: 2 },
  quietMarkers: { opacity: 0.58 },
  dot: { width: 5, height: 5, borderRadius: 3 },
  capsule: { width: 13, height: 4, borderRadius: 2 },
});
