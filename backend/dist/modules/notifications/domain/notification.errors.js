export class NotificationProviderNotFoundError extends Error {
    constructor(channel) {
        super(`Notification provider "${channel}" not found`);
    }
}
