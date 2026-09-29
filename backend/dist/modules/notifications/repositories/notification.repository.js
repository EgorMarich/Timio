import { eq } from 'drizzle-orm';
import { db } from '../../../db/client';
import { notificationLogs } from '../../../db/schema';
export class NotificationRepository {
    async create(data) {
        const [notification] = await db.insert(notificationLogs).values(data).returning();
        return notification;
    }
    async markAsSent(id) {
        await db
            .update(notificationLogs)
            .set({
            status: 'sent',
            sentAt: new Date(),
        })
            .where(eq(notificationLogs.id, id));
    }
    async markAsFailed(id, error) {
        await db
            .update(notificationLogs)
            .set({
            status: 'failed',
            error,
        })
            .where(eq(notificationLogs.id, id));
    }
}
