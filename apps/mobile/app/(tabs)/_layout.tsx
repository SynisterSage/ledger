import { Tabs } from 'expo-router';

import { useLedgerTheme } from '@/theme';

export default function TabLayout() {
  const theme = useLedgerTheme();

  return (
    <Tabs
      initialRouteName="today"
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.accent,
        tabBarInactiveTintColor: theme.colors.textMuted,
        tabBarStyle: {
          backgroundColor: theme.colors.tabBar,
          borderTopColor: theme.colors.tabBarBorder,
        },
        tabBarLabelStyle: {
          fontSize: theme.typography.caption.fontSize,
          fontWeight: theme.typography.caption.fontWeight as '400' | '500' | '600' | '700',
        },
      }}>
      <Tabs.Screen
        name="today"
        options={{
          title: 'Today',
        }}
      />
      <Tabs.Screen
        name="capture"
        options={{
          title: 'Capture',
        }}
      />
      <Tabs.Screen
        name="notifications"
        options={{
          title: 'Notifications',
        }}
      />
    </Tabs>
  );
}
