import { ProviderRegistry } from './application/provider-registry';
import { NotificationService } from './application/notification.service';
import { TemplateEngine } from './application/template-engine';
import { NotificationRepository } from './repositories/notification.repository';
import { TemplateRepository } from './repositories/template.repository';
import { BusinessSettingsRepository } from './repositories/business-settings.repository';
export class NotificationModule {
    registry = new ProviderRegistry();
    templateEngine = new TemplateEngine();
    notificationRepository = new NotificationRepository();
    templateRepository = new TemplateRepository();
    settingsRepository = new BusinessSettingsRepository();
    notifications = new NotificationService(this.registry, this.templateRepository, this.settingsRepository, this.notificationRepository, this.templateEngine);
}
