import type { CapacitorConfig } from '@capacitor/cli';

// The Android (and later iOS) shell around Thockdown Soundscapes. The web side
// is built by vite.config.ts into dist/; the native projects live beside it.
// Capacitor reads this file from the working directory, so its commands run
// from this folder (the package's own scripts do).
const config: CapacitorConfig = {
  appId: 'com.thockdown.soundscapes',
  appName: 'Thockdown Soundscapes',
  webDir: 'dist',
  android: { path: 'android' },
  ios: { path: 'ios' },
};

export default config;
