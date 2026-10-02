import type { CapacitorConfig } from '@capacitor/cli';

// The Android (and later iOS) shell around the mobile soundscape app. The web
// side is built by mobile/vite.config.ts into mobile/dist; the native projects
// live under mobile/ so the desktop app's tree is not mixed with them.
const config: CapacitorConfig = {
  appId: 'com.thockdown.soundscapes',
  appName: 'Thockdown Soundscapes',
  webDir: 'mobile/dist',
  android: { path: 'mobile/android' },
  ios: { path: 'mobile/ios' },
};

export default config;
