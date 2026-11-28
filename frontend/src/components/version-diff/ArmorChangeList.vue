<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import VersionDiffReading from './VersionDiffReading.vue'
import {
  armorFaceLabel, armorRows, deltaDiffValue, faceLabel, fmtDiffValue, moduleLabel,
} from './versionDiffFormat.js'
import type { ArmorRow } from './versionDiffFormat.js'
import type { DiffPair } from '../../composables/useVersionDiff.js'
import './version-diff.css'

interface ArmorChangeListProps {
  armor?: unknown
  detail?: unknown
  pair?: DiffPair | null
  /** 允许点击板件行：选中后在对比器里突出该板、淡化其余装甲。 */
  selectable?: boolean
  /** 当前选中的板件隔离键（module:plate），用于回显行高亮。 */
  selectedKeys?: string[]
  /** 当前选中的配置键（turretLocal/gunLocal）；配置级行只有同配置才高亮/可切换。 */
  selectedConfigKey?: string
}

const props = withDefaults(defineProps<ArmorChangeListProps>(), {
  pair: null,
  selectable: false,
  selectedKeys: () => [],
  selectedConfigKey: '',
})
const emit = defineEmits<{ select: [selection: { configKey: string; keys: string[] }] }>()
const { t, te } = useI18n()

const rows = computed(() => armorRows(props.armor, props.detail))
const directionRows = computed(() => rows.value.filter(row => row.kind === 'direction'))
const plateRows = computed(() => rows.value
  .filter(row => row.kind != null && ['plate', 'addedPlate', 'removedPlate', 'configPlate'].includes(row.kind)))
const structureRows = computed(() => rows.value.filter(row => row.kind != null && ['primary', 'configSpaced'].includes(row.kind)))
const chassisRows = computed(() => rows.value.filter(row => row.kind === 'chassis'))
const empty = computed(() => rows.value.length === 0)

// 行 → 对比器板件隔离键（与 armorComparisonModel 的 armorPlateKey 同一口径）。
function rowKeys(row: ArmorRow): string[] {
  const plateId = (value: unknown): string | null => {
    const id = String(value ?? '').replace(/^armor_/, '')
    return /^\d+$/.test(id) ? id : null
  }
  if (row.kind === 'plate' || row.kind === 'addedPlate' || row.kind === 'removedPlate'
    || row.kind === 'configPlate' || row.kind === 'configSpaced') {
    return [`${row.module}:${row.plate}`]
  }
  if (row.kind === 'primary') {
    return [plateId(row.old), plateId(row.new)]
      .filter((plate): plate is string => plate != null)
      .map(plate => `${row.module}:${plate}`)
  }
  if (row.kind === 'chassis') {
    return [`chassis:${row.field === 'left_track' ? 'leftTrack' : 'rightTrack'}`]
  }
  return []
}

function rowActive(row: ArmorRow): boolean {
  const keys = rowKeys(row)
  if (!keys.length) return false
  // 同一块板号可能出现在多个配置：配置级行只有选中配置与自身一致才算 active。
  if (row.configKey && row.configKey !== props.selectedConfigKey) return false
  return keys.some(key => props.selectedKeys.includes(key))
}

function selectRow(row: ArmorRow) {
  if (!props.selectable) return
  const keys = rowKeys(row)
  if (!keys.length) return
  const active = rowActive(row)
  emit('select', { configKey: row.configKey || '', keys: active ? [] : keys })
}

function rowKey(row: ArmorRow): string {
  return [row.kind, row.configKey || '', row.module || '', row.plate || row.side || row.field || ''].join('-')
}

function plateSection(row: ArmorRow) {
  return row.section ? row.section.split('/').map(face => faceLabel(face, t, te)).join(' / ') : ''
}

function chassisLabel(field?: string) {
  return field === 'left_track' ? t('versionDiff.chassis.leftTrack') : t('versionDiff.chassis.rightTrack')
}

function structureLabel(row: ArmorRow): string {
  const part = moduleLabel(row.module ?? '', t, te)
  const area = row.kind === 'primary'
    ? faceLabel(row.side ?? '', t, te)
    : t('versionDiff.armor.spaced') + ' #' + row.plate
  return part + ' · ' + area
}

function sideValue(row: ArmorRow, side: 0 | 1): unknown {
  if (row.kind === 'addedPlate') return side === 1 ? (row.thickness ?? null) : null
  if (row.kind === 'removedPlate') return side === 0 ? (row.thickness ?? null) : null
  return side === 0 ? row.old : row.new
}

function sideText(row: ArmorRow, side: 0 | 1): string {
  const value = sideValue(row, side)
  return value === null || value === undefined ? '—' : fmtDiffValue(value)
}

function rowDelta(row: ArmorRow): string {
  if (row.kind === 'configSpaced') return row.added ? t('versionDiff.added') : t('versionDiff.removed')
  if (row.kind === 'addedPlate') {
    return row.thickness != null ? `+${fmtDiffValue(row.thickness)}` : t('versionDiff.added')
  }
  if (row.kind === 'removedPlate') {
    return row.thickness != null ? `-${fmtDiffValue(row.thickness)}` : t('versionDiff.removed')
  }
  return deltaDiffValue(row.old, row.new)
}
</script>

<template>
  <div class="vd-armor-list">
    <p v-if="empty" class="vd-muted">{{ t('versionDiff.armor.empty') }}</p>

    <section v-if="directionRows.length" class="vd-block">
      <h4 class="vd-block-title">{{ t('versionDiff.armor.directions') }}</h4>
      <dl class="vd-param-list">
        <div v-for="row in directionRows" :key="row.path">
          <dt>{{ armorFaceLabel((row.path || '').slice(6), t, te) }}</dt>
          <dd><VersionDiffReading :before="fmtDiffValue(row.old)" :value="fmtDiffValue(row.new)"
            :unit="t('agentTanks.units.MILLIMETER')" :delta="deltaDiffValue(row.old, row.new)" /></dd>
        </div>
      </dl>
    </section>

    <section v-if="plateRows.length" class="vd-block">
      <h4 class="vd-block-title">{{ t('versionDiff.armor.plates') }}</h4>
      <div class="vd-table-wrap">
        <table class="vd-table">
          <thead>
            <tr>
              <th scope="col">{{ t('versionDiff.armor.plate') }}</th>
              <th scope="col" class="is-num">{{ pair?.from.dataset || t('versionDiff.old') }} → {{ pair?.to.dataset || t('versionDiff.new') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in plateRows"
              :key="rowKey(row)"
              :class="{ 'is-selectable': selectable && rowKeys(row).length, 'is-active': rowActive(row) }"
              @click="selectRow(row)"
            >
              <td>
                <button v-if="selectable && rowKeys(row).length" type="button" class="vd-text-link vd-plate-select"
                  :aria-pressed="rowActive(row)" @click.stop="selectRow(row)">
                  {{ moduleLabel(row.module ?? '', t, te) }} #{{ row.plate }}
                </button>
                <span v-else>{{ moduleLabel(row.module ?? '', t, te) }} #{{ row.plate }}</span>
                <span v-if="plateSection(row) || row.configLabel" class="vd-muted vd-param-context">
                  {{ [plateSection(row), row.configLabel].filter(Boolean).join(' · ') }}
                </span>
              </td>
              <td class="is-num">
                <VersionDiffReading :before="sideText(row, 0)" :value="sideText(row, 1)"
                  :unit="t('agentTanks.units.MILLIMETER')" :delta="rowDelta(row)" />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section v-if="structureRows.length" class="vd-block">
      <h4 class="vd-block-title">{{ t('versionDiff.armor.structure') }}</h4>
      <dl class="vd-param-list">
        <div v-for="row in structureRows" :key="rowKey(row)"
          :class="{ 'is-selectable': selectable && rowKeys(row).length, 'is-active': rowActive(row) }"
          @click="selectRow(row)">
          <dt>
            <button v-if="selectable && rowKeys(row).length" type="button" class="vd-text-link vd-plate-select"
              :aria-pressed="rowActive(row)" @click.stop="selectRow(row)">{{ structureLabel(row) }}</button>
            <template v-else>{{ structureLabel(row) }}</template>
            <small v-if="row.configLabel" class="vd-muted vd-param-context">{{ row.configLabel }}</small>
          </dt>
          <dd>
            <VersionDiffReading v-if="row.kind === 'primary'" :before="fmtDiffValue(row.old)" :value="fmtDiffValue(row.new)" />
            <span v-else>{{ row.added ? t('versionDiff.added') : t('versionDiff.removed') }}</span>
          </dd>
        </div>
      </dl>
    </section>

    <section v-if="chassisRows.length" class="vd-block">
      <h4 class="vd-block-title">{{ t('versionDiff.modules.chassis') }}</h4>
      <dl class="vd-param-list">
        <div v-for="row in chassisRows" :key="row.field"
          :class="{ 'is-selectable': selectable, 'is-active': rowActive(row) }" @click="selectRow(row)">
          <dt>
            <button v-if="selectable" type="button" class="vd-text-link vd-plate-select"
              :aria-pressed="rowActive(row)" @click.stop="selectRow(row)">{{ chassisLabel(row.field) }}</button>
            <template v-else>{{ chassisLabel(row.field) }}</template>
          </dt>
          <dd><VersionDiffReading :before="fmtDiffValue(row.old)" :value="fmtDiffValue(row.new)"
            :unit="t('agentTanks.units.MILLIMETER')" :delta="deltaDiffValue(row.old, row.new)" /></dd>
        </div>
      </dl>
    </section>
  </div>
</template>
