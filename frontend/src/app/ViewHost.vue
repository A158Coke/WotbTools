<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useAuth } from '../composables/useAuth.js'
import { viewFromRoute } from './navigation.js'
import { replayInitialCapability, VIEW_COMPONENTS } from './viewRegistry.js'

const route = useRoute()
// admin-only 视图（Agent 数据平面）按角色放行：非管理员直达深链收敛回默认视图
const { isAdmin } = useAuth()
const activeView = computed(() => viewFromRoute(route, { allowAdminViews: isAdmin.value }))
const currentView = computed(() => VIEW_COMPONENTS[activeView.value] || VIEW_COMPONENTS.replay)
const initialCapability = computed(() => replayInitialCapability(activeView.value))
</script>

<template>
  <main id="main" class="app-main">
    <!-- 回放工作台是唯一 capability host：五种能力切换、从装甲查看器返回都保留同一个工作台实例 -->
    <KeepAlive :include="['ReplayWorkspace']">
      <component :is="currentView" :initial-capability="initialCapability" />
    </KeepAlive>
  </main>
</template>

<style scoped>
/* 顶栏是 fixed：内容区只在这里让出一次高度（含顶部安全区） */
.app-main {
  flex: 1 0 auto;
  padding-top: calc(var(--header-h) + env(safe-area-inset-top));
}
</style>
