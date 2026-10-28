<script setup>
/**
 * 装备 id 徽标行（回放装配 → 客户端图标）：消费 Type5 配件串（`shooter_equipment.raw` /
 * `vehicles[].equipment`，0=空槽垫底、空槽省略）。图标/名称唯一反查源是资产包
 * devices.json（loadDevices 轻加载器）；未知 id **不猜名**——渲染带 id 的占位徽标并
 * 标注「未知」（fail-closed），目录缺失时整组降级为文本。
 */
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { deviceById, itemIconUrl, loadDevices } from '../utils/researchCatalog.js'

const props = defineProps({
  /** 装备 id 集合（0=空槽；自动过滤；位置不承载槽位语义） */
  ids: { type: Array, default: null },
})

const { t, locale } = useI18n()
const devices = ref(null)
const failed = ref(false)
onMounted(async () => {
  try {
    devices.value = (await loadDevices()).devices
  } catch {
    failed.value = true
  }
})

/** 客户端物品名只有 en / zh-Hans 两套；ru 回退 en（数据文档已记录）。 */
const lang = computed(() => (locale.value === 'zh' ? 'zh-Hans' : 'en'))

const badges = computed(() => {
  if (!Array.isArray(props.ids)) return []
  return [...new Set(props.ids.filter(id => Number.isInteger(id) && id > 0))].map(id => {
    const device = deviceById(devices.value, id)
    return { id, device }
  })
})
const empty = computed(() => !Array.isArray(props.ids) || !props.ids.some(id => Number.isInteger(id) && id > 0))

function titleOf(badge) {
  if (!badge.device) return t('recon.map.playback.loadout_unknown_equipment')
  return badge.device[`name_${lang.value}`] || badge.device['name_zh-Hans'] || badge.device.name_en || badge.device.stem
}
</script>

<template>
  <span v-if="!empty" class="eq-badges" data-testid="equipment-badges">
    <template v-if="failed">—</template>
    <span
      v-for="badge in badges"
      :key="badge.id"
      class="eq-badge"
      :class="{ 'is-unknown': !badge.device }"
      :title="titleOf(badge)"
      :aria-label="titleOf(badge)"
      :data-testid="`equipment-badge-${badge.id}`"
    >
      <img v-if="badge.device && itemIconUrl('devices', badge.device.icon)" :src="itemIconUrl('devices', badge.device.icon)" alt="" width="28" height="28" loading="lazy">
      <span v-else class="eq-fallback">{{ badge.device ? (titleOf(badge).slice(0, 2)) : '?' }}</span>
    </span>
  </span>
</template>

<style scoped>
.eq-badges { display: inline-flex; flex-wrap: wrap; gap: var(--space-1); min-inline-size: 0; }
.eq-badge {
  display: grid;
  place-items: center;
  inline-size: 28px;
  block-size: 28px;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-sm);
  background: var(--color-surface-2);
}
.eq-badge.is-unknown { border-style: dashed; color: var(--color-text-secondary); }
.eq-badge img { inline-size: 100%; block-size: 100%; object-fit: contain; }
.eq-fallback { color: var(--color-text-secondary); font: var(--type-caption); font-weight: 600; }
</style>
