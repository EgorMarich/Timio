import { useAuthStore } from "../stores/auth";

export type WorkingHours = Record<number, { start: number; end: number } | null>;

export interface OwnedBusiness {
  id: string;
  slug: string;
  name: string;
  niche: string;
  timezone: string;
  workingHours: WorkingHours;
  taxPercentBp: number;
  myRole?: string;
}

export interface OwnedMember {
  id: string;
  userId: string;
  role: string;
  name: string;
  email: string;
}

export interface OwnedTemplate {
  id: string;
  businessId: string;
  type: string;
  translations: Record<string, string>;
}

export interface OwnedClientCard {
  client: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    telegramChatId: string | null;
    detectedLocale: string;
    tags: string[];
    notes: string[];
    marketingOptOut: boolean;
    marketingConsentAt: string | null;
    totalSpentCents: number;
    visits: number;
    lastVisitAt: string | null;
    createdAt: string;
  };
  appointments: {
    id: string;
    serviceId: string;
    staffId: string;
    startAt: string;
    endAt: string;
    status: string;
    serviceName: string;
    staffName: string;
    priceCents: number;
    currency: string;
  }[];
}

export interface OwnedService {
  id: string;
  businessId: string;
  name: Record<string, string>;
  durationMin: number;
  priceCents: number;
  currency: string;
  photoUrl?: string | null;
}

export interface OwnedStaff {
  id: string;
  businessId: string;
  name: string;
  serviceIds: string[];
  colorHex: string;
  photoUrl?: string | null;
  workingHours?: WorkingHours | null;
  commissionPercentBp: number;
}

export interface OwnedAppointment {
  id: string;
  clientId: string;
  staffId: string;
  serviceId?: string;
  startAt: string;
  endAt: string;
  status: string;
  priceCents?: number;
  currency?: string;
  clientName?: string;
  clientLocale?: string;
  serviceName?: string;
  staffName?: string;
}

export interface AnalyticsSummary {
  totalRevenueCents: number;
  taxPercent: number;
  taxCents: number;
  totalCommissionCents: number;
  netProfitCents: number;
  totalAppointments: number;
  totalClients: number;
  avgCheckCents: number;
  noShowCount: number;
  cancelledCount: number;
}

export interface AnalyticsResponse {
  summary: AnalyticsSummary;
  byDay: { date: string; revenueCents: number; appointments: number }[];
  byService: { serviceId: string; name: string; revenueCents: number; count: number }[];
  byStaff: { staffId: string; name: string; revenueCents: number; commissionCents: number; count: number }[];
  rows: {
    date: string;
    client: string;
    service: string;
    staff: string;
    status: string;
    priceCents: number;
    commissionCents: number;
    currency: string;
  }[];
}

export type CampaignSegment = 'all' | 'inactive' | 'by_tag' | 'top_clients' | 'new_clients' | 'reactivation';

export interface CampaignFilters {
  segment: CampaignSegment;
  inactiveDays?: number;
  tag?: string;
  visitsGte?: number;
  reactivationSegment?: ReactivationSegment;
  recipientIds?: string[];
  retentionAction?: 'offer';
  offeredSlot?: { serviceId: string; staffId: string; startAt: string };
}

export interface Campaign {
  id: string;
  businessId: string;
  name: string;
  message: string;
  filters: CampaignFilters;
  channel: string;
  status: 'sending' | 'sent' | 'failed';
  recipientCount: number;
  sentCount: number;
  createdAt: string;
  sentAt: string | null;
}

export type ReactivationSegment = "due" | "at_risk" | "lost" | "all";

export interface ReactivationClient {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  visits: number;
  totalSpentCents: number;
  lastVisitAt: string | null;
  daysSinceLastVisit: number | null;
  expectedReturnDays: number | null;
  latenessDays: number | null;
  segment: "due" | "at_risk" | "lost";
  score: number;
  reason: string;
  tags: string[];
}

export interface ReactivationResponse {
  generatedAt: string;
  summary: { total: number; due: number; atRisk: number; lost: number };
  clients: ReactivationClient[];
}

export interface CampaignPreview {
  count: number;
  sample: { id: string; name: string }[];
  channel: string;
  excludedWithoutChannel: number;
}

export interface CampaignSendResult {
  campaign: Campaign;
  result: { total: number; sent: number; failed: number };
}

export interface RetentionDashboard {
  periodDays: 7 | 30 | 90;
  attributionWindowDays: number;
  summary: {
    campaigns: number;
    recipients: number;
    delivered: number;
    failed: number;
    booked: number;
    completed: number;
    revenueCents: number;
    bookingConversionPercent: number;
    completionConversionPercent: number;
  };
  reactivation: { total: number; due: number; atRisk: number; lost: number };
  byDay: { date: string; sent: number; booked: number; completed: number; revenueCents: number }[];
}

export interface RetentionIntelligence {
  generatedAt: string;
  provider: "deterministic" | string;
  explanation: string;
  recommendations: {
    clientId: string;
    clientName: string;
    segment: "due" | "at_risk" | "lost";
    score: number;
    why: string;
    recommendation: string;
    action: "offer_repeat_booking" | "send_reminder";
    lastServiceId: string | null;
    lastStaffId: string | null;
    lastVisitAt: string | null;
  }[];
}

export interface DailyBusinessIntelligence {
  generatedAt: string;
  date: string;
  timezone: string;
  summary: { appointments: number; upcoming: number; confirmed: number; needsConfirmation: number; completed: number; noShow: number; cancelled: number; clients: number; expectedRevenueCents: number; completedRevenueCents: number };
  capacity: { workingMinutes: number; bookedMinutes: number; freeMinutes: number; utilizationPercent: number; freeBlocks: number };
  actions: { id: string; priority: "high" | "medium" | "info"; title: string; description: string; count?: number; target: "appointments" | "clients" | "campaigns" | "analytics" }[];
  nextAppointments: { id: string; clientId: string; clientName: string; staffId: string; staffName: string; serviceName: string; startAt: string; endAt: string; status: string; priceCents: number; currency: string }[];
  retention: { total: number; due: number; atRisk: number; lost: number };
}

export interface EmptySlotIntelligence {
  generatedAt: string; timezone: string; days: 1 | 3 | 7;
  summary: { freeSlots: number; opportunities: number; matchedClients: number };
  opportunities: Array<{ id: string; startAt: string; endAt: string; date: string; time: string; staffId: string; staffName: string; serviceId: string; serviceName: string; durationMin: number; priceCents: number; currency: string; client: { id: string; name: string; score: number; segment: "due" | "at_risk" | "lost"; reason: string; lastVisitAt: string | null; expectedReturnDays: number | null; telegramAvailable: boolean; phoneAvailable: boolean; emailAvailable: boolean } | null; matchReason: string | null; action: "offer_repeat_booking" | "open_client" }>;
}

export interface CampaignPerformance {
  campaign: Campaign;
  attribution: { windowDays: number; rule: string };
  summary: {
    recipients: number;
    delivered: number;
    failed: number;
    booked: number;
    completed: number;
    revenueCents: number;
    bookingConversionPercent: number;
    completionConversionPercent: number;
  };
  recipients: {
    clientId: string;
    status: string;
    sentAt: string | null;
    bookedAt: string | null;
    completedAt: string | null;
  }[];
}


export type AiMessageTone = "friendly" | "professional" | "warm" | "short";
export type AiMessageLanguage = "ru" | "en" | "es" | "it" | "fr" | "kk" | "hy";
export interface AiMessageResult {
  message: string;
  provider: "yandexgpt" | "fallback";
  model: string | null;
  configured: boolean;
}

// ---- Модуль подписок (дописано, существующие типы выше не менялись) ----

export type SubscriptionPlanId = "basic" | "business";
export type SubscriptionStatus = "trial" | "active" | "expired" | "cancelled";

export interface OwnedSubscription {
  id: string;
  businessId: string;
  plan: SubscriptionPlanId;
  status: SubscriptionStatus;
  trialEndsAt: string;
  currentPeriodEndsAt: string | null;
  yookassaPaymentMethodId: string | null;
  cancelledAt: string | null;
  createdAt: string;
}

export interface AuthAuditEvent {
  id: string;
  event: string;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface AuthSession {
  id: string;
  current: boolean;
  createdAt: string;
  lastSeenAt: string;
  ipAddress: string | null;
  userAgent: string | null;
}

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function useTimioAuthApi() {
  const config = useRuntimeConfig();
  const base = config.public.apiBase;
  const auth = useAuthStore();

  async function call<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
    try {
      return await $fetch<T>(`${base}${path}`, {
        method: (opts.method as any) ?? "GET",
        body: opts.body,
        credentials: "include",
      });
    } catch (e: any) {
      const status = e?.response?.status ?? e?.statusCode ?? 0;
      const message = e?.data?.error ?? e?.message ?? "request_failed";
      throw new ApiError(status, message);
    }
  }

  return {
    apiBase: base,

    async register(input: { email: string; password: string; name: string; locale?: string }) {
      return await call<{ verificationRequired: boolean; user: any; devVerificationUrl?: string }>("/auth/register", { method: "POST", body: input });
    },
    async login(input: { email: string; password: string }) {
      const res = await call<{ user: any }>("/auth/login", { method: "POST", body: input });
      auth.setUser(res.user);
      return res;
    },
    async me() {
      const res = await call<{ user: any }>("/auth/me");
      auth.setUser(res.user);
      return res;
    },
    async logout() {
      await call<{ ok: boolean }>("/auth/logout", { method: "POST" });
      auth.clear();
    },
    async verifyEmail(token: string) {
      return await call<{ user: any }>("/auth/verify-email", { method: "POST", body: { token } });
    },
    async resendVerification(email: string) {
      return await call<{ ok: boolean; devVerificationUrl?: string }>("/auth/resend-verification", { method: "POST", body: { email } });
    },
    async requestPasswordReset(email: string) {
      return await call<{ ok: boolean; devResetUrl?: string }>("/auth/request-password-reset", { method: "POST", body: { email } });
    },
    async resetPassword(token: string, password: string) {
      return await call<{ ok: boolean }>("/auth/reset-password", { method: "POST", body: { token, password } });
    },
    async listSessions() {
      return await call<{ sessions: AuthSession[] }>("/auth/sessions");
    },
    async listAuditEvents() {
      return await call<{ events: AuthAuditEvent[] }>("/auth/audit-events");
    },
    async revokeSession(sessionId: string) {
      return await call<{ ok: boolean; current: boolean }>(`/auth/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
    },
    async revokeOtherSessions() {
      return await call<{ ok: boolean; revoked: number }>("/auth/sessions/revoke-others", { method: "POST" });
    },
    async changePassword(currentPassword: string, newPassword: string) {
      const res = await call<{ ok: boolean }>("/auth/change-password", { method: "POST", body: { currentPassword, newPassword } });
      return res;
    },
    async requestEmailChange(email: string) {
      return await call<{ ok: boolean; devConfirmUrl?: string }>("/auth/request-email-change", { method: "POST", body: { email } });
    },
    async confirmEmailChange(token: string) {
      return await call<{ ok: boolean }>("/auth/confirm-email-change", { method: "POST", body: { token } });
    },
    oauthUrl(provider: "google" | "vk") {
      return `${base}/auth/oauth/${provider}`;
    },

    async updateAppointmentStatus(businessId: string, apptId: string, status: string) {
  return await call<{ appointment: OwnedAppointment }>(
    `/me/businesses/${businessId}/appointments/${apptId}`,
    { method: "PATCH", body: { status } }
  );
},

  // ---- Шаблоны уведомлений ----
  async listTemplates(businessId: string) {
    return await call<{ templates: OwnedTemplate[] }>(
      `/me/businesses/${businessId}/templates`
    );
  },
  async updateTemplate(businessId: string, type: string, translations: Record<string, string>) {
    return await call<{ template: OwnedTemplate }>(
      `/me/businesses/${businessId}/templates/${type}`,
      { method: "PATCH", body: { translations } }
    );
  },

  // ---- Команда бизнеса ----
  async listMembers(businessId: string) {
    return await call<{ members: OwnedMember[] }>(
      `/me/businesses/${businessId}/members`
    );
  },
  async addMember(businessId: string, email: string, role?: string) {
    return await call<{ member: OwnedMember }>(
      `/me/businesses/${businessId}/members`,
      { method: "POST", body: { email, role } }
    );
  },
  async removeMember(businessId: string, memberId: string) {
    return await call(
      `/me/businesses/${businessId}/members/${memberId}`,
      { method: "DELETE" }
    );
  },

  // ---- CRM: карточка клиента (полная, с сервера) ----
  async getClientCard(businessId: string, clientId: string) {
    return await call<OwnedClientCard>(
      `/me/businesses/${businessId}/clients/${clientId}`
    );
  },
  async updateClientCrm(businessId: string, clientId: string, input: { tags?: string[]; notes?: string[]; marketingOptOut?: boolean }) {
    return await call<{ client: OwnedClientCard["client"] }>(
      `/me/businesses/${businessId}/clients/${clientId}`,
      { method: "PATCH", body: input }
    );
  },

    async listBusinesses() {
      return await call<{ businesses: OwnedBusiness[] }>("/me/businesses");
    },
    async createBusiness(input: { name: string; niche: string; timezone: string }) {
      return await call<{ business: OwnedBusiness }>("/me/businesses", { method: "POST", body: input });
    },
    async getBusiness(id: string) {
      return await call<{ business: OwnedBusiness; myRole: string }>(`/me/businesses/${id}`);
    },
    async updateBusiness(id: string, input: Partial<{ name: string; timezone: string; workingHours: WorkingHours; taxPercent: number }>) {
      return await call<{ business: OwnedBusiness }>(`/me/businesses/${id}`, { method: "PATCH", body: input });
    },

    async listServices(businessId: string) {
      return await call<{ services: OwnedService[] }>(`/me/businesses/${businessId}/services`);
    },
    async createService(
      businessId: string,
      input: { name: string; durationMin: number; priceCents: number; currency: string; photoUrl?: string }
    ) {
      return await call<{ service: OwnedService }>(`/me/businesses/${businessId}/services`, { method: "POST", body: input });
    },
    async updateService(businessId: string, serviceId: string, input: Partial<{ name: string; durationMin: number; priceCents: number; currency: string; photoUrl: string }>) {
      return await call<{ service: OwnedService }>(`/me/businesses/${businessId}/services/${serviceId}`, { method: "PATCH", body: input });
    },
    async deleteService(businessId: string, serviceId: string) {
      return await call(`/me/businesses/${businessId}/services/${serviceId}`, { method: "DELETE" });
    },

    async listStaff(businessId: string) {
      return await call<{ staff: OwnedStaff[] }>(`/me/businesses/${businessId}/staff`);
    },
    async createStaff(businessId: string, input: { name: string; serviceIds: string[]; colorHex?: string; photoUrl?: string; commissionPercent?: number }) {
      return await call<{ staff: OwnedStaff }>(`/me/businesses/${businessId}/staff`, { method: "POST", body: input });
    },
    async updateStaff(
      businessId: string,
      staffId: string,
      input: Partial<{ name: string; serviceIds: string[]; colorHex: string; photoUrl: string; workingHours: WorkingHours | null; commissionPercent: number }>
    ) {
      return await call<{ staff: OwnedStaff }>(`/me/businesses/${businessId}/staff/${staffId}`, { method: "PATCH", body: input });
    },
    async deleteStaff(businessId: string, staffId: string) {
      return await call(`/me/businesses/${businessId}/staff/${staffId}`, { method: "DELETE" });
    },

    async listAppointments(businessId: string) {
      return await call<{ appointments: OwnedAppointment[] }>(`/me/businesses/${businessId}/appointments`);
    },
    async createAppointment(businessId: string, input: { clientId: string; staffId: string; serviceId: string; startAt: string; status?: string }) {
      return await call<{ appointment: OwnedAppointment }>(`/me/businesses/${businessId}/appointments`, { method: "POST", body: input });
    },
    async rescheduleAppointment(businessId: string, apptId: string, startAt: string) {
      return await call<{ appointment: OwnedAppointment }>(`/me/businesses/${businessId}/appointments/${apptId}/reschedule`, { method: "PATCH", body: { startAt } });
    },
    async listClients(businessId: string) {
      return await call<{ clients: any[] }>(`/me/businesses/${businessId}/clients`);
    },
    async createClient(businessId: string, input: { name: string; phone?: string; email?: string }) {
      return await call<{ client: any }>(`/me/businesses/${businessId}/clients`, { method: "POST", body: input });
    },
    async getOnboarding(businessId: string) {
      return await call<{
        activated: boolean; completed: string[]; nextStep: string; progressPercent: number;
        counts: { services: number; staff: number; clients: number; appointments: number };
        steps: Record<string, boolean>; recentEvents: { event: string; createdAt: string }[];
      }>(`/me/businesses/${businessId}/onboarding`);
    },
    async trackOnboardingEvent(businessId: string, event: string, metadata?: Record<string, unknown>) {
      return await call<{ ok: boolean }>(`/me/businesses/${businessId}/onboarding/events`, { method: "POST", body: { event, metadata } });
    },
    async getAnalytics(businessId: string) {
      return await call<AnalyticsResponse>(`/me/businesses/${businessId}/analytics`);
    },
    async getDailyBusinessIntelligence(businessId: string) {
      return await call<DailyBusinessIntelligence>(`/me/businesses/${businessId}/daily-intelligence`);
    },
    async getEmptySlotIntelligence(businessId: string, days: 1 | 3 | 7 = 3) {
      return await call<EmptySlotIntelligence>(`/me/businesses/${businessId}/empty-slot-intelligence?days=${days}`);
    },

    // ---- Подписка (дописано) ----
    async getSubscription(businessId: string) {
      return await call<{ subscription: OwnedSubscription | null }>(`/me/businesses/${businessId}/subscription`);
    },
    async startTrial(businessId: string, plan: SubscriptionPlanId) {
      return await call<{ subscription: OwnedSubscription }>(`/me/businesses/${businessId}/subscription/start-trial`, {
        method: "POST",
        body: { plan },
      });
    },
    async startCardBinding(businessId: string, returnUrl: string) {
      return await call<{ confirmationUrl: string | null; paymentId: string }>(
        `/me/businesses/${businessId}/subscription/start-card-binding`,
        { method: "POST", body: { returnUrl } }
      );
    },
    async cancelSubscription(businessId: string) {
      return await call<{ subscription: OwnedSubscription }>(`/me/businesses/${businessId}/subscription/cancel`, {
        method: "POST",
      });
    },
    async validatePromoCode(businessId: string, code: string) {
      return await call<{ valid: true; discountType: "percent" | "fixed"; discountValue: number }>(
        `/me/businesses/${businessId}/subscription/validate-promo`,
        { method: "POST", body: { code } }
      );
    },

    // ---- Telegram-бот (дописано) ----
    async getTelegramStatus(businessId: string) {
      return await call<{ connected: boolean; botUsername: string | null }>(`/me/businesses/${businessId}/telegram`);
    },
    async connectTelegramBot(businessId: string, botToken: string) {
      return await call<{ connected: boolean; botUsername?: string; webhookRegistered: boolean; webhookWarning?: string }>(
        `/me/businesses/${businessId}/telegram`,
        { method: "PATCH", body: { botToken } }
      );
    },
    async disconnectTelegramBot(businessId: string) {
      return await call<{ connected: boolean }>(`/me/businesses/${businessId}/telegram`, { method: "DELETE" });
    },
    async sendTelegramTest(businessId: string, clientId: string) {
      return await call<{ ok: boolean; status: "sent" | "failed"; description?: string; clientName: string }>(
        `/me/businesses/${businessId}/telegram/test`,
        { method: "POST", body: { clientId } }
      );
    },
    async getNotificationProviders(businessId: string) {
      return await call<{
        twilio: { configured: boolean; sms: boolean; whatsapp: boolean; smsFrom: string | null; whatsappFrom: string | null };
        email: { configured: boolean; from: string | null };
      }>(`/me/businesses/${businessId}/notification-providers`);
    },
    async sendNotificationProviderTest(businessId: string, channel: "whatsapp" | "sms" | "email", clientId: string) {
      return await call<{ ok: boolean; channel: string; clientName?: string; error?: string }>(
        `/me/businesses/${businessId}/notification-providers/test`,
        { method: "POST", body: { channel, clientId } }
      );
    },
    async getNotificationSettings(businessId: string) {
      return await call<{ id: string; businessId: string; event: string; enabled: boolean; channels: string[] }[]>(`/me/businesses/${businessId}/notifications`);
    },
    async saveNotificationSettings(businessId: string, settings: { event: string; enabled: boolean; channels: string[] }[]) {
      return await call<{ success: boolean }>(`/me/businesses/${businessId}/notifications`, { method: "PATCH", body: settings });
    },
    async getNotificationLogs(businessId: string) {
      return await call<{ logs: {
        id: string; clientId: string; clientName: string; appointmentId: string | null;
        event: string; channel: string; attemptedChannels: string[]; status: string;
        scheduledAt: string | null; sentAt: string | null; retryCount: number;
        error: string | null; locale: string;
      }[] }>(`/me/businesses/${businessId}/notifications/logs`);
    },

    async sendRetentionOffer(businessId: string, input: { clientId: string; serviceId: string; staffId: string; startAt: string; message?: string }) {
      return await call<{ campaign: Campaign; bookingUrl: string; offeredSlot: { serviceId: string; staffId: string; startAt: string; date: string; time: string } }>(
        `/me/businesses/${businessId}/retention/offer`,
        { method: "POST", body: input }
      );
    },
    async getReactivation(businessId: string, segment: ReactivationSegment = "all") {
      return await call<ReactivationResponse>(
        `/me/businesses/${businessId}/retention/reactivation?segment=${encodeURIComponent(segment)}`
      );
    },
    async getRetentionDashboard(businessId: string, days: 7 | 30 | 90 = 30) {
      return await call<RetentionDashboard>(
        `/me/businesses/${businessId}/retention/dashboard?days=${days}`
      );
    },
    async getRetentionIntelligence(businessId: string) {
      return await call<RetentionIntelligence>(
        `/me/businesses/${businessId}/retention/intelligence`
      );
    },
    async generateAiMessage(businessId: string, input: {
      purpose: "reactivation" | "appointment_reminder" | "follow_up" | "promotion";
      tone: AiMessageTone;
      language: AiMessageLanguage;
      channel: "telegram" | "whatsapp" | "sms" | "email";
      clientId?: string;
      draft?: string;
      offer?: { date: string; time: string; bookingUrl?: string };
    }) {
      return await call<AiMessageResult>(`/me/businesses/${businessId}/ai/message`, { method: "POST", body: input });
    },
    async listCampaigns(businessId: string) {
      return await call<{ campaigns: Campaign[] }>(
        `/me/businesses/${businessId}/campaigns`
      );
    },
    async getCampaignPerformance(businessId: string, campaignId: string) {
      return await call<CampaignPerformance>(
        `/me/businesses/${businessId}/campaigns/${campaignId}/performance`
      );
    },
    async previewCampaign(businessId: string, filters: CampaignFilters) {
      return await call<CampaignPreview>(
        `/me/businesses/${businessId}/campaigns/preview`,
        { method: "POST", body: { filters } }
      );
    },
    async sendCampaign(
      businessId: string,
      input: { name: string; message: string; filters: CampaignFilters; channel?: string }
    ) {
      return await call<CampaignSendResult>(
        `/me/businesses/${businessId}/campaigns/send`,
        { method: "POST", body: input }
      );
    },
  };
}
