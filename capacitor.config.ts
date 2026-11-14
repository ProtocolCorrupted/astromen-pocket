import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'ai.astromen.pocket',
  appName: 'Astromen Pocket',
  webDir: 'dist',
  ios: { contentInset: 'never', backgroundColor: '#101312', preferredContentMode: 'mobile' },
  plugins: {
    CapacitorHttp: { enabled: true },
  },
};
export default config;
