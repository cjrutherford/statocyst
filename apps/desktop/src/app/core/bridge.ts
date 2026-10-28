import type { StatocystBridge } from '@statocyst/contracts';
import { CapacitorBridge } from './capacitor-bridge';

declare global {
  interface Window {
    statocyst?: StatocystBridge;
    Capacitor?: { Plugins?: Record<string, unknown>; isNativePlatform?: () => boolean };
  }
}

export function bridge(): StatocystBridge {
  if (window.statocyst) return window.statocyst;
  if (window.Capacitor?.isNativePlatform?.()) {
    // Lazily create the Capacitor bridge.
    const cap = new CapacitorBridge();
    window.statocyst = cap as unknown as StatocystBridge;
    return window.statocyst;
  }
  throw new Error(
    'The Statocyst desktop bridge is unavailable. Run the renderer inside the Electron shell.',
  );
}

export function bridgeAvailable(): boolean {
  return (
    typeof window !== 'undefined' &&
    (!!window.statocyst || !!window.Capacitor?.isNativePlatform?.())
  );
}

/** True when running inside the Capacitor Android app (as opposed to Electron). */
export function isNativePlatform(): boolean {
  return typeof window !== 'undefined' && !!window.Capacitor?.isNativePlatform?.();
}
