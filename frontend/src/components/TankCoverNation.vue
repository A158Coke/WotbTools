<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import sources from '../assets/tank-catalog/sources.json'
import { assetProvider } from '../scene/assetProvider.js'

// 坦克目录卡片/详情封面均为 8:5（`.tp-media`）。布旗画布含打包透明留白，
// 先按 sources.json 的可见 bounds 裁掉留白，再按 cover 规则铺满容器。
const COVER_ASPECT = 8 / 5
const props = defineProps<{ nation?: string }>()
const assets: Record<string, { canvas?: number[]; bounds?: number[]; remote?: string }> = sources.assets
// 整幅封面背景用 tutor-tank 布旗套系（1024×512，9 国齐全、无轮播图顶部压暗）；
// 小尺寸 carousel/filter/text 仍只服务筛选、科技树等场景。
const meta = computed(() => (props.nation ? assets[`cover-${props.nation}`] : undefined))
const url = computed<string | null>(() => {
  const remote = meta.value?.remote
  if (!remote) return null
  try { return assetProvider.imageUrl(remote) } catch { return null }
})
const failed = ref(false)
watch(url, () => { failed.value = false })

const visible = computed(() => {
  const record = meta.value
  if (!record?.canvas || !record.bounds) return null
  const [canvasW, canvasH] = record.canvas
  const [x, y, right, bottom] = record.bounds
  const width = right - x
  const height = bottom - y
  if (canvasW <= 0 || canvasH <= 0 || width <= 0 || height <= 0) return null
  return { canvasW, canvasH, x, y, width, height, aspect: width / height }
})

// 可见区域的 cover 尺寸：宽高比大于容器时按高度铺满、左右裁切；反之按宽度铺满、上下裁切。
const cropStyle = computed(() => {
  const v = visible.value
  if (!v) return {}
  return v.aspect >= COVER_ASPECT
    ? { inlineSize: `${(v.aspect / COVER_ASPECT) * 100}%`, blockSize: '100%' }
    : { inlineSize: '100%', blockSize: `${(COVER_ASPECT / v.aspect) * 100}%` }
})

// 把整张画布按可见 bounds 放大/偏移，使透明留白落在裁剪窗口之外。
const imageStyle = computed(() => {
  const v = visible.value
  if (!v) return {}
  return {
    inlineSize: `${(v.canvasW / v.width) * 100}%`,
    blockSize: `${(v.canvasH / v.height) * 100}%`,
    insetInlineStart: `${(-v.x / v.width) * 100}%`,
    insetBlockStart: `${(-v.y / v.height) * 100}%`,
  }
})
</script>

<template>
  <!-- 国籍作为整张封面的背景层，铺在坦克图后面；纯装饰，国籍文本仍在卡片徽标行。 -->
  <span
    v-if="url && !failed"
    class="tank-cover-flag"
    data-testid="tank-cover-nation"
    aria-hidden="true"
  >
    <span class="tank-cover-flag-crop" :style="cropStyle">
      <img
        :src="url"
        alt=""
        loading="lazy"
        decoding="async"
        :style="imageStyle"
        @error="failed = true"
      >
    </span>
  </span>
</template>

<style scoped>
.tank-cover-flag {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  overflow: hidden;
  pointer-events: none;
}

.tank-cover-flag-crop {
  position: relative;
  flex: none;
  overflow: hidden;
}

.tank-cover-flag-crop img {
  position: absolute;
  max-inline-size: none;
  max-block-size: none;
}
</style>