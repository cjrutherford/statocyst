import { provideBrowserGlobalErrorListeners, provideZonelessChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';

// Capacitor injects `window.Capacitor` before the bundle runs, so the native
// rendering profile can be selected synchronously and the first paint already
// uses the cheaper ocean/bubble paint path (no live backdrop blur).
const capacitor = (window as unknown as {
  Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string };
}).Capacitor;
if (capacitor?.isNativePlatform?.()) {
  document.documentElement.dataset['native'] = capacitor.getPlatform?.() ?? 'native';
}

bootstrapApplication(AppComponent, {
  providers: [provideZonelessChangeDetection(), provideBrowserGlobalErrorListeners()],
}).catch((error) => {
  console.error('Statocyst failed to start', error);
});
