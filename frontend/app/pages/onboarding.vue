<script setup lang="ts">
import { computed, ref } from "vue";
import { useTimioAuthApi, type WorkingHours } from "../composables/useTimioAuthApi";

definePageMeta({ middleware: "auth" });

const api = useTimioAuthApi();
const router = useRouter();

type Step = "business" | "services" | "staff" | "schedule" | "client" | "appointment" | "done";
const step = ref<Step>("business");
const error = ref("");
const loading = ref(false);
const businessId = ref("");
const businessSlug = ref("");
const progress = ref(0);

const bizName = ref("");
const niche = ref("barbershop");
const timezone = ref(Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Moscow");
const niches = [
  ["barbershop", "Барбершоп"], ["beauty_salon", "Салон красоты"], ["dental", "Стоматология"],
  ["massage", "Массаж / SPA"], ["psychology", "Психолог / консультант"], ["tutoring", "Репетитор"],
  ["vet", "Ветклиника"], ["auto_service", "Автосервис"], ["other", "Другое"],
];

interface DraftService { name: string; durationMin: number; priceCents: number; currency: string }
const services = ref<DraftService[]>([]);
const draftName = ref("");
const draftDuration = ref(30);
const draftPrice = ref(0);
const draftCurrency = ref("RUB");

const staffName = ref("");
const staffId = ref("");
const serviceIds = ref<string[]>([]);

const dayLabels: Record<number, string> = { 1: "Пн", 2: "Вт", 3: "Ср", 4: "Чт", 5: "Пт", 6: "Сб", 0: "Вс" };
const dayOrder = [1, 2, 3, 4, 5, 6, 0];
const workingHours = ref<WorkingHours>(Object.fromEntries(dayOrder.map((d) => [d, d <= 5 ? { start: 600, end: 1200 } : null])) as WorkingHours);

const clientName = ref("");
const clientPhone = ref("");
const clientEmail = ref("");
const clientId = ref("");
const appointmentAt = ref(defaultAppointmentDate());
const selectedServiceId = ref("");

const stepIndex = computed(() => ["business", "services", "staff", "schedule", "client", "appointment", "done"].indexOf(step.value));
const progressLabel = computed(() => step.value === "done" ? "Активировано" : `${Math.max(0, stepIndex.value) + 1} из 6`);

function defaultAppointmentDate() {
  const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
  d.setHours(10, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T10:00`;
}

function setError(message: string) { error.value = message; }
async function refreshProgress() {
  if (!businessId.value) return;
  const res = await api.getOnboarding(businessId.value);
  progress.value = res.progressPercent;
}

async function createBusiness() {
  if (!bizName.value.trim()) return setError("Введите название компании.");
  loading.value = true; error.value = "";
  try {
    const res = await api.createBusiness({ name: bizName.value.trim(), niche: niche.value, timezone: timezone.value });
    businessId.value = res.business.id; businessSlug.value = res.business.slug;
    await api.trackOnboardingEvent(businessId.value, "business_created").catch(() => {});
    progress.value = 17; step.value = "services";
  } catch { setError("Не удалось создать компанию. Проверьте соединение с API."); }
  finally { loading.value = false; }
}

async function addService() {
  if (!draftName.value.trim() || draftDuration.value < 5 || draftPrice.value < 0) return setError("Заполните название, длительность и цену.");
  loading.value = true; error.value = "";
  try {
    const res = await api.createService(businessId.value, { name: draftName.value.trim(), durationMin: draftDuration.value, priceCents: Math.round(draftPrice.value * 100), currency: draftCurrency.value });
    services.value.push({ name: draftName.value.trim(), durationMin: draftDuration.value, priceCents: Math.round(draftPrice.value * 100), currency: draftCurrency.value });
    serviceIds.value.push(res.service.id);
    draftName.value = ""; draftDuration.value = 30; draftPrice.value = 0;
    await refreshProgress();
  } catch { setError("Не удалось добавить услугу."); }
  finally { loading.value = false; }
}

async function continueServices() {
  if (serviceIds.value.length < 3) return setError("Добавьте минимум 3 услуги — это помогает сразу настроить рабочий каталог.");
  error.value = ""; step.value = "staff";
}

async function createStaff() {
  if (!staffName.value.trim()) return setError("Введите имя сотрудника.");
  loading.value = true; error.value = "";
  try {
    const res = await api.createStaff(businessId.value, { name: staffName.value.trim(), serviceIds: serviceIds.value });
    staffId.value = res.staff.id;
    await refreshProgress();
    step.value = "schedule";
  } catch { setError("Не удалось добавить сотрудника."); }
  finally { loading.value = false; }
}

function toggleDay(day: number) {
  workingHours.value = { ...workingHours.value, [day]: workingHours.value[day] ? null : { start: 600, end: 1200 } };
}
function minutesToTime(value: number) { return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`; }
function timeToMinutes(value: string) { const [h, m] = value.split(":").map(Number); return h * 60 + m; }

async function saveSchedule() {
  if (!Object.values(workingHours.value).some(Boolean)) return setError("Выберите хотя бы один рабочий день.");
  loading.value = true; error.value = "";
  try {
    await api.updateBusiness(businessId.value, { workingHours: workingHours.value });
    await api.trackOnboardingEvent(businessId.value, "schedule_configured").catch(() => {});
    await refreshProgress(); step.value = "client";
  } catch { setError("Не удалось сохранить график."); }
  finally { loading.value = false; }
}

async function createClient() {
  if (!clientName.value.trim()) return setError("Введите имя первого клиента.");
  if (!clientPhone.value.trim() && !clientEmail.value.trim()) return setError("Добавьте телефон или email клиента.");
  loading.value = true; error.value = "";
  try {
    const res = await api.createClient(businessId.value, { name: clientName.value.trim(), phone: clientPhone.value.trim() || undefined, email: clientEmail.value.trim() || undefined });
    clientId.value = res.client.id;
    selectedServiceId.value = serviceIds.value[0] || "";
    await refreshProgress(); step.value = "appointment";
  } catch { setError("Не удалось создать клиента."); }
  finally { loading.value = false; }
}

async function createAppointment() {
  if (!appointmentAt.value || !selectedServiceId.value || !staffId.value) return setError("Выберите услугу и время записи.");
  const start = new Date(appointmentAt.value);
  if (Number.isNaN(start.getTime()) || start.getTime() <= Date.now()) return setError("Первая запись должна быть в будущем.");
  loading.value = true; error.value = "";
  try {
    await api.createAppointment(businessId.value, { clientId: clientId.value, staffId: staffId.value, serviceId: selectedServiceId.value, startAt: start.toISOString() });
    await refreshProgress(); step.value = "done";
  } catch (e: any) { setError(e?.message || "Не удалось создать первую запись. Попробуйте другое время."); }
  finally { loading.value = false; }
}

function goToDashboard() { router.push(`/app/${businessId.value}`); }
</script>

<template>
  <div class="centered-shell onboarding-shell">
    <div class="auth-card onboarding-card">
      <div class="brand"><span class="brand-mark">T</span><span class="brand-name">Timio</span></div>

      <div class="onboarding-progress">
        <div class="onboarding-progress-head"><span>Настройка бизнеса</span><strong>{{ progressLabel }}</strong></div>
        <div class="onboarding-progress-track"><span :style="{ width: `${step === 'done' ? 100 : Math.max(progress, (stepIndex / 6) * 100)}%` }" /></div>
      </div>

      <div v-if="error" class="error-banner">{{ error }}</div>

      <template v-if="step === 'business'">
        <h1 class="page-title">Создадим ваш бизнес</h1>
        <p class="page-subtitle">После настройки вы сразу сможете открыть страницу записи для клиентов.</p>
        <div class="field"><label class="field-label">Название</label><input v-model="bizName" type="text" placeholder="Например, Barber House" /></div>
        <div class="field"><label class="field-label">Сфера</label><select v-model="niche"><option v-for="n in niches" :key="n[0]" :value="n[0]">{{ n[1] }}</option></select></div>
        <div class="field"><label class="field-label">Часовой пояс</label><input v-model="timezone" type="text" /><p class="helper-text">Определён по браузеру. В нём будут отображаться записи и свободные окна.</p></div>
        <button class="btn-primary" :disabled="loading" @click="createBusiness">{{ loading ? "Создаём…" : "Продолжить" }}</button>
      </template>

      <template v-else-if="step === 'services'">
        <h1 class="page-title">Добавим услуги</h1>
        <p class="page-subtitle">Нужно минимум три. Их увидят клиенты на вашей странице записи.</p>
        <div v-if="services.length" class="onboarding-list">
          <div v-for="(s, i) in services" :key="i" class="data-row"><div><strong>{{ s.name }}</strong><div class="text-dim text-xs">{{ s.durationMin }} мин</div></div><span class="mono text-dim">{{ (s.priceCents / 100).toFixed(0) }} {{ s.currency }}</span></div>
        </div>
        <div class="field"><label class="field-label">Название услуги</label><input v-model="draftName" type="text" placeholder="Стрижка" /></div>
        <div class="onboarding-fields-3"><div class="field"><label class="field-label">Минут</label><input v-model.number="draftDuration" type="number" min="5" step="5" /></div><div class="field"><label class="field-label">Цена</label><input v-model.number="draftPrice" type="number" min="0" step="1" /></div><div class="field"><label class="field-label">Валюта</label><select v-model="draftCurrency"><option>RUB</option><option>EUR</option><option>USD</option><option>KZT</option></select></div></div>
        <button class="btn-secondary" style="width:100%;margin-bottom:10px" :disabled="loading" @click="addService">+ Добавить услугу</button>
        <button class="btn-primary" :disabled="loading || services.length < 3" @click="continueServices">Продолжить</button>
      </template>

      <template v-else-if="step === 'staff'">
        <h1 class="page-title">Кто принимает клиентов?</h1>
        <p class="page-subtitle">Добавьте хотя бы одного сотрудника. Позже можно будет добавить команду и роли.</p>
        <div class="field"><label class="field-label">Имя сотрудника</label><input v-model="staffName" type="text" placeholder="Например, Ольга" @keyup.enter="createStaff" /></div>
        <button class="btn-primary" :disabled="loading" @click="createStaff">{{ loading ? "Добавляем…" : "Добавить сотрудника" }}</button>
      </template>

      <template v-else-if="step === 'schedule'">
        <h1 class="page-title">Настроим график</h1>
        <p class="page-subtitle">Выберите рабочие дни и часы. Это станет базовым графиком бизнеса.</p>
        <div class="schedule-grid">
          <div v-for="day in dayOrder" :key="day" class="schedule-row">
            <button class="day-toggle" :class="{ active: workingHours[day] }" @click="toggleDay(day)">{{ dayLabels[day] }}</button>
            <template v-if="workingHours[day]">
              <input type="time" :value="minutesToTime(workingHours[day]!.start)" @change="workingHours[day] = { ...workingHours[day]!, start: timeToMinutes(($event.target as HTMLInputElement).value) }" />
              <span>—</span>
              <input type="time" :value="minutesToTime(workingHours[day]!.end)" @change="workingHours[day] = { ...workingHours[day]!, end: timeToMinutes(($event.target as HTMLInputElement).value) }" />
            </template><span v-else class="text-dim">Выходной</span>
          </div>
        </div>
        <button class="btn-primary" :disabled="loading" @click="saveSchedule">{{ loading ? "Сохраняем…" : "Сохранить график" }}</button>
      </template>

      <template v-else-if="step === 'client'">
        <h1 class="page-title">Добавим первого клиента</h1>
        <p class="page-subtitle">Так мы сразу подготовим CRM к работе. Реального клиента можно заменить тестовым контактом.</p>
        <div class="field"><label class="field-label">Имя</label><input v-model="clientName" type="text" placeholder="Иван Петров" /></div>
        <div class="field"><label class="field-label">Телефон</label><input v-model="clientPhone" type="tel" placeholder="+7 900 000-00-00" /></div>
        <div class="field"><label class="field-label">Email <span class="text-dim">(необязательно)</span></label><input v-model="clientEmail" type="email" placeholder="ivan@example.com" /></div>
        <button class="btn-primary" :disabled="loading" @click="createClient">{{ loading ? "Создаём…" : "Продолжить" }}</button>
      </template>

      <template v-else-if="step === 'appointment'">
        <h1 class="page-title">Создадим первую запись</h1>
        <p class="page-subtitle">Это финальный шаг активации. После него Timio уже готов к ежедневной работе.</p>
        <div class="field"><label class="field-label">Услуга</label><select v-model="selectedServiceId"><option v-for="id in serviceIds" :key="id" :value="id">{{ services[serviceIds.indexOf(id)]?.name || "Услуга" }}</option></select></div>
        <div class="field"><label class="field-label">Дата и время</label><input v-model="appointmentAt" type="datetime-local" /></div>
        <button class="btn-primary" :disabled="loading" @click="createAppointment">{{ loading ? "Создаём…" : "Создать первую запись" }}</button>
      </template>

      <template v-else>
        <div class="onboarding-success-mark">✓</div>
        <h1 class="page-title">Timio готов к работе</h1>
        <p class="page-subtitle">Бизнес активирован. Теперь вы можете принимать записи, вести CRM и возвращать клиентов.</p>
        <div class="onboarding-summary"><div><strong>Страница записи</strong><code>timio.app/{{ businessSlug }}</code></div><div><strong>Активация</strong><span>{{ progress || 100 }}%</span></div></div>
        <button class="btn-primary" @click="goToDashboard">Перейти в панель управления</button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.onboarding-card { max-width: 560px; }
.onboarding-progress { margin: -4px 0 24px; }
.onboarding-progress-head { display:flex; justify-content:space-between; color:var(--text-dim); font-size:12px; font-weight:700; margin-bottom:8px; }
.onboarding-progress-head strong { color:var(--text); }
.onboarding-progress-track { height:5px; border-radius:99px; background:var(--surface-3); overflow:hidden; }
.onboarding-progress-track span { display:block; height:100%; background:var(--accent); transition:width .25s ease; }
.onboarding-list { display:grid; gap:8px; margin-bottom:14px; max-height:190px; overflow:auto; }
.onboarding-fields-3 { display:grid; grid-template-columns:1fr 1fr 90px; gap:10px; }
.schedule-grid { display:grid; gap:8px; margin:4px 0 18px; }
.schedule-row { display:grid; grid-template-columns:58px 1fr 16px 1fr; gap:8px; align-items:center; min-height:44px; }
.day-toggle { border:1px solid var(--border); background:var(--surface-2); color:var(--text-dim); border-radius:var(--radius-sm); padding:10px 8px; font-weight:800; }
.day-toggle.active { background:var(--accent-dim); color:var(--accent); border-color:var(--accent); }
.schedule-row input[type=time] { min-width:0; }
.schedule-row > .text-dim { grid-column:2 / -1; }
.onboarding-success-mark { width:54px; height:54px; display:grid; place-items:center; border-radius:50%; background:var(--success-dim); color:var(--success); font-size:28px; font-weight:900; margin-bottom:18px; }
.onboarding-summary { border:1px solid var(--border); background:var(--surface-2); border-radius:var(--radius); padding:14px; display:grid; gap:12px; margin:20px 0; }
.onboarding-summary div { display:flex; justify-content:space-between; gap:16px; font-size:13px; }
.onboarding-summary strong { font-size:12px; color:var(--text-dim); }
.onboarding-summary code { font-size:12px; }
@media (max-width:600px) { .onboarding-card { padding:28px 20px; } .onboarding-fields-3 { grid-template-columns:1fr 1fr; } .onboarding-fields-3 .field:last-child { grid-column:1 / -1; width:100%; } .schedule-row { grid-template-columns:54px 1fr 12px 1fr; } }
</style>
