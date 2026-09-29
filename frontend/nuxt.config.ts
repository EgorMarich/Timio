export default defineNuxtConfig({
  compatibilityDate: '2025-01-01',
  devtools: { enabled: process.env.NODE_ENV !== 'production' },
  modules: ['@pinia/nuxt', '@vueuse/nuxt', '@nuxtjs/tailwindcss'],
  css: ['~/assets/css/main.css'],

  runtimeConfig: {
    public: {
      // Публичное API Timio (Hono + Postgres). Клиент бьёт сюда напрямую -
      // браузер сам подставляет свой Accept-Language, никакой доп. логики не нужно:
      // язык клиента определяет бэкенд (см. api/src/i18n/detectLocale.ts),
      // фронт лишь рендерит то, что вернул сервер.
      apiBase: process.env.NUXT_PUBLIC_API_BASE || 'http://localhost:8787',
    },
  },

  app: {
    head: {
      title: 'Timio',
      link: [
        { rel: 'manifest', href: '/manifest.webmanifest' },
        { rel: 'apple-touch-icon', href: '/icons/icon-192.png' },
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        {
          rel: 'stylesheet',
          href: 'https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700;900&family=Roboto+Mono:wght@500&display=swap',
        },
        {
          rel: 'stylesheet',
          href: 'https://fonts.googleapis.com/css2?family=Geist+Mono:ital,wght@0,100..900;1,100..900&display=swap',
        },
      ],
      meta: [
        { name: 'theme-color', content: '#ff4438' },
        { name: 'mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-title', content: 'Timio' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
      ],
    },
  },
});
