import { and, eq } from 'drizzle-orm';
import { db } from '../../../db/client';
import { businessNotificationSettings } from '../../../db/schema';
export class BusinessSettingsRepository {
    async get(businessId, event) {
        const [settings] = await db
            .select()
            .from(businessNotificationSettings)
            .where(and(eq(businessNotificationSettings.businessId, businessId), eq(businessNotificationSettings.event, event)));
        return settings;
    }
    async list(businessId) {
        return db
            .select()
            .from(businessNotificationSettings)
            .where(eq(businessNotificationSettings.businessId, businessId));
    }
    async saveMany(businessId, settings) {
        await db.transaction(async (tx) => {
            await tx
                .delete(businessNotificationSettings)
                .where(eq(businessNotificationSettings.businessId, businessId));
            if (!settings.length) {
                return;
            }
            await tx.insert(businessNotificationSettings).values(settings.map((item) => ({
                businessId,
                event: item.event,
                enabled: item.enabled,
                channels: item.channels,
            })));
        });
    }
}
