<script setup lang="ts">
const props = defineProps<{ error: { statusCode?: number; statusMessage?: string } }>();
const message = computed(() => props.error?.statusCode === 404 ? "Страница не найдена" : "Что-то пошло не так");
</script>
<template>
  <div class="error-shell">
    <div class="error-mark">T</div>
    <p class="error-code">{{ error?.statusCode ?? 500 }}</p>
    <h1>{{ message }}</h1>
    <p>Вернитесь на главную или попробуйте открыть страницу ещё раз.</p>
    <div class="error-actions">
      <NuxtLink to="/" class="btn-primary">На главную</NuxtLink>
      <button class="btn-secondary" @click="clearError({ redirect: '/' })">Обновить</button>
    </div>
  </div>
</template>
<style scoped>.error-shell{min-height:100vh;display:grid;place-content:center;justify-items:center;text-align:center;padding:24px;background:var(--bg);color:var(--text)}.error-mark{width:48px;height:48px;border-radius:12px;background:var(--accent);color:#fff;display:grid;place-items:center;font-weight:900}.error-code{font:700 11px 'Roboto Mono',monospace;color:var(--text-faint);margin:24px 0 8px}.error-shell h1{font-size:40px;letter-spacing:-.05em;margin:0}.error-shell>p:not(.error-code){color:var(--text-dim);max-width:420px;line-height:1.5}.error-actions{display:flex;gap:10px;margin-top:18px}.error-actions .btn-primary{width:auto}.error-actions .btn-secondary{width:auto}</style>
