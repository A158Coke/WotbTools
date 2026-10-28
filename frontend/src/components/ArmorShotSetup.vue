<script setup>
/**
 * 射击复现的「与射击相关」装配面板（2026-10-28 用户裁定）：
 *   - 射击方：主炮（配置 = 炮塔×炮）、校准弹、弹种
 *   - 受击方：炮塔/主炮（配置）、强化装甲
 * 别的模块/装备/技能不在这里出现。图标格与详情页同一套口径（模块类型图、弹种图、
 * 等级罗马数字），改动经事件交给宿主写 URL 并调用场景 API（setShooterConfig /
 * setShell / setEquipmentOverride / setConfig）。
 *
 * 数据：shooter/target 的 tank/{id}.json（configs 里 turret_local/gun_local/shells）
 * + research modules（炮的等级/名称）；模块缺失时退回 config.label，仍可点。
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check } from 'lucide-vue-next'
import { fetchTankData } from '../scene/agentData.js'
import { findTankModules } from '../replay-local/compute/tankSetup'
import { loadTankModules, moduleIconUrl, shellIconUrl } from '../utils/researchCatalog.js'
import { shellLabel } from '../scene/tankMeta.js'
import { romanLevel } from '../utils/tierFormat.js'

const props = defineProps({
  shooterId: { type: Number, default: null },
  targetId: { type: Number, default: null },
  /** URL：&scfg=（射击方配置）/ &config=（受击方配置）/ &shell=（弹种下标） */
  scfg: { type: [Number, String], default: null },
  config: { type: [Number, String], default: null },
  shell: { type: [Number, String], default: null },
  /** 回放 Type5 判定（数据缺失时为 false）：开关的初始值 */
  calibratedDefault: { type: Boolean, default: false },
  enhancedDefault: { type: Boolean, default: false },
  /** URL 手动覆盖（&eqcal=0/1、&eqenh=0/1）；null = 跟随回放 */
  eqcal: { type: [Number, String], default: null },
  eqenh: { type: [Number, String], default: null },
})
const emit = defineEmits(['shooter-config', 'shell', 'calibrated', 'target-config', 'enhanced', 'ready'])

const { t, locale } = useI18n()
const shooter = ref(null)
const target = ref(null)
const shooterModules = ref(null)
const targetModules = ref(null)
let request = 0

async function loadModules(nation) {
  try {
    return await loadTankModules(nation)
  } catch {
    return null
  }
}

async function load(sid, tid) {
  const seq = ++request
  shooter.value = null
  target.value = null
  shooterModules.value = null
  targetModules.value = null
  if (!(sid > 0) || !(tid > 0)) return
  try {
    const [sd, td] = await Promise.all([fetchTankData(sid), fetchTankData(tid)])
    if (seq !== request) return
    shooter.value = sd
    target.value = td
    const [sm, tm] = await Promise.all([loadModules(sd.nation), loadModules(td.nation)])
    if (seq !== request) return
    shooterModules.value = findTankModules(sm, sid)
    targetModules.value = findTankModules(tm, tid)
    emit('ready')
  } catch {
    if (seq === request) { shooter.value = null; target.value = null }
  }
}

watch([() => props.shooterId, () => props.targetId], ([sid, tid]) => load(sid, tid), { immediate: true })

const clamp = (value, length) => {
  const n = Number(value)
  return Number.isInteger(n) && n >= 0 && n < length ? n : Math.max(0, length - 1)
}
const shooterConfigs = computed(() => shooter.value?.configs || [])
const targetConfigs = computed(() => target.value?.configs || [])
// 同车检视（普通装甲页）：射击方与受击方是同一辆，未单独给 scfg 时跟随受击方 config，
// 否则弹表会和场景 applyConfig 之后的弹表脱节。
const shooterCfg = computed(() => {
  if (!shooterConfigs.value.length) return null
  const fallback = props.scfg != null
    ? props.scfg
    : (props.shooterId === props.targetId ? props.config : null)
  return clamp(fallback, shooterConfigs.value.length)
})
const targetCfg = computed(() => (targetConfigs.value.length ? clamp(props.config, targetConfigs.value.length) : null))
const shells = computed(() => (shooterCfg.value == null ? [] : (shooterConfigs.value[shooterCfg.value]?.shells || [])))
/** 「主炮」按炮去重：同一门炮挂在两座炮塔上只出现一次（取首个配置；炮塔名进 title）。 */
const shooterOptions = computed(() => {
  const byKey = new Map()
  shooterConfigs.value.forEach((cfg, index) => {
    const gun = gunOf(shooterModules.value, cfg)
    const key = gun?.stem || `${cfg.turret_local}:${cfg.gun_local}`
    const hit = byKey.get(key)
    if (hit) hit.indices.push(index)
    else byKey.set(key, { index, indices: [index], key, label: cfg.label })
  })
  return [...byKey.values()]
})
const currentShooter = computed(() => (shooterCfg.value == null ? null : shooterConfigs.value[shooterCfg.value]))
const currentShooterGunKey = computed(() => {
  const cfg = currentShooter.value
  if (!cfg) return null
  const gun = gunOf(shooterModules.value, cfg)
  return gun?.stem || `${cfg.turret_local}:${cfg.gun_local}`
})
const shellCfg = computed(() => (shells.value.length ? clamp(props.shell, shells.value.length) : null))
const calibrated = computed(() => (props.eqcal == null ? props.calibratedDefault : String(props.eqcal) === '1'))
const enhanced = computed(() => (props.eqenh == null ? props.enhancedDefault : String(props.eqenh) === '1'))

/** 配置对应的炮（模块表按 turret_local/gun_local 对号；缺数据时 null）。 */
function gunOf(modules, cfg) {
  if (!modules || !cfg) return null
  const turret = (modules.turrets || []).find(item => item.localId === cfg.turret_local)
  return (turret?.guns || []).find(item => item.localId === cfg.gun_local) || null
}
const lang = computed(() => (locale.value === 'zh' ? 'zh-Hans' : 'en'))
function itemName(item) {
  if (!item) return ''
  return item[`name_${lang.value}`] || item['name_zh-Hans'] || item.name_en || item.stem || ''
}
function turretName(modules, cfg) {
  if (!modules || !cfg) return ''
  return itemName((modules.turrets || []).find(turret => turret.localId === cfg.turret_local)) || cfg.turret_name || ''
}
/** 同炮不同炮塔的配置用「炮塔名 · 炮名」区分（客户端配置名只有炮名）。 */
function configTitle(list, modules, index) {
  const cfg = index == null ? null : list[index]
  if (!cfg) return ''
  const turret = turretName(modules, cfg)
  return turret ? `${turret} · ${cfg.label}` : cfg.label
}
/** 同车检视：选一门炮时优先留在当前炮塔的同炮配置。 */
function selectShooterGun(option) {
  if (option.key === currentShooterGunKey.value) return
  const currentTurret = props.shooterId === props.targetId
    ? targetConfigs.value[targetCfg.value]?.turret_local
    : null
  const sameTurret = currentTurret == null
    ? null
    : option.indices.find(index => shooterConfigs.value[index]?.turret_local === currentTurret)
  emit('shooter-config', sameTurret ?? option.index)
}
function shellTitle(shell) {
  if (!shell) return ''
  const pen = shell.penetration == null ? '' : ` · ${Math.round(shell.penetration)}mm`
  const dmg = shell.damage == null ? '' : ` · ${Math.round(shell.damage)}`
  return `${shellLabel(shell) || shell.type}${pen}${dmg}`
}
</script>

<template>
  <div v-if="shooter && target" class="shot-setup" data-testid="armor-shot-setup">
    <section class="ss-group">
      <h3 class="ss-title">{{ t('armor.shooter') }}</h3>
      <div class="ss-row" role="group" :aria-label="t('armor.shooter')">
        <button
          v-for="option in shooterOptions"
          :key="`sg-${option.index}`"
          type="button"
          class="ss-tile"
          :class="{ 'is-on': option.key === currentShooterGunKey }"
          :aria-pressed="option.key === currentShooterGunKey"
          :aria-label="configTitle(shooterConfigs, shooterModules, option.index)"
          :title="configTitle(shooterConfigs, shooterModules, option.index)"
          :data-testid="`shot-shooter-gun-${option.index}`"
          @click="selectShooterGun(option)"
        >
          <img :src="moduleIconUrl('gun')" alt="" width="32" height="32" loading="lazy">
          <span v-if="gunOf(shooterModules, shooterConfigs[option.index])?.level != null" class="ss-level">{{ romanLevel(gunOf(shooterModules, shooterConfigs[option.index]).level) }}</span>
        </button>
      </div>
      <p class="ss-value" data-testid="shot-shooter-label">{{ configTitle(shooterConfigs, shooterModules, shooterCfg) }}</p>
      <div v-if="shells.length" class="ss-row" role="group" :aria-label="t('armor.shell')">
        <button
          v-for="(shell, index) in shells"
          :key="`sh-${index}`"
          type="button"
          class="ss-shell"
          :class="{ 'is-on': index === shellCfg }"
          :aria-pressed="index === shellCfg"
          :aria-label="shellTitle(shell)"
          :title="shellTitle(shell)"
          :data-testid="`shot-shell-${index}`"
          @click="index === shellCfg ? null : emit('shell', index)"
        >
          <img :src="shellIconUrl(shell.type)" alt="" width="28" height="28" loading="lazy">
        </button>
      </div>
      <button
        type="button"
        class="ss-switch"
        :class="{ 'is-on': calibrated }"
        :aria-pressed="calibrated"
        data-testid="shot-calibrated"
        @click="emit('calibrated', !calibrated)"
      >
        <Check :size="14" aria-hidden="true" />
        {{ t('armor.calibrated') }}
      </button>
    </section>

    <section class="ss-group">
      <h3 class="ss-title">{{ t('armor.target') }}</h3>
      <div class="ss-row" role="group" :aria-label="t('armor.target')">
        <button
          v-for="(cfg, index) in targetConfigs"
          :key="`tg-${index}`"
          type="button"
          class="ss-tile"
          :class="{ 'is-on': index === targetCfg }"
          :aria-pressed="index === targetCfg"
          :aria-label="configTitle(targetConfigs, targetModules, index)"
          :title="configTitle(targetConfigs, targetModules, index)"
          :data-testid="`shot-target-config-${index}`"
          @click="index === targetCfg ? null : emit('target-config', index)"
        >
          <img :src="moduleIconUrl('gun')" alt="" width="32" height="32" loading="lazy">
          <span v-if="gunOf(targetModules, cfg)?.level != null" class="ss-level">{{ romanLevel(gunOf(targetModules, cfg).level) }}</span>
        </button>
      </div>
      <p class="ss-value" data-testid="shot-target-label">{{ configTitle(targetConfigs, targetModules, targetCfg) }}</p>
      <button
        type="button"
        class="ss-switch"
        :class="{ 'is-on': enhanced }"
        :aria-pressed="enhanced"
        data-testid="shot-enhanced"
        @click="emit('enhanced', !enhanced)"
      >
        <Check :size="14" aria-hidden="true" />
        {{ t('armor.enhanced') }}
      </button>
    </section>
  </div>
</template>

<style scoped>
.shot-setup { display: grid; gap: var(--space-3); min-inline-size: 0; }
.ss-group { display: grid; gap: var(--space-1); min-inline-size: 0; }
.ss-title { margin: 0; color: var(--color-text-secondary); font: var(--type-caption); font-weight: 600; }
.ss-row { display: flex; flex-wrap: wrap; gap: var(--space-1); }
.ss-tile {
  position: relative;
  display: grid;
  place-items: center;
  inline-size: 48px;
  block-size: 40px;
  padding: 0;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-sm);
  background: var(--color-surface-2);
  cursor: pointer;
}
.ss-tile img { inline-size: 32px; block-size: 32px; object-fit: contain; }
.ss-tile.is-on { border-color: var(--color-accent); background: color-mix(in oklab, var(--color-accent) 14%, var(--color-surface-1)); }
.ss-tile:focus-visible, .ss-shell:focus-visible, .ss-switch:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }
.ss-level {
  position: absolute;
  inset-block-start: 0;
  inset-inline-end: 0;
  min-inline-size: 14px;
  padding: 0 2px;
  border-radius: var(--radius-full);
  background: var(--color-surface-1);
  color: var(--color-text-secondary);
  font: var(--type-caption);
  font-weight: 700;
}
.ss-value { margin: 0; color: var(--color-text-secondary); font: var(--type-caption); overflow-wrap: anywhere; }
.ss-shell {
  display: grid;
  place-items: center;
  inline-size: 40px;
  block-size: 32px;
  padding: 0;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-sm);
  background: var(--color-surface-2);
  cursor: pointer;
}
.ss-shell img { inline-size: 28px; block-size: 28px; object-fit: contain; }
.ss-shell.is-on { border-color: var(--color-accent); background: color-mix(in oklab, var(--color-accent) 14%, var(--color-surface-1)); }
.ss-switch {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  min-block-size: var(--hit-min);
  padding: 0 var(--space-3);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-full);
  background: var(--color-surface-2);
  color: var(--color-text-secondary);
  font: var(--type-caption);
  cursor: pointer;
}
.ss-switch svg { opacity: 0; }
.ss-switch.is-on { border-color: var(--color-accent); color: var(--color-text-primary); }
.ss-switch.is-on svg { opacity: 1; }
</style>
