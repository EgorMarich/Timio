import { ref } from 'vue';

const deferredPrompt = ref<BeforeInstallPromptEvent | null>(null);
const canInstall = ref(false);
const isOffline = ref(false);
const isStandalone = ref(false);
const isIos = ref(false);
let initialized = false;

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export function usePwa() {
  function init() {
    if (initialized || typeof window === 'undefined') return;
    initialized = true;
    isOffline.value = !navigator.onLine;
    isStandalone.value = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    isIos.value = /iphone|ipad|ipod/i.test(navigator.userAgent) && !isStandalone.value;

    window.addEventListener('online', () => { isOffline.value = false; });
    window.addEventListener('offline', () => { isOffline.value = true; });
    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      deferredPrompt.value = event as BeforeInstallPromptEvent;
      canInstall.value = true;
    });
    window.addEventListener('appinstalled', () => {
      deferredPrompt.value = null;
      canInstall.value = false;
    });

    if ('serviceWorker' in navigator && import.meta.env.PROD) {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }
  }

  async function install() {
    if (!deferredPrompt.value) return false;
    await deferredPrompt.value.prompt();
    const result = await deferredPrompt.value.userChoice;
    deferredPrompt.value = null;
    canInstall.value = false;
    return result.outcome === 'accepted';
  }

  return { canInstall, isOffline, isStandalone, isIos, init, install };
}
