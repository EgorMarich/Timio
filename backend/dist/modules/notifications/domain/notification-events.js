export var NotificationEvent;
(function (NotificationEvent) {
    NotificationEvent["APPOINTMENT_CREATED"] = "appointment.created";
    NotificationEvent["APPOINTMENT_UPDATED"] = "appointment.updated";
    NotificationEvent["APPOINTMENT_CANCELLED"] = "appointment.cancelled";
    NotificationEvent["APPOINTMENT_RESCHEDULED"] = "appointment.rescheduled";
    NotificationEvent["REMINDER_24H"] = "reminder.24h";
    NotificationEvent["REMINDER_3H"] = "reminder.3h";
    NotificationEvent["REMINDER_15M"] = "reminder.15m";
    NotificationEvent["VISIT_COMPLETED"] = "visit.completed";
    NotificationEvent["REVIEW_REQUEST"] = "review.request";
})(NotificationEvent || (NotificationEvent = {}));
