import { Tabs } from 'expo-router';

import { FloatingTabBar } from '@/components/FloatingTabBar';
import { MobileSearchSheet } from '@/features/search/MobileSearchSheet';
import { SearchSheetProvider } from '@/features/search/SearchSheetContext';
import { useLedgerTheme } from '@/theme';

export default function TabLayout() {
  const theme = useLedgerTheme();

  return (
    <SearchSheetProvider>
      <Tabs
        initialRouteName="today"
        tabBar={(props) => <FloatingTabBar {...props} />}
        screenOptions={{
          headerShown: false,
          tabBarStyle: { display: 'none' },
          sceneStyle: { backgroundColor: theme.colors.background },
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
      <MobileSearchSheet />
    </SearchSheetProvider>
  );
}
