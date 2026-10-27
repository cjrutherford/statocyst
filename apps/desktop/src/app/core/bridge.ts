import type { StatocystBridge } from '@statocyst/contracts';

declare global {
  interface Window {
    statocyst?: StatocystBridge;
  }
}

export function bridge(): StatocystBridge {
  const api = window.statocyst;
  if (!api) {
    throw new Error(
      'The Statocyst desktop bridge is unavailable. Run the renderer inside the Electron shell.',
    );
  }
  return api;
}

export function bridgeAvailable(): boolean {
  return typeof window !== 'undefined' && !!window.statocyst;
}
