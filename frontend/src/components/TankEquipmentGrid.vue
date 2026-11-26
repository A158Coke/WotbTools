<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { itemIconUrl } from '../utils/researchCatalog.js'
import { fmtNum } from '../scene/tankMeta.js'
import type { SetupSelection } from '../replay-local/compute/tankSetupTypes'

interface Device {
  id?: number | string
  stem?: string
  icon?: string
  description_en?: string
  script?: { params?: { attribute?: string; bonusValues?: { percent?: number | string } } }
  displayParams?: Record<string, unknown>
  [key: string]: unknown
}
interface EquipmentSlot { level?: number; group?: string; left?: string; right?: string }

const props = defineProps<{
  detail: { type?: string }; selection: SetupSelection; catalog: { devices: Device[] }
  slots: EquipmentSlot[]; itemName: (item: Device) => string; lang: string; comparisonLayout?: boolean
}>()
const emit = defineEmits(['update'])
const { t } = useI18n()
const GROUPS = ['attack', 'defence', 'specialization']
const LEVELS = [0, 1, 2]
function slotIndex(level: number, group: string) {
  return props.slots.findIndex(slot => Number(slot?.level) === level && slot?.group === group)
}

function device(stem: string | null | undefined) {
  if (!stem) return null
  return props.catalog.devices.find(item => item.stem === stem) || null
}

function deviceLabel(stem: string | null | undefined) {
  const item = device(stem)
  return item ? props.itemName(item) : stem
}

function deviceIcon(stem: string | null | undefined) {
  const item = device(stem)
  return item ? itemIconUrl('devices', item.icon) : null
}

const MODULE_DEFENCE_DEVICE_IDS = new Set([108, 109, 112, 120, 121])

const DEVICE_PERCENT_KEYS = new Set([
  'gunReloadTimeFactor', 'equipmentDurationFactor', 'gunAimingTimeFactor',
  'additiveShotDispersionFactor', 'shotDispersionAngleFactor', 'maxHealthPercentageBonus',
  'rammingAbsorptionPercent', 'armorHomogenizationFactor', 'maxHpBonusPercent',
  'repairSpeedFactor', 'rotationSpeedLimit', 'circularVisionRadiusFactor', 'detectabilityFactor', 'enginePower',
  'equipmentReloadBoost', 'projectileSpeedFactor', 'piercingPenaltyFactor500m',
  'firmGroundPassabilityIncrease', 'mediumGroundPassabilityIncrease',
  'softGroundPassabilityIncrease', 'ARMOR_PIERCING', 'ARMOR_PIERCING_CR',
  'HOLLOW_CHARGE', 'HIGH_EXPLOSIVE',
  'engineEvasionPercentageBonus', 'crewEvasionPercentageBonus', 'ammoEvasionPercentageBonus',
])
const DEVICE_RAW_KEYS = new Set([
  'upperPitchLimitIncrease', 'lowerPitchLimitIncrease',
  'circularVisionRadiusIncrease', 'activateWhenStillSec',
])
const DEVICE_CLASS_KEYS: Record<string, string> = {
  lightTank: 'Light', mediumTank: 'Medium', heavyTank: 'Heavy', 'AT-SPG': 'AT_SPG', SPG: 'AT_SPG',
}
const vehicleClassKey = () => DEVICE_CLASS_KEYS[props.detail?.type || ''] || null

function deviceScriptPercent(item: Device, key: string) {
  const params = item.script?.params || {}
  const attr = String(params.attribute || '').split('/').pop()
  const percent = Number(params.bonusValues?.percent)
  return attr === key && Number.isFinite(percent) ? percent : null
}

function deviceDisplayValue(item: Device, key: string) {
  let raw = item.displayParams?.[key]
  if (raw != null && typeof raw === 'object') {
    const classKey = vehicleClassKey()
    const values = raw as Record<string, unknown>
    raw = classKey != null && values[classKey] != null ? values[classKey] : Object.values(values)[0]
  }
  const percent = deviceScriptPercent(item, key)
  if (percent != null) raw = percent
  if (raw == null || raw === '') return ''
  if (DEVICE_RAW_KEYS.has(key)) return String(fmtNum(Number(raw), 1))
  if (!DEVICE_PERCENT_KEYS.has(key)) return String(raw)
  const value = Number(raw)
  if (!Number.isFinite(value)) return String(raw)
  const sign = value > 0 ? '+' : value < 0 ? '−' : ''
  return `${sign}${fmtNum(Math.abs(value), 1)}%`
}

function deviceHint(stem: string | null | undefined) {
  const item = device(stem)
  if (!item) return stem || ''
  const localized = item[`description_${props.lang}`]
  const description = typeof localized === 'string' ? localized : item.description_en || ''
  const note = MODULE_DEFENCE_DEVICE_IDS.has(Number(item.id))
    ? ` · ${t('agentTanks.configurator.equipment_no_stat_note')}`
    : ''
  const filled = description
    .replace(/%\(([^)]+)\)/g, (_, key) => (key === 'highlight_start' || key === 'highlight_end' ? '' : deviceDisplayValue(item, key)))
    .replace(/%%/g, '%')
  return `${props.itemName(item)} — ${filled}${note}`
}

function deviceChoice(index: number, choice: 0 | 1) {
  if (index < 0) return
  const devices = props.selection.devices.slice()
  devices[index] = devices[index] === choice ? null : choice
  emit('update', { devices })
}

</script>

<template>
    <section class="tp-config-block">
      <div class="tp-block-head tp-loadout-head">
        <h3>{{ t('agentTanks.configurator.equipment') }}</h3>
        <span class="tp-muted tp-loadout-hint">{{ t('agentTanks.configurator.equipment_hint') }}</span>
        <div v-if="$slots.devices" class="tp-loadout-action"><slot name="devices" /></div>
        <span v-if="comparisonLayout" class="tp-muted tp-loadout-count">{{ selection.devices.filter(v => v != null).length }}/{{ slots.filter(s => s?.left || s?.right).length }}</span>
      </div>
      <div class="tp-dev-matrix" role="group" :aria-label="t('agentTanks.configurator.equipment')">
        <div class="tp-dev-corner" aria-hidden="true"></div>
        <div v-for="group in GROUPS" :key="group" class="tp-dev-group">{{ t(`agentTanks.configurator.groups.${group}`) }}</div>
        <template v-for="level in LEVELS" :key="level">
          <div class="tp-dev-level">{{ t(`agentTanks.configurator.level_${level + 1}`) }}</div>
          <div v-for="group in GROUPS" :key="`${level}-${group}`" class="tp-dev-slot">
            <button
              v-for="choice in [0, 1]"
              :key="choice"
              type="button"
              class="tp-dev-btn"
              :class="{ 'is-on': selection.devices[slotIndex(level, group)] === choice }"
              :aria-pressed="selection.devices[slotIndex(level, group)] === choice"
              :aria-label="deviceLabel(slots[slotIndex(level, group)]?.[choice === 0 ? 'left' : 'right']) || t('agentTanks.configurator.empty_slot')"
              :disabled="!slots[slotIndex(level, group)]?.[choice === 0 ? 'left' : 'right']"
              :title="deviceHint(slots[slotIndex(level, group)]?.[choice === 0 ? 'left' : 'right'])"
              :data-testid="`tank-device-${level}-${group}-${choice}`"
              @click="deviceChoice(slotIndex(level, group), choice)"
            >
              <img
                v-if="deviceIcon(slots[slotIndex(level, group)]?.[choice === 0 ? 'left' : 'right'])"
                :src="deviceIcon(slots[slotIndex(level, group)]?.[choice === 0 ? 'left' : 'right'])"
                alt=""
                width="40"
                height="40"
                loading="lazy"
              >
              <span v-else class="tp-tile-fallback">
                {{ (deviceLabel(slots[slotIndex(level, group)]?.[choice === 0 ? 'left' : 'right']) || '–').slice(0, 2) }}
              </span>
            </button>
          </div>
        </template>
      </div>
    </section>

</template>

<style scoped>
.tp-config-block { display: grid; gap: var(--space-2); min-inline-size: 0; }
.tp-block-head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: var(--space-1) var(--space-2); }
.tp-block-head h3 { margin: 0; font: var(--type-body); font-weight: 600; }
.tp-muted { margin: 0; color: var(--color-text-secondary); font: var(--type-caption); }
.tp-tile-fallback { color: var(--color-text-secondary); font: var(--type-caption); font-weight: 600; overflow-wrap: anywhere; }
.tp-dev-matrix {
  display: grid;
  grid-template-columns: auto repeat(3, minmax(0, 1fr));
  gap: var(--space-1) var(--space-2);
  align-items: stretch;
}
.tp-dev-corner { min-inline-size: 0; }
.tp-dev-group { color: var(--color-text-secondary); font: var(--type-caption); font-weight: 600; text-align: center; overflow-wrap: anywhere; }
.tp-dev-level { display: flex; align-items: center; color: var(--color-text-secondary); font: var(--type-caption); font-weight: 600; }
.tp-dev-slot { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-1); min-inline-size: 0; }
.tp-dev-btn {
  display: grid;
  place-items: center;
  min-block-size: var(--control-h-lg);
  padding: var(--space-1);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-surface-2);
  color: var(--color-text-secondary);
  cursor: pointer;
}
.tp-dev-btn:hover { border-color: var(--color-border-strong); }
.tp-dev-btn.is-on { border-color: var(--color-accent); background: color-mix(in oklab, var(--color-accent) 16%, var(--color-surface-1)); }
.tp-dev-btn:disabled { cursor: default; opacity: 0.35; }
.tp-dev-btn:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }
.tp-dev-btn img { inline-size: 40px; block-size: 40px; object-fit: contain; }

@media (width < 768px) {
  .tp-dev-matrix { gap: var(--space-3); }
  .tp-dev-slot { grid-template-columns: repeat(auto-fit, minmax(var(--hit-min-comfortable), 1fr)); gap: calc(var(--space-1) / 2); }
  .tp-dev-btn { min-inline-size: var(--hit-min-comfortable); min-block-size: var(--hit-min-comfortable); padding: 2px; }
  .tp-dev-btn img { inline-size: 32px; block-size: 32px; }
}
</style>
