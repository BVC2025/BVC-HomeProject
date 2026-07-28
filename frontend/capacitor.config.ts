import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.bvcerp.app',
  appName: 'bvc-erp',
  webDir: 'dist',
  // ── Server config ─────────────────────────────────────────────
  // androidScheme: 'http'
  //   Capacitor 5+ defaults to loading the WebView from
  //   https://localhost. Our backend is HTTP-only
  //   (http://192.168.1.10:8001), so calls from an https page hit
  //   Chrome's Mixed Content block. Switching the WebView to
  //   http://localhost puts both origins on HTTP and eliminates the
  //   block. Secure-context APIs (geolocation, getUserMedia) still
  //   work: Chrome treats http://localhost as a secure origin.
  //
  // cleartext: true
  //   Lets the WebView's network layer make plain-HTTP requests.
  //   AndroidManifest.xml also has usesCleartextTraffic=true — both
  //   gates need to be open.
  server: {
    androidScheme: 'http',
    cleartext: true
  }
};

export default config;
