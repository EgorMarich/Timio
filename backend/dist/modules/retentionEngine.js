function differenceInDays(from, to) {
    return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 86_400_000));
}
export function buildReactivationClients(clientRows, appointmentRows) {
    const now = Date.now();
    const apptsByClient = new Map();
    for (const appointment of appointmentRows) {
        const list = apptsByClient.get(appointment.clientId) ?? [];
        list.push(appointment);
        apptsByClient.set(appointment.clientId, list);
    }
    return clientRows.flatMap((client) => {
        const history = (apptsByClient.get(client.id) ?? []).filter((a) => a.status === "completed")
            .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
        if (!history.length)
            return [];
        const last = history[history.length - 1];
        const daysSinceLastVisit = differenceInDays(new Date(last.startAt), new Date(now));
        const gaps = [];
        for (let i = 1; i < history.length; i++)
            gaps.push(differenceInDays(new Date(history[i - 1].startAt), new Date(history[i].startAt)));
        const averageGap = gaps.length ? gaps.reduce((sum, value) => sum + value, 0) / gaps.length : 30;
        const expectedReturnDays = Math.round(Math.min(120, Math.max(14, averageGap)));
        const latenessDays = Math.max(0, daysSinceLastVisit - expectedReturnDays);
        const dueThreshold = Math.max(7, Math.round(expectedReturnDays * 1.05));
        const riskThreshold = Math.max(30, Math.round(expectedReturnDays * 1.5));
        const lostThreshold = Math.max(90, Math.round(expectedReturnDays * 2.2));
        let segment;
        if (daysSinceLastVisit >= lostThreshold)
            segment = "lost";
        else if (daysSinceLastVisit >= riskThreshold)
            segment = "at_risk";
        else if (daysSinceLastVisit >= dueThreshold)
            segment = "due";
        else
            return [];
        const hasFutureAppointment = (apptsByClient.get(client.id) ?? []).some((a) => ["booked", "confirmed"].includes(a.status) && new Date(a.startAt).getTime() > now);
        if (hasFutureAppointment)
            return [];
        const latenessRatio = Math.min(1, latenessDays / Math.max(expectedReturnDays, 1));
        const visitScore = Math.min(1, history.length / 8);
        const spendScore = Math.min(1, Math.max(0, client.totalSpentCents) / 200_000);
        const score = Math.round(45 * latenessRatio + 30 * visitScore + 25 * spendScore);
        const reason = segment === "lost" ? `Нет визита ${daysSinceLastVisit} дн. — клиент заметно выбился из привычного цикла.`
            : segment === "at_risk" ? `Нет визита ${daysSinceLastVisit} дн. — обычно возвращается примерно раз в ${expectedReturnDays} дн.`
                : `Пора напомнить: прошло ${daysSinceLastVisit} дн., обычный цикл около ${expectedReturnDays} дн.`;
        return [{ id: client.id, name: client.name, phone: client.phone, email: client.email, visits: history.length, totalSpentCents: client.totalSpentCents, lastVisitAt: last.startAt, daysSinceLastVisit, expectedReturnDays, latenessDays, segment, score, reason, tags: client.tags }];
    }).sort((a, b) => b.score - a.score || (b.latenessDays ?? 0) - (a.latenessDays ?? 0));
}
