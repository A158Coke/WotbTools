<script setup lang="ts">
import Banner from '../components/Banner.vue'
import AppButton from '../components/AppButton.vue'
import { reloadForFreshBundle } from '../utils/lazyModule'

// lazy View chunk 加载失败（#845）：由 defineLazyView 在原 view 位置渲染。
// 恢复动作复用 lazyModule.ts 的 fresh-bundle reload owner——chunk 文件名是内容哈希，
// 失败的 import URL 无法原地重试（浏览器实测证据见 lazyModule.ts 头注），reload 是唯一可靠恢复。
function reload() {
  // 不能把 click event 直接绑到 reloadForFreshBundle：它的首参是 beforeReload 回调。
  // explicit：用户主动刷新不被 automatic cooldown 静默拦截（guard 仍会写入）。
  reloadForFreshBundle({ explicit: true })
}

// Vue 会把失败原因作为 `error` attr 传给 errorComponent。按 #845 只给可操作文案，
// 不展示原始错误对象，因此显式丢弃它（不声明 prop 也不落到根元素 attr）。
defineOptions({ inheritAttrs: false })
</script>

<template>
  <div class="view-load-error" data-testid="view-load-error">
    <Banner tone="danger">
      {{ $t('app.view_load_error') }}
      <template #actions>
        <AppButton data-testid="view-load-reload" @click="reload">{{ $t('app.view_load_reload') }}</AppButton>
      </template>
    </Banner>
  </div>
</template>

<style scoped>
/* 与 ViewLoadingState 相同的填满契约（ViewHost 的 flex 规则）：error 态不把 Footer 推出视口。 */
.view-load-error {
  flex: 1 1 auto;
  display: grid;
  align-content: center;
  padding: var(--space-4);
}
</style>
