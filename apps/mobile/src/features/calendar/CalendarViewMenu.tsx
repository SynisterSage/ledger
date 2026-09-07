import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ComponentProps, type RefObject } from 'react';
import { Animated, Easing, Modal, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from '@/components/AppText';
import { useLedgerTheme } from '@/theme';
import { useAppPreferencesState } from '@/store/appPreferencesStore';
import type { MonthDisplayMode } from './useMobileCalendarState';

type CalendarViewMenuValue = MonthDisplayMode | 'list';

type CalendarSymbolName = ComponentProps<typeof SymbolView>['name'];

const options: Array<{ id: CalendarViewMenuValue; label: string; icon: CalendarSymbolName }> = [
  { id: 'compact', label: 'Compact', icon: { ios: 'rectangle.grid.2x2', android: 'grid_view', web: 'grid_view' } },
  { id: 'stacked', label: 'Stacked', icon: { ios: 'rectangle.stack', android: 'view_agenda', web: 'view_agenda' } },
  { id: 'details', label: 'Details', icon: { ios: 'calendar', android: 'calendar_month', web: 'calendar_month' } },
  { id: 'list', label: 'List', icon: { ios: 'list.bullet', android: 'view_list', web: 'view_list' } },
];

type Props = {
  visible: boolean;
  value: CalendarViewMenuValue;
  anchorRef: RefObject<View | null>;
  onChange: (value: CalendarViewMenuValue) => void;
  onClose: () => void;
};

export type CalendarViewMenuHandle = {
  open: () => void;
};

type CalendarViewMenuControllerProps = {
  value: CalendarViewMenuValue;
  icon: CalendarSymbolName;
  onChange: (value: CalendarViewMenuValue) => void;
};

export const CalendarViewMenuController = forwardRef<CalendarViewMenuHandle, CalendarViewMenuControllerProps>(function CalendarViewMenuController({ value, icon, onChange }, ref) {
  const theme = useLedgerTheme();
  const [visible, setVisible] = useState(false);
  const anchorRef = useRef<View>(null);

  useImperativeHandle(ref, () => ({ open: () => setVisible(true) }), []);

  return (
    <>
      <Pressable ref={anchorRef} accessibilityRole="button" accessibilityLabel="Change calendar view" onPress={() => setVisible(true)} style={styles.trigger}>
        <SymbolView name={icon} size={21} tintColor={theme.colors.textPrimary} />
      </Pressable>
      <CalendarViewMenu
        visible={visible}
        value={value}
        anchorRef={anchorRef}
        onChange={onChange}
        onClose={() => setVisible(false)}
      />
    </>
  );
});

export function CalendarViewMenu({ visible, value, anchorRef, onChange, onClose }: Props) {
  const theme = useLedgerTheme();
  const { reduceMotionEnabled } = useAppPreferencesState();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [anchor, setAnchor] = useState({ x: 0, y: 0, width: 0, height: 0 });
  const [anchorReady, setAnchorReady] = useState(false);
  const [mounted, setMounted] = useState(visible);
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-3)).current;
  const closingRef = useRef(false);

  useEffect(() => {
    closingRef.current = false;
    opacity.stopAnimation();
    translateY.stopAnimation();

    if (visible) {
      setMounted(true);
      setAnchorReady(false);
      opacity.setValue(0);
      translateY.setValue(-3);
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: reduceMotionEnabled ? 1 : 55, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(translateY, { toValue: 0, duration: reduceMotionEnabled ? 1 : 65, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      ]).start();
      return;
    }

    if (!mounted) return;
    closingRef.current = true;
    Animated.parallel([
      Animated.timing(opacity, { toValue: 0, duration: reduceMotionEnabled ? 1 : 45, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      Animated.timing(translateY, { toValue: -2, duration: reduceMotionEnabled ? 1 : 45, easing: Easing.in(Easing.quad), useNativeDriver: true }),
    ]).start(({ finished }) => {
      if (finished && closingRef.current) setMounted(false);
    });
  }, [mounted, opacity, reduceMotionEnabled, translateY, visible]);

  useEffect(() => {
    if (!visible) return;
    setAnchorReady(false);
    const frame = requestAnimationFrame(() => {
      anchorRef.current?.measureInWindow((x, y, measuredWidth, measuredHeight) => {
        setAnchor({ x, y, width: measuredWidth, height: measuredHeight });
        setAnchorReady(true);
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [anchorRef, visible]);

  const closeMenu = () => {
    if (closingRef.current) return;
    onClose();
  };

  if (!mounted || !anchorReady) return null;

  const menuWidth = 176;
  const menuHeight = options.length * 48 + 8;
  const left = Math.max(8, Math.min(anchor.x + anchor.width - menuWidth, width - menuWidth - 8));
  const top = Math.max(insets.top + 8, Math.min(anchor.y + anchor.height + 4, height - insets.bottom - menuHeight - 8));

  return (
    <Modal visible={mounted} transparent animationType="none" statusBarTranslucent onRequestClose={closeMenu}>
      <Pressable style={StyleSheet.absoluteFill} onPress={closeMenu} accessibilityLabel="Close calendar view menu" />
      <Animated.View style={[styles.menu, { left, top, width: menuWidth, backgroundColor: theme.colors.surface, borderColor: theme.colors.borderSubtle, opacity, transform: [{ translateY }] }]}>
        {options.map((option, index) => (
          <View key={option.id}>
            {index === 3 ? <View style={[styles.divider, { backgroundColor: theme.colors.borderSubtle }]} /> : null}
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ selected: option.id === value }}
              accessibilityLabel={`${option.label} calendar view`}
              onPress={() => { onChange(option.id); closeMenu(); }}
              style={({ pressed }) => [styles.option, { opacity: pressed ? 0.62 : 1 }]}
            >
              <SymbolView name={option.icon} size={17} tintColor={theme.colors.textSecondary} />
              <AppText variant="body" style={styles.label}>{option.label}</AppText>
              {option.id === value ? <SymbolView name={{ ios: 'checkmark', android: 'check', web: 'check' }} size={17} tintColor={theme.colors.accent} /> : null}
            </Pressable>
          </View>
        ))}
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  trigger: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  menu: { position: 'absolute', borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, paddingVertical: 4 },
  option: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 13 },
  label: { flex: 1 },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 4 },
});
