import type { ExpoConfig } from 'expo/config';

const supabaseUrl = process.env.VITE_SUPABASE_URL?.trim() ?? '';
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY?.trim() ?? '';
const apiUrl = process.env.VITE_API_URL?.trim() ?? '';

const config: ExpoConfig = {
  name: 'mobile',
  slug: 'mobile',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: 'mobile',
  userInterfaceStyle: 'automatic',
  ios: {
    supportsTablet: true,
  },
  android: {
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
    [
      'expo-splash-screen',
      {
        image: './assets/images/logo-white.svg',
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
