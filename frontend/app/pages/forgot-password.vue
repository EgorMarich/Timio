<script setup lang="ts">
import { ref } from "vue";
import { useTimioAuthApi } from "../composables/useTimioAuthApi";
const api=useTimioAuthApi(); const email=ref(""); const loading=ref(false); const sent=ref(false); const devUrl=ref("");
async function submit(){loading.value=true; try{const r=await api.requestPasswordReset(email.value); devUrl.value=r.devResetUrl||""; sent.value=true;}finally{loading.value=false;}}
</script>
<template><div class="centered-shell"><div class="auth-card"><div class="brand"><span class="brand-mark">T</span><span class="brand-name">Timio</span></div><h1 class="page-title">Сброс пароля</h1><p class="page-subtitle">Введите email аккаунта. Мы отправим ссылку для нового пароля.</p><div v-if="sent" class="success-banner">Если аккаунт существует, инструкции отправлены на email.<template v-if="devUrl"> <a :href="devUrl">Открыть dev-ссылку</a>.</template></div><form v-else @submit.prevent="submit"><div class="field"><label class="field-label">Email</label><input v-model="email" type="email" autocomplete="email" required /></div><button class="btn-primary" :disabled="loading">{{loading?'…':'Отправить ссылку'}}</button></form><p class="footer-link"><NuxtLink to="/login" class="btn-link">Вернуться ко входу</NuxtLink></p></div></div>
</template>
