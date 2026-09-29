<template>
  <aside class="app-sidebar">
    <div class="brand" style="padding: 6px 8px 20px">
      <span class="brand-mark">T</span>
      <span class="brand-name">Timio</span>
    </div>
    
    <a
      v-for="item in menuItems"
      :key="item.tab"
      class="sidebar-nav-item"
      :class="{ active: tab === item.tab }"
      @click="openTab(item.tab)"
    >
      <span class="nav-icon">{{ item.icon }}</span>
      {{ item.label }}
    </a>
    
    <div style="flex: 1" />
    <a class="sidebar-nav-item" @click="logout">
      <span class="nav-icon">←</span> Выйти
    </a>
  </aside>
</template>

<script>
export default {
  name: 'SidebarMenu',
  props: {
    tab: {
      type: String,
      required: true
    }
  },
  data() {
    return {
      menuItems: [
        { tab: 'overview', icon: '◱', label: 'Обзор' },
        { tab: 'appointments', icon: '▤', label: 'Записи' },
        { tab: 'archive', icon: '▦', label: 'Архив' },
        { tab: 'services', icon: '◇', label: 'Услуги' },
        { tab: 'staff', icon: '◍', label: 'Сотрудники' },
        { tab: 'analytics', icon: '▲', label: 'Аналитика' },
        { tab: 'billing', icon: '◈', label: 'Подписка' },
        { tab: 'templates', icon: '✉', label: 'Шаблоны' },
        { tab: 'team', icon: '◎', label: 'Команда' },
        { tab: 'campaigns', icon: '📣', label: 'Рассылки' },
        { tab: 'settings', icon: '⚙', label: 'Настройки' }
      ]
    }
  },
  methods: {
    openTab(tab) {
      this.$emit('update:tab', tab);
      this.$emit('tab-change', tab);
    },
    logout() {
      this.$emit('logout');
    }
  }
}
</script>