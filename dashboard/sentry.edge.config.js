// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever middleware or an Edge route handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from '@sentry/nextjs';

const SENTRY_DSN = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;


process.env.NODE_ENV !== 'development' && Sentry.init({
  dsn: SENTRY_DSN || 'https://bf98dec973d744239df98e94d5a041fe@o4505186986557440.ingest.sentry.io/4505186987999232',
  // Adjust this value in production, or use tracesSampler for greater control
  tracesSampleRate: 0,
  // ...
  // Note: if you want to override the automatic release value, do not set a
  // `release` value here - use the environment variable `SENTRY_RELEASE`, so
  // that it will also get attached to your source maps
  // integrations: [
  //   new Sentry.Integrations.GlobalHandlers({
  //     onunhandledrejection: false,
  //     onerror: false
  //   })
  // ],
});
