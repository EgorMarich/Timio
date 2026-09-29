<script setup lang="ts">
const { canInstall, isOffline, isStandalone, isIos, install } = usePwa();
const dismissed = ref(false);

async function installTimio() {
  await install();
}
</script>

<template>
  <div v-if="isOffline" class="pwa-offline" role="status">
    <span class="pwa-dot" aria-hidden="true"></span>
    Нет соединения · изменения не отправляются
  </div>
  <div v-else-if="canInstall && !dismissed" class="pwa-install" role="status">
    <div>
      <strong>Timio на телефоне</strong>
      <span>Установите приложение для быстрого доступа.</span>
    </div>
    <div class="pwa-actions">
      <button type="button" class="pwa-install-btn" @click="installTimio">Установить</button>
      <button type="button" class="pwa-close" aria-label="Закрыть" @click="dismissed = true">×</button>
    </div>
  </div>
  <div v-else-if="isIos && !isStandalone && !dismissed" class="pwa-install pwa-install-ios" role="status">
    <div>
      <strong>Добавьте Timio на экран «Домой»</strong>
      <span>Откройте меню «Поделиться» в Safari → «На экран Домой».</span>
    </div>
    <button type="button" class="pwa-close" aria-label="Закрыть" @click="dismissed = true">×</button>
  </div>
</template>

<style scoped>
.pwa-offline,
.pwa-install {
  position: fixed;
  z-index: 3000;
  left: 16px;
  right: 16px;
  bottom: calc(16px + env(safe-area-inset-bottom));
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  border-radius: 14px;
  box-shadow: var(--shadow);
}
.pwa-offline { padding: 12px 14px; font-size: 13px; font-weight: 700; }
.pwa-dot { display:inline-block; width:8px; height:8px; margin-right:8px; border-radius:50%; background:var(--accent); }
.pwa-install { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:14px; }
.pwa-install strong,.pwa-install span { display:block; }
.pwa-install strong { font-size:14px; margin-bottom:3px; }
.pwa-install span { color:var(--text-dim); font-size:12px; }
.pwa-actions { display:flex; align-items:center; gap:6px; flex:none; }
.pwa-install-btn { border:0; border-radius:9px; background:var(--accent); color:#fff; font-weight:700; padding:9px 12px; }
.pwa-close { border:0; background:transparent; color:var(--text-dim); font-size:22px; line-height:1; padding:6px; }
@media (min-width: 700px) { .pwa-offline,.pwa-install { left:auto; max-width:460px; } }
</style>
