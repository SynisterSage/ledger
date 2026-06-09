# Ledger Mobile Release

This app uses Expo + EAS for iOS builds and TestFlight submission.

## One-time setup

1. Install the EAS CLI if needed:

```bash
npx eas-cli --version
```

2. Link the project to Expo/EAS:

```bash
cd apps/mobile
npx eas-cli init
```

3. Make sure the iOS bundle identifier is the one you want to ship:

```bash
EXPO_PUBLIC_IOS_BUNDLE_IDENTIFIER=com.yourcompany.ledger
```

4. Add the required runtime environment variables in EAS:

```bash
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
VITE_API_URL
```

## TestFlight build

From `apps/mobile`:

```bash
npm run build:ios
```

That produces a production iOS build suitable for TestFlight.

## Submit to TestFlight

```bash
npm run submit:ios
```

## Internal iOS build

If you want a non-App-Store build for device testing:

```bash
npm run build:ios:internal
```

## Notes

- `apps/mobile/app.config.ts` is the source of truth for Expo config.
- `apps/mobile/eas.json` controls the build profiles.
- `autoIncrement` is enabled for production builds so TestFlight uploads do not reuse the same build number.
