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
  plugins: {
    SystemBars: {
      // index.html declares viewport-fit=cover, so the page draws under the
      // system bars. Without this hint Capacitor only learns that once the
      // page has committed, and until then pads the WebView clear of the bars,
      // so the navigation bar's strip showed the window and filled in later.
      initialViewportFitValueHint: 'cover',
      // Light icons from the start: the first thing on screen is the launch
      // overlay's dark background (launch_background). The page sets the
      // look's own style once the overlay is gone (launchHandover.ts).
      style: 'DARK',
    },
  },
};

export default config;
