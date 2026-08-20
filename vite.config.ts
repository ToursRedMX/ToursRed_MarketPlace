import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { sentryVitePlugin } from '@sentry/vite-plugin';

const hasSentryToken = !!process.env.SENTRY_AUTH_TOKEN;

const plugins: ReturnType<typeof react>[] = [react()];

if (hasSentryToken) {
  plugins.push(
    sentryVitePlugin({
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      telemetry: false,
      sourcemaps: {
        filesToDeleteAfterUpload: ['dist/**/*.js.map'],
      },
    })
  );
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins,
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  server: {
    hmr: {
      overlay: true,
    },
  },
  build: {
    sourcemap: hasSentryToken ? 'hidden' : false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('react-router-dom') || id.includes('/react/') || id.includes('/react-dom/')) {
              return 'vendor';
            }
            if (id.includes('@supabase/supabase-js')) {
              return 'supabase';
            }
          }
        },
      },
    },
  },
});
