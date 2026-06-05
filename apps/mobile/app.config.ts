import type { ExpoConfig } from 'expo/config';

const supabaseUrl = process.env.VITE_SUPABASE_URL?.trim() ?? '';
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY?.trim() ?? '';
const apiUrl = process.env.VITE_API_URL?.trim() ?? '';
const iosBundleIdentifier = process.env.EXPO_PUBLIC_IOS_BUNDLE_IDENTIFIER?.trim() ?? 'com.ledger.mobile';
const androidPackage = process.env.EXPO_PUBLIC_ANDROID_PACKAGE?.trim() ?? 'com.ledger.mobile';

const config: ExpoConfig = {
  name: 'Ledger',
  slug: 'ledger',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: 'ledger',
  userInterfaceStyle: 'automatic',
  ios: {
    bundleIdentifier: iosBundleIdentifier,
    supportsTablet: true,
    infoPlist: {
      NSSiriUsageDescription: 'Allow Ledger to capture tasks, reminders, notes, and events with Siri.',
    },
  },
  android: {
    package: androidPackage,
    adaptiveIcon: {
      backgroundColor: '#E6F4FE',
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
  },
  web: {
    bundler: 'metro',
    output: 'static',
    favicon: './assets/images/favicon.png',
  },
  plugins: [
    'expo-router',
    'expo-notifications',
    '@react-native-community/datetimepicker',
    [
      'expo-splash-screen',
      {
        image: './assets/images/splash-icon.png',
        resizeMode: 'contain',
        backgroundColor: '#FF5F40',
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    ledgerApiUrl: apiUrl,
    ledgerSupabaseUrl: supabaseUrl,
    ledgerSupabaseAnonKey: supabaseAnonKey,
  },
};

export default config;
