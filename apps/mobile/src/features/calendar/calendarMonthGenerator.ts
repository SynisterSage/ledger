export type CalendarDayCell = {
  date: Date;
  dateKey: string;
  dayNumber: number;
  monthKey: string;
  isCurrentMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
};

export type CalendarWeek = CalendarDayCell[];

export type CalendarMonth = {
  monthKey: string;
  label: string;
  date: Date;
  weeks: CalendarWeek[];
};

const startOfDay = (date: Date) => {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
};

export const formatCalendarDateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const formatCalendarMonthKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

export const monthFromKey = (monthKey: string) => {
  const [year, month] = monthKey.split('-').map(Number);
  return new Date(year, (month || 1) - 1, 1);
};

export const addCalendarMonths = (date: Date, amount: number) => {
  const next = new Date(date);
  next.setDate(1);
  next.setMonth(next.getMonth() + amount);
  return next;
};

const getFirstWeekday = () => {
  try {
    const locale = new Intl.Locale(Intl.DateTimeFormat().resolvedOptions().locale) as Intl.Locale & {
      weekInfo?: { firstDay?: number };
      getWeekInfo?: () => { firstDay?: number };
    };
    const info = locale.getWeekInfo?.() ?? locale.weekInfo;
    if (typeof info?.firstDay === 'number') return info.firstDay % 7;
  } catch {
    // Sunday is the safe fallback when locale week metadata is unavailable.
  }
  return 0;
};

const addDays = (date: Date, amount: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
};

const startOfCalendarWeek = (date: Date, firstWeekday: number) => {
  const day = date.getDay();
  return addDays(startOfDay(date), -((day - firstWeekday + 7) % 7));
};

export function generateCalendarMonth(
  monthDate: Date,
  selectedDate: Date,
  today = new Date(),
  firstWeekday = getFirstWeekday(),
): CalendarMonth {
  const month = new Date(monthDate);
  month.setDate(1);
  month.setHours(0, 0, 0, 0);
  const monthKey = formatCalendarMonthKey(month);
  const monthEnd = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  const gridStart = startOfCalendarWeek(month, firstWeekday);
  const gridEnd = addDays(startOfCalendarWeek(monthEnd, firstWeekday), 6);
  const selectedKey = formatCalendarDateKey(selectedDate);
  const todayKey = formatCalendarDateKey(today);
  const weeks: CalendarWeek[] = [];

  for (let cursor = gridStart; cursor <= gridEnd; cursor = addDays(cursor, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, index) => {
      const date = addDays(cursor, index);
      return {
        date,
        dateKey: formatCalendarDateKey(date),
        dayNumber: date.getDate(),
        monthKey,
        isCurrentMonth: date.getMonth() === month.getMonth() && date.getFullYear() === month.getFullYear(),
        isToday: formatCalendarDateKey(date) === todayKey,
        isSelected: formatCalendarDateKey(date) === selectedKey,
      };
    }));
  }

  return {
    monthKey,
    label: month.toLocaleDateString([], { month: 'long', year: 'numeric' }),
    date: month,
    weeks,
  };
}

export function generateCalendarMonths(startMonth: Date, count: number) {
  return Array.from({ length: count }, (_, index) => addCalendarMonths(startMonth, index));
}

export function getCalendarWeekdayLabels(firstWeekday = getFirstWeekday()) {
  const anchor = new Date(2024, 0, 7 + firstWeekday);
  return Array.from({ length: 7 }, (_, index) =>
    addDays(anchor, index).toLocaleDateString([], { weekday: 'short' }).slice(0, 1),
  );
}
