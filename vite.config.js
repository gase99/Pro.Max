import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Content-Security-Policy is injected into the production build only.
// Dev keeps Vite's HMR inline scripts and websocket connection working.
const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self' file:",
  "style-src 'self' 'unsafe-inline' file:",
  "img-src 'self' data: blob: file:",
  "font-src 'self' data: file:",
  "connect-src 'self' data: blob: file:",
  "worker-src 'self' blob: file:",
  "media-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].join('; ');

function contentSecurityPolicy() {
  return {
    name: 'promax-content-security-policy',
    apply: 'build',
    transformIndexHtml(html) {
      return {
        html,
        tags: [
          {
            tag: 'meta',
            attrs: { 'http-equiv': 'Content-Security-Policy', content: CONTENT_SECURITY_POLICY },
            injectTo: 'head-prepend'
          }
        ]
      };
    }
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), contentSecurityPolicy()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: true
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    strictPort: true,
    allowedHosts: true
  },
  build: {
    chunkSizeWarningLimit: 1000
  }
});
