import { defineStore } from "pinia";

export interface OwnerUser {
  id: string;
  email: string;
  name: string;
  locale: string;
  status?: string;
  emailVerifiedAt?: string | null;
}

export const useAuthStore = defineStore("auth", {
  state: () => ({
    user: null as OwnerUser | null,
    initialized: false,
    loading: false,
  }),

  actions: {
    setUser(user: OwnerUser) {
      this.user = user;
    },
    clear() {
      this.user = null;
    },
  },

  getters: {
    isAuthenticated: (state) => Boolean(state.user),
  },
});
