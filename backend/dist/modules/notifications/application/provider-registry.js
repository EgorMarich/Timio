export class ProviderRegistry {
    providers = new Map();
    register(provider) {
        this.providers.set(provider.channel, provider);
    }
    get(channel) {
        return this.providers.get(channel);
    }
    has(channel) {
        return this.providers.has(channel);
    }
    all() {
        return [...this.providers.values()];
    }
}
