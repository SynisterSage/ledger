import { Fragment, memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '@/components/AppText';
import { useLedgerTheme } from '@/theme';
import { formatCalendarDateKey, type CalendarMonth } from './calendarMonthGenerator';
import type { StackedDayPresentation } from './stackedDayPresentation';

type Props = {
  month: CalendarMonth;
  selectedDate: Date;
  presentations: Record<string, StackedDayPresentation>;
  onSelectDate: (date: Date) => void;
  onOpenDate: (date: Date) => void;
};

const emptyPresentation: StackedDayPresentation = { totalCount: 0, visibleStrips: [], overflowCount: 0, categorySummary: '', sourceCount: 0 };

export const StackedMonthView = memo(function StackedMonthView({ month, selectedDate, presentations, onSelectDate, onOpenDate }: Props) {
  const theme = useLedgerTheme();
  const selectedKey = formatCalendarDateKey(selectedDate);

  return <View>
    <View style={[styles.monthLabel, { borderBottomColor: theme.colors.borderSubtle }]}><AppText variant="bodyStrong">{month.label}</AppText></View>
    {month.weeks.map((week) => <Fragment key={week[0]?.dateKey ?? month.monthKey}>
      <View style={[styles.week, { borderBottomColor: theme.colors.borderSubtle }]}>
        {week.map((day) => {
          const presentation = presentations[day.dateKey] ?? emptyPresentation;
          const selected = day.dateKey === selectedKey;
          const today = day.isToday;
          const weekend = day.date.getDay() === 0 || day.date.getDay() === 6;
          const stateLabel = selected ? (today ? ', selected, today' : ', selected') : today ? ', today' : '';
          const accessibilityLabel = `${month.label} ${day.dayNumber}${stateLabel}${presentation.totalCount ? `, ${presentation.totalCount} items${presentation.sourceCount > 1 ? ` from ${presentation.sourceCount} calendars` : ''}${presentation.categorySummary ? `: ${presentation.categorySummary}` : ''}` : ', no items'}`;
          return <Pressable
            key={day.dateKey}
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel}
            onPress={() => selected ? onOpenDate(day.date) : onSelectDate(day.date)}
            style={({ pressed }) => [styles.cell, { opacity: pressed ? 0.62 : 1 }]}
          >
            <View style={styles.dateArea}>
              <View style={[styles.number, selected && { backgroundColor: theme.colors.accent }]}>
                <AppText variant="body" style={{ color: selected ? theme.colors.onAccent : day.isCurrentMonth ? today ? theme.colors.accent : weekend ? theme.colors.textSecondary : theme.colors.textPrimary : theme.colors.textMuted, fontWeight: selected || today ? '700' : '400' }}>{day.dayNumber}</AppText>
              </View>
              <View style={[styles.stripArea, !day.isCurrentMonth && styles.quietStrips]}>
                {presentation.visibleStrips.map((strip) => <View key={strip.id} style={[styles.strip, { backgroundColor: strip.color }]} />)}
                {presentation.overflowCount > 0 ? <AppText variant="caption" style={[styles.overflow, { color: theme.colors.textMuted }]}>+{presentation.overflowCount}</AppText> : null}
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
  week: { height: 78, flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth },
  cell: { flex: 1, minWidth: 0, minHeight: 44, alignItems: 'center', justifyContent: 'flex-start', paddingTop: 5, paddingHorizontal: 3 },
  dateArea: { width: '100%', minHeight: 44, alignItems: 'center', justifyContent: 'flex-start' },
  number: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  stripArea: { width: '100%', minHeight: 34, gap: 2, paddingTop: 3 },
  quietStrips: { opacity: 0.58 },
  strip: { width: '100%', height: 5, borderRadius: 2.5 },
  overflow: { fontSize: 10, lineHeight: 12, paddingTop: 0 },
});
