import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'net.christopherrutherford.statocyst',
  appName: 'Statocyst',
  webDir: 'dist/apps/desktop/browser',
  server: {
    androidScheme: 'https',
  },
};

export default config;
