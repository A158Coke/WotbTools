<script setup>
/**
 * 装甲查看器右上角的射击 HUD（BlitzKit 式布局）：
 *   - 弹种：射击方当前主炮的弹种图标（点击切换，穿深/伤害判定重跑）
 *   - 右侧三枚装备图标：射击方「校准弹」/ 受击方「强化装甲」/ 受击方「改进型垂直稳定器」
 *     （122，俯仰 +4°/+3°），高亮 = 已装配
 * 弹种直接显示100米内穿深（含校准弹）；图标来自资产包 devices 目录（103/110/122）。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Crosshair, MoveVertical, Shield } from 'lucide-vue-next'
import { fetchTankData } from '../scene/agentData.js'
import { loadDevices, shellIconUrl, itemIconUrl } from '../utils/researchCatalog.js'
import { shellLabel } from '../scene/tankMeta.js'
import { calibratedPenMul, shellTypeOf } from '../scene/viewer/armorPlateModel.js'

const props = defineProps({
  shooterId: { type: Number, default: null },
  /** 射击方配置（&scfg=；缺省用射手自身默认顶级配置 configs 末位，不从目标推导） */
  scfg: { type: [Number, String], default: null },
  config: { type: [Number, String], default: null },
  upgrade: { type: String, default: null },
  abilities: { type: [String, Array], default: null },
  shell: { type: [Number, String], default: null },
  eqcal: { type: [Number, String], default: null },
  eqenh: { type: [Number, String], default: null },
  /** 122 改进型垂直稳定器（受击方/被展示车；手动勾选或射击复现自动判定） */
  eqpitch: { type: [Number, String], default: null },
  calibratedDefault: { type: Boolean, default: false },
  enhancedDefault: { type: Boolean, default: false },
  pitchDefault: { type: Boolean, default: false },
  /** 目标车预设是否提供 122（无该配件的车不显示按钮） */
  pitchAvailable: { type: Boolean, default: false },
})
const emit = defineEmits(['shell', 'calibrated', 'enhanced', 'pitch', 'ready'])

const { t } = useI18n()
const details = ref(null)
const devices = ref({ calibrated: null, enhanced: null, pitch: null })
let request = 0
onBeforeUnmount(() => { request++ })

async function load(shooterId) {
  const seq = ++request
  details.value = null
  devices.value = { calibrated: null, enhanced: null, pitch: null }
  if (!(shooterId > 0)) return
  try {
    // HUD 常驻且只读 devices：不要为三枚装备图标拉整份配置器目录（skills/camo/params…）。
    // 缺省 = XI 顶级；显式 stock 才回退基础值（非 XI 传 top 会由 fetchTankData 原样返回）。
    const upgrade = props.upgrade === 'stock' ? 'stock' : 'top'
    const detailRequest = fetchTankData(shooterId, { upgrade, abilities: props.abilities })
    const [detail, catalog] = await Promise.all([detailRequest, loadDevices()])
    if (seq !== request) return
    details.value = detail
    const list = catalog?.devices || []
    devices.value = {
      calibrated: list.find(item => item.id === 103) || null,
      enhanced: list.find(item => item.id === 110) || null,
      pitch: list.find(item => item.id === 122) || null,
    }
  } catch {
    if (seq === request) details.value = null
  }
}
watch(() => [props.shooterId, props.upgrade, props.abilities], ([id]) => load(id), { immediate: true })

const configs = computed(() => details.value?.configs || [])
const cfgIndex = computed(() => {
  if (!configs.value.length) return null
  const raw = props.scfg ?? props.config
  // 与 tankViewer 的缺省完全一致：没有显式 scfg/config 时用最后一档（顶级炮），
  // 不能 Number(null) → 0 选成 stock 炮——否则 HUD 的弹种索引对应错弹表。
  const wanted = raw == null || raw === '' ? NaN : Number(raw)
  return Number.isInteger(wanted) && wanted >= 0 && wanted < configs.value.length
    ? wanted
    : configs.value.length - 1
})
const shells = computed(() => {
  const configured = configs.value[cfgIndex.value]?.shells
  if (Array.isArray(configured) && configured.length) return configured
  // 与 tankViewer.loadShooter 的回退一致：config shells 为空时用坦克顶层弹表。
  return details.value?.shells || []
})
/** readiness 必须双向：切换配置导致 HUD 消失时要交还原生 shell/装备控件。 */
const hasShells = computed(() => shells.value.length > 0)
watch(hasShells, value => { emit('ready', value) }, { immediate: true })
const shellIndex = computed(() => {
  const n = Number(props.shell)
  return Number.isInteger(n) && n >= 0 && n < shells.value.length ? n : 0
})
const calibrated = computed(() => (props.eqcal == null ? props.calibratedDefault : String(props.eqcal) === '1'))
const enhanced = computed(() => (props.eqenh == null ? props.enhancedDefault : String(props.eqenh) === '1'))
const pitchDevice = computed(() => (props.eqpitch == null ? props.pitchDefault : String(props.eqpitch) === '1'))
// 与场景判定共用弹种分类和校准系数；仅在展示的最后一步取整，不把显示值写回炮弹。
const shellOptions = computed(() => shells.value.map(shell => {
  const penetration = typeof shell.penetration === 'number' && Number.isFinite(shell.penetration) && shell.penetration >= 0
    ? Math.round(shell.penetration * (calibrated.value ? calibratedPenMul(shellTypeOf(shell)) : 1))
    : null
  const name = shellLabel(shell) || shell.type || ''
  const damage = typeof shell.damage === 'number' && Number.isFinite(shell.damage) ? Math.round(shell.damage) : null
  return {
    shell,
    penetration,
    label: `${name} · ${penetration ?? '—'}mm · ${t('armor.shell_penetration_basis')}${damage == null ? '' : ` · ${damage}`}`,
  }
}))
</script>

<template>
  <div v-if="shells.length" class="shot-hud" data-testid="armor-shot-hud">
    <div class="hud-row hud-shells" role="group" :aria-label="t('armor.shell')">
      <button
        v-for="(option, index) in shellOptions"
        :key="`hud-shell-${index}`"
        type="button"
        class="hud-shell"
        :class="{ 'is-on': index === shellIndex }"
        :aria-pressed="index === shellIndex"
        :aria-label="option.label"
        :title="option.label"
        :data-testid="`hud-shell-${index}`"
        @click="index === shellIndex ? null : emit('shell', index)"
      >
        <img :src="shellIconUrl(option.shell.type)" alt="" width="28" height="28" loading="eager">
        <span class="hud-penetration" data-testid="hud-penetration" aria-hidden="true">{{ option.penetration ?? '—' }}<span class="hud-unit"> mm</span></span>
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
      <button
        v-if="pitchAvailable"
        type="button"
        class="hud-eq"
        :class="{ 'is-on': pitchDevice }"
        :aria-pressed="pitchDevice"
        :aria-label="t('armor.pitch_device')"
        :title="t('armor.pitch_device')"
        data-testid="hud-pitch-device"
        @click="emit('pitch', !pitchDevice)"
      >
        <img v-if="devices.pitch?.icon" :src="itemIconUrl('devices', devices.pitch.icon)" alt="" width="28" height="28" loading="lazy">
        <MoveVertical v-else :size="22" aria-hidden="true" />
      </button>
    </div>
  </div>
</template>

<style scoped>
/* 卡片外观由宿主（#corner-tr 整体面板）提供；这里只排布弹种/装备图标。 */
.shot-hud {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-1);
  min-inline-size: 0;
}
.hud-row { display: flex; align-items: center; gap: var(--space-1); }
.hud-shell,
.hud-eq {
  display: grid;
  place-items: center;
  inline-size: var(--hit-min-comfortable);
  block-size: var(--hit-min-comfortable);
  padding: 0;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-sm);
  background: var(--color-surface-2);
  color: var(--color-text-secondary);
  cursor: pointer;
}
.hud-shell { inline-size: auto; min-inline-size: var(--hit-min-comfortable); block-size: auto; min-block-size: var(--hit-min-comfortable); padding: var(--space-1); }
.hud-penetration { color: var(--color-text-primary); font: var(--type-caption); font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; }
.hud-unit { color: var(--color-text-secondary); font-weight: 400; }
.hud-shell.is-on .hud-penetration { color: var(--color-accent-text); }
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
.hud-equipment { padding-inline-start: var(--space-1); border-inline-start: 1px solid var(--color-border-subtle); }
</style>
