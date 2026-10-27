import { protocol } from 'electron';

export const MEDIA_SCHEME = 'statocyst-media';
export const ART_SCHEME = 'statocyst-art';

/**
 * Custom schemes must be declared before the app is ready and before the first
 * renderer process starts, otherwise Chromium reports ERR_UNKNOWN_URL_SCHEME
 * for early subresource requests.
 *
 * This module is imported first by `main.ts` so the registration happens before
 * any heavier runtime dependency (libSQL, music-metadata) is loaded.
 */
protocol.registerSchemesAsPrivileged([
  {
    scheme: MEDIA_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
      bypassCSP: false,
    },
  },
  {
    scheme: ART_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
      bypassCSP: false,
    },
  },
]);
