<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useTimioAuthApi } from "../composables/useTimioAuthApi";
const api = useTimioAuthApi(); const route = useRoute();
const status = ref<"loading"|"success"|"error">("loading"); const message = ref("Подтверждаем email…");
const email = ref((route.query.email as string) || ""); const devUrl = ref((route.query.dev as string) || ""); const resendLoading = ref(false);
async function verify() {
  const token = route.query.token as string;
  if (!token) { status.value = "error"; message.value = "Ссылка подтверждения отсутствует или повреждена."; return; }
  try { await api.verifyEmail(token); status.value="success"; message.value="Email подтверждён. Теперь можно войти."; }
  catch { status.value="error"; message.value="Ссылка недействительна или уже истекла."; }
}
async function resend() { resendLoading.value=true; try { const r=await api.resendVerification(email.value); devUrl.value=r.devVerificationUrl||""; message.value="Если аккаунт ожидает подтверждения, новая ссылка отправлена."; } finally { resendLoading.value=false; } }
onMounted(verify);
</script>
<template><div class="centered-shell"><div class="auth-card"><div class="brand"><span class="brand-mark">T</span><span class="brand-name">Timio</span></div><h1 class="page-title">Подтверждение email</h1><p class="page-subtitle">{{ message }}</p><div v-if="status==='success'"><NuxtLink to="/login" class="btn-primary">Перейти ко входу</NuxtLink></div><div v-else><div v-if="status==='error' && email" class="field"><label class="field-label">Email</label><input v-model="email" type="email" /></div><button v-if="status==='error' && email" class="btn-primary" :disabled="resendLoading" @click="resend">Отправить снова</button><p v-if="devUrl" class="footer-link"><a :href="devUrl">Открыть dev-ссылку</a></p></div></div></div>
</template>
