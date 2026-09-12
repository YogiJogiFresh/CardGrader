import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';

import { App } from './App';
import './styles.css';

let registration: ServiceWorkerRegistration | undefined;
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    document.documentElement.dataset.cardgraderUpdateAvailable = 'true';
    window.dispatchEvent(new Event('cardgrader:update-available'));
  },
  onRegisteredSW(_serviceWorkerUrl, serviceWorkerRegistration) {
    registration = serviceWorkerRegistration;
    void registration?.update().catch(() => undefined);
  },
});

window.addEventListener('cardgrader:apply-update', () => {
  void updateSW(true).catch((error: unknown) => {
    window.dispatchEvent(
      new CustomEvent<string>('cardgrader:update-error', {
        detail:
          error instanceof Error
            ? error.message
            : 'The update could not be applied.',
      }),
    );
  });
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    void registration?.update().catch(() => undefined);
  }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
