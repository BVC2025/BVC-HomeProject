import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.bvcerp.app',
  appName: 'bvc-erp',
  webDir: 'dist',
  // Allow the WebView to make plain-HTTP requests. The ERP backend
  // at http://192.168.1.10:8001 is LAN-only HTTP; without this the
  // WebView blocks it even when AndroidManifest permits cleartext.
  server: {
    cleartext: true
  }
};

export default config;
