<script setup lang="ts">
const { init } = usePwa();

onMounted(() => init());
</script>

<template>
  <div>
    <NuxtPage />
    <PwaStatus />
  </div>
</template>
