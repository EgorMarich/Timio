import { useAuthStore } from "../stores/auth";
import { useTimioAuthApi } from "../composables/useTimioAuthApi";

export default defineNuxtRouteMiddleware(async (to) => {
  if (!import.meta.client) return;
  const auth = useAuthStore();
  if (!auth.initialized) {
    auth.loading = true;
    try {
      await useTimioAuthApi().me();
    } catch {
      auth.clear();
    } finally {
      auth.initialized = true;
      auth.loading = false;
    }
  }
  if (!auth.isAuthenticated) return navigateTo(`/login?next=${encodeURIComponent(to.fullPath)}`);
});
