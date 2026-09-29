<script setup lang="ts">
import { ref, onMounted, computed, reactive } from "vue";
import {
  useTimioAuthApi,
  type OwnedBusiness,
  type OwnedService,
  type OwnedStaff,
  type OwnedAppointment,
  type AnalyticsResponse,
  type WorkingHours,
  type OwnedSubscription,
  type SubscriptionPlanId,
  type ReactivationResponse,
  type ReactivationSegment,
  type RetentionDashboard,
  type RetentionIntelligence,
  type DailyBusinessIntelligence,
  type EmptySlotIntelligence,
} from "../../../composables/useTimioAuthApi";
import { useAuthStore } from "../../../stores/auth";
import { downloadAnalyticsXlsx } from "../../../utils/xlsxReport";

definePageMeta({ middleware: "auth" });

const route = useRoute();
const router = useRouter();
const businessId = route.params.businessId as string;

const api = useTimioAuthApi();
const auth = useAuthStore();

const business = ref<OwnedBusiness | null>(null);
const services = ref<OwnedService[]>([]);
const staff = ref<OwnedStaff[]>([]);
const appointments = ref<OwnedAppointment[]>([]);
const clients = ref<any[]>([]);
const clientSearch = ref("");
const filteredClients = computed(() => {
  const q = clientSearch.value.trim().toLowerCase();
  if (!q) return clients.value;
  return clients.value.filter((c) => [c.name, c.phone, c.email].filter(Boolean).some((v) => String(v).toLowerCase().includes(q)));
});
const status = ref<"loading" | "ready" | "error">("loading");
const toast = ref<{ message: string; tone: "success" | "error" } | null>(null);
const confirmDialog = ref<{ title: string; message: string; confirmText: string; tone: "danger" | "primary"; action: (() => Promise<void>) | null }>({
  title: "",
  message: "",
  confirmText: "Подтвердить",
  tone: "primary",
  action: null,
});
let toastTimer: ReturnType<typeof setTimeout> | null = null;

function showToast(message: string, tone: "success" | "error" = "success") {
  toast.value = { message, tone };
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.value = null; }, 3200);
}

function requestConfirmation(options: Omit<NonNullable<typeof confirmDialog.value>, "action">, action: () => Promise<void>) {
  confirmDialog.value = { ...options, action };
}

function closeConfirmation() {
  if (!confirmDialog.value.action) return;
  confirmDialog.value.action = null;
}

type Tab = "overview" | "appointments" | "archive" | "clients" | "services" | "staff" | "analytics" | "billing" | "templates" | "team" | "campaigns" | "settings";
const tab = ref<Tab>("overview");
const mobileMoreOpen = ref(false);

const mobilePrimaryTabs: Array<{ tab: Tab; label: string; icon: string }> = [
  { tab: "overview", label: "Сегодня", icon: "⌂" },
  { tab: "appointments", label: "Расписание", icon: "▤" },
  { tab: "clients", label: "Клиенты", icon: "◎" },
  { tab: "services", label: "Услуги", icon: "◇" },
];

const mobileMoreTabs: Array<{ tab: Tab; label: string; icon: string }> = [
  { tab: "staff", label: "Сотрудники", icon: "◍" },
  { tab: "analytics", label: "Аналитика", icon: "↗" },
  { tab: "campaigns", label: "Маркетинг", icon: "✦" },
  { tab: "templates", label: "Уведомления", icon: "✉" },
  { tab: "team", label: "Команда", icon: "◌" },
  { tab: "billing", label: "Тариф", icon: "◈" },
  { tab: "settings", label: "Настройки", icon: "⚙" },
  { tab: "archive", label: "Архив", icon: "▦" },
];

function openMobileTab(nextTab: Tab) {
  tab.value = nextTab;
  mobileMoreOpen.value = false;
}


async function loadAll() {
  status.value = "loading";
  try {
    const [b, s, st, ap, cl] = await Promise.all([
      api.getBusiness(businessId),
      api.listServices(businessId),
      api.listStaff(businessId),
      api.listAppointments(businessId),
      api.listClients(businessId),
    ]);
    business.value = b.business;
    todayKey.value = getBusinessToday(b.business.timezone || "Europe/Moscow");
    services.value = s.services;
    staff.value = st.staff;
    appointments.value = ap.appointments;
    clients.value = cl.clients;
    status.value = "ready";
  } catch {
    status.value = "error";
  }
}

onMounted(async () => {
  await loadAll();
  loadAnalytics();
  loadReactivation();
  loadRetentionDashboard(30);
  loadRetentionIntelligence();
  loadDailyIntelligence();
  loadEmptySlotIntelligence();
});

const publicUrl = computed(() => {
  const webOrigin = typeof window !== "undefined" ? window.location.origin : "";
  return business.value ? `${webOrigin}/${business.value.slug}` : "";
});

const upcomingCount = computed(() => appointments.value.filter((a) => a.status === "booked").length);
const bookedAppointments = computed(() => appointments.value.filter((a) => a.status !== "cancelled"));

function getBusinessToday(timeZone = "Europe/Moscow") {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

const todayKey = ref(getBusinessToday());
const selectedDate = computed(() => new Date(`${todayKey.value}T12:00:00`));
const selectedDayAppointments = computed(() => bookedAppointments.value
  .filter((a) => a.startAt.slice(0, 10) === todayKey.value)
  .sort((a, b) => a.startAt.localeCompare(b.startAt)));
const todayRevenue = computed(() => selectedDayAppointments.value
  .filter((a) => a.status === "completed" || a.status === "booked" || a.status === "confirmed")
  .reduce((sum, a) => sum + (a.priceCents ?? 0), 0));
const todayClients = computed(() => new Set(selectedDayAppointments.value.map((a) => a.clientId).filter(Boolean)).size);
const dailyIntelligence = ref<DailyBusinessIntelligence | null>(null);
const dailyIntelligenceStatus = ref<"idle" | "loading" | "ready" | "error">("idle");
const emptySlotIntelligence = ref<EmptySlotIntelligence | null>(null);
const emptySlotIntelligenceStatus = ref<"idle" | "loading" | "ready" | "error">("idle");
const emptySlotDays = ref<1 | 3 | 7>(3);

async function loadDailyIntelligence() {
  dailyIntelligenceStatus.value = "loading";
  try {
    dailyIntelligence.value = await api.getDailyBusinessIntelligence(businessId);
    dailyIntelligenceStatus.value = "ready";
  } catch {
    dailyIntelligenceStatus.value = "error";
  }
}

async function loadEmptySlotIntelligence() {
  emptySlotIntelligenceStatus.value = "loading";
  try {
    emptySlotIntelligence.value = await api.getEmptySlotIntelligence(businessId, emptySlotDays.value);
    emptySlotIntelligenceStatus.value = "ready";
  } catch {
    emptySlotIntelligenceStatus.value = "error";
  }
}

function selectEmptySlotDays(days: 1 | 3 | 7) {
  emptySlotDays.value = days;
  void loadEmptySlotIntelligence();
}

function openEmptySlotOpportunity(opportunity: EmptySlotIntelligence["opportunities"][number]) {
  if (!opportunity.client) {
    openTab("appointments");
    return;
  }
  if (!opportunity.client.telegramAvailable) {
    void openClientDetail(opportunity.client.id);
    return;
  }
  void prepareRetentionOffer(opportunity.client.id, opportunity);
}

function openDailyAction(target: DailyBusinessIntelligence["actions"][number]["target"]) {
  if (target === "analytics") openTab("analytics");
  else if (target === "campaigns") openTab("campaigns");
  else if (target === "clients") openTab("clients");
  else openTab("appointments");
}
const activeClients = computed(() => clients.value.length);
const reactivation = ref<ReactivationResponse | null>(null);
const reactivationStatus = ref<"idle" | "loading" | "ready" | "error">("idle");
const reactivationSegment = ref<ReactivationSegment>("all");

async function loadReactivation(segment: ReactivationSegment = reactivationSegment.value) {
  reactivationStatus.value = "loading";
  try {
    reactivation.value = await api.getReactivation(businessId, segment);
    reactivationStatus.value = "ready";
  } catch {
    reactivationStatus.value = "error";
  }
}

const reactivationPreview = computed(() => reactivation.value?.clients.slice(0, 5) ?? []);

function shiftDay(delta: number) {
  const [year, month, day] = todayKey.value.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day + delta, 12));
  todayKey.value = [d.getUTCFullYear(), String(d.getUTCMonth() + 1).padStart(2, '0'), String(d.getUTCDate()).padStart(2, '0')].join('-');
}
function formatDayTitle() {
  return selectedDate.value.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" });
}

// Только БУДУЩИЕ и не отменённые записи показываем на основной доске - прошедшие
// уходят в архив (см. archivedAppointments ниже).
const upcomingAppointments = computed(() =>
  appointments.value.filter((a) => new Date(a.startAt).getTime() >= Date.now() && a.status !== "cancelled")
);
const archivedAppointments = computed(() =>
  appointments.value
    .filter((a) => new Date(a.startAt).getTime() < Date.now() || a.status === "cancelled" || a.status === "completed" || a.status === "no_show")
    .sort((a, b) => b.startAt.localeCompare(a.startAt)) // новые сверху
);

const appointmentsByStaff = computed(() => {
  return staff.value.map((member) => ({
    staff: member,
    appointments: selectedDayAppointments.value
      .filter((a) => a.staffId === member.id)
      .sort((a, b) => a.startAt.localeCompare(b.startAt)),
  }));
});

// ---- Детали клиента / мастера по клику ----
const selectedClientId = ref<string | null>(null);
const selectedStaffId = ref<string | null>(null);

const selectedClientAppointments = computed(() =>
  !selectedClientId.value
    ? []
    : appointments.value
        .filter((a) => a.clientId === selectedClientId.value)
        .sort((a, b) => b.startAt.localeCompare(a.startAt))
);
const selectedClientName = computed(() => selectedClientAppointments.value[0]?.clientName ?? "");
const selectedClientStats = computed(() => {
  const list = selectedClientAppointments.value;
  const completed = list.filter((a) => a.status === "completed" || a.status === "booked");
  return { visits: list.length, upcoming: list.filter((a) => new Date(a.startAt).getTime() >= Date.now()).length };
});

const selectedStaffMember = computed(() => staff.value.find((s) => s.id === selectedStaffId.value) ?? null);
// Уникальные клиенты этого мастера + сколько раз были у него
const selectedStaffClients = computed(() => {
  if (!selectedStaffId.value) return [];
  const byClient = new Map<string, { clientId: string; name: string; visits: number; lastVisit: string }>();
  for (const a of appointments.value) {
    if (a.staffId !== selectedStaffId.value || !a.clientId) continue;
    const entry = byClient.get(a.clientId) ?? { clientId: a.clientId, name: a.clientName ?? "—", visits: 0, lastVisit: a.startAt };
    entry.visits += 1;
    if (a.startAt > entry.lastVisit) entry.lastVisit = a.startAt;
    byClient.set(a.clientId, entry);
  }
  return [...byClient.values()].sort((a, b) => b.lastVisit.localeCompare(a.lastVisit));
});

// function openClientDetail(clientId?: string) {
//   if (!clientId) return;
//   selectedClientId.value = clientId;
// }
function openStaffDetail(staffId: string) {
  selectedStaffId.value = staffId;
}
function openClientFromStaffModal(clientId: string) {
  selectedStaffId.value = null;
  selectedClientId.value = clientId;
}

function initials(name: string) {
  return name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}
function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: business.value?.timezone || "Europe/Moscow" });
}
function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("ru-RU", { dateStyle: "medium", timeStyle: "short", timeZone: business.value?.timezone || "Europe/Moscow" });
}
function formatMoney(cents: number, currency = "") {
  return `${(cents / 100).toFixed(0)} ${currency}`.trim();
}

// ---- Смена статуса записи ----
const statusOptions = ["booked", "confirmed", "completed", "cancelled", "no_show"] as const;

async function changeAppointmentStatus(apptId: string, newStatus: string) {
  await api.updateAppointmentStatus(businessId, apptId, newStatus);
  // Обновляем локально — не перезапрашиваем весь список
  const idx = appointments.value.findIndex((a) => a.id === apptId);
  if (idx !== -1) appointments.value[idx] = { ...appointments.value[idx], status: newStatus };
}

// ---- Запись из панели: создание / перенос ----
const appointmentModalOpen = ref(false);
const appointmentSaving = ref(false);
const appointmentError = ref("");
const appointmentClientId = ref("");
const appointmentServiceId = ref("");
const appointmentStaffId = ref("");
const appointmentDate = ref(new Date().toISOString().slice(0, 10));
const appointmentTime = ref("10:00");
const appointmentStatus = ref<"booked" | "confirmed">("confirmed");
const rescheduleAppointmentId = ref<string | null>(null);
const selectedAppointmentId = ref<string | null>(null);
const selectedAppointment = computed(() => appointments.value.find((a) => a.id === selectedAppointmentId.value) ?? null);
const appointmentActionSaving = ref(false);

const appointmentStatusLabels: Record<string, string> = {
  booked: "Новая",
  confirmed: "Подтверждена",
  completed: "Завершена",
  cancelled: "Отменена",
  no_show: "Неявка",
};

function appointmentStatusLabel(value: string) {
  return appointmentStatusLabels[value] ?? value;
}

function openAppointmentDetail(a: OwnedAppointment) {
  selectedAppointmentId.value = a.id;
}

function closeAppointmentDetail() {
  if (!appointmentActionSaving.value) selectedAppointmentId.value = null;
}

function openRepeatAppointment(a: OwnedAppointment) {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const service = services.value.find((s) => s.id === a.serviceId);
  const staffMember = staff.value.find((s) => s.id === a.staffId);
  rescheduleAppointmentId.value = null;
  appointmentError.value = "";
  appointmentClientId.value = a.clientId;
  appointmentServiceId.value = a.serviceId ?? service?.id ?? "";
  appointmentStaffId.value = a.staffId || staffMember?.id || "";
  appointmentDate.value = d.toISOString().slice(0, 10);
  appointmentTime.value = "10:00";
  appointmentStatus.value = "confirmed";
  selectedAppointmentId.value = null;
  appointmentModalOpen.value = true;
}

// Smart Action: предлагаем ту же услугу и сотрудника, а затем ищем
// ближайшее реальное свободное окно по расписанию и существующим записям.
const smartRebookLoading = ref(false);
const intelligenceActionClientId = ref<string | null>(null);
const intelligenceActionResult = ref<Record<string, "success" | "error">>({});
const smartRebookHint = ref("");
const retentionOfferOpen = ref(false);
const retentionOfferLoading = ref(false);
const retentionOfferSending = ref(false);
const retentionOfferError = ref("");
const retentionOfferSuccess = ref("");
const retentionOffer = reactive<{ clientId: string; clientName: string; serviceId: string; staffId: string; startAt: string; date: string; time: string; message: string }>({
  clientId: "", clientName: "", serviceId: "", staffId: "", startAt: "", date: "", time: "", message: "",
});

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] ?? ch));
}

function prepareRetentionOffer(clientId: string, suggestedOpportunity?: EmptySlotIntelligence["opportunities"][number]) {
  if (retentionOfferLoading.value) return;
  retentionOfferLoading.value = true;
  retentionOfferError.value = "";
  retentionOfferSuccess.value = "";
  void (async () => {
    try {
      const res = await api.getClientCard(businessId, clientId);
      if (res.client.marketingOptOut) {
        retentionOfferError.value = "Клиент отказался от маркетинговых сообщений.";
        return;
      }
      if (!res.client.telegramChatId) {
        retentionOfferError.value = "У клиента не подключён Telegram.";
        return;
      }
      const last = res.appointments.find((a) => a.status === "completed");
      if (!last) {
        retentionOfferError.value = "Нет завершённого визита, для предложения нужна предыдущая услуга.";
        return;
      }
      const slot = suggestedOpportunity
        ? { date: suggestedOpportunity.date, time: suggestedOpportunity.time, startAt: suggestedOpportunity.startAt, serviceId: suggestedOpportunity.serviceId, staffId: suggestedOpportunity.staffId, serviceName: suggestedOpportunity.serviceName, staffName: suggestedOpportunity.staffName }
        : (() => {
            const found = findNextAvailableSlot(last.serviceId, last.staffId);
            return found ? { ...found, startAt: zonedLocalToIso(found.date, found.time, business.value?.timezone || "Europe/Moscow"), serviceId: last.serviceId, staffId: last.staffId, serviceName: undefined, staffName: undefined } : null;
          })();
      if (!slot) {
        retentionOfferError.value = "На ближайшие 21 день свободного окна нет.";
        return;
      }
      const service = services.value.find((item) => item.id === slot.serviceId);
      const staffMember = staff.value.find((item) => item.id === slot.staffId);
      const serviceName = slot.serviceName ?? service?.name?.ru ?? service?.name?.en ?? last.serviceName ?? "услуга";
      const staffName = slot.staffName ?? staffMember?.name ?? last.staffName ?? "мастер";
      retentionOffer.clientId = clientId;
      retentionOffer.clientName = res.client.name;
      retentionOffer.serviceId = slot.serviceId;
      retentionOffer.staffId = slot.staffId;
      retentionOffer.date = slot.date;
      retentionOffer.time = slot.time;
      retentionOffer.startAt = slot.startAt;
      const bookingUrl = `${window.location.origin}/${business.value?.slug ?? ""}`;
      retentionOffer.message = `Привет, ${res.client.name}! Мы будем рады видеть вас снова в ${business.value?.name ?? "нашем бизнесе"}.\n\nМожем предложить ${slot.date} в ${slot.time} — ${serviceName}, мастер ${staffName}.\n\nЗаписаться: ${bookingUrl}`;
      retentionOfferOpen.value = true;
      intelligenceActionClientId.value = clientId;
    } catch (e: any) {
      retentionOfferError.value = e?.message ?? "Не удалось подготовить предложение.";
    } finally {
      retentionOfferLoading.value = false;
    }
  })();
}

async function sendRetentionOffer() {
  if (!retentionOffer.clientId || retentionOfferSending.value) return;
  retentionOfferSending.value = true;
  retentionOfferError.value = "";
  try {
    await api.sendRetentionOffer(businessId, {
      clientId: retentionOffer.clientId,
      serviceId: retentionOffer.serviceId,
      staffId: retentionOffer.staffId,
      startAt: retentionOffer.startAt,
      message: retentionOffer.message,
    });
    retentionOfferSuccess.value = `Предложение отправлено ${retentionOffer.clientName}`;
    retentionOfferOpen.value = false;
    void loadCampaigns();
    void loadReactivation(reactivationSegment.value);
    if (intelligenceActionClientId.value === retentionOffer.clientId) {
      intelligenceActionResult.value[retentionOffer.clientId] = "success";
      intelligenceActionClientId.value = null;
      void loadRetentionIntelligence();
    }
    showToast("Предложение отправлено в Telegram", "success");
  } catch (e: any) {
    retentionOfferError.value = e?.message ?? "Не удалось отправить предложение.";
  } finally {
    retentionOfferSending.value = false;
  }
}


function findNextAvailableSlot(serviceId: string, staffId: string, fromDate = new Date()) {
  const service = services.value.find((s) => s.id === serviceId);
  const staffMember = staff.value.find((s) => s.id === staffId);
  if (!service || !staffMember) return null;
  const zone = business.value?.timezone || "Europe/Moscow";

  const baseDateKey = businessDateKey(fromDate.toISOString());
  const [baseYear, baseMonth, baseDay] = baseDateKey.split("-").map(Number);
  for (let offset = 1; offset <= 21; offset++) {
    const d = new Date(baseYear, baseMonth - 1, baseDay + offset, 12, 0, 0, 0);
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const [year, month, day] = date.split("-").map(Number);
    const weekday = new Date(year, month - 1, day).getDay();
    const hours = staffMember.workingHours?.[weekday] || business.value?.workingHours?.[weekday];
    if (!hours) continue;

    for (let minute = hours.start; minute + service.durationMin <= hours.end; minute += 15) {
      const hh = String(Math.floor(minute / 60)).padStart(2, "0");
      const mm = String(minute % 60).padStart(2, "0");
      const endMinute = minute + service.durationMin;
      const eh = String(Math.floor(endMinute / 60)).padStart(2, "0");
      const em = String(endMinute % 60).padStart(2, "0");
      const start = zonedLocalToIso(date, `${hh}:${mm}`, zone);
      const end = zonedLocalToIso(date, `${eh}:${em}`, zone);
      const overlaps = appointments.value.some((a) => {
        if (a.staffId !== staffId || a.status === "cancelled") return false;
        return new Date(start).getTime() < new Date(a.endAt).getTime() && new Date(end).getTime() > new Date(a.startAt).getTime();
      });
      if (!overlaps) return { date, time: `${hh}:${mm}` };
    }
  }
  return null;
}

async function smartRebookClient(clientId: string) {
  if (smartRebookLoading.value) return;
  smartRebookLoading.value = true;
  smartRebookHint.value = "";
  try {
    const res = await api.getClientCard(businessId, clientId);
    const last = res.appointments.find((a) => a.status === "completed");
    if (!last) {
      smartRebookHint.value = "Нет завершённого визита — откройте клиента и выберите услугу вручную.";
      await openClientDetail(clientId);
      return;
    }
    const slot = findNextAvailableSlot(last.serviceId, last.staffId);
    if (!slot) {
      await openClientDetail(clientId);
      showToast("На ближайшие 21 день свободного окна нет", "error");
      return;
    }
    rescheduleAppointmentId.value = null;
    appointmentError.value = "";
    appointmentClientId.value = clientId;
    appointmentServiceId.value = last.serviceId;
    appointmentStaffId.value = last.staffId;
    appointmentDate.value = slot.date;
    appointmentTime.value = slot.time;
    appointmentStatus.value = "confirmed";
    selectedAppointmentId.value = null;
    appointmentModalOpen.value = true;
    intelligenceActionClientId.value = clientId;
    smartRebookHint.value = `Timio предложил ${slot.date} · ${slot.time}`;
  } catch (e: any) {
    showToast(e?.message || "Не удалось подготовить повторную запись", "error");
  } finally {
    smartRebookLoading.value = false;
  }
}

async function setSelectedAppointmentStatus(newStatus: string) {
  if (!selectedAppointment.value || appointmentActionSaving.value) return;
  const appointmentId = selectedAppointment.value.id;
  const labels: Record<string, { title: string; message: string; confirmText: string; tone: "danger" | "primary" }> = {
    completed: { title: "Завершить визит?", message: "Timio добавит визит и стоимость услуги в историю клиента.", confirmText: "Завершить визит", tone: "primary" },
    cancelled: { title: "Отменить запись?", message: "Запись будет убрана из активного расписания.", confirmText: "Отменить запись", tone: "danger" },
    no_show: { title: "Отметить неявку?", message: "Визит попадёт в архив как неявка.", confirmText: "Отметить неявку", tone: "danger" },
  };
  const confirmation = labels[newStatus];
  const execute = async () => {
    appointmentActionSaving.value = true;
    try {
      await changeAppointmentStatus(appointmentId, newStatus);
      if (newStatus === "cancelled" || newStatus === "completed" || newStatus === "no_show") selectedAppointmentId.value = null;
      showToast(newStatus === "completed" ? "Визит завершён" : `Статус: ${appointmentStatusLabel(newStatus)}`);
    } catch (error: any) {
      appointmentError.value = error?.message || "Не удалось изменить статус записи";
      showToast(appointmentError.value, "error");
    } finally {
      appointmentActionSaving.value = false;
    }
  };
  if (confirmation) {
    requestConfirmation(confirmation, execute);
    return;
  }
  await execute();
}


const appointmentStaffOptions = computed(() => {
  if (!appointmentServiceId.value) return staff.value;
  return staff.value.filter((s) => s.serviceIds.includes(appointmentServiceId.value));
});

function openCreateAppointment(date = todayKey.value, staffId = "") {
  appointmentError.value = "";
  rescheduleAppointmentId.value = null;
  appointmentClientId.value = clients.value[0]?.id ?? "";
  appointmentServiceId.value = services.value[0]?.id ?? "";
  appointmentStaffId.value = staffId || appointmentStaffOptions.value[0]?.id || "";
  appointmentDate.value = date;
  appointmentTime.value = "10:00";
  appointmentStatus.value = "confirmed";
  appointmentModalOpen.value = true;
}

function businessDateParts(iso: string, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(new Date(iso))
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, p.value]),
  );
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
}

function businessDateKey(iso: string) {
  const tz = business.value?.timezone || "Europe/Moscow";
  const { year, month, day } = businessDateParts(iso, tz);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function openReschedule(a: OwnedAppointment) {
  selectedAppointmentId.value = null;
  appointmentError.value = "";
  rescheduleAppointmentId.value = a.id;
  appointmentDate.value = businessDateKey(a.startAt);
  appointmentTime.value = formatTime(a.startAt);
  appointmentModalOpen.value = true;
}

function workingHoursForAppointment() {
  const staffMember = staff.value.find((s) => s.id === appointmentStaffId.value);
  return staffMember?.workingHours || business.value?.workingHours || {};
}

const appointmentQuickSlots = computed(() => {
  if (!appointmentDate.value || !appointmentStaffId.value || !appointmentServiceId.value) return [];
  const [year, month, day] = appointmentDate.value.split("-").map(Number);
  const weekday = new Date(year, month - 1, day).getDay();
  const hours = workingHoursForAppointment()[weekday];
  if (!hours) return [];

  const duration = services.value.find((s) => s.id === appointmentServiceId.value)?.durationMin ?? 30;
  const zone = business.value?.timezone || "Europe/Moscow";
  const slots: string[] = [];
  const step = 15;
  const selectedId = rescheduleAppointmentId.value;

  for (let minute = hours.start; minute + duration <= hours.end; minute += step) {
    const hh = String(Math.floor(minute / 60)).padStart(2, "0");
    const mm = String(minute % 60).padStart(2, "0");
    const start = zonedLocalToIso(appointmentDate.value, `${hh}:${mm}`, zone);
    const end = zonedLocalToIso(appointmentDate.value, `${String(Math.floor((minute + duration) / 60)).padStart(2, "0")}:${String((minute + duration) % 60).padStart(2, "0")}`, zone);
    const overlaps = appointments.value.some((a) => {
      if (a.id === selectedId || a.staffId !== appointmentStaffId.value || a.status === "cancelled") return false;
      return new Date(start).getTime() < new Date(a.endAt).getTime() && new Date(end).getTime() > new Date(a.startAt).getTime();
    });
    if (!overlaps) slots.push(`${hh}:${mm}`);
  }
  return slots.slice(0, 12);
});

function zonedLocalToIso(date: string, time: string, timeZone: string) {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const localAsUtc = Date.UTC(y, m - 1, d, hh, mm);
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const parts = Object.fromEntries(formatter.formatToParts(new Date(localAsUtc)).filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
  const renderedAsUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
  const offset = renderedAsUtc - localAsUtc;
  return new Date(localAsUtc - offset).toISOString();
}

async function runIntelligenceAction(recommendation: RetentionIntelligence["recommendations"][number]) {
  if (intelligenceActionClientId.value) return;
  intelligenceActionClientId.value = recommendation.clientId;
  delete intelligenceActionResult.value[recommendation.clientId];
  try {
    if (recommendation.action === "offer_repeat_booking") {
      await prepareRetentionOffer(recommendation.clientId);
    } else {
      await smartRebookClient(recommendation.clientId);
    }
    // Подготовка может завершиться без открытия следующего шага (например,
    // нет Telegram/завершённого визита/свободного окна). В таком случае
    // разблокируем остальные рекомендации.
    if (!retentionOfferOpen.value && !appointmentModalOpen.value) {
      intelligenceActionResult.value[recommendation.clientId] = "error";
      intelligenceActionClientId.value = null;
    }
  } catch {
    intelligenceActionResult.value[recommendation.clientId] = "error";
    intelligenceActionClientId.value = null;
  }
}

async function saveAppointment() {
  appointmentError.value = "";
  appointmentSaving.value = true;
  try {
    const startAt = zonedLocalToIso(appointmentDate.value, appointmentTime.value, business.value?.timezone || "Europe/Moscow");
    if (rescheduleAppointmentId.value) {
      const res = await api.rescheduleAppointment(businessId, rescheduleAppointmentId.value, startAt);
      const idx = appointments.value.findIndex((a) => a.id === rescheduleAppointmentId.value);
      if (idx !== -1) appointments.value[idx] = { ...appointments.value[idx], ...res.appointment };
    } else {
      if (!appointmentClientId.value || !appointmentServiceId.value || !appointmentStaffId.value) {
        appointmentError.value = "Выберите клиента, услугу и сотрудника.";
        return;
      }
      const res = await api.createAppointment(businessId, {
        clientId: appointmentClientId.value, staffId: appointmentStaffId.value, serviceId: appointmentServiceId.value, startAt, status: appointmentStatus.value,
      });
      appointments.value.push(res.appointment);
      appointments.value.sort((a, b) => a.startAt.localeCompare(b.startAt));
    }
    appointmentModalOpen.value = false;
    if (intelligenceActionClientId.value === appointmentClientId.value) {
      intelligenceActionResult.value[appointmentClientId.value] = "success";
      intelligenceActionClientId.value = null;
      void loadRetentionIntelligence();
    }
    showToast(rescheduleAppointmentId.value ? "Запись перенесена" : "Запись создана");
  } catch (e: any) {
    appointmentError.value = e?.message === "slot_taken" ? "Это время уже занято. Выберите другой слот." : (e?.message || "Не удалось сохранить запись.");
  } finally {
    appointmentSaving.value = false;
  }
}

// ---- Шаблоны уведомлений ----
import type { OwnedTemplate } from "../../../composables/useTimioAuthApi";

const templates = ref<OwnedTemplate[]>([]);
const templatesStatus = ref<"idle" | "loading" | "ready" | "error">("idle");
// Черновики переводов: { [templateType]: { [locale]: text } }
const templateDrafts = reactive<Record<string, Record<string, string>>>({});
const templateSaving = reactive<Record<string, boolean>>({});

const LOCALES = ["ru", "en", "es", "it", "fr", "kk", "hy"] as const;

async function loadTemplates() {
  templatesStatus.value = "loading";
  try {
    const res = await api.listTemplates(businessId);
    templates.value = res.templates;
    // Инициализируем черновики из текущих переводов
    for (const t of res.templates) {
      templateDrafts[t.type] = { ...t.translations };
    }
    templatesStatus.value = "ready";
  } catch {
    templatesStatus.value = "error";
  }
}

async function saveTemplate(type: string) {
  templateSaving[type] = true;
  try {
    const res = await api.updateTemplate(businessId, type, templateDrafts[type]);
    const idx = templates.value.findIndex((t) => t.type === type);
    if (idx !== -1) templates.value[idx] = res.template;
  } finally {
    templateSaving[type] = false;
  }
}

// ---- Команда бизнеса ----
import type { OwnedMember } from "../../../composables/useTimioAuthApi";

const members = ref<OwnedMember[]>([]);
const membersStatus = ref<"idle" | "loading" | "ready" | "error">("idle");
const newMemberEmail = ref("");
const newMemberRole = ref<"administrator" | "manager" | "employee">("employee");
const addingMember = ref(false);
const memberError = ref("");

async function loadMembers() {
  membersStatus.value = "loading";
  try {
    const res = await api.listMembers(businessId);
    members.value = res.members;
    membersStatus.value = "ready";
  } catch {
    membersStatus.value = "error";
  }
}

async function addMember() {
  if (!newMemberEmail.value.trim()) return;
  memberError.value = "";
  addingMember.value = true;
  try {
    const res = await api.addMember(businessId, newMemberEmail.value.trim(), newMemberRole.value);
    members.value.push(res.member);
    newMemberEmail.value = "";
  } catch (e: any) {
    memberError.value = e?.message ?? "Не удалось добавить участника";
  } finally {
    addingMember.value = false;
  }
}

async function removeMember(memberId: string) {
  await api.removeMember(businessId, memberId);
  members.value = members.value.filter((m) => m.id !== memberId);
}

// ---- CRM: полная карточка клиента ----
import type { OwnedClientCard } from "../../../composables/useTimioAuthApi";

const clientCard = ref<OwnedClientCard | null>(null);
const clientCardLoading = ref(false);
// Черновик тегов и заметок для редактирования
const clientCrmDraft = reactive<{ tags: string[]; notes: string[]; marketingOptOut: boolean; saving: boolean }>({
  tags: [],
  notes: [],
  marketingOptOut: false,
  saving: false,
});
const newTag = ref("");
const newNote = ref("");

// Заменяем старый openClientDetail — теперь грузим с сервера
async function openClientDetail(clientId?: string) {
  if (!clientId) return;
  selectedClientId.value = clientId;
  clientCard.value = null;
  clientCardLoading.value = true;
  try {
    const res = await api.getClientCard(businessId, clientId);
    clientCard.value = res;
    clientCrmDraft.tags = [...res.client.tags];
    clientCrmDraft.notes = [...res.client.notes];
    clientCrmDraft.marketingOptOut = res.client.marketingOptOut;
  } finally {
    clientCardLoading.value = false;
  }
}

function addTag() {
  const t = newTag.value.trim();
  if (t && !clientCrmDraft.tags.includes(t)) clientCrmDraft.tags.push(t);
  newTag.value = "";
}
function removeTag(tag: string) {
  clientCrmDraft.tags = clientCrmDraft.tags.filter((t) => t !== tag);
}
function addNote() {
  const n = newNote.value.trim();
  if (n) clientCrmDraft.notes.push(n);
  newNote.value = "";
}
function removeNote(idx: number) {
  clientCrmDraft.notes.splice(idx, 1);
}

const clientUpcomingAppointment = computed(() =>
  clientCard.value?.appointments.find((a) =>
    new Date(a.startAt).getTime() > Date.now() && !["cancelled", "no_show"].includes(a.status)
  ) ?? null
);

const clientCompletedAppointments = computed(() =>
  clientCard.value?.appointments.filter((a) => a.status === "completed") ?? []
);

const clientLastCompletedAppointment = computed(() => clientCompletedAppointments.value[0] ?? null);

function openClientAppointment(appointmentId: string) {
  const a = appointments.value.find((item) => item.id === appointmentId);
  if (!a) return;
  selectedClientId.value = null;
  openAppointmentDetail(a);
}

function repeatClientAppointment(appointmentId: string) {
  const a = appointments.value.find((item) => item.id === appointmentId);
  if (!a) return;
  selectedClientId.value = null;
  openRepeatAppointment(a);
}

async function saveClientCrm() {
  if (!selectedClientId.value) return;
  clientCrmDraft.saving = true;
  try {
    const res = await api.updateClientCrm(businessId, selectedClientId.value, {
      tags: clientCrmDraft.tags,
      notes: clientCrmDraft.notes,
      marketingOptOut: clientCrmDraft.marketingOptOut,
    });
    if (clientCard.value) clientCard.value.client = res.client;
  } finally {
    clientCrmDraft.saving = false;
  }
}


// ---- Услуги ----
const newServiceName = ref("");
const newServiceDuration = ref(30);
const newServicePrice = ref(0);
const newServiceCurrency = ref("RUB");
const newServicePhoto = ref<string | null>(null);
const addingService = ref(false);

async function addService() {
  if (!newServiceName.value.trim()) return;
  addingService.value = true;
  try {
    await api.createService(businessId, {
      name: newServiceName.value,
      durationMin: newServiceDuration.value,
      priceCents: Math.round(newServicePrice.value * 100),
      currency: newServiceCurrency.value,
      photoUrl: newServicePhoto.value ?? undefined,
    });
    newServiceName.value = "";
    newServiceDuration.value = 30;
    newServicePrice.value = 0;
    newServicePhoto.value = null;
    const s = await api.listServices(businessId);
    services.value = s.services;
  } finally {
    addingService.value = false;
  }
}
async function removeService(id: string) {
  await api.deleteService(businessId, id);
  services.value = services.value.filter((s) => s.id !== id);
}

// ---- Сотрудники ----
const newStaffName = ref("");
const newStaffServiceIds = ref<string[]>([]);
const newStaffPhoto = ref<string | null>(null);
const addingStaff = ref(false);
const expandedStaffId = ref<string | null>(null);

// Черновики редактирования расписания/комиссии по каждому сотруднику
const staffDrafts = reactive<Record<string, { workingHours: WorkingHours; inherited: boolean; commissionPercent: number; saving: boolean }>>({});

function ensureDraft(member: OwnedStaff) {
  if (!staffDrafts[member.id]) {
    staffDrafts[member.id] = {
      workingHours: member.workingHours ?? emptyWeek(),
      inherited: !member.workingHours,
      commissionPercent: member.commissionPercentBp / 100,
      saving: false,
    };
  }
  return staffDrafts[member.id];
}
function emptyWeek(): WorkingHours {
  return { 1: { start: 600, end: 1200 }, 2: { start: 600, end: 1200 }, 3: { start: 600, end: 1200 }, 4: { start: 600, end: 1200 }, 5: { start: 600, end: 1200 }, 6: null, 0: null };
}

function toggleExpand(member: OwnedStaff) {
  expandedStaffId.value = expandedStaffId.value === member.id ? null : member.id;
  ensureDraft(member);
}

async function addStaff() {
  if (!newStaffName.value.trim() || newStaffServiceIds.value.length === 0) return;
  addingStaff.value = true;
  try {
    await api.createStaff(businessId, {
      name: newStaffName.value,
      serviceIds: newStaffServiceIds.value,
      photoUrl: newStaffPhoto.value ?? undefined,
    });
    newStaffName.value = "";
    newStaffServiceIds.value = [];
    newStaffPhoto.value = null;
    const st = await api.listStaff(businessId);
    staff.value = st.staff;
  } finally {
    addingStaff.value = false;
  }
}
async function removeStaff(id: string) {
  await api.deleteStaff(businessId, id);
  staff.value = staff.value.filter((s) => s.id !== id);
}
function toggleServiceForStaff(id: string) {
  const idx = newStaffServiceIds.value.indexOf(id);
  if (idx === -1) newStaffServiceIds.value.push(id);
  else newStaffServiceIds.value.splice(idx, 1);
}
async function saveStaffPhoto(member: OwnedStaff, photo: string | null) {
  await api.updateStaff(businessId, member.id, { photoUrl: photo ?? "" });
  const st = await api.listStaff(businessId);
  staff.value = st.staff;
}
async function saveStaffSchedule(member: OwnedStaff) {
  const draft = ensureDraft(member);
  draft.saving = true;
  try {
    await api.updateStaff(businessId, member.id, {
      workingHours: draft.inherited ? null : draft.workingHours,
      commissionPercent: draft.commissionPercent,
    });
    const st = await api.listStaff(businessId);
    staff.value = st.staff;
  } finally {
    draft.saving = false;
  }
}

// ---- Маркетинговые рассылки ----
  import type { Campaign, CampaignFilters, CampaignSegment, CampaignPreview, CampaignPerformance, AiMessageTone, AiMessageLanguage } from "../../../composables/useTimioAuthApi";

  const campaignsList = ref<Campaign[]>([]);
  const campaignsStatus = ref<"idle" | "loading" | "ready" | "error">("idle");
  const retentionDashboard = ref<RetentionDashboard | null>(null);
  const retentionDashboardStatus = ref<"idle" | "loading" | "ready" | "error">("idle");
  const retentionDashboardDays = ref<7 | 30 | 90>(30);
  const retentionIntelligence = ref<RetentionIntelligence | null>(null);
  const retentionIntelligenceStatus = ref<"idle" | "loading" | "ready" | "error">("idle");

  const campaignDraft = reactive<{
    name: string;
    message: string;
    filters: CampaignFilters;
    channel: "telegram";
  }>({
    name: "",
    message: "",
    filters: { segment: "all" },
    channel: "telegram",
  });

  const campaignPreview = ref<CampaignPreview | null>(null);
  const previewLoading = ref(false);
  const campaignSending = ref(false);
  const campaignError = ref("");
  const campaignSuccess = ref("");
  const selectedCampaignPerformance = ref<CampaignPerformance | null>(null);
  const campaignPerformanceLoading = ref(false);
  const campaignPerformanceError = ref("");
  const aiMessageTone = ref<AiMessageTone>("friendly");
  const aiMessageLanguage = ref<AiMessageLanguage>("ru");
  const aiMessageLoading = ref(false);
  const aiMessageError = ref("");
  const aiMessageProvider = ref<"yandexgpt" | "fallback" | null>(null);

  async function generateCampaignMessage() {
    aiMessageError.value = "";
    aiMessageLoading.value = true;
    try {
      const purpose = campaignDraft.filters.segment === "reactivation" ? "reactivation" : "promotion";
      const result = await api.generateAiMessage(businessId, {
        purpose,
        tone: aiMessageTone.value,
        language: aiMessageLanguage.value,
        channel: campaignDraft.channel,
        draft: campaignDraft.message || undefined,
      });
      campaignDraft.message = result.message;
      aiMessageProvider.value = result.provider;
    } catch (e: any) {
      aiMessageError.value = e?.message ?? "Не удалось сгенерировать сообщение";
    } finally {
      aiMessageLoading.value = false;
    }
  }

  const segmentLabels: Record<CampaignSegment, string> = {
    all: "Все клиенты",
    inactive: "Давно не приходили",
    by_tag: "По тегу",
    top_clients: "Постоянные клиенты",
    new_clients: "Новые клиенты (1–2 визита)",
    reactivation: "Вернуть клиентов",
  };

  const reactivationCampaignLabels: Record<ReactivationSegment, string> = {
    all: "Всех, кого пора вернуть",
    due: "Пора вернуть",
    at_risk: "Под угрозой",
    lost: "Потеряны",
  };

  function startReactivationCampaign(segment: ReactivationSegment = reactivationSegment.value) {
    reactivationSegment.value = segment;
    campaignDraft.filters = { segment: "reactivation", reactivationSegment: segment };
    campaignDraft.name = `Возврат клиентов · ${reactivationCampaignLabels[segment]}`;
    campaignDraft.message = "Привет, {{clientName}}! Мы скучаем по вам — будем рады видеть вас снова в {{businessName}} 😊";
    campaignDraft.channel = "telegram";
    campaignPreview.value = null;
    openTab("campaigns");
    void loadReactivation(segment);
  }

  // Уникальные теги всех клиентов - для выпадающего списка в фильтре by_tag
  const allClientTags = computed(() => {
    // clients уже загружены в loadAll, но если нет - пустой массив
    const tagSet = new Set<string>();
    // Используем appointments для получения clientId-ов, но теги нам нужны из CRM.
    // Простое решение: запрашиваем /clients один раз при открытии таба.
    return [...tagSet];
  });

  async function loadRetentionIntelligence() {
    retentionIntelligenceStatus.value = "loading";
    try {
      retentionIntelligence.value = await api.getRetentionIntelligence(businessId);
      retentionIntelligenceStatus.value = "ready";
    } catch {
      retentionIntelligenceStatus.value = "error";
    }
  }

  async function loadRetentionDashboard(days: 7 | 30 | 90 = retentionDashboardDays.value) {
    retentionDashboardDays.value = days;
    retentionDashboardStatus.value = "loading";
    try {
      retentionDashboard.value = await api.getRetentionDashboard(businessId, days);
      retentionDashboardStatus.value = "ready";
    } catch {
      retentionDashboardStatus.value = "error";
    }
  }

  async function loadCampaigns() {
    campaignsStatus.value = "loading";
    try {
      const res = await api.listCampaigns(businessId);
      campaignsList.value = res.campaigns;
      campaignsStatus.value = "ready";
    } catch {
      campaignsStatus.value = "error";
    }
  }

  async function loadCampaignPerformance(campaignId: string) {
    campaignPerformanceLoading.value = true;
    campaignPerformanceError.value = "";
    try {
      selectedCampaignPerformance.value = await api.getCampaignPerformance(businessId, campaignId);
    } catch (e: any) {
      campaignPerformanceError.value = e?.message ?? "Не удалось загрузить результат кампании";
    } finally {
      campaignPerformanceLoading.value = false;
    }
  }

  async function previewCampaign() {
    campaignPreview.value = null;
    previewLoading.value = true;
    try {
      campaignPreview.value = await api.previewCampaign(businessId, campaignDraft.filters);
    } finally {
      previewLoading.value = false;
    }
  }

  async function sendCampaign() {
    if (!campaignDraft.name.trim() || !campaignDraft.message.trim()) return;
    campaignError.value = "";
    campaignSuccess.value = "";
    campaignSending.value = true;
    try {
      const res = await api.sendCampaign(businessId, {
        name: campaignDraft.name,
        message: campaignDraft.message,
        filters: campaignDraft.filters,
        channel: campaignDraft.channel,
      });
      campaignsList.value.unshift(res.campaign);
      campaignSuccess.value = `Отправлено: ${res.result.sent} из ${res.result.total}`;
      void loadRetentionDashboard(retentionDashboardDays.value);
      // Сбрасываем форму
      campaignDraft.name = "";
      campaignDraft.message = "";
      campaignDraft.filters = { segment: "all" };
      campaignDraft.channel = "telegram";
      campaignPreview.value = null;
    } catch (e: any) {
      campaignError.value = e?.message ?? "Не удалось отправить рассылку";
    } finally {
      campaignSending.value = false;
    }
  }

  function formatCampaignStatus(status: string) {
    return { sending: "Отправляется…", sent: "Отправлена", failed: "Ошибка" }[status] ?? status;
  }

// ---- Настройки бизнеса ----
const businessDraft = reactive({ timezone: "", taxPercent: 0, workingHours: emptyWeek(), savingSettings: false });
function loadBusinessDraft() {
  if (!business.value) return;
  businessDraft.timezone = business.value.timezone;
  businessDraft.taxPercent = business.value.taxPercentBp / 100;
  businessDraft.workingHours = business.value.workingHours;
}
async function saveBusinessSettings() {
  businessDraft.savingSettings = true;
  try {
    await api.updateBusiness(businessId, {
      timezone: businessDraft.timezone,
      taxPercent: businessDraft.taxPercent,
      workingHours: businessDraft.workingHours,
    });
    const b = await api.getBusiness(businessId);
    business.value = b.business;
  } finally {
    businessDraft.savingSettings = false;
  }
}

// ---- Аналитика ----
const analytics = ref<AnalyticsResponse | null>(null);
const analyticsStatus = ref<"idle" | "loading" | "ready" | "error">("idle");

async function loadAnalytics() {
  analyticsStatus.value = "loading";
  try {
    analytics.value = await api.getAnalytics(businessId);
    analyticsStatus.value = "ready";
  } catch {
    analyticsStatus.value = "error";
  }
}

// ---- Подписка ----
const subscription = ref<OwnedSubscription | null>(null);
const billingStatus = ref<"idle" | "loading" | "ready" | "error">("idle");
const selectedPlan = ref<SubscriptionPlanId>("basic");
const startingTrial = ref(false);
const bindingCard = ref(false);
const cancelling = ref(false);
const promoCodeInput = ref("");
const promoCheckStatus = ref<"idle" | "checking" | "valid" | "invalid">("idle");
const promoDiscountLabel = ref("");
const billingError = ref("");

async function loadBilling() {
  billingStatus.value = "loading";
  try {
    const res = await api.getSubscription(businessId);
    subscription.value = res.subscription;
    billingStatus.value = "ready";
  } catch {
    billingStatus.value = "error";
  }
}

async function handleStartTrial() {
  billingError.value = "";
  startingTrial.value = true;
  try {
    const res = await api.startTrial(businessId, selectedPlan.value);
    subscription.value = res.subscription;
  } catch (e: any) {
    billingError.value = e?.message ?? "Не удалось запустить пробный период";
  } finally {
    startingTrial.value = false;
  }
}

async function handleStartCardBinding() {
  billingError.value = "";
  bindingCard.value = true;
  try {
    // После подтверждения оплаты ЮKassa вернёт пользователя на ЭТУ ЖЕ страницу -
    // при возврате достаточно просто заново загрузить статус подписки.
    const returnUrl = window.location.href;
    const res = await api.startCardBinding(businessId, returnUrl);
    if (res.confirmationUrl) {
      window.location.href = res.confirmationUrl; // редирект на страницу оплаты ЮKassa
    } else {
      billingError.value = "ЮKassa не вернула ссылку на подтверждение оплаты";
    }
  } catch (e: any) {
    billingError.value = e?.message ?? "Не удалось начать привязку карты";
  } finally {
    bindingCard.value = false;
  }
}

async function handleCancelSubscription() {
  if (!confirm("Отменить подписку? Доступ сохранится до конца оплаченного периода.")) return;
  cancelling.value = true;
  try {
    const res = await api.cancelSubscription(businessId);
    subscription.value = res.subscription;
  } finally {
    cancelling.value = false;
  }
}

async function checkPromoCode() {
  if (!promoCodeInput.value.trim()) return;
  promoCheckStatus.value = "checking";
  try {
    const res = await api.validatePromoCode(businessId, promoCodeInput.value.trim());
    promoCheckStatus.value = "valid";
    promoDiscountLabel.value =
      res.discountType === "percent" ? `−${res.discountValue}% на первый месяц` : `−${(res.discountValue / 100).toFixed(0)} ₽ на первый месяц`;
  } catch {
    promoCheckStatus.value = "invalid";
    promoDiscountLabel.value = "";
  }
}

const subscriptionStatusLabel: Record<string, string> = {
  trial: "Пробный период",
  active: "Активна",
  expired: "Истекла",
  cancelled: "Отменена",
};
const subscriptionPlanLabel: Record<string, string> = {
  basic: "Базовый",
  business: "Бизнес",
};

function daysLeft(iso: string) {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
}
// ---- Telegram-бот (реальная отправка уведомлений) ----
const telegramConnected = ref(false);
const telegramBotUsername = ref<string | null>(null);
const telegramTokenInput = ref("");
const telegramConnecting = ref(false);
const telegramError = ref("");
const telegramWarning = ref("");
const telegramTestClientId = ref("");
const telegramTesting = ref(false);
const telegramTestMessage = ref("");
const notificationLogs = ref<any[]>([]);
const notificationLogsLoading = ref(false);
const notificationProviders = ref<any>(null);
const providerTestChannel = ref<"whatsapp" | "sms" | "email">("email");
const providerTestClientId = ref("");
const providerTesting = ref(false);
const providerTestMessage = ref("");
const notificationSettingsSaving = ref(false);
const notificationSettingsMessage = ref("");
const notificationEvents = [
  { event: "appointment.created", label: "Подтверждение новой записи", channels: ["telegram", "whatsapp", "sms", "email"] },
  { event: "appointment.confirmed", label: "Запись подтверждена", channels: ["telegram", "whatsapp", "sms", "email"] },
  { event: "appointment.cancelled", label: "Отмена записи", channels: ["telegram", "whatsapp", "sms", "email"] },
  { event: "appointment.rescheduled", label: "Перенос записи", channels: ["telegram", "whatsapp", "sms", "email"] },
  { event: "appointment.reminder.24h", label: "Напоминание за 24 часа", channels: ["telegram", "whatsapp", "sms", "email"] },
  { event: "appointment.reminder.3h", label: "Напоминание за 3 часа", channels: ["telegram", "whatsapp", "sms", "email"] },
  { event: "appointment.reminder.15m", label: "Напоминание за 15 минут", channels: ["telegram", "whatsapp", "sms", "email"] },
  { event: "visit.completed", label: "Сообщение после визита", channels: ["telegram", "whatsapp", "sms", "email"] },
];
const notificationSettings = ref<Record<string, { enabled: boolean; channels: string[] }>>(Object.fromEntries(notificationEvents.map((event) => [event.event, { enabled: true, channels: [...event.channels] }])));
const notificationChannelLabels: Record<string, string> = { telegram: "Telegram", whatsapp: "WhatsApp", sms: "SMS", email: "Email" };


const telegramClients = computed(() => clients.value.filter((client) => client.telegramChatId));

async function loadNotificationSettings() {
  try {
    const rows = await api.getNotificationSettings(businessId);
    const next: Record<string, { enabled: boolean; channels: string[] }> = {};
    for (const event of notificationEvents) {
      const row = rows.find((item) => item.event === event.event);
      next[event.event] = {
        enabled: row?.enabled ?? true,
        channels: row?.channels?.length ? row.channels : ["telegram", "whatsapp", "sms", "email"],
      };
    }
    notificationSettings.value = next;
  } catch {
    notificationSettings.value = Object.fromEntries(notificationEvents.map((event) => [event.event, { enabled: true, channels: ["telegram", "whatsapp", "sms", "email"] }]));
  }
}

function toggleNotificationChannel(event: string, channel: string) {
  const current = notificationSettings.value[event] ?? { enabled: true, channels: [] };
  const channels = current.channels.includes(channel)
    ? current.channels.filter((item) => item !== channel)
    : [...current.channels, channel];
  notificationSettings.value = { ...notificationSettings.value, [event]: { ...current, channels } };
}

async function saveNotificationSettings() {
  notificationSettingsSaving.value = true;
  notificationSettingsMessage.value = "";
  try {
    await api.saveNotificationSettings(businessId, notificationEvents.map((event) => ({ event: event.event, ...notificationSettings.value[event.event] })));
    notificationSettingsMessage.value = "✓ Настройки уведомлений сохранены.";
  } catch (e: any) {
    notificationSettingsMessage.value = e?.message ?? "Не удалось сохранить настройки.";
  } finally {
    notificationSettingsSaving.value = false;
  }
}

async function loadNotificationLogs() {
  notificationLogsLoading.value = true;
  try {
    const res = await api.getNotificationLogs(businessId);
    notificationLogs.value = res.logs;
  } catch {
    notificationLogs.value = [];
  } finally {
    notificationLogsLoading.value = false;
  }
}

async function loadNotificationProviders() {
  try {
    notificationProviders.value = await api.getNotificationProviders(businessId);
  } catch {
    notificationProviders.value = null;
  }
}

async function sendProviderTest() {
  if (!providerTestClientId.value) return;
  providerTesting.value = true;
  providerTestMessage.value = "";
  try {
    const res = await api.sendNotificationProviderTest(businessId, providerTestChannel.value, providerTestClientId.value);
    providerTestMessage.value = res.ok
      ? `✓ Тест для ${providerTestChannel.value} отправлен клиенту ${res.clientName}.`
      : `Не удалось отправить: ${res.error ?? "провайдер вернул ошибку"}`;
    await loadNotificationLogs();
  } catch (e: any) {
    providerTestMessage.value = e?.message ?? "Не удалось отправить тестовое сообщение.";
  } finally {
    providerTesting.value = false;
  }
}

async function sendTelegramTest() {
  if (!telegramTestClientId.value) return;
  telegramTesting.value = true;
  telegramTestMessage.value = "";
  try {
    const res = await api.sendTelegramTest(businessId, telegramTestClientId.value);
    telegramTestMessage.value = res.ok
      ? `✓ Тестовое сообщение отправлено клиенту ${res.clientName}.`
      : `Не удалось отправить: ${res.description ?? "Telegram API вернул ошибку"}`;
    await loadNotificationLogs();
  } catch (e: any) {
    telegramTestMessage.value = e?.message ?? "Не удалось отправить тестовое сообщение.";
  } finally {
    telegramTesting.value = false;
  }
}

async function loadTelegramStatus() {
  try {
    const res = await api.getTelegramStatus(businessId);
    telegramConnected.value = res.connected;
    telegramBotUsername.value = res.botUsername;
  } catch {
    /* не критично для остального экрана настроек */
  }
}

async function connectTelegram() {
  if (!telegramTokenInput.value.trim()) return;
  telegramError.value = "";
  telegramWarning.value = "";
  telegramConnecting.value = true;
  try {
    const res = await api.connectTelegramBot(businessId, telegramTokenInput.value.trim());
    telegramConnected.value = res.connected;
    telegramBotUsername.value = res.botUsername ?? null;
    telegramTokenInput.value = "";
    if (!res.webhookRegistered && res.webhookWarning) telegramWarning.value = res.webhookWarning;
  } catch (e: any) {
    telegramError.value = e?.message ?? "Не удалось подключить бота. Проверьте токен.";
  } finally {
    telegramConnecting.value = false;
  }
}

async function disconnectTelegram() {
  await api.disconnectTelegramBot(businessId);
  telegramConnected.value = false;
  telegramBotUsername.value = null;
}
function openTab(t: Tab) {
  tab.value = t;
  if (t === "analytics" && analyticsStatus.value === "idle") loadAnalytics();
  if (t === "settings") {
    loadBusinessDraft();
    loadTelegramStatus();
    loadNotificationProviders();
    loadNotificationLogs();
    loadNotificationSettings();
  }
  if (t === "billing" && billingStatus.value === "idle") loadBilling();
  if (t === "templates" && templatesStatus.value === "idle") loadTemplates(); 
  if (t === "team" && membersStatus.value === "idle") loadMembers(); 
  if (t === "campaigns") {
    if (campaignsStatus.value === "idle") loadCampaigns();
    void loadRetentionDashboard(retentionDashboardDays.value);
  }
}

function exportXlsx() {
  if (!analytics.value || !business.value) return;
  downloadAnalyticsXlsx(business.value.name, analytics.value);
}

const revenueByDayChart = computed(
  () => analytics.value?.byDay.map((d) => ({ label: d.date.slice(5), value: d.revenueCents / 100 })) ?? []
);
const revenueByServiceChart = computed(
  () => analytics.value?.byService.map((s) => ({ label: s.name, value: s.revenueCents / 100 })) ?? []
);
const revenueByStaffChart = computed(
  () => analytics.value?.byStaff.map((s) => ({ label: s.name, value: s.revenueCents / 100 })) ?? []
);

function formatNotificationEvent(event: string) {
  const map: Record<string, string> = {
    "appointment.created": "Запись создана",
    "appointment.confirmed": "Запись подтверждена",
    "appointment.cancelled": "Запись отменена",
    "appointment.rescheduled": "Запись перенесена",
    "appointment.reminder.24h": "Напоминание за 24 часа",
    "appointment.reminder.3h": "Напоминание за 3 часа",
    "appointment.reminder.15m": "Напоминание за 15 минут",
    "visit.completed": "Визит завершён",
    "waitlist.invite": "Приглашение из листа ожидания",
  };
  return map[event] ?? event;
}

function formatNotificationStatus(status: string) {
  const map: Record<string, string> = { sent: "Отправлено", failed: "Ошибка", pending: "В очереди", processing: "Отправляется", retry: "Повтор", skipped: "Пропущено", cancelled: "Отменено" };
  return map[status] ?? status;
}

function notificationLogStyle(status: string) {
  if (status === "sent") return "color:var(--success);background:var(--success-dim)";
  if (status === "failed") return "color:var(--accent);background:var(--accent-dim)";
  return "";
}

function formatNotificationLogDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
}

async function logout() {
  await api.logout().catch(() => auth.clear());
  router.push("/login");
}
</script>

<template>
  <div class="app-shell">
    <aside class="app-sidebar">
      <div class="brand" style="padding: 6px 8px 20px">
        <span class="brand-mark">T</span>
        <span class="brand-name">Timio</span>
      </div>
      <div class="sidebar-section-label">Рабочий день</div>
      <a class="sidebar-nav-item" :class="{ active: tab === 'overview' }" @click="openTab('overview')"><span class="nav-icon">⌂</span> Сегодня</a>
      <a class="sidebar-nav-item" :class="{ active: tab === 'appointments' }" @click="openTab('appointments')"><span class="nav-icon">▤</span> Расписание</a>
      <a class="sidebar-nav-item" :class="{ active: tab === 'clients' }" @click="openTab('clients')"><span class="nav-icon">◎</span> Клиенты</a>

      <div class="sidebar-section-label">Бизнес</div>
      <a class="sidebar-nav-item" :class="{ active: tab === 'services' }" @click="openTab('services')"><span class="nav-icon">◇</span> Услуги</a>
      <a class="sidebar-nav-item" :class="{ active: tab === 'staff' }" @click="openTab('staff')"><span class="nav-icon">◍</span> Сотрудники</a>
      <a class="sidebar-nav-item" :class="{ active: tab === 'analytics' }" @click="openTab('analytics')"><span class="nav-icon">↗</span> Аналитика</a>
      <a class="sidebar-nav-item" :class="{ active: tab === 'campaigns' }" @click="openTab('campaigns')"><span class="nav-icon">✦</span> Маркетинг</a>

      <div class="sidebar-section-label">Настройки</div>
      <a class="sidebar-nav-item" :class="{ active: tab === 'templates' }" @click="openTab('templates')"><span class="nav-icon">✉</span> Уведомления</a>
      <a class="sidebar-nav-item" :class="{ active: tab === 'team' }" @click="openTab('team')"><span class="nav-icon">◌</span> Команда</a>
      <a class="sidebar-nav-item" :class="{ active: tab === 'billing' }" @click="openTab('billing')"><span class="nav-icon">◈</span> Тариф</a>
      <a class="sidebar-nav-item" :class="{ active: tab === 'settings' }" @click="openTab('settings')"><span class="nav-icon">⚙</span> Настройки</a>
      <a class="sidebar-nav-item" :class="{ active: tab === 'archive' }" @click="openTab('archive')"><span class="nav-icon">▦</span> Архив</a>
      <div style="flex: 1" />
      <a class="sidebar-nav-item" @click="logout"><span class="nav-icon">←</span> Выйти</a>
    </aside>

    <nav class="mobile-bottom-nav" aria-label="Основная навигация">
      <button
        v-for="item in mobilePrimaryTabs"
        :key="item.tab"
        type="button"
        class="mobile-nav-item"
        :class="{ active: tab === item.tab }"
        @click="openMobileTab(item.tab)"
      >
        <span class="mobile-nav-icon">{{ item.icon }}</span>
        <span>{{ item.label }}</span>
      </button>
      <button
        type="button"
        class="mobile-nav-item"
        :class="{ active: mobileMoreOpen || !mobilePrimaryTabs.some((item) => item.tab === tab) }"
        @click="mobileMoreOpen = !mobileMoreOpen"
      >
        <span class="mobile-nav-icon">•••</span>
        <span>Ещё</span>
      </button>
    </nav>

    <Transition name="mobile-sheet">
      <div v-if="mobileMoreOpen" class="mobile-more-backdrop" @click.self="mobileMoreOpen = false">
        <div class="mobile-more-sheet" role="dialog" aria-label="Дополнительная навигация">
          <div class="mobile-more-head">
            <div>
              <strong>Разделы Timio</strong>
              <span>Управление бизнесом</span>
            </div>
            <button type="button" class="mobile-sheet-close" aria-label="Закрыть" @click="mobileMoreOpen = false">✕</button>
          </div>
          <div class="mobile-more-grid">
            <button
              v-for="item in mobileMoreTabs"
              :key="item.tab"
              type="button"
              class="mobile-more-item"
              :class="{ active: tab === item.tab }"
              @click="openMobileTab(item.tab)"
            >
              <span class="mobile-more-icon">{{ item.icon }}</span>
              <span>{{ item.label }}</span>
            </button>
          </div>
          <button type="button" class="mobile-logout" @click="logout">← Выйти</button>
        </div>
      </div>
    </Transition>

    <main class="app-main">
      <div v-if="status === 'loading'" class="text-dim">Загрузка…</div>

      <div v-else-if="status === 'error'" class="panel">
        <div class="error-banner" style="margin-bottom: 12px">
          Не удалось загрузить данные компании. Проверьте подключение и попробуйте ещё раз.
        </div>
        <button class="btn-primary" @click="loadAll">Повторить загрузку</button>
      </div>

      <template v-else-if="business">
        <div class="topbar app-topbar">
          <div>
            <div class="eyebrow">TIMIO · BUSINESS OS</div>
            <p class="page-title" style="margin-bottom: 3px">{{ business.name }}</p>
            <a :href="publicUrl" target="_blank" class="public-link">Открыть страницу записи ↗</a>
          </div>
          <div class="topbar-actions">
            <button class="btn-secondary topbar-book" @click="openCreateAppointment()">+ Новая запись</button>
            <ThemeToggle />
          </div>
        </div>

        <!-- Сегодня -->
        <div v-if="tab === 'overview'" class="dashboard-page">
          <div class="dashboard-heading">
            <div>
              <h1>Добрый день 👋</h1>
              <p>{{ formatDayTitle() }} · вот что происходит в бизнесе сегодня.</p>
            </div>
            <button class="btn-primary" @click="openCreateAppointment()">+ Новая запись</button>
          </div>

          <div class="today-grid">
            <div class="today-hero panel">
              <div class="hero-kicker">СЕГОДНЯ</div>
              <div class="hero-number">{{ selectedDayAppointments.length }}</div>
              <div class="hero-label">записей в расписании</div>
              <div class="hero-meta">
                <span>{{ todayClients }} клиентов</span>
                <span>·</span>
                <span>{{ formatMoney(todayRevenue, 'RUB') }}</span>
              </div>
              <div class="hero-actions">
                <button class="btn-primary compact" @click="openCreateAppointment()">+ Новая запись</button>
                <button class="btn-secondary compact" @click="openTab('appointments')">Посмотреть день</button>
              </div>
            </div>

            <div class="metric-stack">
              <div class="metric-card">
                <span>Предстоящие</span><strong>{{ upcomingCount }}</strong><small>все активные записи</small>
              </div>
              <div class="metric-card">
                <span>Клиенты</span><strong>{{ activeClients }}</strong><small>в базе Timio</small>
              </div>
            </div>
          </div>

          <!-- Daily Business Intelligence -->
          <section class="daily-intelligence panel">
            <div class="daily-intelligence-head">
              <div>
                <div class="hero-kicker">DAILY BUSINESS INTELLIGENCE</div>
                <h2>Главное на сегодня</h2>
                <p>Timio собирает расписание, загрузку и клиентские сигналы в несколько конкретных действий.</p>
              </div>
              <button class="btn-secondary compact" :disabled="dailyIntelligenceStatus === 'loading'" @click="loadDailyIntelligence">{{ dailyIntelligenceStatus === 'loading' ? 'Обновляем…' : 'Обновить' }}</button>
            </div>

            <div v-if="dailyIntelligenceStatus === 'loading'" class="daily-intelligence-empty">Собираем картину дня…</div>
            <div v-else-if="dailyIntelligenceStatus === 'error'" class="error-banner">Не удалось загрузить сводку дня. Попробуйте обновить.</div>
            <template v-else-if="dailyIntelligence">
              <div class="daily-kpi-grid">
                <div class="daily-kpi"><span>Записей</span><strong>{{ dailyIntelligence.summary.appointments }}</strong><small>{{ dailyIntelligence.summary.upcoming }} впереди</small></div>
                <div class="daily-kpi"><span>Подтверждение</span><strong>{{ dailyIntelligence.summary.needsConfirmation }}</strong><small>не подтверждено</small></div>
                <div class="daily-kpi"><span>Выручка</span><strong>{{ formatMoney(dailyIntelligence.summary.expectedRevenueCents, 'RUB') }}</strong><small>{{ formatMoney(dailyIntelligence.summary.completedRevenueCents, 'RUB') }} уже получено</small></div>
                <div class="daily-kpi"><span>Загрузка</span><strong>{{ dailyIntelligence.capacity.utilizationPercent }}%</strong><small>{{ Math.round(dailyIntelligence.capacity.freeMinutes / 60) }} ч свободно</small></div>
              </div>

              <div class="daily-intelligence-grid">
                <div>
                  <div class="daily-subhead">Действия</div>
                  <div class="daily-actions">
                    <button v-for="action in dailyIntelligence.actions" :key="action.id" class="daily-action" :class="`priority-${action.priority}`" @click="openDailyAction(action.target)">
                      <span class="daily-action-mark">{{ action.priority === 'high' ? '!' : action.priority === 'medium' ? '→' : '✓' }}</span>
                      <span class="daily-action-copy"><strong>{{ action.title }}</strong><small>{{ action.description }}</small></span>
                      <span v-if="action.count !== undefined" class="daily-action-count">{{ action.count }}</span>
                    </button>
                  </div>
                </div>

                <div>
                  <div class="daily-subhead">Ближайшие визиты</div>
                  <div v-if="dailyIntelligence.nextAppointments.length" class="daily-next-list">
                    <button v-for="appointment in dailyIntelligence.nextAppointments" :key="appointment.id" class="daily-next" @click="openAppointmentDetail(appointment)">
                      <span class="daily-next-time">{{ formatTime(appointment.startAt) }}</span>
                      <span class="daily-next-copy"><strong>{{ appointment.clientName }}</strong><small>{{ appointment.serviceName }} · {{ appointment.staffName }}</small></span>
                      <span class="daily-next-status" :class="{ pending: appointment.status === 'booked' }">{{ appointment.status === 'booked' ? 'Ожидает' : 'Подтверждён' }}</span>
                    </button>
                  </div>
                  <div v-else class="daily-intelligence-empty compact-empty">Сегодня активных будущих визитов нет.</div>
                </div>
              </div>
            </template>
          </section>

          <!-- Empty Slot Intelligence -->
          <section class="empty-slot-intelligence panel">
            <div class="empty-slot-head">
              <div>
                <div class="hero-kicker">EMPTY SLOT INTELLIGENCE</div>
                <h2>Свободные окна → кому их предложить</h2>
                <p>Timio связывает свободное время мастера с клиентами, которым уже пора возвращаться.</p>
              </div>
              <div class="empty-slot-periods">
                <button v-for="period in ([1, 3, 7] as const)" :key="period" class="btn-secondary compact" :class="{ active: emptySlotDays === period }" :disabled="emptySlotIntelligenceStatus === 'loading'" @click="selectEmptySlotDays(period)">{{ period === 1 ? 'Завтра' : period + ' дня' }}</button>
              </div>
            </div>
            <div v-if="emptySlotIntelligenceStatus === 'loading'" class="daily-intelligence-empty">Ищем свободные окна и подходящих клиентов…</div>
            <div v-else-if="emptySlotIntelligenceStatus === 'error'" class="error-banner">Не удалось рассчитать свободные окна. Попробуйте ещё раз.</div>
            <template v-else-if="emptySlotIntelligence">
              <div class="empty-slot-summary"><strong>{{ emptySlotIntelligence.summary.freeSlots }}</strong><span>свободных слотов · {{ emptySlotIntelligence.summary.opportunities }} готовых предложений</span></div>
              <div v-if="emptySlotIntelligence.opportunities.length" class="empty-slot-list">
                <div v-for="opportunity in emptySlotIntelligence.opportunities" :key="opportunity.id" class="empty-slot-item">
                  <div class="empty-slot-time"><strong>{{ opportunity.time }}</strong><small>{{ opportunity.date }}</small></div>
                  <div class="empty-slot-copy"><strong>{{ opportunity.client?.name }}</strong><span>{{ opportunity.serviceName }} · {{ opportunity.staffName }}</span><small>{{ opportunity.matchReason }} · {{ opportunity.client?.reason }}</small></div>
                  <button class="retention-offer-action" @click="openEmptySlotOpportunity(opportunity)">{{ opportunity.client?.telegramAvailable ? '✈ Предложить' : '↗ Открыть клиента' }}</button>
                </div>
              </div>
              <div v-else class="daily-intelligence-empty compact-empty">Свободные окна есть, но подходящих клиентов из retention-сегмента пока нет.</div>
            </template>
          </section>

          <!-- AI Retention Intelligence -->
          <div class="ai-intelligence-card panel">
            <div class="ai-intelligence-head">
              <div>
                <div class="hero-kicker">TIMIO INTELLIGENCE</div>
                <h2>Что стоит сделать сегодня</h2>
                <p v-if="retentionIntelligence?.explanation">{{ retentionIntelligence.explanation }}</p>
                <p v-else>Timio анализирует клиентов и подсказывает следующие действия.</p>
              </div>
              <button class="btn-secondary compact" :disabled="retentionIntelligenceStatus === 'loading'" @click="loadRetentionIntelligence">{{ retentionIntelligenceStatus === 'loading' ? 'Анализируем…' : 'Обновить' }}</button>
            </div>

            <div v-if="retentionIntelligenceStatus === 'loading'" class="ai-intelligence-empty">Собираем рекомендации…</div>
            <div v-else-if="retentionIntelligenceStatus === 'error'" class="error-banner">Не удалось загрузить рекомендации. Попробуйте обновить.</div>
            <div v-else-if="retentionIntelligence && retentionIntelligence.recommendations.length" class="ai-recommendation-list">
              <div v-for="recommendation in retentionIntelligence.recommendations.slice(0, 3)" :key="recommendation.clientId" class="ai-recommendation">
                <button class="ai-recommendation-main" @click="openClientDetail(recommendation.clientId)">
                  <span class="appointment-avatar">{{ initials(recommendation.clientName) }}</span>
                  <span class="ai-recommendation-copy">
                    <strong>{{ recommendation.clientName }}</strong>
                    <small>{{ recommendation.why }}</small>
                    <span>{{ recommendation.recommendation }}</span>
                  </span>
                  <span class="retention-score">{{ recommendation.score }}</span>
                </button>
                <div class="ai-recommendation-actions">
                  <button v-if="intelligenceActionResult[recommendation.clientId] === 'success'" class="retention-action-success" disabled>✓ Готово</button>
                  <button v-else-if="recommendation.action === 'offer_repeat_booking'" class="retention-offer-action" :disabled="!!intelligenceActionClientId" @click.stop="runIntelligenceAction(recommendation)">{{ intelligenceActionClientId === recommendation.clientId ? 'Подготавливаем…' : '✈ Предложить' }}</button>
                  <button v-else class="retention-smart-action" :disabled="!!intelligenceActionClientId" @click.stop="runIntelligenceAction(recommendation)">{{ intelligenceActionClientId === recommendation.clientId ? 'Подготавливаем…' : '↻ Запись' }}</button>
                </div>
              </div>
            </div>
            <div v-else class="ai-intelligence-empty">Сейчас нет клиентов, для которых Timio рекомендует действие.</div>

            <div v-if="retentionIntelligence?.recommendations.length" class="ai-intelligence-footer">
              <span>Показаны {{ Math.min(3, retentionIntelligence.recommendations.length) }} из {{ retentionIntelligence.recommendations.length }} рекомендаций.</span>
              <button class="btn-link" @click="openTab('campaigns')">Открыть retention →</button>
            </div>
          </div>

          <div v-if="reactivationStatus === 'ready' && reactivation?.summary.total" class="retention-card panel">
            <div class="retention-card-main">
              <div class="hero-kicker">RETENTION</div>
              <h2>{{ reactivation.summary.total }} клиентов пора вернуть</h2>
              <p>Timio нашёл клиентов, которые вышли за пределы их обычного интервала между визитами.</p>
              <div class="retention-stats">
                <button class="retention-stat" @click="startReactivationCampaign('due')">
                  <strong>{{ reactivation.summary.due }}</strong><span>пора напомнить</span>
                </button>
                <button class="retention-stat" @click="startReactivationCampaign('at_risk')">
                  <strong>{{ reactivation.summary.atRisk }}</strong><span>под угрозой</span>
                </button>
                <button class="retention-stat" @click="startReactivationCampaign('lost')">
                  <strong>{{ reactivation.summary.lost }}</strong><span>потеряны</span>
                </button>
              </div>
            </div>
            <div class="retention-list">
              <div v-for="client in reactivationPreview" :key="client.id" class="retention-client">
                <button class="retention-client-main" @click="openClientDetail(client.id)">
                  <span class="appointment-avatar">{{ initials(client.name) }}</span>
                  <span class="retention-client-copy"><strong>{{ client.name }}</strong><small>{{ client.reason }}</small></span>
                  <span class="retention-score">{{ client.score }}</span>
                </button>
                <div class="retention-actions">
          <button class="retention-smart-action" :disabled="smartRebookLoading" @click.stop="smartRebookClient(client.id)">↻ Запись</button>
          <button class="retention-offer-action" :disabled="retentionOfferLoading" @click.stop="prepareRetentionOffer(client.id)">✈ Предложить</button>
        </div>
              </div>
              <div v-if="reactivationStatus === 'loading'" class="text-dim">Анализируем клиентов…</div>
            </div>
          </div>

          <div class="dashboard-section-head">
            <div><h2>Ближайшие визиты</h2><p>Следующие записи, требующие внимания.</p></div>
            <button class="btn-link" @click="openTab('appointments')">Все записи →</button>
          </div>

          <div v-if="selectedDayAppointments.length === 0" class="empty-state panel dashboard-empty">
            <div class="empty-icon">✓</div>
            <div class="title">На сегодня свободно</div>
            <p>Поделитесь ссылкой на запись или добавьте визит вручную.</p>
          </div>
          <div v-for="a in selectedDayAppointments.slice(0, 6)" :key="a.id" class="appointment-list-row" style="cursor:pointer" @click="openAppointmentDetail(a)">
            <div class="time-column">{{ formatTime(a.startAt) }}</div>
            <div class="appointment-avatar">{{ initials(a.clientName || "?") }}</div>
            <div class="appointment-main">
              <button class="client-link" @click.stop="openClientDetail(a.clientId)">{{ a.clientName }}</button>
              <div>{{ a.serviceName }} <span>· {{ a.staffName }}</span></div>
            </div>
            <div class="appointment-price">{{ formatMoney(a.priceCents, a.currency) }}</div>
            <span class="badge" :class="`status-${a.status}`">{{ appointmentStatusLabel(a.status) }}</span>
          </div>

          <div class="dashboard-section-head compact-head">
            <div><h2>Состояние бизнеса</h2><p>Основные рабочие показатели.</p></div>
          </div>
          <div class="quick-grid">
            <button class="quick-card" @click="openTab('services')"><span class="quick-icon">◇</span><strong>{{ services.length }} услуг</strong><small>Каталог и цены</small></button>
            <button class="quick-card" @click="openTab('staff')"><span class="quick-icon">◍</span><strong>{{ staff.length }} сотрудников</strong><small>Команда и графики</small></button>
            <button class="quick-card" @click="openTab('analytics')"><span class="quick-icon">↗</span><strong>Аналитика</strong><small>Выручка и прибыль</small></button>
            <button class="quick-card" @click="openTab('campaigns')"><span class="quick-icon">✦</span><strong>Маркетинг</strong><small>Вернуть клиентов</small></button>
          </div>
        </div>

        <!-- Записи: колоночное расписание по сотрудникам (только предстоящие) -->
        <div v-else-if="tab === 'appointments'">
          <div class="schedule-toolbar">
            <div><h1>Расписание</h1><p>{{ formatDayTitle() }}</p></div>
            <div class="date-controls">
              <button class="btn-primary" @click="openCreateAppointment()">+ Новая запись</button>
              <button class="btn-secondary" @click="shiftDay(-1)">←</button>
              <button class="btn-secondary today-button" @click="todayKey = getBusinessToday(business?.timezone || 'Europe/Moscow')">Сегодня</button>
              <button class="btn-secondary" @click="shiftDay(1)">→</button>
            </div>
          </div>
          <div v-if="staff.length === 0" class="empty-state panel">
            <div class="title">Сначала добавьте сотрудников</div>
            <p>Расписание группируется по сотрудникам — добавьте хотя бы одного во вкладке «Сотрудники».</p>
          </div>
          <div v-else class="schedule-board">
            <div v-for="col in appointmentsByStaff" :key="col.staff.id" class="schedule-column">
              <div class="schedule-column-head" style="cursor: pointer" @click="openStaffDetail(col.staff.id)">
                <img v-if="col.staff.photoUrl" :src="col.staff.photoUrl" class="option-avatar" alt="" />
                <span v-else class="avatar-circle" :style="{ background: col.staff.colorHex }">{{ initials(col.staff.name) }}</span>
                <span class="schedule-column-name">{{ col.staff.name }}</span>
              </div>
              <div v-if="col.appointments.length === 0" class="schedule-empty">Нет записей</div>
              <div v-for="a in col.appointments" :key="a.id" class="appointment-card" @click="openAppointmentDetail(a)">
                <span class="appointment-time mono">{{ formatTime(a.startAt) }}</span>
                <div class="appointment-client" style="cursor: pointer; text-decoration: underline dotted" @click="openClientDetail(a.clientId)">
                  {{ a.clientName }}
                </div>
                <div class="appointment-service text-dim text-xs">{{ a.serviceName }}</div>
                <span class="badge mt-4" :class="`status-${a.status}`" style="margin-top: 8px">{{ appointmentStatusLabel(a.status) }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Клиенты -->
        <div v-else-if="tab === 'clients'" class="clients-page">
          <div class="dashboard-heading">
            <div><h1>Клиенты</h1><p>Вся история отношений с клиентами в одном месте.</p></div>
            <div class="client-count">{{ clients.length }} клиентов</div>
          </div>
          <div class="panel client-toolbar">
            <input v-model="clientSearch" type="search" placeholder="Поиск по имени, телефону или email…" />
          </div>
          <div v-if="filteredClients.length === 0" class="empty-state panel">
            <div class="empty-icon">◎</div><div class="title">Клиенты не найдены</div><p>Когда появятся записи, здесь будет собираться история клиентов.</p>
          </div>
          <div v-for="client in filteredClients" :key="client.id" class="client-row" @click="openClientDetail(client.id)">
            <div class="appointment-avatar">{{ initials(client.name || "?") }}</div>
            <div class="client-row-main"><strong>{{ client.name || 'Без имени' }}</strong><span>{{ client.phone || client.email || 'Контакты не указаны' }}</span></div>
            <div class="client-row-stat"><strong>{{ client.visits ?? 0 }}</strong><span>визитов</span></div>
            <div class="client-row-stat"><strong>{{ formatMoney(client.totalSpentCents ?? 0, 'RUB') }}</strong><span>потрачено</span></div>
            <span class="client-arrow">→</span>
          </div>
        </div>

        <!-- Архив: прошедшие/отменённые записи -->
        <div v-else-if="tab === 'archive'">
          <div v-if="archivedAppointments.length === 0" class="empty-state panel">
            <div class="title">Архив пуст</div>
            <p>Здесь появятся записи после того, как визит состоится или будет отменён.</p>
          </div>
          <div v-for="a in archivedAppointments" :key="a.id" class="data-row" style="cursor:pointer" @click="openAppointmentDetail(a)">
            <div style="display: flex; align-items: center; gap: 12px">
              <span class="avatar-circle" style="background: var(--accent)">{{ initials(a.clientName || "?") }}</span>
              <div>
                <div
                  style="font-weight: 600; font-size: 14px; cursor: pointer; text-decoration: underline dotted; display: inline-block"
                  @click.stop="openClientDetail(a.clientId)"
                >
                  {{ a.clientName }}
                </div>
                <div class="text-dim text-xs">{{ a.serviceName }} · {{ a.staffName }} · {{ formatDateTime(a.startAt) }}</div>
              </div>
            </div>
            <span class="badge" :class="`status-${a.status}`">{{ appointmentStatusLabel(a.status) }}</span>
          </div>
        </div>

        <!-- Услуги -->
        <div v-else-if="tab === 'services'">
          <div class="panel mt-4" style="margin-bottom: 20px">
            <p class="field-label" style="margin-bottom: 12px">Новая услуга</p>
            <div style="display: flex; gap: 16px; align-items: flex-start">
              <PhotoUpload v-model="newServicePhoto" shape="square" />
              <div style="flex: 1">
                <div class="field">
                  <input v-model="newServiceName" type="text" placeholder="Название услуги" />
                </div>
                <div style="display: flex; gap: 10px">
                  <div class="field" style="flex: 1">
                    <input v-model.number="newServiceDuration" type="number" placeholder="Минут" />
                  </div>
                  <div class="field" style="flex: 1">
                    <input v-model.number="newServicePrice" type="number" placeholder="Цена" />
                  </div>
                  <div class="field" style="width: 90px">
                    <select v-model="newServiceCurrency">
                      <option>RUB</option><option>USD</option><option>EUR</option><option>KZT</option><option>AMD</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>
            <button class="btn-secondary" :disabled="addingService" @click="addService">+ Добавить услугу</button>
          </div>

          <div v-if="services.length === 0" class="empty-state panel">
            <div class="title">Пока нет услуг</div>
            <p>Добавьте услугу выше, чтобы клиенты могли на неё записаться.</p>
          </div>
          <div v-for="s in services" :key="s.id" class="data-row">
            <div style="display: flex; align-items: center; gap: 12px">
              <img v-if="s.photoUrl" :src="s.photoUrl" class="option-photo" alt="" />
              <div>
                <div style="font-weight: 600; font-size: 14px">{{ s.name.ru || s.name.en }}</div>
                <div class="text-dim text-xs">{{ s.durationMin }} мин</div>
              </div>
            </div>
            <div style="display: flex; align-items: center; gap: 12px">
              <span class="mono text-dim" style="font-size: 13px">{{ formatMoney(s.priceCents, s.currency) }}</span>
              <button class="btn-danger-text" @click="removeService(s.id)">Удалить</button>
            </div>
          </div>
        </div>

        <!-- Сотрудники -->
        <div v-else-if="tab === 'staff'">
          <div class="panel mt-4" style="margin-bottom: 20px">
            <p class="field-label" style="margin-bottom: 12px">Новый сотрудник</p>
            <div style="display: flex; gap: 16px; align-items: flex-start; margin-bottom: 14px">
              <PhotoUpload v-model="newStaffPhoto" shape="circle" />
              <div style="flex: 1">
                <div class="field">
                  <input v-model="newStaffName" type="text" placeholder="Имя сотрудника" />
                </div>
                <p class="field-label">Услуги, которые он оказывает</p>
                <div style="display: flex; flex-wrap: wrap; gap: 8px">
                  <span
                    v-for="s in services"
                    :key="s.id"
                    class="badge"
                    :style="newStaffServiceIds.includes(s.id) ? 'background:var(--accent-dim);color:var(--accent);cursor:pointer' : 'cursor:pointer'"
                    @click="toggleServiceForStaff(s.id)"
                  >
                    {{ s.name.ru || s.name.en }}
                  </span>
                </div>
              </div>
            </div>
            <button class="btn-secondary" :disabled="addingStaff" @click="addStaff">+ Добавить сотрудника</button>
          </div>

          <div v-if="staff.length === 0" class="empty-state panel">
            <div class="title">Пока нет сотрудников</div>
          </div>
          <div v-for="s in staff" :key="s.id" class="panel mt-4" style="padding: 0; margin-bottom: 10px; overflow: hidden">
            <div class="data-row" style="border: none; margin-bottom: 0; cursor: pointer" @click="toggleExpand(s)">
              <div style="display: flex; align-items: center; gap: 10px">
                <img v-if="s.photoUrl" :src="s.photoUrl" class="option-avatar" alt="" />
                <span v-else class="avatar-circle" :style="{ background: s.colorHex }">{{ initials(s.name) }}</span>
                <span style="font-weight: 600; font-size: 14px">{{ s.name }}</span>
                <span class="text-dim text-xs" v-if="s.commissionPercentBp">{{ s.commissionPercentBp / 100 }}% комиссия</span>
              </div>
              <div style="display: flex; align-items: center; gap: 14px">
                <button class="btn-link" @click.stop="openStaffDetail(s.id)">Клиенты</button>
                <span class="text-dim text-xs">{{ expandedStaffId === s.id ? "Свернуть ▲" : "Расписание и фото ▼" }}</span>
                <button class="btn-danger-text" @click.stop="removeStaff(s.id)">Удалить</button>
              </div>
            </div>

            <div v-if="expandedStaffId === s.id" style="padding: 16px; border-top: 1px solid var(--border)">
              <div style="display: flex; gap: 20px; align-items: flex-start; margin-bottom: 18px">
                <PhotoUpload :model-value="s.photoUrl" shape="circle" @update:model-value="(v) => saveStaffPhoto(s, v)" />
                <div style="flex: 1">
                  <label class="field-label">Комиссия сотрудника (% с каждой услуги)</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    v-model.number="staffDrafts[s.id].commissionPercent"
                    style="max-width: 140px"
                  />
                </div>
              </div>

              <p class="field-label" style="margin-bottom: 10px">Окно приёма сотрудника</p>
              <WorkingHoursEditor
                v-model="staffDrafts[s.id].workingHours"
                allow-inherit
                v-model:inherited="staffDrafts[s.id].inherited"
              />

              <button class="btn-primary mt-4" :disabled="staffDrafts[s.id].saving" @click="saveStaffSchedule(s)">
                {{ staffDrafts[s.id].saving ? "…" : "Сохранить" }}
              </button>
            </div>
          </div>
        </div>

                <!-- Шаблоны уведомлений -->
        <div v-else-if="tab === 'templates'">
          <div v-if="templatesStatus === 'loading'" class="text-dim">Загрузка…</div>
          <div v-else-if="templatesStatus === 'error'" class="error-banner">Не удалось загрузить шаблоны.</div>

          <template v-else>
            <p class="page-subtitle" style="margin-bottom:6px;font-weight:700;color:var(--text)">Шаблоны уведомлений</p>
            <p class="helper-text" style="margin-bottom:20px">
              Доступные переменные: <code>{{clientName}}</code>, <code>{{serviceName}}</code>,
              <code>{{staffName}}</code>, <code>{{date}}</code>, <code>{{time}}</code>
            </p>

            <div v-for="tmpl in templates" :key="tmpl.type" class="panel" style="margin-bottom:14px">
              <p class="field-label" style="margin-bottom:12px">{{ tmpl.type }}</p>

              <div v-for="locale in LOCALES" :key="locale" class="field" style="margin-bottom:8px">
                <label class="field-label" style="font-size:11px;text-transform:uppercase;letter-spacing:.04em">
                  {{ locale }}
                </label>
                <textarea
                  v-model="templateDrafts[tmpl.type][locale]"
                  rows="2"
                  style="width:100%;resize:vertical;font-size:13px"
                />
              </div>

              <button
                class="btn-secondary"
                style="margin-top:8px"
                :disabled="templateSaving[tmpl.type]"
                @click="saveTemplate(tmpl.type)"
              >
                {{ templateSaving[tmpl.type] ? "…" : "Сохранить" }}
              </button>
            </div>
          </template>
        </div>

        <!-- Аналитика -->
        <div v-else-if="tab === 'analytics'">
          <div v-if="analyticsStatus === 'loading'" class="text-dim">Считаем…</div>

          <div v-else-if="analyticsStatus === 'error'" class="error-banner">Не удалось загрузить аналитику.</div>

          <template v-else-if="analytics">
            <div class="flex-between mt-4" style="margin-bottom: 20px">
              <p class="page-subtitle" style="margin: 0; font-weight: 700; color: var(--text)">Сводка</p>
              <button class="btn-secondary" @click="exportXlsx">⭳ Скачать .xlsx отчёт</button>
            </div>

            <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 20px">
              <div class="stat-card">
                <div class="stat-label">Выручка</div>
                <div class="stat-value">{{ formatMoney(analytics.summary.totalRevenueCents) }}</div>
              </div>
              <div class="stat-card">
                <div class="stat-label">Налог ({{ analytics.summary.taxPercent }}%)</div>
                <div class="stat-value">−{{ formatMoney(analytics.summary.taxCents) }}</div>
              </div>
              <div class="stat-card">
                <div class="stat-label">Комиссии сотрудников</div>
                <div class="stat-value">−{{ formatMoney(analytics.summary.totalCommissionCents) }}</div>
              </div>
              <div class="stat-card" style="border-color: var(--accent)">
                <div class="stat-label">Чистая прибыль</div>
                <div class="stat-value" style="color: var(--accent)">{{ formatMoney(analytics.summary.netProfitCents) }}</div>
              </div>
            </div>

            <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 28px">
              <div class="stat-card">
                <div class="stat-label">Записей</div>
                <div class="stat-value">{{ analytics.summary.totalAppointments }}</div>
              </div>
              <div class="stat-card">
                <div class="stat-label">Клиентов</div>
                <div class="stat-value">{{ analytics.summary.totalClients }}</div>
              </div>
              <div class="stat-card">
                <div class="stat-label">Средний чек</div>
                <div class="stat-value">{{ formatMoney(analytics.summary.avgCheckCents) }}</div>
              </div>
              <div class="stat-card">
                <div class="stat-label">Неявки / Отмены</div>
                <div class="stat-value">{{ analytics.summary.noShowCount }} / {{ analytics.summary.cancelledCount }}</div>
              </div>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px">
              <div class="panel">
                <p class="field-label" style="margin-bottom: 14px">Выручка по дням</p>
                <BarChart :data="revenueByDayChart" :format-value="(v) => v.toFixed(0)" />
              </div>
              <div class="panel">
                <p class="field-label" style="margin-bottom: 14px">Выручка по услугам</p>
                <BarChart :data="revenueByServiceChart" :format-value="(v) => v.toFixed(0)" color="var(--success)" />
              </div>
              <div class="panel" style="grid-column: 1 / -1">
                <p class="field-label" style="margin-bottom: 14px">Выручка по сотрудникам</p>
                <BarChart :data="revenueByStaffChart" :format-value="(v) => v.toFixed(0)" />
              </div>
            </div>
          </template>
        </div>

                <!-- Команда бизнеса -->
        <div v-else-if="tab === 'team'">
          <div class="panel" style="max-width:480px; margin-bottom:20px">
            <p class="field-label" style="margin-bottom:12px">Добавить участника</p>
            <p class="helper-text" style="margin-bottom:12px">
              Пользователь должен быть уже зарегистрирован в Timio.
            </p>
            <div v-if="memberError" class="error-banner">{{ memberError }}</div>
            <div class="field">
              <label class="field-label">Email</label>
              <input v-model="newMemberEmail" type="email" placeholder="colleague@example.com" />
            </div>
            <div class="field">
              <label class="field-label">Роль</label>
              <select v-model="newMemberRole">
                <option value="administrator">Администратор</option>
                <option value="manager">Менеджер</option>
                <option value="employee">Сотрудник</option>
              </select>
            </div>
            <button class="btn-secondary" :disabled="addingMember" @click="addMember">
              {{ addingMember ? "…" : "+ Добавить" }}
            </button>
          </div>

          <div v-if="membersStatus === 'loading'" class="text-dim">Загрузка…</div>
          <div v-else-if="membersStatus === 'error'" class="error-banner">Не удалось загрузить команду.</div>
          <div v-else>
            <div v-for="m in members" :key="m.id" class="data-row">
              <div style="display:flex; align-items:center; gap:12px">
                <span class="avatar-circle" style="background:var(--accent)">{{ initials(m.name) }}</span>
                <div>
                  <div style="font-weight:600; font-size:14px">{{ m.name }}</div>
                  <div class="text-dim text-xs">{{ m.email }}</div>
                </div>
              </div>
              <div style="display:flex; align-items:center; gap:12px">
                <span class="badge">{{ m.role }}</span>
                <button
                  v-if="m.role !== 'owner'"
                  class="btn-danger-text"
                  @click="removeMember(m.id)"
                >Удалить</button>
              </div>
            </div>
          </div>
        </div>

        <!-- Подписка -->
        <div v-else-if="tab === 'billing'">
          <div v-if="billingStatus === 'loading'" class="text-dim">Загрузка…</div>
          <div v-else-if="billingStatus === 'error'" class="error-banner">Не удалось загрузить подписку.</div>

          <template v-else>
            <div v-if="billingError" class="error-banner">{{ billingError }}</div>

            <!-- Подписки ещё нет - выбор тарифа -->
            <div v-if="!subscription" class="panel" style="max-width: 480px">
              <p class="field-label" style="margin-bottom: 12px">Выберите тариф</p>
              <div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px">
                <label class="option" style="cursor: pointer">
                  <input type="radio" value="basic" v-model="selectedPlan" style="margin-right: 10px; width: auto" />
                  <div>
                    <div style="font-weight: 700">Базовый</div>
                    <div class="text-dim text-xs">До 5 сотрудников · 1490 ₽/мес</div>
                  </div>
                </label>
                <label class="option" style="cursor: pointer">
                  <input type="radio" value="business" v-model="selectedPlan" style="margin-right: 10px; width: auto" />
                  <div>
                    <div style="font-weight: 700">Бизнес</div>
                    <div class="text-dim text-xs">2490 ₽/мес + 390 ₽ за каждого сотрудника сверх 5</div>
                  </div>
                </label>
              </div>
              <p class="helper-text" style="margin-bottom: 16px">
                14 дней бесплатно. Карта привязывается, но списание произойдёт только после окончания пробного периода.
              </p>
              <button class="btn-primary" :disabled="startingTrial" @click="handleStartTrial">
                {{ startingTrial ? "…" : "Начать пробный период" }}
              </button>
            </div>

            <!-- Подписка есть -->
            <div v-else style="max-width: 480px">
              <div class="panel" style="margin-bottom: 20px">
                <div class="flex-between" style="margin-bottom: 14px">
                  <div>
                    <div style="font-weight: 900; font-size: 18px">{{ subscriptionPlanLabel[subscription.plan] }}</div>
                    <div class="text-dim text-xs">Тариф</div>
                  </div>
                  <span
                    class="badge"
                    :style="
                      subscription.status === 'active'
                        ? 'background:var(--success-dim);color:var(--success)'
                        : subscription.status === 'trial'
                        ? 'background:var(--accent-dim);color:var(--accent)'
                        : ''
                    "
                  >
                    {{ subscriptionStatusLabel[subscription.status] }}
                  </span>
                </div>

                <div v-if="subscription.status === 'trial'" class="text-dim" style="font-size: 13px; margin-bottom: 14px">
                  Пробный период закончится через <b style="color: var(--text)">{{ daysLeft(subscription.trialEndsAt) }} дн.</b>
                  <template v-if="!subscription.yookassaPaymentMethodId"> — карта ещё не привязана.</template>
                  <template v-else> — карта привязана, автосписание произойдёт автоматически.</template>
                </div>
                <div v-else-if="subscription.status === 'active' && subscription.currentPeriodEndsAt" class="text-dim" style="font-size: 13px; margin-bottom: 14px">
                  Следующее списание: {{ new Date(subscription.currentPeriodEndsAt).toLocaleDateString("ru-RU") }}
                </div>

                <button
                  v-if="subscription.status === 'trial' && !subscription.yookassaPaymentMethodId"
                  class="btn-primary"
                  :disabled="bindingCard"
                  @click="handleStartCardBinding"
                >
                  {{ bindingCard ? "…" : "Привязать карту" }}
                </button>
                <button
                  v-if="subscription.status === 'trial' || subscription.status === 'active'"
                  class="btn-secondary mt-4"
                  style="width: 100%"
                  :disabled="cancelling"
                  @click="handleCancelSubscription"
                >
                  {{ cancelling ? "…" : "Отменить подписку" }}
                </button>
              </div>

              <!-- Промокод: применяется к первому месяцу оплаты -->
              <div v-if="subscription.status === 'trial'" class="panel">
                <p class="field-label" style="margin-bottom: 10px">Промокод на первый месяц</p>
                <div style="display: flex; gap: 8px">
                  <input v-model="promoCodeInput" type="text" placeholder="WELCOME20" style="flex: 1" />
                  <button class="btn-secondary" @click="checkPromoCode">Проверить</button>
                </div>
                <p v-if="promoCheckStatus === 'valid'" class="text-xs" style="color: var(--success); margin-top: 8px">
                  ✓ {{ promoDiscountLabel }}
                </p>
                <p v-else-if="promoCheckStatus === 'invalid'" class="text-xs" style="color: var(--accent); margin-top: 8px">
                  Промокод не найден или недействителен
                </p>
              </div>
            </div>
          </template>
        </div>

        <!-- Маркетинговые рассылки -->
<div v-else-if="tab === 'campaigns'">

  <!-- Retention Dashboard -->
  <div class="panel retention-dashboard" style="margin-bottom: 24px">
    <div class="retention-dashboard-head">
      <div>
        <p class="field-label" style="margin-bottom: 6px">RETENTION</p>
        <h2>Возврат клиентов</h2>
        <p class="helper-text" style="margin: 0">Что Timio уже вернул и сколько денег это принесло.</p>
      </div>
      <div class="retention-periods">
        <button v-for="period in ([7, 30, 90] as const)" :key="period" class="chip" :class="{ active: retentionDashboardDays === period }" :disabled="retentionDashboardStatus === 'loading'" @click="loadRetentionDashboard(period)">
          {{ period }} дней
        </button>
      </div>
    </div>

    <div v-if="retentionDashboardStatus === 'loading'" class="text-dim" style="padding: 20px 0">Считаем результат…</div>
    <div v-else-if="retentionDashboardStatus === 'error'" class="error-banner">Не удалось загрузить retention-аналитику.</div>
    <template v-else-if="retentionDashboard">
      <div class="retention-kpi-grid">
        <div class="retention-kpi">
          <span>Клиентов пора вернуть</span>
          <strong>{{ retentionDashboard.reactivation.total }}</strong>
          <small>{{ retentionDashboard.reactivation.due }} уже пора · {{ retentionDashboard.reactivation.atRisk }} под угрозой</small>
        </div>
        <div class="retention-kpi">
          <span>Контактов</span>
          <strong>{{ retentionDashboard.summary.delivered }}</strong>
          <small>{{ retentionDashboard.summary.campaigns }} кампаний за период</small>
        </div>
        <div class="retention-kpi">
          <span>Записались</span>
          <strong>{{ retentionDashboard.summary.booked }}</strong>
          <small>{{ retentionDashboard.summary.bookingConversionPercent }}% от получивших сообщение</small>
        </div>
        <div class="retention-kpi retention-kpi-money">
          <span>Возвращённая выручка</span>
          <strong>{{ formatMoney(retentionDashboard.summary.revenueCents, 'RUB') }}</strong>
          <small>{{ retentionDashboard.summary.completed }} завершённых визита</small>
        </div>
      </div>

      <div class="retention-funnel">
        <div><span>Отправлено</span><strong>{{ retentionDashboard.summary.recipients }}</strong></div>
        <div><span>Доставлено</span><strong>{{ retentionDashboard.summary.delivered }}</strong></div>
        <div><span>Записались</span><strong>{{ retentionDashboard.summary.booked }}</strong></div>
        <div><span>Пришли</span><strong>{{ retentionDashboard.summary.completed }}</strong></div>
        <div><span>Конверсия в визит</span><strong>{{ retentionDashboard.summary.completionConversionPercent }}%</strong></div>
      </div>

      <div class="retention-trend" v-if="retentionDashboard.byDay.length">
        <div class="retention-trend-head">
          <span>Результат по дням отправки</span>
          <small>Атрибуция: до {{ retentionDashboard.attributionWindowDays }} дней после сообщения</small>
        </div>
        <div v-for="day in retentionDashboard.byDay.slice(-7)" :key="day.date" class="retention-trend-row">
          <span>{{ day.date }}</span>
          <span>{{ day.sent }} отправлено</span>
          <span>{{ day.booked }} записались</span>
          <span>{{ day.completed }} пришли</span>
          <strong>{{ formatMoney(day.revenueCents, 'RUB') }}</strong>
        </div>
      </div>

      <div class="retention-dashboard-footer">
        <span>Без стоимости каналов это не ROI: здесь показана именно атрибутированная выручка от retention.</span>
        <button class="btn-secondary compact" @click="startReactivationCampaign('all')">Вернуть клиентов →</button>
      </div>
    </template>
  </div>

  <!-- Retention Engine → Campaign Engine -->
  <div class="panel campaign-retention-card" style="margin-bottom: 24px">
    <div>
      <p class="field-label" style="margin-bottom: 6px">RETENTION ENGINE</p>
      <h2>Вернуть клиента</h2>
      <p class="helper-text" style="margin: 0 0 14px">Timio находит клиентов, которые отклоняются от привычного интервала визитов, и превращает сегмент в готовую рассылку.</p>
    </div>

    <div class="retention-filter-row">
      <button v-for="seg in (['all', 'due', 'at_risk', 'lost'] as ReactivationSegment[])" :key="seg" class="chip" :class="{ active: reactivationSegment === seg }" @click="startReactivationCampaign(seg)">
        {{ reactivationCampaignLabels[seg] }}
        <strong style="margin-left: 5px">{{ seg === 'all' ? (reactivation?.summary.total ?? 0) : seg === 'due' ? (reactivation?.summary.due ?? 0) : seg === 'at_risk' ? (reactivation?.summary.atRisk ?? 0) : (reactivation?.summary.lost ?? 0) }}</strong>
      </button>
    </div>

    <div v-if="reactivationStatus === 'ready' && reactivation?.clients.length" class="retention-client-grid" style="margin-top: 14px">
      <div v-for="client in reactivation.clients.slice(0, 6)" :key="client.id" class="retention-client retention-client-large">
        <button class="retention-client-main" @click="openClientDetail(client.id)">
          <span class="retention-client-copy"><strong>{{ client.name }}</strong><small>{{ client.reason }}</small></span>
          <span class="retention-score">{{ client.score }}</span>
        </button>
        <div class="retention-actions">
          <button class="retention-smart-action" :disabled="smartRebookLoading" @click.stop="smartRebookClient(client.id)">↻ Запись</button>
          <button class="retention-offer-action" :disabled="retentionOfferLoading" @click.stop="prepareRetentionOffer(client.id)">✈ Предложить</button>
        </div>
      </div>
    </div>

    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:16px;flex-wrap:wrap">
      <span class="helper-text">Повторная реактивация одного клиента блокируется на {{ 14 }} дней.</span>
      <span v-if="smartRebookHint" class="helper-text" style="color:var(--success)">{{ smartRebookHint }}</span>
      <button class="btn-primary" @click="startReactivationCampaign(reactivationSegment)">Создать рассылку</button>
    </div>
  </div>

  <!-- Форма новой рассылки -->
  <div class="panel" style="max-width: 560px; margin-bottom: 24px">
    <p class="field-label" style="margin-bottom: 14px">Новая рассылка</p>

    <div v-if="campaignError" class="error-banner">{{ campaignError }}</div>
    <div v-if="campaignSuccess" class="helper-text" style="color: var(--success); margin-bottom: 12px">
      ✓ {{ campaignSuccess }}
    </div>

    <!-- Название -->
    <div class="field">
      <label class="field-label">Название (для истории)</label>
      <input v-model="campaignDraft.name" type="text" placeholder="Акция май, возврат клиентов…" />
    </div>

    <!-- Сегмент -->
    <div class="field">
      <label class="field-label">Кому отправить</label>
      <select v-model="campaignDraft.filters.segment" @change="campaignPreview = null">
        <option v-for="(label, seg) in segmentLabels" :key="seg" :value="seg">{{ label }}</option>
      </select>
    </div>

    <div v-if="campaignDraft.filters.segment === 'reactivation'" class="field">
      <label class="field-label">Тип возврата</label>
      <select v-model="campaignDraft.filters.reactivationSegment" @change="campaignPreview = null">
        <option v-for="(label, seg) in reactivationCampaignLabels" :key="seg" :value="seg">{{ label }}</option>
      </select>
    </div>

    <div v-if="campaignDraft.filters.segment === 'reactivation'" class="field">
      <label class="field-label">Канал</label>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button type="button" class="chip active" @click="campaignDraft.channel = 'telegram'">Telegram</button>
        <button type="button" class="chip" disabled title="Подключим в следующем этапе">WhatsApp · скоро</button>
        <button type="button" class="chip" disabled title="Подключим в следующем этапе">SMS · скоро</button>
        <button type="button" class="chip" disabled title="Подключим в следующем этапе">Email · скоро</button>
      </div>
      <p class="helper-text" style="margin-top:6px">Сейчас отправка реально работает только через Telegram.</p>
    </div>

    <!-- Доп. параметры сегмента -->
    <div v-if="campaignDraft.filters.segment === 'inactive'" class="field">
      <label class="field-label">Не приходили более (дней)</label>
      <input
        v-model.number="campaignDraft.filters.inactiveDays"
        type="number"
        min="7"
        step="1"
        style="max-width: 120px"
        placeholder="30"
        @change="campaignPreview = null"
      />
    </div>

    <div v-if="campaignDraft.filters.segment === 'by_tag'" class="field">
      <label class="field-label">Тег</label>
      <input
        v-model="campaignDraft.filters.tag"
        type="text"
        placeholder="vip, скидка…"
        @change="campaignPreview = null"
      />
    </div>

    <div v-if="campaignDraft.filters.segment === 'top_clients'" class="field">
      <label class="field-label">Минимум визитов</label>
      <input
        v-model.number="campaignDraft.filters.visitsGte"
        type="number"
        min="1"
        style="max-width: 120px"
        placeholder="5"
        @change="campaignPreview = null"
      />
    </div>

    <!-- AI Message Generator -->
    <div class="ai-message-generator">
      <div class="ai-message-head">
        <div>
          <p class="field-label" style="margin-bottom:4px">AI MESSAGE GENERATOR</p>
          <strong>Пусть Timio подготовит текст</strong>
          <p class="helper-text" style="margin:3px 0 0">Генерация только предлагает текст. Отправка всё равно требует вашего действия.</p>
        </div>
        <span class="ai-provider-badge">{{ aiMessageProvider === 'yandexgpt' ? 'YandexGPT' : aiMessageProvider === 'fallback' ? 'Fallback' : 'AI' }}</span>
      </div>
      <div class="ai-message-controls">
        <select v-model="aiMessageTone" aria-label="Тон сообщения">
          <option value="friendly">Дружелюбный</option>
          <option value="warm">Тёплый</option>
          <option value="professional">Профессиональный</option>
          <option value="short">Короткий</option>
        </select>
        <select v-model="aiMessageLanguage" aria-label="Язык сообщения">
          <option value="ru">Русский</option>
          <option value="en">English</option>
          <option value="es">Español</option>
          <option value="it">Italiano</option>
          <option value="fr">Français</option>
          <option value="kk">Қазақша</option>
          <option value="hy">Հայերեն</option>
        </select>
        <button type="button" class="btn-secondary" :disabled="aiMessageLoading" @click="generateCampaignMessage">
          {{ aiMessageLoading ? 'Генерируем…' : '✦ Сгенерировать' }}
        </button>
      </div>
      <div v-if="aiMessageError" class="error-banner" style="margin-top:10px">{{ aiMessageError }}</div>
      <p v-if="aiMessageProvider === 'fallback'" class="helper-text" style="margin:8px 0 0">YandexGPT пока не подключён — Timio использовал безопасный локальный шаблон. Добавим ключ позже без изменения UI.</p>
    </div>

    <!-- Текст сообщения -->
    <div class="field">
      <label class="field-label">Текст сообщения</label>
      <textarea
        v-model="campaignDraft.message"
        rows="4"
        style="width: 100%; resize: vertical"
        placeholder="Привет, {{clientName}}! Мы скучаем — возвращайтесь, для вас скидка 10% 🎁"
      />
      <p class="helper-text" style="margin-top: 4px">
        Переменные: <code>{{clientName}}</code>, <code>{{businessName}}</code>
      </p>
    </div>

    <!-- Превью получателей -->
    <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px">
      <button class="btn-secondary" :disabled="previewLoading" @click="previewCampaign">
        {{ previewLoading ? "…" : "Посмотреть получателей" }}
      </button>
      <span v-if="campaignPreview" class="text-dim" style="font-size: 13px">
        Получат:
        <b style="color: var(--text)">{{ campaignPreview.count }}</b> клиентов
        <template v-if="campaignPreview.excludedWithoutChannel">
          · {{ campaignPreview.excludedWithoutChannel }} без Telegram исключены
        </template>
        <template v-if="campaignPreview.sample.length">
          ({{ campaignPreview.sample.map(s => s.name).join(", ") }}{{ campaignPreview.count > 5 ? "…" : "" }})
        </template>
        <template v-else-if="campaignPreview.count === 0">
          — никто не попал в выборку
        </template>
      </span>
    </div>

    <button
      class="btn-primary"
      :disabled="campaignSending || !campaignDraft.name.trim() || !campaignDraft.message.trim()"
      @click="sendCampaign"
    >
      {{ campaignSending ? "Отправляем…" : "Отправить рассылку" }}
    </button>
  </div>

    <div v-if="selectedCampaignPerformance" class="panel campaign-performance-panel">
      <div class="client-section-head">
        <div><span class="client-section-kicker">Результат</span><h3>{{ selectedCampaignPerformance.campaign.name }}</h3></div>
        <button class="btn-secondary compact" @click="selectedCampaignPerformance = null">Закрыть</button>
      </div>
      <div class="campaign-attribution-note">Атрибуция: запись считается результатом, если она создана после отправки сообщения и в течение {{ selectedCampaignPerformance.attribution.windowDays }} дней.</div>
      <div class="campaign-performance-grid">
        <div><strong>{{ selectedCampaignPerformance.summary.recipients }}</strong><span>получателей</span></div>
        <div><strong>{{ selectedCampaignPerformance.summary.delivered }}</strong><span>доставлено</span></div>
        <div><strong>{{ selectedCampaignPerformance.summary.booked }}</strong><span>записались</span></div>
        <div><strong>{{ selectedCampaignPerformance.summary.completed }}</strong><span>пришли</span></div>
        <div><strong>{{ selectedCampaignPerformance.summary.bookingConversionPercent }}%</strong><span>конверсия в запись</span></div>
        <div><strong>{{ formatMoney(selectedCampaignPerformance.summary.revenueCents, 'RUB') }}</strong><span>выручка</span></div>
      </div>
    </div>
    <div v-if="campaignPerformanceError" class="error-banner">{{ campaignPerformanceError }}</div>

    <!-- История рассылок -->
    <p class="page-subtitle" style="margin-bottom: 12px; font-weight: 700; color: var(--text)">
      История рассылок
    </p>

    <div v-if="campaignsStatus === 'loading'" class="text-dim">Загрузка…</div>
    <div v-else-if="campaignsStatus === 'error'" class="error-banner">Не удалось загрузить историю.</div>

    <div v-else-if="campaignsList.length === 0" class="empty-state panel">
      <div class="title">Рассылок пока не было</div>
      <p>Создайте первую рассылку выше — она уйдёт клиентам в Telegram.</p>
    </div>

    <div v-for="camp in campaignsList" :key="camp.id" class="data-row">
      <div>
        <div style="font-weight: 600; font-size: 14px">{{ camp.name }}</div>
        <div class="text-dim text-xs">
          {{ camp.filters.segment === 'reactivation'
            ? `Возврат · ${reactivationCampaignLabels[camp.filters.reactivationSegment ?? 'all']}`
            : segmentLabels[camp.filters.segment as CampaignSegment] }} ·
          {{ camp.channel }} · {{ camp.sentAt ? formatDateTime(camp.sentAt) : "—" }}
        </div>
        <div class="text-dim text-xs" style="margin-top: 2px; font-style: italic">
          {{ camp.message.slice(0, 60) }}{{ camp.message.length > 60 ? "…" : "" }}
        </div>
      </div>
      <div style="text-align: right">
        <button class="btn-secondary compact" :disabled="campaignPerformanceLoading" @click="loadCampaignPerformance(camp.id)">
          {{ campaignPerformanceLoading ? "…" : "Результат" }}
        </button>
        <span
          class="badge"
          :style="camp.status === 'sent'
            ? 'background:var(--success-dim);color:var(--success)'
            : camp.status === 'failed'
            ? 'background:var(--danger-dim);color:var(--danger)'
            : ''"
        >
          {{ formatCampaignStatus(camp.status) }}
        </span>
        <div class="text-dim text-xs" style="margin-top: 4px">
          {{ camp.sentCount }} / {{ camp.recipientCount }} доставлено
        </div>
      </div>
    </div>

  </div>

        <!-- Настройки -->
        <div v-else-if="tab === 'settings'">
          <AccountSecurity />
          <div style="height: 20px"></div>
          <div class="panel" style="max-width: 680px; margin-bottom: 20px">
            <div style="display:flex;justify-content:space-between;gap:16px;align-items:flex-start;margin-bottom:8px">
              <div>
                <p class="field-label" style="margin-bottom: 6px">Уведомления клиентам · Telegram</p>
                <p class="helper-text" style="margin:0">Реальный канал доставки. Timio отправляет сообщения через Telegram Bot API, а не имитирует отправку.</p>
              </div>
              <span class="badge" :style="telegramConnected ? 'color:var(--success);background:var(--success-dim)' : ''">{{ telegramConnected ? 'Подключён' : 'Не подключён' }}</span>
            </div>

            <p class="helper-text" style="margin: 12px 0 14px">Создайте бота через <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" style="color: var(--accent)">@BotFather</a> и вставьте токен ниже. После подключения клиенту нужно один раз открыть бота по персональной ссылке — тогда Timio получит его Telegram chat ID.</p>

            <div v-if="telegramError" class="error-banner">{{ telegramError }}</div>
            <div v-if="telegramWarning" class="helper-text" style="color: var(--accent); margin-bottom: 12px">⚠ {{ telegramWarning }}</div>

            <div v-if="telegramConnected" class="data-row">
              <div>
                <div style="font-weight: 700">@{{ telegramBotUsername }}</div>
                <div class="text-dim text-xs">Bot API подключён · webhook {{ telegramWarning ? 'требует внимания' : 'настроен' }}</div>
              </div>
              <button class="btn-danger-text" @click="disconnectTelegram">Отключить</button>
            </div>
            <div v-else style="display: flex; gap: 8px">
              <input v-model="telegramTokenInput" type="password" autocomplete="off" placeholder="123456:ABC-DEF... (токен от BotFather)" style="flex: 1" />
              <button class="btn-secondary" :disabled="telegramConnecting" @click="connectTelegram">
                {{ telegramConnecting ? "Проверяем…" : "Подключить" }}
              </button>
            </div>

            <div v-if="telegramConnected" style="margin-top: 18px; padding-top: 18px; border-top: 1px solid var(--border)">
              <p class="field-label" style="margin-bottom: 6px">Проверка доставки</p>
              <p class="helper-text" style="margin-bottom: 10px">Выберите клиента, у которого уже подключён Telegram, и Timio отправит ему настоящее тестовое сообщение.</p>
              <div style="display:flex;gap:8px;align-items:center">
                <select v-model="telegramTestClientId" style="flex:1">
                  <option value="">Выберите клиента</option>
                  <option v-for="client in telegramClients" :key="client.id" :value="client.id">{{ client.name }} · Telegram подключён</option>
                </select>
                <button class="btn-secondary" :disabled="telegramTesting || !telegramTestClientId" @click="sendTelegramTest">{{ telegramTesting ? "Отправляем…" : "Отправить тест" }}</button>
              </div>
              <p v-if="telegramTestMessage" class="helper-text" style="margin:10px 0 0">{{ telegramTestMessage }}</p>
              <p v-if="telegramClients.length === 0" class="helper-text" style="margin:10px 0 0">Пока нет клиентов с подключённым Telegram. Откройте публичную страницу записи и подключите Telegram у клиента.</p>
            </div>
          </div>

          <div class="panel" style="max-width: 680px; margin-bottom: 20px">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:12px">
              <div>
                <p class="field-label" style="margin-bottom: 4px">История доставки</p>
                <p class="helper-text" style="margin:0">Последние 50 попыток отправки напоминаний и системных уведомлений.</p>
              </div>
              <button class="btn-link" @click="loadNotificationLogs">Обновить</button>
            </div>
            <div v-if="notificationLogsLoading" class="helper-text">Загружаем историю…</div>
            <div v-else-if="notificationLogs.length === 0" class="helper-text">Пока нет попыток доставки.</div>
            <div v-else>
              <div v-for="log in notificationLogs" :key="log.id" class="data-row" style="align-items:flex-start">
                <div style="min-width:0">
                  <div style="font-weight:700">{{ log.clientName }} · {{ log.channel }}</div>
                  <div class="text-dim text-xs">{{ formatNotificationEvent(log.event) }} · {{ formatNotificationLogDate(log.sentAt || log.scheduledAt) }}</div>
                  <div v-if="log.error" class="text-dim text-xs" style="margin-top:4px">{{ log.error }}</div>
                </div>
                <span class="badge" :style="notificationLogStyle(log.status)">{{ formatNotificationStatus(log.status) }}</span>
              </div>
            </div>
          </div>

          <div class="panel" style="max-width: 900px; margin-bottom: 20px">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:16px">
              <div>
                <p class="field-label" style="margin-bottom: 6px">Автоматизация уведомлений</p>
                <p class="helper-text" style="margin:0">Здесь задаётся политика доставки. Timio пробует каналы по порядку слева направо и переходит к следующему, если текущий недоступен или провайдер вернул ошибку.</p>
              </div>
              <button class="btn-secondary" :disabled="notificationSettingsSaving" @click="saveNotificationSettings">{{ notificationSettingsSaving ? "Сохраняем…" : "Сохранить" }}</button>
            </div>
            <div style="display:grid;gap:10px">
              <div v-for="event in notificationEvents" :key="event.event" class="data-row" style="display:block">
                <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
                  <strong>{{ event.label }}</strong>
                  <label style="display:flex;align-items:center;gap:8px;font-size:13px"><input type="checkbox" v-model="notificationSettings[event.event].enabled" /> Включено</label>
                </div>
                <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px">
                  <button v-for="channel in event.channels" :key="channel" type="button" class="chip" :class="{ active: notificationSettings[event.event].channels.includes(channel) }" @click="toggleNotificationChannel(event.event, channel)">{{ notificationChannelLabels[channel] }}</button>
                </div>
              </div>
            </div>
            <p v-if="notificationSettingsMessage" class="helper-text" style="margin:12px 0 0">{{ notificationSettingsMessage }}</p>
          </div>

          <div class="panel" style="max-width: 680px; margin-bottom: 20px">
            <div style="display:flex;justify-content:space-between;gap:16px;align-items:flex-start;margin-bottom:14px">
              <div>
                <p class="field-label" style="margin-bottom: 6px">WhatsApp · SMS · Email</p>
                <p class="helper-text" style="margin:0">Реальные каналы через Twilio и Resend. Ключи провайдеров задаются на backend, поэтому они не попадают в браузер.</p>
              </div>
              <button class="btn-link" @click="loadNotificationProviders">Обновить</button>
            </div>
            <div v-if="notificationProviders" style="display:grid;gap:8px;margin-bottom:16px">
              <div class="data-row"><span>WhatsApp</span><span class="badge" :style="notificationProviders.twilio.whatsapp ? 'color:var(--success);background:var(--success-dim)' : ''">{{ notificationProviders.twilio.whatsapp ? 'Готов' : 'Не настроен' }}</span></div>
              <div class="data-row"><span>SMS</span><span class="badge" :style="notificationProviders.twilio.sms ? 'color:var(--success);background:var(--success-dim)' : ''">{{ notificationProviders.twilio.sms ? 'Готов' : 'Не настроен' }}</span></div>
              <div class="data-row"><span>Email</span><span class="badge" :style="notificationProviders.email.configured ? 'color:var(--success);background:var(--success-dim)' : ''">{{ notificationProviders.email.configured ? 'Готов' : 'Не настроен' }}</span></div>
            </div>
            <p class="field-label" style="margin-bottom:6px">Проверка реальной доставки</p>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              <select v-model="providerTestChannel">
                <option value="email">Email</option>
                <option value="sms">SMS</option>
                <option value="whatsapp">WhatsApp</option>
              </select>
              <select v-model="providerTestClientId" style="flex:1;min-width:180px">
                <option value="">Выберите клиента</option>
                <option v-for="client in clients" :key="client.id" :value="client.id">{{ client.name }}{{ client.phone ? ` · ${client.phone}` : '' }}{{ client.email ? ` · ${client.email}` : '' }}</option>
              </select>
              <button class="btn-secondary" :disabled="providerTesting || !providerTestClientId" @click="sendProviderTest">{{ providerTesting ? 'Отправляем…' : 'Отправить тест' }}</button>
            </div>
            <p v-if="providerTestMessage" class="helper-text" style="margin:10px 0 0">{{ providerTestMessage }}</p>
          </div>

          <div class="panel" style="max-width: 480px; margin-bottom: 20px">
            <p class="field-label" style="margin-bottom: 12px">Основные</p>
            <div class="field">
              <label class="field-label">Часовой пояс</label>
              <input v-model="businessDraft.timezone" type="text" />
            </div>
            <div class="field">
              <label class="field-label">Налог на выручку (%)</label>
              <input v-model.number="businessDraft.taxPercent" type="number" min="0" max="100" step="0.5" style="max-width: 140px" />
              <p class="helper-text">Используется в аналитике для расчёта чистой прибыли.</p>
            </div>
          </div>

          <div class="panel" style="max-width: 480px; margin-bottom: 20px">
            <p class="field-label" style="margin-bottom: 12px">Расписание по умолчанию</p>
            <p class="helper-text" style="margin-bottom: 12px">
              Используется для сотрудников без собственного индивидуального расписания.
            </p>
            <WorkingHoursEditor v-model="businessDraft.workingHours" />
          </div>

          <button class="btn-primary" style="max-width: 200px" :disabled="businessDraft.savingSettings" @click="saveBusinessSettings">
            {{ businessDraft.savingSettings ? "…" : "Сохранить настройки" }}
          </button>
        </div>
      </template>
    </main>

    <!-- Детали записи -->
    <Modal v-if="selectedAppointment" :title="selectedAppointment.clientName || 'Запись'" @close="closeAppointmentDetail">
      <div class="appointment-detail-head">
        <div>
          <div class="text-dim text-xs">{{ formatDateTime(selectedAppointment.startAt) }}</div>
          <h3 style="margin:4px 0 0">{{ selectedAppointment.serviceName || 'Услуга' }}</h3>
        </div>
        <span class="badge" :class="`status-${selectedAppointment.status}`">{{ appointmentStatusLabel(selectedAppointment.status) }}</span>
      </div>

      <div class="appointment-detail-grid">
        <div><span>Мастер</span><strong>{{ selectedAppointment.staffName || '—' }}</strong></div>
        <div><span>Стоимость</span><strong>{{ formatMoney(selectedAppointment.priceCents ?? 0, selectedAppointment.currency) }}</strong></div>
        <div><span>Начало</span><strong>{{ formatTime(selectedAppointment.startAt) }}</strong></div>
        <div><span>Окончание</span><strong>{{ formatTime(selectedAppointment.endAt) }}</strong></div>
      </div>

      <div class="appointment-detail-actions">
        <button v-if="selectedAppointment.status === 'booked'" class="btn-primary" :disabled="appointmentActionSaving" @click="setSelectedAppointmentStatus('confirmed')">Подтвердить</button>
        <button v-if="selectedAppointment.status === 'booked' || selectedAppointment.status === 'confirmed'" class="btn-secondary" :disabled="appointmentActionSaving" @click="openReschedule(selectedAppointment)">Перенести</button>
        <button v-if="selectedAppointment.status === 'booked' || selectedAppointment.status === 'confirmed'" class="btn-secondary" :disabled="appointmentActionSaving" @click="setSelectedAppointmentStatus('completed')">Завершить</button>
        <button v-if="selectedAppointment.status === 'booked' || selectedAppointment.status === 'confirmed'" class="btn-danger-text" :disabled="appointmentActionSaving" @click="setSelectedAppointmentStatus('cancelled')">Отменить</button>
        <button v-if="selectedAppointment.status === 'booked' || selectedAppointment.status === 'confirmed'" class="btn-secondary" :disabled="appointmentActionSaving" @click="setSelectedAppointmentStatus('no_show')">Неявка</button>
        <button class="btn-link" @click="openClientDetail(selectedAppointment.clientId); selectedAppointmentId = null">Открыть клиента →</button>
      </div>
    </Modal>

    <!-- Создание / перенос записи -->
    <Modal v-if="appointmentModalOpen" :title="rescheduleAppointmentId ? 'Перенести запись' : 'Новая запись'" @close="appointmentModalOpen = false">
      <div v-if="appointmentError" class="error-banner" style="margin-bottom:14px">{{ appointmentError }}</div>
      <template v-if="!rescheduleAppointmentId">
        <div class="field">
          <label class="field-label">Клиент</label>
          <select v-model="appointmentClientId"><option value="" disabled>Выберите клиента</option><option v-for="c in clients" :key="c.id" :value="c.id">{{ c.name }}{{ c.phone ? ` · ${c.phone}` : '' }}</option></select>
        </div>
        <div class="field">
          <label class="field-label">Услуга</label>
          <select v-model="appointmentServiceId" @change="appointmentStaffId = appointmentStaffOptions[0]?.id || ''"><option value="" disabled>Выберите услугу</option><option v-for="s in services" :key="s.id" :value="s.id">{{ s.name.ru || s.name.en }} · {{ s.durationMin }} мин · {{ formatMoney(s.priceCents, s.currency) }}</option></select>
        </div>
        <div class="field">
          <label class="field-label">Сотрудник</label>
          <select v-model="appointmentStaffId"><option value="" disabled>Выберите сотрудника</option><option v-for="s in appointmentStaffOptions" :key="s.id" :value="s.id">{{ s.name }}</option></select>
        </div>
        <div class="field">
          <label class="field-label">Статус</label>
          <select v-model="appointmentStatus"><option value="confirmed">Подтверждена</option><option value="booked">Новая</option></select>
        </div>
      </template>
      <div class="appointment-date-time-grid">
        <div class="field"><label class="field-label">Дата</label><input v-model="appointmentDate" type="date" /></div>
        <div class="field"><label class="field-label">Время</label><input v-model="appointmentTime" type="time" step="900" /></div>
      </div>

      <div v-if="appointmentQuickSlots.length" class="quick-slot-picker">
        <div class="quick-slot-head">Свободные окна <span>{{ appointmentQuickSlots.length }}+</span></div>
        <div class="quick-slot-list">
          <button v-for="slot in appointmentQuickSlots" :key="slot" type="button" class="quick-slot" :class="{ active: appointmentTime === slot }" @click="appointmentTime = slot">{{ slot }}</button>
        </div>
      </div>
      <div v-else-if="appointmentStaffId && appointmentServiceId" class="quick-slot-empty">На выбранную дату свободных окон не найдено. Можно указать время вручную.</div>

      <p class="helper-text" style="margin-bottom:16px">Время интерпретируется по часовому поясу бизнеса: {{ business?.timezone || '—' }}.</p>
      <div class="appointment-modal-footer">
        <button class="btn-secondary" :disabled="appointmentSaving" @click="appointmentModalOpen = false">Отмена</button>
        <button class="btn-primary" :disabled="appointmentSaving" @click="saveAppointment">{{ appointmentSaving ? 'Сохраняем…' : (rescheduleAppointmentId ? 'Перенести' : 'Создать запись') }}</button>
      </div>
    </Modal>

    <div v-if="toast" class="timio-toast" :class="`toast-${toast.tone}`" role="status">{{ toast.message }}</div>

    <Modal v-if="confirmDialog.action" :title="confirmDialog.title" @close="closeConfirmation">
      <div class="confirm-dialog">
        <p>{{ confirmDialog.message }}</p>
        <div class="confirm-actions">
          <button class="btn-secondary" :disabled="appointmentActionSaving" @click="closeConfirmation">Отмена</button>
          <button :class="confirmDialog.tone === 'danger' ? 'btn-danger-solid' : 'btn-primary'" :disabled="appointmentActionSaving" @click="async () => { const action = confirmDialog.action; closeConfirmation(); if (action) await action(); }">{{ confirmDialog.confirmText }}</button>
        </div>
      </div>
    </Modal>

    <!-- Retention: персональное предложение -->
    <Modal v-if="retentionOfferOpen" title="Предложить повторную запись" @close="retentionOfferOpen = false">
      <div class="retention-offer-modal">
        <div class="retention-offer-summary">
          <span class="client-section-kicker">Клиент</span>
          <strong>{{ retentionOffer.clientName }}</strong>
          <span>{{ retentionOffer.date }} · {{ retentionOffer.time }}</span>
        </div>
        <p class="helper-text">Timio нашёл ближайшее свободное окно на основе последней услуги и мастера.</p>
        <div v-if="retentionOfferError" class="error-banner">{{ retentionOfferError }}</div>
        <textarea v-model="retentionOffer.message" rows="8" class="retention-offer-message" />
        <p class="helper-text">Сообщение будет отправлено клиенту в Telegram. Запись создаётся только после действия клиента по ссылке.</p>
        <div class="confirm-actions">
          <button class="btn-secondary" :disabled="retentionOfferSending" @click="retentionOfferOpen = false">Отмена</button>
          <button class="btn-primary" :disabled="retentionOfferSending || !retentionOffer.message.trim()" @click="sendRetentionOffer">{{ retentionOfferSending ? "Отправляем…" : "Отправить предложение" }}</button>
        </div>
      </div>
    </Modal>

    <!-- CRM: полная карточка клиента -->
    <Modal v-if="selectedClientId" :title="clientCard?.client.name ?? '…'" @close="selectedClientId = null">
      <div v-if="clientCardLoading" class="client-card-loading">
        <div class="client-card-skeleton client-card-skeleton-lg"></div>
        <div class="client-card-skeleton"></div>
        <div class="client-card-skeleton"></div>
      </div>

      <template v-else-if="clientCard">
        <div class="client-card">
          <!-- Профиль и быстрые действия -->
          <section class="client-profile">
            <div class="client-profile-main">
              <div class="client-profile-avatar">{{ initials(clientCard.client.name || "?") }}</div>
              <div class="client-profile-copy">
                <h2>{{ clientCard.client.name || "Без имени" }}</h2>
                <p v-if="clientCard.client.phone || clientCard.client.email">
                  {{ clientCard.client.phone || clientCard.client.email }}
                </p>
                <p v-else class="text-dim">Контакты не указаны</p>
              </div>
            </div>
            <div class="client-quick-actions">
              <a v-if="clientCard.client.phone" class="client-quick-action" :href="`tel:${clientCard.client.phone}`" aria-label="Позвонить">
                <span>⌕</span><small>Позвонить</small>
              </a>
              <a v-if="clientCard.client.email" class="client-quick-action" :href="`mailto:${clientCard.client.email}`" aria-label="Написать email">
                <span>✉</span><small>Email</small>
              </a>
              <button v-if="clientLastCompletedAppointment" type="button" class="client-quick-action client-quick-action-primary" @click="repeatClientAppointment(clientLastCompletedAppointment.id)">
                <span>＋</span><small>Записать</small>
              </button>
            </div>
          </section>

          <!-- Ключевые показатели -->
          <section class="client-metrics">
            <div class="client-metric">
              <strong>{{ clientCard.client.visits }}</strong>
              <span>визитов</span>
            </div>
            <div class="client-metric">
              <strong>{{ formatMoney(clientCard.client.totalSpentCents, 'RUB') }}</strong>
              <span>потрачено</span>
            </div>
            <div class="client-metric">
              <strong>{{ clientCard.client.lastVisitAt ? formatDateTime(clientCard.client.lastVisitAt).split(',')[0] : '—' }}</strong>
              <span>последний визит</span>
            </div>
          </section>

          <!-- Следующий визит -->
          <section v-if="clientUpcomingAppointment" class="client-next-visit">
            <div>
              <span class="client-section-kicker">Следующая запись</span>
              <strong>{{ formatDateTime(clientUpcomingAppointment.startAt) }}</strong>
              <span class="text-dim">{{ clientUpcomingAppointment.serviceName }} · {{ clientUpcomingAppointment.staffName }}</span>
            </div>
            <button type="button" class="btn-secondary compact" @click="openClientAppointment(clientUpcomingAppointment.id)">Открыть</button>
          </section>

          <!-- Контакты / Telegram -->
          <section class="client-contact-line">
            <span v-if="clientCard.client.telegramChatId" class="badge">✈ Telegram подключён</span>
            <span class="badge locale">{{ clientCard.client.detectedLocale }}</span>
          </section>

          <section class="client-card-section client-marketing-preference">
            <div class="client-section-head">
              <div><span class="client-section-kicker">Маркетинг</span><h3>Связь с клиентом</h3></div>
            </div>
            <label class="marketing-consent-toggle">
              <input v-model="clientCrmDraft.marketingOptOut" type="checkbox" />
              <span>Не отправлять маркетинговые сообщения</span>
            </label>
            <span class="text-dim text-xs">Если включено, клиент исключается из рассылок и Retention Engine.</span>
          </section>

          <!-- Теги -->
          <section class="client-card-section">
            <div class="client-section-head">
              <div><span class="client-section-kicker">CRM</span><h3>Теги</h3></div>
              <span class="text-dim text-xs">Нажмите на тег, чтобы удалить</span>
            </div>
            <div v-if="clientCrmDraft.tags.length" class="client-tags">
              <button v-for="tag in clientCrmDraft.tags" :key="tag" type="button" class="badge client-tag" @click="removeTag(tag)">{{ tag }} ·</button>
            </div>
            <div class="client-add-row">
              <input v-model="newTag" type="text" placeholder="Например: постоянный" @keydown.enter="addTag" />
              <button type="button" class="btn-secondary" @click="addTag">Добавить</button>
            </div>
          </section>

          <!-- Заметки -->
          <section class="client-card-section">
            <div class="client-section-head">
              <div><span class="client-section-kicker">CRM</span><h3>Заметки</h3></div>
            </div>
            <div v-if="clientCrmDraft.notes.length" class="client-notes">
              <div v-for="(note, idx) in clientCrmDraft.notes" :key="idx" class="client-note">
                <span>{{ note }}</span>
                <button type="button" class="btn-danger-text" @click="removeNote(idx)">✕</button>
              </div>
            </div>
            <div class="client-add-row">
              <input v-model="newNote" type="text" placeholder="Например: предпочитает вечерние записи" @keydown.enter="addNote" />
              <button type="button" class="btn-secondary" @click="addNote">Добавить</button>
            </div>
          </section>

          <div class="client-save-bar">
            <button class="btn-primary client-save-button" :disabled="clientCrmDraft.saving" @click="saveClientCrm">
              {{ clientCrmDraft.saving ? "Сохраняем…" : "Сохранить изменения" }}
            </button>
          </div>

          <!-- История -->
          <section class="client-card-section">
            <div class="client-section-head">
              <div><span class="client-section-kicker">История</span><h3>Визиты</h3></div>
              <span class="text-dim text-xs">{{ clientCompletedAppointments.length }} завершено</span>
            </div>
            <div v-if="clientCard.appointments.length === 0" class="client-history-empty">
              <strong>Истории пока нет</strong>
              <span class="text-dim">После первого визита здесь появятся детали.</span>
            </div>
            <div
              v-for="a in clientCard.appointments"
              :key="a.id"
              class="client-history-row"
              role="button"
              tabindex="0"
              @click="openClientAppointment(a.id)"
              @keydown.enter="openClientAppointment(a.id)"
            >
              <span class="client-history-date">{{ formatDateTime(a.startAt).split(',')[0] }}<strong>{{ formatTime(a.startAt) }}</strong></span>
              <span class="client-history-main">
                <strong>{{ a.serviceName }}</strong>
                <small>{{ a.staffName }} · {{ appointmentStatusLabel(a.status) }}</small>
              </span>
              <span class="client-history-side">
                <strong>{{ formatMoney(a.priceCents, a.currency) }}</strong>
                <button v-if="a.status === 'completed'" type="button" class="btn-secondary compact" @click.stop="repeatClientAppointment(a.id)">Повторить</button>
              </span>
            </div>
          </section>
        </div>
      </template>
    </Modal>

    <!-- Клиенты конкретного мастера -->
    <Modal v-if="selectedStaffId" :title="`Клиенты: ${selectedStaffMember?.name ?? ''}`" @close="selectedStaffId = null">
      <div v-if="selectedStaffClients.length === 0" class="empty-state">
        <div class="title">Пока нет клиентов</div>
      </div>
      <div
        v-for="c in selectedStaffClients"
        :key="c.clientId"
        class="data-row"
        style="cursor: pointer"
        @click="openClientFromStaffModal(c.clientId)"
      >
        <div>
          <div style="font-weight: 600; font-size: 14px">{{ c.name }}</div>
          <div class="text-dim text-xs">Последний визит: {{ formatDateTime(c.lastVisit) }}</div>
        </div>
        <span class="badge">{{ c.visits }} визит{{ c.visits === 1 ? "" : c.visits < 5 ? "а" : "ов" }}</span>
      </div>
    </Modal>
  </div>
</template>

<style>
.chip { border: 1px solid var(--border); background: var(--surface-2); border-radius: 999px; padding: 6px 10px; font: inherit; color: var(--text); cursor: pointer; }
.chip.active { border-color: var(--accent); background: var(--accent-dim); color: var(--accent); }


.empty-slot-intelligence { margin: 20px 0; }
.empty-slot-head { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; margin-bottom:16px; }
.empty-slot-head h2 { margin:4px 0 7px; }
.empty-slot-head p { margin:0; color:var(--text-dim); line-height:1.45; max-width:720px; }
.empty-slot-periods { display:flex; gap:6px; flex-wrap:wrap; }
.empty-slot-periods .active { border-color:var(--accent); }
.empty-slot-summary { display:flex; align-items:baseline; gap:9px; padding:11px 13px; border:1px solid var(--border); background:var(--surface-2); border-radius:10px; margin-bottom:10px; }
.empty-slot-summary strong { font-size:24px; }
.empty-slot-summary span { color:var(--text-dim); font-size:12px; }
.empty-slot-list { display:flex; flex-direction:column; gap:7px; }
.empty-slot-item { display:grid; grid-template-columns:76px minmax(0,1fr) auto; align-items:center; gap:12px; padding:10px; border:1px solid var(--border); background:var(--surface); border-radius:10px; }
.empty-slot-time strong, .empty-slot-time small, .empty-slot-copy strong, .empty-slot-copy span, .empty-slot-copy small { display:block; }
.empty-slot-time strong { font-size:18px; }
.empty-slot-time small, .empty-slot-copy span, .empty-slot-copy small { color:var(--text-dim); font-size:11px; margin-top:3px; }
.empty-slot-copy { min-width:0; }
.empty-slot-copy strong, .empty-slot-copy span, .empty-slot-copy small { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
@media (max-width:760px) { .empty-slot-head { flex-direction:column; } .empty-slot-item { grid-template-columns:62px minmax(0,1fr); } .empty-slot-item button { grid-column:1 / -1; justify-self:stretch; } }

.daily-intelligence { margin: 20px 0; }
.daily-intelligence-head { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; margin-bottom:16px; }
.daily-intelligence-head h2 { margin:4px 0 7px; }
.daily-intelligence-head p { margin:0; color:var(--text-dim); line-height:1.45; max-width:720px; }
.daily-kpi-grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:8px; margin-bottom:16px; }
.daily-kpi { border:1px solid var(--border); background:var(--surface); padding:12px; border-radius:10px; }
.daily-kpi span,.daily-kpi small { display:block; color:var(--text-dim); font-size:11px; }
.daily-kpi strong { display:block; margin:5px 0 2px; font-size:21px; }
.daily-intelligence-grid { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:16px; }
.daily-subhead { font-size:11px; text-transform:uppercase; letter-spacing:.08em; color:var(--text-dim); margin:0 0 8px; }
.daily-actions,.daily-next-list { display:flex; flex-direction:column; gap:7px; }
.daily-action,.daily-next { width:100%; display:flex; align-items:center; gap:10px; border:1px solid var(--border); background:var(--surface); color:var(--text); border-radius:10px; padding:10px; text-align:left; cursor:pointer; }
.daily-action:hover,.daily-next:hover { border-color:var(--accent); }
.daily-action-mark { width:26px; height:26px; display:grid; place-items:center; border:1px solid var(--border); border-radius:8px; flex:0 0 auto; font-weight:700; }
.priority-high .daily-action-mark { border-color:var(--accent); color:var(--accent); }
.daily-action-copy,.daily-next-copy { min-width:0; flex:1; }
.daily-action-copy strong,.daily-action-copy small,.daily-next-copy strong,.daily-next-copy small { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.daily-action-copy small,.daily-next-copy small { margin-top:2px; color:var(--text-dim); font-size:11px; }
.daily-action-count { min-width:24px; text-align:center; font-weight:700; }
.daily-next-time { min-width:45px; font-weight:700; }
.daily-next-status { font-size:10px; color:var(--text-dim); border:1px solid var(--border); padding:4px 7px; border-radius:999px; }
.daily-next-status.pending { color:var(--accent); border-color:var(--accent); }
.compact-empty { padding:12px; }
@media (max-width:760px) { .daily-kpi-grid { grid-template-columns:repeat(2,minmax(0,1fr)); } .daily-intelligence-grid { grid-template-columns:1fr; } }
@media (max-width:560px) { .daily-intelligence-head { flex-direction:column; } }

.ai-intelligence-card { margin: 20px 0; border-color: var(--accent); }
.ai-intelligence-head { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; margin-bottom:16px; }
.ai-intelligence-head h2 { margin:4px 0 7px; }
.ai-intelligence-head p { margin:0; color:var(--text-dim); line-height:1.45; max-width:680px; }
.ai-recommendation-list { display:flex; flex-direction:column; gap:8px; }
.ai-recommendation { display:flex; align-items:center; gap:10px; padding:10px; border:1px solid var(--border); background:var(--surface); border-radius:10px; }
.ai-recommendation-main { min-width:0; flex:1; display:flex; align-items:center; gap:10px; border:0; background:transparent; color:inherit; padding:0; text-align:left; cursor:pointer; }
.ai-recommendation-copy { min-width:0; flex:1; }
.ai-recommendation-copy strong, .ai-recommendation-copy small, .ai-recommendation-copy span { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ai-recommendation-copy small { color:var(--text-dim); font-size:12px; margin-top:2px; }
.ai-recommendation-copy span { color:var(--text-dim); font-size:12px; margin-top:4px; }
.ai-recommendation-actions { flex:0 0 auto; }
.ai-intelligence-empty { padding:16px; border:1px dashed var(--border); border-radius:10px; color:var(--text-dim); font-size:13px; }
.ai-intelligence-footer { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-top:12px; color:var(--text-dim); font-size:11px; }
@media (max-width:560px) { .ai-intelligence-head { flex-direction:column; } .ai-recommendation { align-items:stretch; flex-direction:column; } .ai-recommendation-actions { display:flex; justify-content:flex-end; } .ai-intelligence-footer { flex-direction:column; align-items:flex-start; } }

.retention-card { display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(320px, .95fr); gap: 20px; margin: 20px 0; }
.retention-card-main h2, .campaign-retention-card h2 { margin: 4px 0 8px; }
.retention-card-main p { margin: 0; color: var(--text-dim); line-height: 1.5; }
.retention-stats { display: flex; gap: 8px; margin-top: 18px; flex-wrap: wrap; }
.retention-stat { border: 1px solid var(--border); background: var(--surface); border-radius: 10px; padding: 10px 14px; text-align: left; cursor: pointer; color: var(--text); }
.retention-stat strong { display: block; font-size: 20px; }
.retention-stat span { color: var(--text-dim); font-size: 12px; }
.retention-list, .retention-client-grid { display: flex; flex-direction: column; gap: 8px; }
.retention-client { width: 100%; display: flex; align-items: center; gap: 10px; border: 1px solid var(--border); background: var(--surface); border-radius: 10px; padding: 9px; color: var(--text); text-align: left; cursor: pointer; }
.retention-client:hover, .retention-stat:hover { border-color: var(--accent); }
.retention-client-copy { min-width: 0; flex: 1; }
.retention-client-copy strong, .retention-client-copy small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.retention-client-copy small { color: var(--text-dim); margin-top: 2px; font-size: 12px; }
.retention-score { min-width: 34px; text-align: center; font-weight: 700; }
.campaign-retention-card { grid-template-columns: 1fr; }
.retention-filter-row { display: flex; gap: 8px; flex-wrap: wrap; }
.retention-filter-row .active { border-color: var(--accent); }
.retention-client-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
.retention-client-large { min-height: 58px; }
@media (max-width: 760px) { .retention-card { grid-template-columns: 1fr; } .retention-client-grid { grid-template-columns: 1fr; } }


.retention-actions { display:flex; gap:6px; flex-wrap:wrap; align-items:center; }
.retention-offer-action { border:1px solid var(--border); background:var(--surface); color:var(--text); border-radius:9px; padding:8px 10px; cursor:pointer; font:inherit; }
.retention-offer-action:hover:not(:disabled) { border-color:var(--text-dim); }
.retention-offer-action:disabled { opacity:.55; cursor:not-allowed; }
.retention-offer-modal { display:flex; flex-direction:column; gap:14px; }
.retention-offer-summary { display:grid; gap:4px; padding:14px; border:1px solid var(--border); border-radius:12px; background:var(--surface); }
.retention-offer-summary strong { font-size:18px; }
.retention-offer-summary span:last-child { color:var(--text-dim); font-size:13px; }
.retention-offer-message { width:100%; resize:vertical; min-height:160px; font:inherit; line-height:1.5; box-sizing:border-box; }
.campaign-performance-panel { margin-bottom: 18px; }
.campaign-attribution-note { margin-top: 10px; padding: 9px 11px; border: 1px solid var(--border); background: var(--surface); border-radius: 8px; color: var(--text-dim); font-size: 12px; line-height: 1.45; }
.campaign-performance-grid { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 10px; margin-top: 14px; }
.campaign-performance-grid > div { border: 1px solid var(--border); background: var(--surface); border-radius: 10px; padding: 12px; }
.campaign-performance-grid strong { display: block; font-size: 20px; }
.campaign-performance-grid span { display: block; color: var(--text-dim); font-size: 12px; margin-top: 3px; }
.marketing-consent-toggle { display: flex; align-items: center; gap: 9px; font-size: 14px; cursor: pointer; }
.marketing-consent-toggle input { width: 18px; height: 18px; }
.retention-client { display:flex; align-items:stretch; gap:8px; }
.retention-client-main { min-width:0; flex:1; display:flex; align-items:center; gap:10px; border:0; background:transparent; color:inherit; padding:0; text-align:left; cursor:pointer; }
.retention-action-success { flex:0 0 auto; align-self:center; border:1px solid var(--border); background:var(--surface); color:var(--success, #2f855a); border-radius:8px; padding:7px 9px; font-size:12px; }
.retention-smart-action { flex:0 0 auto; align-self:center; border:1px solid var(--border); background:var(--surface); color:var(--text); border-radius:8px; padding:7px 9px; font-size:12px; cursor:pointer; }
.retention-smart-action:hover { border-color:var(--accent); }
.retention-smart-action:disabled { opacity:.55; cursor:wait; }
.retention-dashboard { overflow:hidden; }
.retention-dashboard-head { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; margin-bottom:18px; }
.retention-dashboard-head h2 { margin:4px 0 8px; }
.retention-periods { display:flex; gap:6px; flex-wrap:wrap; }
.retention-kpi-grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:10px; }
.retention-kpi { border:1px solid var(--border); background:var(--surface); padding:14px; border-radius:10px; min-width:0; }
.retention-kpi span, .retention-kpi small { display:block; color:var(--text-dim); }
.retention-kpi span { font-size:12px; }
.retention-kpi strong { display:block; font-size:25px; margin:7px 0 4px; }
.retention-kpi small { font-size:11px; line-height:1.4; }
.retention-kpi-money { border-color:var(--accent); }
.retention-funnel { display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); gap:8px; margin-top:12px; }
.retention-funnel div { padding:10px 12px; border:1px solid var(--border); background:var(--surface-2); border-radius:9px; }
.retention-funnel span { display:block; color:var(--text-dim); font-size:11px; }
.retention-funnel strong { display:block; margin-top:4px; font-size:16px; }
.retention-trend { margin-top:14px; border-top:1px solid var(--border); padding-top:14px; }
.retention-trend-head { display:flex; justify-content:space-between; gap:12px; margin-bottom:7px; font-size:12px; font-weight:700; }
.retention-trend-head small { color:var(--text-dim); font-weight:400; }
.retention-trend-row { display:grid; grid-template-columns:1.1fr 1fr 1fr 1fr 1fr; gap:8px; padding:7px 0; border-bottom:1px solid var(--border); font-size:12px; }
.retention-trend-row span { color:var(--text-dim); }
.retention-trend-row strong { text-align:right; }
.retention-dashboard-footer { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-top:14px; color:var(--text-dim); font-size:11px; }
@media (max-width:900px) { .retention-kpi-grid { grid-template-columns:repeat(2,minmax(0,1fr)); } .retention-funnel { grid-template-columns:repeat(3,minmax(0,1fr)); } .retention-dashboard-head { flex-direction:column; } .campaign-performance-grid { grid-template-columns:repeat(3,minmax(0,1fr)); } }
@media (max-width:560px) { .retention-kpi-grid { grid-template-columns:1fr 1fr; } .retention-funnel { grid-template-columns:1fr 1fr; } .retention-trend-row { grid-template-columns:1fr 1fr; } .retention-trend-row strong { text-align:left; } .retention-dashboard-footer { flex-direction:column; align-items:flex-start; } .campaign-performance-grid { grid-template-columns:repeat(2,minmax(0,1fr)); } }

.ai-message-generator { border:1px solid var(--border); background:var(--surface-2); padding:14px; margin:0 0 16px; border-radius:var(--radius); }
.ai-message-head { display:flex; justify-content:space-between; gap:16px; align-items:flex-start; }
.ai-provider-badge { font-size:10px; font-weight:900; letter-spacing:.08em; border:1px solid var(--border); padding:5px 7px; border-radius:var(--radius-sm); color:var(--accent); white-space:nowrap; }
.ai-message-controls { display:grid; grid-template-columns:1fr 1fr auto; gap:8px; margin-top:12px; }
@media (max-width:700px) { .ai-message-controls { grid-template-columns:1fr 1fr; } .ai-message-controls button { grid-column:1 / -1; } }
</style>
