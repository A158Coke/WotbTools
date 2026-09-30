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
  <div class="tb-content">
    <KeepAlive :include="['ReplayWorkspace']">
      <component :is="currentView" :initial-capability="initialCapability" />
    </KeepAlive>
  </div>
</template>
