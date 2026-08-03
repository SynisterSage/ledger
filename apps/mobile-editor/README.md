# Ledger Mobile Lexical Editor

This is an isolated Lexical proof of concept for the Expo app. It is intentionally separate from production Notes persistence and the existing mobile editor.

Run `npm run build:mobile-editor` from the repository root. Vite builds the web editor and writes a single self-contained HTML asset to `apps/mobile/assets/mobile-editor/index.html`. The mobile Metro config treats HTML as a bundled asset, and `/dev/lexical-editor` loads that local file through `react-native-webview`.

After changing the web editor, rebuild the asset before opening the development route. A native development build is required after changing the `react-native-webview` dependency.
