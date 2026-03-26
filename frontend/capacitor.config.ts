import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.regionalpulsenews.app',
  appName: 'Regional Pulse News',
  webDir: 'out',
  server: {
    url: 'https://regionalpulsenews.com',
    cleartext: false,
  },
  android: {
    backgroundColor: '#0f172a',
    allowMixedContent: false,
  },
};

export default config;
