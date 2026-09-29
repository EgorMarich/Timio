import { NotificationProviderNotFoundError } from '../domain/notification.errors';
export class NotificationService {
    registry;
    templateRepository;
    settingsRepository;
    notificationRepository;
    templateEngine;
    constructor(registry, templateRepository, settingsRepository, notificationRepository, templateEngine) {
        this.registry = registry;
        this.templateRepository = templateRepository;
        this.settingsRepository = settingsRepository;
        this.notificationRepository = notificationRepository;
        this.templateEngine = templateEngine;
    }
    async send(command) {
        const provider = this.registry.get(command.channel);
        if (!provider) {
            throw new NotificationProviderNotFoundError(command.channel);
        }
        await provider.send(command.recipient, command.payload);
    }
    async notify(command) {
        const settings = await this.settingsRepository.get(command.businessId, command.templateType);
        if (!settings?.enabled) {
            return;
        }
        const template = await this.templateRepository.find(command.businessId, command.templateType);
        if (!template) {
            throw new Error(`Template "${command.templateType}" not found`);
        }
        const rawTemplate = template.translations[command.locale] ??
            template.translations['en'] ??
            Object.values(template.translations)[0];
        const rendered = this.templateEngine.render(rawTemplate, command.variables);
        return {
            settings,
            rendered,
        };
    }
    async getBusinessSettings(businessId) {
        return this.settingsRepository.list(businessId);
    }
    async updateBusinessSettings(businessId, settings) {
        await this.settingsRepository.saveMany(businessId, settings);
    }
}
