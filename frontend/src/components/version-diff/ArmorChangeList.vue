<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
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
  return row.section ? faceLabel(row.section.split('/')[0], t, te) : '—'
}

function chassisLabel(field?: string) {
  return field === 'left_track' ? t('versionDiff.chassis.leftTrack') : t('versionDiff.chassis.rightTrack')
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
      <div class="vd-armor-grid">
        <div v-for="row in directionRows" :key="row.path" class="vd-armor-cell">
          <span class="vd-armor-name">{{ armorFaceLabel((row.path || '').slice(6), t, te) }}</span>
          <span class="vd-value">{{ fmtDiffValue(row.old) }}</span>
          <span class="vd-arrow">→</span>
          <span class="vd-value is-new">{{ fmtDiffValue(row.new) }}</span>
          <span class="vd-delta">{{ deltaDiffValue(row.old, row.new) }}</span>
        </div>
      </div>
    </section>

    <section v-if="plateRows.length" class="vd-block">
      <h4 class="vd-block-title">{{ t('versionDiff.armor.plates') }}</h4>
      <div class="vd-table-wrap">
        <table class="vd-table">
          <thead>
            <tr>
              <th>{{ t('versionDiff.armor.module') }}</th>
              <th>{{ t('versionDiff.armor.section') }}</th>
              <th>{{ t('versionDiff.armor.plate') }}</th>
              <th class="is-num">{{ pair?.from.dataset || t('versionDiff.old') }}</th>
              <th class="is-num">{{ pair?.to.dataset || t('versionDiff.new') }}</th>
              <th class="is-num">{{ t('versionDiff.delta') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in plateRows"
              :key="rowKey(row)"
              :class="{ 'is-selectable': selectable && rowKeys(row).length, 'is-active': rowActive(row) }"
              @click="selectRow(row)"
            >
              <td>{{ moduleLabel(row.module ?? '', t, te) }}<span v-if="row.configLabel" class="vd-muted"> · {{ row.configLabel }}</span></td>
              <td>{{ plateSection(row) }}</td>
              <td>#{{ row.plate }}</td>
              <td class="is-num">{{ sideText(row, 0) }}</td>
              <td class="is-num">{{ sideText(row, 1) }}</td>
              <td class="is-num vd-delta">{{ rowDelta(row) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section v-if="structureRows.length" class="vd-block">
      <h4 class="vd-block-title">{{ t('versionDiff.armor.structure') }}</h4>
      <ul class="vd-list">
        <li
          v-for="row in structureRows.filter(item => item.kind === 'primary')"
          :key="`primary-${row.module}-${row.side}`"
          :class="{ 'is-selectable': selectable && rowKeys(row).length, 'is-active': rowActive(row) }"
          @click="selectRow(row)"
        >
          {{ moduleLabel(row.module ?? '', t, te) }}<span v-if="row.configLabel" class="vd-muted"> · {{ row.configLabel }}</span> · {{ faceLabel(row.side ?? '', t, te) }}:
          {{ fmtDiffValue(row.old) }} → {{ fmtDiffValue(row.new) }}
        </li>
        <li
          v-for="row in structureRows.filter(item => item.kind === 'configSpaced')"
          :key="rowKey(row)"
          :class="{ 'is-selectable': selectable && rowKeys(row).length, 'is-active': rowActive(row) }"
          @click="selectRow(row)"
        >
          {{ moduleLabel(row.module ?? '', t, te) }}<span v-if="row.configLabel" class="vd-muted"> · {{ row.configLabel }}</span> · {{ t('versionDiff.armor.spaced') }} #{{ row.plate }}:
          {{ row.added ? t('versionDiff.added') : t('versionDiff.removed') }}
        </li>
      </ul>
    </section>

    <section v-if="chassisRows.length" class="vd-block">
      <h4 class="vd-block-title">{{ t('versionDiff.modules.chassis') }}</h4>
      <ul class="vd-list">
        <li
          v-for="row in chassisRows"
          :key="`chassis-${row.field}`"
          :class="{ 'is-selectable': selectable && rowKeys(row).length, 'is-active': rowActive(row) }"
          @click="selectRow(row)"
        >
          {{ chassisLabel(row.field) }}: {{ fmtDiffValue(row.old) }} → {{ fmtDiffValue(row.new) }}
        </li>
      </ul>
    </section>
  </div>
</template>
