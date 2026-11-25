<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import sources from '../assets/tank-catalog/sources.json'
import { assetProvider } from '../scene/assetProvider.js'

const props = defineProps<{ nation?: string }>()
const assets: Record<string, { remote?: string }> = sources.assets
// 整幅封面背景用 tutor-tank 布旗套系（1024×512，9 国齐全、无轮播图顶部压暗）；
// 小尺寸 carousel/filter/text 仍只服务筛选、科技树等场景。
const meta = computed(() => (props.nation ? assets[`cover-${props.nation}`] : undefined))
const url = computed<string | null>(() => {
  const remote = meta.value?.remote
  if (!remote) return null
  try { return assetProvider.url(remote) } catch { return null }
})
const failed = ref(false)
watch(url, () => { failed.value = false })
</script>

<template>
  <!-- 国籍作为整张封面的背景层，铺在坦克图后面；纯装饰，国籍文本仍在卡片徽标行。 -->
  <img
    v-if="url && !failed"
    class="tank-cover-flag"
    :src="url"
    alt=""
    aria-hidden="true"
    loading="lazy"
    decoding="async"
    data-testid="tank-cover-nation"
    style="object-fit: cover"
    @error="failed = true"
  >
</template>

<style scoped>
.tank-cover-flag {
  position: absolute;
  inset: 0;
  inline-size: 100%;
  block-size: 100%;
  object-fit: cover;
  pointer-events: none;
}
</style>