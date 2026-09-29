<script setup lang="ts">
import { ref } from "vue";
import { useTimioAuthApi } from "../composables/useTimioAuthApi";

const api = useTimioAuthApi();
const router = useRouter();
const route = useRoute();
const email = ref("");
const password = ref("");
const loading = ref(false);
const error = ref("");
const oauthError = ref((route.query.error as string) || "");

async function submit() {
  error.value = "";
  loading.value = true;
  try {
    await api.login({ email: email.value, password: password.value });
    router.push((route.query.next as string) || "/app");
  } catch (e: any) {
    error.value = e.message === "email_not_verified"
      ? "Сначала подтвердите email."
      : e.message === "account_unavailable" ? "Аккаунт недоступен." : "Неверный email или пароль.";
  } finally { loading.value = false; }
}

function oauth(provider: "google" | "vk") {
  window.location.href = api.oauthUrl(provider);
}
</script>

<template>
  <div class="centered-shell">
    <div class="auth-card">
      <div class="brand"><span class="brand-mark">T</span><span class="brand-name">Timio</span></div>
      <h1 class="page-title">Вход</h1>
      <p class="page-subtitle">Войдите, чтобы управлять расписанием и клиентами.</p>

      <div v-if="oauthError" class="error-banner">Не удалось войти через внешний аккаунт. Попробуйте ещё раз.</div>
      <div v-if="error" class="error-banner">{{ error }}</div>

      <div class="oauth-grid">
        <button class="oauth-btn" type="button" @click="oauth('google')">Продолжить с Google</button>
        <button class="oauth-btn" type="button" @click="oauth('vk')">Продолжить с VK</button>
      </div>
      <div class="auth-divider"><span>или</span></div>

      <form @submit.prevent="submit">
        <div class="field"><label class="field-label">Email</label><input v-model="email" type="email" placeholder="you@example.com" autocomplete="email" required /></div>
        <div class="field"><label class="field-label">Пароль</label><input v-model="password" type="password" placeholder="••••••••" autocomplete="current-password" required /></div>
        <button class="btn-primary" type="submit" :disabled="loading">{{ loading ? "…" : "Войти" }}</button>
      </form>

      <p class="footer-link"><NuxtLink to="/forgot-password" class="btn-link">Забыли пароль?</NuxtLink></p>
      <p class="footer-link">Нет аккаунта? <NuxtLink to="/register" class="btn-link">Зарегистрироваться</NuxtLink></p>
    </div>
  </div>
</template>

<style scoped>
.oauth-grid { display:grid; gap:8px; margin-bottom:14px; }
.oauth-btn { width:100%; min-height:44px; border:1px solid var(--border, #ddd); border-radius:10px; background:transparent; cursor:pointer; font:inherit; }
.auth-divider { display:flex; align-items:center; gap:10px; color:#888; font-size:12px; margin:10px 0 14px; }
.auth-divider::before,.auth-divider::after { content:""; height:1px; flex:1; background:var(--border,#ddd); }
</style>
