<script setup lang="ts">
// 抽屉外壳（手机竖屏 / 手机横屏，design-language §9 L1 / L3）的主导航：顶栏左上菜单按钮打开，
// 内容就是侧边栏同一份分组（AppSidebar drawer 形态）。焦点陷阱、Esc、遮罩、安全区由 AppSheet 提供；
// 不做左边缘滑动打开，避免与 iOS Safari 的返回手势冲突。路由变化即关闭。
import { watch } from 'vue'
import { useRoute } from 'vue-router'
import AppSheet from '../components/AppSheet.vue'
import AppSidebar from './AppSidebar.vue'

const props = defineProps<{ open: boolean, returnFocusTo?: HTMLElement | null }>()
const emit = defineEmits<{ close: [] }>()
const route = useRoute()

watch(() => route.fullPath, () => {
  if (props.open) emit('close')
})
</script>

<template>
  <AppSheet
    :open="open"
    side="start"
    :title="$t('nav.primary')"
    :return-focus-to="returnFocusTo"
    data-testid="nav-drawer"
    @close="emit('close')"
  >
    <AppSidebar drawer @close="emit('close')" />
  </AppSheet>
</template>
