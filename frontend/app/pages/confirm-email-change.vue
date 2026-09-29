<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useTimioAuthApi } from "../composables/useTimioAuthApi";
const api = useTimioAuthApi();
const route = useRoute();
const loading = ref(true);
const error = ref("");
const done = ref(false);
onMounted(async () => {
  const token = String(route.query.token || "");
  if (!token) { error.value = "Ссылка недействительна."; loading.value = false; return; }
  try { await api.confirmEmailChange(token); done.value = true; }
  catch (e: any) { error.value = e.message === "email_taken" ? "Этот email уже занят." : "Ссылка недействительна или истекла."; }
  finally { loading.value = false; }
});
</script>
<template><div class="centered-shell"><div class="auth-card"><div class="brand"><span class="brand-mark">T</span><span class="brand-name">Timio</span></div><h1 class="page-title">Email обновлён</h1><div v-if="loading" class="helper-text">Проверяем ссылку…</div><div v-else-if="done" class="success-banner">Новый email подтверждён. Вы вошли в Timio заново.</div><div v-else class="error-banner">{{ error }}</div><p class="footer-link"><NuxtLink to="/app" class="btn-link">Вернуться в Timio</NuxtLink></p></div></div></template>
