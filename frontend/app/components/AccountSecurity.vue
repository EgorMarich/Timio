<script setup lang="ts">
import { ref, computed } from "vue";
import { useTimioAuthApi, type AuthSession, type AuthAuditEvent } from "../composables/useTimioAuthApi";
import { useAuthStore } from "../stores/auth";

const api = useTimioAuthApi();
const auth = useAuthStore();
const sessions = ref<AuthSession[]>([]);
const auditEvents = ref<AuthAuditEvent[]>([]);
const auditLoading = ref(false);
const sessionsLoading = ref(false);
const sessionsMessage = ref("");
const passwordCurrent = ref("");
const passwordNew = ref("");
const passwordConfirm = ref("");
const passwordLoading = ref(false);
const passwordMessage = ref("");
const passwordError = ref("");
const newEmail = ref("");
const emailLoading = ref(false);
const emailMessage = ref("");
const emailError = ref("");
const devEmailUrl = ref("");

const otherSessions = computed(() => sessions.value.filter(s => !s.current));

function browserLabel(ua: string | null) {
  if (!ua) return "Неизвестное устройство";
  if (/Edg/i.test(ua)) return "Microsoft Edge";
  if (/Chrome/i.test(ua)) return "Google Chrome";
  if (/Firefox/i.test(ua)) return "Firefox";
  if (/Safari/i.test(ua)) return "Safari";
  return "Браузер";
}
function dateLabel(value: string) { return new Date(value).toLocaleString("ru-RU", { dateStyle: "medium", timeStyle: "short" }); }

async function loadAuditEvents() {
  auditLoading.value = true;
  try { auditEvents.value = (await api.listAuditEvents()).events; } catch { auditEvents.value = []; }
  finally { auditLoading.value = false; }
}
async function loadSessions() {
  sessionsLoading.value = true; sessionsMessage.value = "";
  try { sessions.value = (await api.listSessions()).sessions; }
  catch { sessionsMessage.value = "Не удалось загрузить список сессий."; }
  finally { sessionsLoading.value = false; }
}
async function revoke(id: string) {
  sessionsMessage.value = "";
  try { await api.revokeSession(id); sessions.value = sessions.value.filter(s => s.id !== id); }
  catch { sessionsMessage.value = "Не удалось завершить сессию."; }
}
async function revokeOthers() {
  sessionsMessage.value = "";
  try { const r = await api.revokeOtherSessions(); sessions.value = sessions.value.filter(s => s.current); sessionsMessage.value = `Завершено сессий: ${r.revoked}.`; }
  catch { sessionsMessage.value = "Не удалось завершить другие сессии."; }
}
async function changePassword() {
  passwordError.value = ""; passwordMessage.value = "";
  if (passwordNew.value.length < 10 || !/[A-Za-z]/.test(passwordNew.value) || !/\d/.test(passwordNew.value)) { passwordError.value = "Новый пароль: минимум 10 символов, буквы и цифры."; return; }
  if (passwordNew.value !== passwordConfirm.value) { passwordError.value = "Пароли не совпадают."; return; }
  passwordLoading.value = true;
  try { await api.changePassword(passwordCurrent.value, passwordNew.value); passwordCurrent.value = passwordNew.value = passwordConfirm.value = ""; passwordMessage.value = "Пароль изменён. Остальные сессии завершены."; await loadSessions();
loadAuditEvents(); }
  catch (e: any) { passwordError.value = e.message === "invalid_current_password" ? "Текущий пароль неверен." : e.message === "password_reused" ? "Новый пароль должен отличаться от текущего." : "Не удалось изменить пароль."; }
  finally { passwordLoading.value = false; }
}
async function requestEmailChange() {
  emailError.value = ""; emailMessage.value = ""; devEmailUrl.value = "";
  emailLoading.value = true;
  try { const r = await api.requestEmailChange(newEmail.value); devEmailUrl.value = r.devConfirmUrl || ""; emailMessage.value = "Ссылка для подтверждения отправлена на новый email."; }
  catch (e: any) { emailError.value = e.message === "email_taken" ? "Этот email уже занят." : e.message === "same_email" ? "Это уже ваш текущий email." : e.message === "invalid_email" ? "Введите корректный email." : "Не удалось изменить email."; }
  finally { emailLoading.value = false; }
}

loadSessions();
loadAuditEvents();
</script>

<template>
  <div class="account-security">
    <section class="panel security-panel">
      <div class="security-heading"><div><p class="field-label">Аккаунт и безопасность</p><p class="helper-text">{{ auth.user?.email }} · {{ auth.user?.emailVerifiedAt ? "email подтверждён" : "email не подтверждён" }}</p></div><span class="badge">Защищённая сессия</span></div>
    </section>

    <section class="panel security-panel">
      <div class="security-heading"><div><p class="field-label">Сменить пароль</p><p class="helper-text">После смены пароля все остальные устройства будут отключены.</p></div></div>
      <div v-if="passwordError" class="error-banner">{{ passwordError }}</div><div v-if="passwordMessage" class="success-banner">{{ passwordMessage }}</div>
      <div class="security-form">
        <input v-model="passwordCurrent" type="password" autocomplete="current-password" placeholder="Текущий пароль" />
        <input v-model="passwordNew" type="password" autocomplete="new-password" placeholder="Новый пароль" minlength="10" />
        <input v-model="passwordConfirm" type="password" autocomplete="new-password" placeholder="Повторите новый пароль" minlength="10" />
        <button class="btn-secondary" :disabled="passwordLoading" @click="changePassword">{{ passwordLoading ? "Сохраняем…" : "Изменить пароль" }}</button>
      </div>
    </section>

    <section class="panel security-panel">
      <div class="security-heading"><div><p class="field-label">Изменить email</p><p class="helper-text">Новый адрес нужно подтвердить. После подтверждения активные сессии будут перевыпущены.</p></div></div>
      <div v-if="emailError" class="error-banner">{{ emailError }}</div><div v-if="emailMessage" class="success-banner">{{ emailMessage }}<template v-if="devEmailUrl"> <a :href="devEmailUrl">Открыть dev-ссылку</a>.</template></div>
      <div class="security-form security-form-inline"><input v-model="newEmail" type="email" autocomplete="email" placeholder="new@example.com" /><button class="btn-secondary" :disabled="emailLoading" @click="requestEmailChange">{{ emailLoading ? "Отправляем…" : "Подтвердить новый email" }}</button></div>
    </section>

    <section class="panel security-panel">
      <div class="security-heading"><div><p class="field-label">Активные сессии</p><p class="helper-text">Список браузеров, с которых выполнялся вход в аккаунт.</p></div><div class="security-actions"><button class="btn-link" @click="loadSessions">Обновить</button><button v-if="otherSessions.length" class="btn-danger-text" @click="revokeOthers">Завершить остальные</button></div></div>
      <div v-if="sessionsMessage" class="helper-text">{{ sessionsMessage }}</div>
      <div v-if="sessionsLoading" class="helper-text">Загружаем сессии…</div>
      <div v-else class="session-list">
        <div v-for="session in sessions" :key="session.id" class="data-row session-row"><div><div style="font-weight:700">{{ browserLabel(session.userAgent) }} <span v-if="session.current" class="badge">Текущее</span></div><div class="text-dim text-xs">Последняя активность: {{ dateLabel(session.lastSeenAt) }} · {{ session.ipAddress || "IP неизвестен" }}</div></div><button v-if="!session.current" class="btn-danger-text" @click="revoke(session.id)">Завершить</button></div>
        <div v-if="!sessions.length && !sessionsLoading" class="helper-text">Активных сессий нет.</div>
      </div>
    </section>

    <section class="panel security-panel">
      <div class="security-heading"><div><p class="field-label">Журнал безопасности</p><p class="helper-text">Последние события входа и изменения аккаунта.</p></div><button class="btn-link" @click="loadAuditEvents">Обновить</button></div>
      <div v-if="auditLoading" class="helper-text">Загружаем журнал…</div>
      <div v-else-if="!auditEvents.length" class="helper-text">Событий пока нет.</div>
      <div v-else class="session-list">
        <div v-for="event in auditEvents" :key="event.id" class="data-row session-row"><div><div style="font-weight:700">{{ ({ login_success: 'Успешный вход', login_failed: 'Неудачный вход', oauth_login_success: 'Вход через OAuth', logout: 'Выход', password_changed: 'Пароль изменён', password_reset: 'Пароль восстановлен', email_verified: 'Email подтверждён', email_change_requested: 'Запрошена смена email', email_changed: 'Email изменён', session_revoked: 'Сессия завершена', sessions_revoked_others: 'Другие сессии завершены', password_change_failed: 'Ошибка смены пароля' } as Record<string,string>)[event.event] || event.event }}</div><div class="text-dim text-xs">{{ dateLabel(event.createdAt) }} · {{ event.ipAddress || 'IP неизвестен' }}</div></div></div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.account-security { display: grid; gap: 16px; max-width: 900px; }
.security-panel { margin: 0 !important; }
.security-heading { display:flex; justify-content:space-between; gap:16px; align-items:flex-start; margin-bottom:14px; }
.security-actions { display:flex; gap:12px; align-items:center; }
.security-form { display:grid; gap:8px; grid-template-columns: repeat(3, minmax(0, 1fr)); }
.security-form input { min-width:0; }
.security-form .btn-secondary { min-height:44px; }
.security-form-inline { grid-template-columns: 1fr auto; }
.session-list { display:grid; gap:0; }
.session-row { gap:16px; }
.session-row .btn-danger-text { white-space:nowrap; }
@media (max-width: 720px) {
  .security-heading { flex-direction:column; }
  .security-actions { width:100%; justify-content:space-between; }
  .security-form, .security-form-inline { grid-template-columns: 1fr; }
  .session-row { align-items:flex-start; }
}
</style>
