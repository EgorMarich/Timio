import { pgTable, text, integer, timestamp, jsonb, pgEnum, uuid, varchar, boolean, } from 'drizzle-orm/pg-core';
// Схема соответствует разделу 11 продуктовой спецификации (business/services/
// staff/clients/appointments/message_templates), только вместо MongoDB - Postgres.
// Мультиязычные поля (название услуги, шаблоны сообщений) хранятся как jsonb
// вида { "ru": "...", "en": "...", ... } - гибкость документа сохраняется,
// но данные лежат в реляционной БД с транзакциями и внешними ключами.
export const notificationChannelEnum = pgEnum('notification_channel', [
    'telegram',
    'whatsapp',
    'viber',
    'messenger',
    'sms',
    'email',
]);
export const notificationEventEnum = pgEnum('notification_event', [
    'appointment.created',
    'appointment.confirmed',
    'appointment.cancelled',
    'appointment.rescheduled',
    'appointment.reminder.24h',
    'appointment.reminder.3h',
    'appointment.reminder.15m',
    'visit.completed',
    'review.request',
    'waitlist.invite',
    'waitlist.expired',
    'waitlist.confirmed',
]);
export const campaignStatusEnum = pgEnum('campaign_status', [
    'sending',
    'sent',
    'failed',
]);
export const campaigns = pgTable('campaigns', {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
        .notNull()
        .references(() => businesses.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    message: text('message').notNull(),
    filters: jsonb('filters')
        .$type()
        .notNull(),
    channel: varchar('channel', { length: 20 }).notNull().default('telegram'),
    status: campaignStatusEnum('status').notNull().default('sending'),
    recipientCount: integer('recipient_count').notNull().default(0),
    sentCount: integer('sent_count').notNull().default(0),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    sentAt: timestamp('sent_at'),
});
export const campaignRecipients = pgTable('campaign_recipients', {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
        .notNull()
        .references(() => campaigns.id, { onDelete: 'cascade' }),
    businessId: uuid('business_id')
        .notNull()
        .references(() => businesses.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id')
        .notNull()
        .references(() => clients.id, { onDelete: 'cascade' }),
    channel: varchar('channel', { length: 20 }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    error: text('error'),
    sentAt: timestamp('sent_at'),
    bookedAt: timestamp('booked_at'),
    completedAt: timestamp('completed_at'),
    bookedAppointmentId: uuid('booked_appointment_id').references(() => appointments.id, { onDelete: 'set null' }),
    completedAppointmentId: uuid('completed_appointment_id').references(() => appointments.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
});
export const notificationDeliveryStatusEnum = pgEnum('notification_delivery_status', [
    'pending',
    'processing',
    'sent',
    'failed',
    'cancelled',
    'retry',
    'skipped',
]);
export const appointmentStatusEnum = pgEnum('appointment_status', [
    'booked',
    'confirmed',
    'completed',
    'cancelled',
    'no_show',
]);
export const userRoleEnum = pgEnum('user_role', ['owner', 'administrator', 'manager', 'employee']);
export const userStatusEnum = pgEnum('user_status', ['pending_email_verification', 'active', 'suspended', 'deleted']);
export const users = pgTable('users', {
    id: uuid('id').primaryKey().defaultRandom(),
    email: varchar('email', { length: 255 }).notNull().unique(),
    passwordHash: text('password_hash'),
    name: text('name').notNull(),
    // язык ВЛАДЕЛЬЦА в ЕГО панели управления - не влияет на язык клиентов
    locale: varchar('locale', { length: 5 }).notNull().default('en'),
    status: userStatusEnum('status').notNull().default('pending_email_verification'),
    emailVerifiedAt: timestamp('email_verified_at'),
    lastLoginAt: timestamp('last_login_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
});
export const identityProviderEnum = pgEnum('identity_provider', ['google', 'vk']);
export const userIdentities = pgTable('user_identities', {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    provider: identityProviderEnum('provider').notNull(),
    providerUserId: varchar('provider_user_id', { length: 255 }).notNull(),
    providerEmail: varchar('provider_email', { length: 255 }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
});
export const authAuditEvents = pgTable('auth_audit_events', {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    event: varchar('event', { length: 64 }).notNull(),
    ipAddress: varchar('ip_address', { length: 64 }),
    userAgent: text('user_agent'),
    metadata: jsonb('metadata').$type(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
});
export const authTokens = pgTable('auth_tokens', {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 32 }).notNull(),
    tokenHash: varchar('token_hash', { length: 128 }).notNull().unique(),
    expiresAt: timestamp('expires_at').notNull(),
    usedAt: timestamp('used_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
});
export const businesses = pgTable('businesses', {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
        .notNull()
        .references(() => users.id, { onDelete: 'cascade' }),
    slug: varchar('slug', { length: 120 }).notNull().unique(),
    name: text('name').notNull(),
    niche: varchar('niche', { length: 60 }).notNull(),
    timezone: varchar('timezone', { length: 60 }).notNull(),
    channelPriority: jsonb('channel_priority').$type().notNull(),
    workingHours: jsonb('working_hours')
        .$type()
        .notNull(),
    // Ставка налога в процентах (0-100, с сотыми долями), применяется к выручке
    // при расчёте чистой прибыли в аналитике. Хранится как integer в сотых долях
    // процента (2050 = 20.50%), чтобы избежать проблем с плавающей точкой.
    taxPercentBp: integer('tax_percent_bp').notNull().default(0),
    // Telegram-бот бизнеса для реальной отправки уведомлений клиентам (см. modules/telegram/).
    // Владелец создаёт бота через @BotFather и вставляет токен в настройках.
    // ВАЖНО: в проде токен должен храниться зашифрованным, а не открытым текстом -
    // здесь оставлено как есть для скорости MVP (см. TODO в telegram.service.ts).
    telegramBotToken: text('telegram_bot_token'),
    telegramBotUsername: varchar('telegram_bot_username', { length: 64 }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
});
export const businessMembers = pgTable('business_members', {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
        .notNull()
        .references(() => businesses.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
        .notNull()
        .references(() => users.id, { onDelete: 'cascade' }),
    role: userRoleEnum('role').notNull().default('employee'),
});
export const onboardingEventTypeEnum = pgEnum('onboarding_event_type', [
    'business_created',
    'service_created',
    'staff_created',
    'schedule_configured',
    'client_created',
    'appointment_created',
    'activation_completed',
]);
export const onboardingEvents = pgTable('onboarding_events', {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id').notNull().references(() => businesses.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    event: onboardingEventTypeEnum('event').notNull(),
    metadata: jsonb('metadata').$type(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
});
export const businessNotificationSettings = pgTable('business_notification_settings', {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
        .notNull()
        .references(() => businesses.id, {
        onDelete: 'cascade',
    }),
    event: varchar('event', {
        length: 50,
    }).notNull(),
    enabled: boolean('enabled').notNull().default(true),
    channels: jsonb('channels').$type().notNull().default([]),
    createdAt: timestamp('created_at').defaultNow().notNull(),
});
export const services = pgTable('services', {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
        .notNull()
        .references(() => businesses.id, { onDelete: 'cascade' }),
    name: jsonb('name').$type().notNull(), // мультиязычное название
    durationMin: integer('duration_min').notNull(),
    priceCents: integer('price_cents').notNull(),
    currency: varchar('currency', { length: 3 }).notNull(),
    // Фото услуги. В MVP храним как data-URL (base64) прямо в БД - без отдельного
    // объектного хранилища; в проде это заменяется на ссылку на S3/CDN.
    photoUrl: text('photo_url'),
});
export const staff = pgTable('staff', {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
        .notNull()
        .references(() => businesses.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    serviceIds: jsonb('service_ids').$type().notNull(),
    workingHours: jsonb('working_hours').$type(),
    colorHex: varchar('color_hex', { length: 7 }).notNull(),
    photoUrl: text('photo_url'),
    // Процент, который сотрудник получает с каждой оказанной услуги (0-100, сотые
    // доли, integer basis points: 4500 = 45.00%). Используется в аналитике для
    // расчёта чистой прибыли владельца = выручка - налог - комиссии сотрудников.
    commissionPercentBp: integer('commission_percent_bp').notNull().default(0),
});
export const clients = pgTable('clients', {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
        .notNull()
        .references(() => businesses.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    phone: varchar('phone', { length: 32 }),
    email: varchar('email', { length: 255 }),
    telegramChatId: varchar('telegram_chat_id', { length: 64 }),
    // Язык клиента определяется автоматически при первом обращении и дальше
    // не меняется молча - см. resolveClientLocale(). Владелец бизнеса это поле не редактирует.
    detectedLocale: varchar('detected_locale', { length: 5 }).notNull(),
    preferredChannel: notificationChannelEnum('preferred_channel'),
    marketingOptOut: boolean('marketing_opt_out').notNull().default(false),
    marketingConsentAt: timestamp('marketing_consent_at'),
    tags: jsonb('tags').$type().notNull().default([]),
    notes: jsonb('notes').$type().notNull().default([]),
    totalSpentCents: integer('total_spent_cents').notNull().default(0),
    visits: integer('visits').notNull().default(0),
    lastVisitAt: timestamp('last_visit_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
});
export const appointments = pgTable('appointments', {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
        .notNull()
        .references(() => businesses.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id')
        .notNull()
        .references(() => clients.id, { onDelete: 'cascade' }),
    staffId: uuid('staff_id')
        .notNull()
        .references(() => staff.id, { onDelete: 'cascade' }),
    serviceId: uuid('service_id')
        .notNull()
        .references(() => services.id, { onDelete: 'cascade' }),
    startAt: timestamp('start_at').notNull(),
    endAt: timestamp('end_at').notNull(),
    status: appointmentStatusEnum('status').notNull().default('booked'),
    source: varchar('source', { length: 30 }).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
});
export const messageTemplates = pgTable('message_templates', {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
        .notNull()
        .references(() => businesses.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 40 }).notNull(),
    // { "ru": "...", "en": "...", "es": "...", ... }
    translations: jsonb('translations').$type().notNull(),
});
export const notificationLogs = pgTable('notification_logs', {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
        .notNull()
        .references(() => clients.id, { onDelete: 'cascade' }),
    appointmentId: uuid('appointment_id').references(() => appointments.id, {
        onDelete: 'set null',
    }),
    event: notificationEventEnum('event').notNull(),
    templateId: uuid('template_id').references(() => messageTemplates.id, {
        onDelete: 'set null',
    }),
    channel: notificationChannelEnum('channel').notNull(),
    attemptedChannels: jsonb('attempted_channels').$type().notNull(),
    status: notificationDeliveryStatusEnum('status').notNull().default('pending'),
    renderedText: text('rendered_text').notNull(),
    scheduledAt: timestamp('scheduled_at'),
    sentAt: timestamp('sent_at'),
    retryCount: integer('retry_count').notNull().default(0),
    error: text('error'),
    locale: varchar('locale', { length: 5 }).notNull(),
});
// ================================================================
// Модуль Waitlist
// ================================================================
export const waitlistStatusEnum = pgEnum('waitlist_status', [
    'active', // ожидает приглашения
    'invited', // приглашён, слот в холде
    'claimed', // подтвердил и занял
    'expired', // приглашение истекло
    'cancelled', // отменено вручную
]);
export const waitlistEntries = pgTable('waitlist_entries', {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
        .notNull()
        .references(() => businesses.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id')
        .notNull()
        .references(() => clients.id, { onDelete: 'cascade' }),
    serviceId: uuid('service_id')
        .notNull()
        .references(() => services.id, { onDelete: 'cascade' }),
    // null = "любой сотрудник"
    staffId: uuid('staff_id').references(() => staff.id, { onDelete: 'cascade' }),
    startAt: timestamp('start_at').notNull(),
    endAt: timestamp('end_at').notNull(),
    status: waitlistStatusEnum('status').notNull().default('active'),
    confirmationToken: varchar('confirmation_token', { length: 64 }).notNull().unique(),
    inviteSentAt: timestamp('invite_sent_at'),
    holdExpiresAt: timestamp('hold_expires_at'),
    channelAttempts: jsonb('channel_attempts').$type().notNull().default([]),
    priority: integer('priority').notNull().default(0),
    createdAt: timestamp('created_at').defaultNow().notNull(),
});
// ================================================================
// Модуль подписок и оплаты (ЮKassa). Дописано поверх существующей
// схемы - таблицы выше не менялись.
// ================================================================
export const subscriptionPlanEnum = pgEnum('subscription_plan', ['basic', 'business']);
// trial -> active -> expired / cancelled. Подробная машина состояний и переходы
// между ними - в modules/subscriptions/subscription.service.ts.
export const subscriptionStatusEnum = pgEnum('subscription_status', [
    'trial',
    'active',
    'expired',
    'cancelled',
]);
export const promoDiscountTypeEnum = pgEnum('promo_discount_type', ['percent', 'fixed']);
export const paymentStatusEnum = pgEnum('payment_status', [
    'pending',
    'succeeded',
    'canceled',
    'failed',
]);
// Ровно ОДНА подписка на бизнес (действующая история переходов состояний
// хранится в payments, а не отдельными строками подписки).
export const subscriptions = pgTable('subscriptions', {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
        .notNull()
        .unique()
        .references(() => businesses.id, { onDelete: 'cascade' }),
    plan: subscriptionPlanEnum('plan').notNull(),
    status: subscriptionStatusEnum('status').notNull().default('trial'),
    trialEndsAt: timestamp('trial_ends_at').notNull(),
    // Конец уже ОПЛАЧЕННОГO периода (для active) - когда cron должен попытаться
    // списать следующий платёж.
    currentPeriodEndsAt: timestamp('current_period_ends_at'),
    // ID сохранённого способа оплаты в ЮKassa (payment_method_id), полученный
    // при привязке карты во время триала. Без него рекуррентное списание невозможно.
    yookassaPaymentMethodId: text('yookassa_payment_method_id'),
    // Промокод, применённый к ПЕРВОМУ месяцу оплаты (см. promo_code_redemptions
    // для истории/защиты от повторного использования).
    appliedPromoCodeId: uuid('applied_promo_code_id').references(() => promoCodes.id),
    cancelledAt: timestamp('cancelled_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
export const promoCodes = pgTable('promo_codes', {
    id: uuid('id').primaryKey().defaultRandom(),
    code: varchar('code', { length: 40 }).notNull().unique(),
    discountType: promoDiscountTypeEnum('discount_type').notNull(),
    // Для percent: 0-100 (целое, %). Для fixed: сумма скидки в центах/копейках.
    discountValue: integer('discount_value').notNull(),
    maxUses: integer('max_uses'), // null = без ограничения по количеству использований
    usedCount: integer('used_count').notNull().default(0),
    expiresAt: timestamp('expires_at'), // null = бессрочный
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at').defaultNow().notNull(),
});
// Факт использования промокода конкретным бизнесом - защищает от повторного
// применения одного и того же кода одним и тем же бизнесом.
export const promoCodeRedemptions = pgTable('promo_code_redemptions', {
    id: uuid('id').primaryKey().defaultRandom(),
    promoCodeId: uuid('promo_code_id')
        .notNull()
        .references(() => promoCodes.id, { onDelete: 'cascade' }),
    businessId: uuid('business_id')
        .notNull()
        .references(() => businesses.id, { onDelete: 'cascade' }),
    redeemedAt: timestamp('redeemed_at').defaultNow().notNull(),
});
// Журнал всех платежей/попыток списания ЮKassa - и привязки карты (сумма может
// быть символической), и обычных рекуррентных списаний.
export const payments = pgTable('payments', {
    id: uuid('id').primaryKey().defaultRandom(),
    subscriptionId: uuid('subscription_id')
        .notNull()
        .references(() => subscriptions.id, { onDelete: 'cascade' }),
    yookassaPaymentId: varchar('yookassa_payment_id', { length: 64 }).notNull().unique(),
    amountCents: integer('amount_cents').notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('RUB'),
    status: paymentStatusEnum('status').notNull().default('pending'),
    // "card_binding" - символическое списание при активации триала для сохранения
    // способа оплаты; "recurring" - обычное автосписание по расписанию.
    purpose: varchar('purpose', { length: 20 }).notNull(),
    idempotenceKey: varchar('idempotence_key', { length: 64 }).notNull(),
    rawPayload: jsonb('raw_payload'), // сырой ответ ЮKassa - на случай разбора инцидентов
    createdAt: timestamp('created_at').defaultNow().notNull(),
});
