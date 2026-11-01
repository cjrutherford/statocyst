import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.hopefulaspirationsindustries.statocyst',
  appName: 'Statocyst',
  webDir: 'dist/apps/desktop/browser',
  server: {
    androidScheme: 'https',
    iosScheme: 'capacitor',
  },
  android: {
    // Match the splash background (abyss-900) so the WebView never flashes
    // white between the branded splash and the dark app shell rendering.
    backgroundColor: '#050a18',
  },
  ios: {
    // Match the splash background (abyss-900) so WKWebView never flashes
    // white between the branded launch screen and the dark app shell rendering.
    backgroundColor: '#050a18',
    contentInset: 'never',
    scheme: 'Statocyst',
  },
};

export default config;
