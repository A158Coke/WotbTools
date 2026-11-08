<script setup lang="ts">
// 抽屉外壳（手机竖屏 / 手机横屏，design-language §9 L1 / L3）的主导航：顶栏左上菜单按钮打开，
// 内容就是侧边栏同一份分组（AppSidebar drawer 形态）。焦点陷阱、Esc、遮罩、安全区由 AppSheet 提供；
// 不做左边缘滑动打开，避免与 iOS Safari 的返回手势冲突。路由变化即关闭。
import { ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useEventListener } from '@vueuse/core'
import AppSheet from '../components/AppSheet.vue'
import AppSidebar from './AppSidebar.vue'

const props = defineProps<{ open: boolean, returnFocusTo?: HTMLElement | null }>()
const emit = defineEmits<{ close: [] }>()
const route = useRoute()

watch(() => route.fullPath, () => {
  if (props.open) emit('close')
})

// 点的是当前页（路由不变，上面的 watch 不触发）也要关：任何导航链接被点即收起抽屉，回到页面内容
function onNavClick(event: MouseEvent) {
  if ((event.target as Element | null)?.closest?.('a[href]')) emit('close')
}

// 回放 2D / 3D 进入原生全屏时，从播放控制条打开的抽屉必须渲染进全屏元素里：
// 传送到 body 的抽屉与遮罩会落在全屏层后面，看起来按钮没反应（与 OnboardingHost 同一做法）
const fullscreenRoot = ref<HTMLElement | null>(typeof document === 'undefined' ? null : document.fullscreenElement as HTMLElement | null)
useEventListener(typeof document === 'undefined' ? null : document, 'fullscreenchange', () => {
  fullscreenRoot.value = document.fullscreenElement as HTMLElement | null
})
watch(() => props.open, (open) => { if (open) fullscreenRoot.value = document.fullscreenElement as HTMLElement | null })
</script>

<template>
  <AppSheet
    :open="open"
    side="start"
    :title="$t('nav.primary')"
    :return-focus-to="returnFocusTo"
    :portal-to="fullscreenRoot"
    data-testid="nav-drawer"
    @close="emit('close')"
  >
    <div class="nav-drawer-body" @click="onNavClick">
      <AppSidebar drawer @close="emit('close')" />
    </div>
  </AppSheet>
</template>

<style scoped>
/* 只为委托点击存在，不参与布局 */
.nav-drawer-body { display: contents; }
</style>
