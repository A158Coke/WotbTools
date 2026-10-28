<script setup>
/**
 * 装甲查看器右上角的射击 HUD（BlitzKit 式布局）：
 *   - 弹种：射击方当前主炮的弹种图标（点击切换，穿深/伤害判定重跑）
 *   - 右侧两枚装备图标：射击方「校准弹」/ 受击方「强化装甲」，高亮 = 已装配
 * 只做图标交互，不出现文字按钮；图标来自资产包 devices 目录（103/110）。
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Crosshair, Shield } from 'lucide-vue-next'
import { fetchTankData } from '../scene/agentData.js'
import { loadResearchCatalog, shellIconUrl, itemIconUrl } from '../utils/researchCatalog.js'
import { shellLabel } from '../scene/tankMeta.js'

const props = defineProps({
  shooterId: { type: Number, default: null },
  /** 射击方配置（&scfg=；普通同车检视回落到 &config=） */
  scfg: { type: [Number, String], default: null },
  config: { type: [Number, String], default: null },
  shell: { type: [Number, String], default: null },
  eqcal: { type: [Number, String], default: null },
  eqenh: { type: [Number, String], default: null },
  calibratedDefault: { type: Boolean, default: false },
  enhancedDefault: { type: Boolean, default: false },
})
const emit = defineEmits(['shell', 'calibrated', 'enhanced', 'ready'])

const { t } = useI18n()
const details = ref(null)
const devices = ref({ calibrated: null, enhanced: null })
let request = 0

async function load(shooterId) {
  const seq = ++request
  details.value = null
  devices.value = { calibrated: null, enhanced: null }
  if (!(shooterId > 0)) return
  try {
    const [detail, catalog] = await Promise.all([fetchTankData(shooterId), loadResearchCatalog()])
    if (seq !== request) return
    details.value = detail
    const list = catalog?.devices || []
    devices.value = {
      calibrated: list.find(item => item.id === 103) || null,
      enhanced: list.find(item => item.id === 110) || null,
    }
    emit('ready')
  } catch {
    if (seq === request) details.value = null
  }
}
watch(() => props.shooterId, id => load(id), { immediate: true })

const configs = computed(() => details.value?.configs || [])
const cfgIndex = computed(() => {
  if (!configs.value.length) return null
  const wanted = Number(props.scfg ?? props.config)
  return Number.isInteger(wanted) && wanted >= 0 && wanted < configs.value.length
    ? wanted
    : configs.value.length - 1
})
const shells = computed(() => configs.value[cfgIndex.value]?.shells || [])
const shellIndex = computed(() => {
  const n = Number(props.shell)
  return Number.isInteger(n) && n >= 0 && n < shells.value.length ? n : 0
})
const calibrated = computed(() => (props.eqcal == null ? props.calibratedDefault : String(props.eqcal) === '1'))
const enhanced = computed(() => (props.eqenh == null ? props.enhancedDefault : String(props.eqenh) === '1'))
</script>

<template>
  <div v-if="shells.length" class="shot-hud" data-testid="armor-shot-hud">
    <div class="hud-row hud-shells" role="group" :aria-label="t('armor.shell')">
      <button
        v-for="(shell, index) in shells"
        :key="`hud-shell-${index}`"
        type="button"
        class="hud-shell"
        :class="{ 'is-on': index === shellIndex }"
        :aria-pressed="index === shellIndex"
        :aria-label="shellLabel(shell) || shell.type"
        :title="`${shellLabel(shell) || shell.type}${shell.penetration != null ? ` · ${Math.round(shell.penetration)}mm` : ''}${shell.damage != null ? ` · ${Math.round(shell.damage)}` : ''}`"
        :data-testid="`hud-shell-${index}`"
        @click="index === shellIndex ? null : emit('shell', index)"
      >
        <img :src="shellIconUrl(shell.type)" alt="" width="28" height="28" loading="lazy">
      </button>
    </div>
    <div class="hud-row hud-equipment">
      <button
        type="button"
        class="hud-eq"
        :class="{ 'is-on': calibrated }"
        :aria-pressed="calibrated"
        :aria-label="t('armor.calibrated')"
        :title="t('armor.calibrated')"
        data-testid="hud-calibrated"
        @click="emit('calibrated', !calibrated)"
      >
        <img v-if="devices.calibrated?.icon" :src="itemIconUrl('devices', devices.calibrated.icon)" alt="" width="28" height="28" loading="lazy">
        <Crosshair v-else :size="22" aria-hidden="true" />
      </button>
      <button
        type="button"
        class="hud-eq"
        :class="{ 'is-on': enhanced }"
        :aria-pressed="enhanced"
        :aria-label="t('armor.enhanced')"
        :title="t('armor.enhanced')"
        data-testid="hud-enhanced"
        @click="emit('enhanced', !enhanced)"
      >
        <img v-if="devices.enhanced?.icon" :src="itemIconUrl('devices', devices.enhanced.icon)" alt="" width="28" height="28" loading="lazy">
        <Shield v-else :size="22" aria-hidden="true" />
      </button>
    </div>
  </div>
</template>

<style scoped>
/* 卡片外观由宿主（#corner-tr 整体面板）提供；这里只排布弹种/装备图标。 */
.shot-hud {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}
.hud-row { display: flex; align-items: center; gap: var(--space-1); }
.hud-shell,
.hud-eq {
  display: grid;
  place-items: center;
  inline-size: 40px;
  block-size: 36px;
  padding: 0;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-sm);
  background: var(--color-surface-2);
  color: var(--color-text-secondary);
  cursor: pointer;
}
.hud-shell img,
.hud-eq img { inline-size: 28px; block-size: 28px; object-fit: contain; }
.hud-shell.is-on,
.hud-eq.is-on {
  border-color: var(--color-accent);
  background: color-mix(in oklab, var(--color-accent) 16%, var(--color-surface-1));
  color: var(--color-accent-text);
}
.hud-shell:focus-visible,
.hud-eq:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }
.hud-equipment { padding-inline-start: var(--space-2); border-inline-start: 1px solid var(--color-border-subtle); }
</style>
