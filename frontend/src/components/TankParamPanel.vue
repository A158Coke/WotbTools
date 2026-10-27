<script setup>
/**
 * 参数区（protectability / gun / mobility）：每行「名称 + 上一次值 delta + 主值」。
 * 数值来自 replay-local/compute/characteristics（与配置面板同一套选择态），
 * 分组/小数位/单位/越大越好来自客户端 params/{structure,format}.json。
 * 显示口径对齐客户端 NumberValue：delta 绿色 = 有利、红色 = 不利（biggerIsBetter 决定方向）。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { armorRows } from '../replay-local/compute/tankSetup'
import { fmtNum } from '../scene/tankMeta.js'
import GunArcDiagram from './GunArcDiagram.vue'

const props = defineProps({
  /** paramGroups() 输出 */
  groups: { type: Array, required: true },
  /** 引擎输出（当前值） */
  current: { type: Object, required: true },
  /** 上一次渲染的特性（BK useDelta）：delta = 当前 − 上一次；初次为空 */
  base: { type: Object, default: () => ({}) },
  /** 当前配置的火炮元信息（口径 + 循环类型），来自 tank/{id}.json */
  gunMeta: { type: Object, default: null },
  /** 当前配置的 pitch_limits / yaw_limits（交互射界图的原始数据） */
  pitchLimits: { type: Object, default: null },
  yawLimits: { type: Object, default: null },
  /** 装备加成（improvedPitchLimitsSystem） */
  pitchBonus: { type: Object, default: null },
  /** 当前配置的弹种（含每个弹种的选择态/联动值） */
  shells: { type: Array, default: () => [] },
})
const emit = defineEmits(['select-shell'])

const { t } = useI18n()

/** 概览条（BlitzInfo “Characteristics” 同构）：HP / 单发伤害 / 穿深 / 极速 / 视野 */
const summary = computed(() => {
  const current = props.current || {}
  return [
    { key: 'hp', label: t('agentTanks.hp'), value: fmtNum(current.maxHealth, 0) },
    { key: 'damage', label: t('agentTanks.dmg'), value: fmtNum(current.baseShellAvgDamage, 0) },
    { key: 'pen', label: t('agentTanks.pen'), value: fmtNum(current.baseShellAvgPiercingPower, 0), unit: t('agentTanks.units.MILLIMETER') },
    { key: 'speed', label: t('agentTanks.speed_fwd'), value: fmtNum(current.maxFrontSpeed, 0), unit: t('agentTanks.units.KILOMETER_PER_HOUR') },
    { key: 'view', label: t('agentTanks.view_range'), value: fmtNum(current.circularVisionRadius, 0), unit: t('agentTanks.units.METER') },
  ].filter(item => item.value !== '-')
})

const gunTypeLabel = computed(() => {
  const type = props.gunMeta?.type
  return type ? t(`agentTanks.configurator.gun_type_${type}`) : ''
})

const armorTable = computed(() => armorRows(props.current, props.base))
const hasTurretArmor = computed(() => armorTable.value.some(row => row.turret.value != null))
const hasHullArmor = computed(() => armorTable.value.some(row => row.hull.value != null))
const selectedShell = computed(() => props.shells.find(shell => shell.selected) || null)

</script>

<template>
  <section class="tp-params" data-testid="tank-params">
    <header class="tp-params-head">
      <h2 class="tp-section-title">{{ t('agentTanks.params.title') }}</h2>
      <p class="tp-muted">{{ t('agentTanks.params.baseline_note') }}</p>
    </header>

    <dl class="tp-summary-strip" data-testid="tank-summary">
      <div v-for="item in summary" :key="item.key" :data-testid="`tank-summary-${item.key}`">
        <dt>{{ item.label }}</dt>
        <dd>{{ item.value }}<span v-if="item.unit" class="tp-summary-unit">{{ item.unit }}</span></dd>
      </div>
    </dl>

    <div class="tp-param-grid" data-testid="tank-param-grid">
      <section v-for="group in groups" :key="group.group" class="tp-param-group" :data-testid="`tank-params-${group.group}`">
        <h3>
          {{ t(`agentTanks.params.groups.${group.group}`) }}
          <span v-if="group.group === 'gun' && gunMeta && gunTypeLabel" class="tp-gun-meta" data-testid="tank-gun-meta">
            {{ t('agentTanks.configurator.gun_meta', { caliber: gunMeta.caliber ?? '—', type: gunTypeLabel }) }}
          </span>
        </h3>

        <table v-if="group.group === 'protectability' && (hasTurretArmor || hasHullArmor)" class="tp-armor-table">
          <thead>
            <tr>
              <th scope="col">{{ t('agentTanks.params.armor') }}</th>
              <th v-if="hasTurretArmor" scope="col">{{ t('agentTanks.params.turret') }}</th>
              <th v-if="hasHullArmor" scope="col">{{ t('agentTanks.params.hull') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in armorTable" :key="row.part">
              <th scope="row">{{ t(`agentTanks.params.armor_${row.part}`) }}</th>
              <td v-if="hasTurretArmor">
                <span
                  v-if="row.turret.delta"
                  class="tp-param-delta"
                  :class="row.turret.good ? 'is-good' : 'is-bad'"
                >{{ fmtNum(Math.abs(row.turret.delta), 0) }}<span aria-hidden="true">{{ row.turret.delta > 0 ? '▲' : '▼' }}</span></span>
                <span class="tp-param-value">{{ fmtNum(row.turret.value, 1) }}</span>
                <span class="tp-param-unit">{{ t('agentTanks.units.MILLIMETER') }}</span>
              </td>
              <td v-if="hasHullArmor">
                <span
                  v-if="row.hull.delta"
                  class="tp-param-delta"
                  :class="row.hull.good ? 'is-good' : 'is-bad'"
                >{{ fmtNum(Math.abs(row.hull.delta), 0) }}<span aria-hidden="true">{{ row.hull.delta > 0 ? '▲' : '▼' }}</span></span>
                <span class="tp-param-value">{{ fmtNum(row.hull.value, 1) }}</span>
                <span class="tp-param-unit">{{ t('agentTanks.units.MILLIMETER') }}</span>
              </td>
            </tr>
          </tbody>
        </table>

        <div v-if="group.group === 'gun' && shells.length" class="tp-shells" data-testid="tank-shell-table">
          <div class="tp-shells-head">
            <span>{{ t('agentTanks.shells') }}</span>
            <span class="tp-muted">{{ t('agentTanks.configurator.shell_pick_hint') }}</span>
          </div>
          <div class="tp-shell-icons" role="group" :aria-label="t('agentTanks.shells')">
            <button
              v-for="shell in shells"
              :key="shell.index"
              type="button"
              class="tp-shell-btn"
              :class="{ 'is-on': shell.selected, 'is-premium': shell.premium }"
              :aria-pressed="shell.selected"
              :aria-label="shell.label"
              :title="`${shell.label} · ${t('agentTanks.pen')} ${fmtNum(shell.tunedPenetration)} · ${t('agentTanks.dmg')} ${fmtNum(shell.tunedDamage, 0)}`"
              :data-testid="`tank-shell-${shell.index}`"
              @click="emit('select-shell', shell.index)"
            >
              <img v-if="shell.iconUrl" :src="shell.iconUrl" alt="" width="40" height="40" loading="lazy">
              <span v-else class="tp-shell-kind" :class="{ 'is-premium': shell.premium }">{{ shell.label }}</span>
            </button>
          </div>
          <dl v-if="selectedShell" class="tp-shell-stats" data-testid="tank-shell-detail">
            <div><dt>{{ t('agentTanks.pen') }}</dt><dd>{{ fmtNum(selectedShell.tunedPenetration) }}</dd></div>
            <div><dt>{{ t('agentTanks.dmg') }}</dt><dd>{{ fmtNum(selectedShell.tunedDamage, 0) }}</dd></div>
            <div><dt>{{ t('agentTanks.velocity') }}</dt><dd>{{ fmtNum(selectedShell.tunedVelocity) }}</dd></div>
            <div><dt>{{ t('agentTanks.pen_far') }}</dt><dd>{{ fmtNum(selectedShell.tunedPenetrationFar) }}</dd></div>
            <div><dt>{{ t('agentTanks.module_dmg') }}</dt><dd>{{ fmtNum(selectedShell.tunedModuleDamage, 0) }}</dd></div>
            <div><dt>{{ t('agentTanks.normalization') }}</dt><dd>{{ fmtNum(selectedShell.normalization, 0) }}°</dd></div>
            <div><dt>{{ t('agentTanks.ricochet') }}</dt><dd>{{ fmtNum(selectedShell.ricochet, 0) }}°</dd></div>
            <div v-if="selectedShell.range != null"><dt>{{ t('agentTanks.configurator.shell_range') }}</dt><dd>{{ fmtNum(selectedShell.range, 0) }} m</dd></div>
            <div v-if="selectedShell.maxAmmo != null"><dt>{{ t('agentTanks.configurator.shell_capacity') }}</dt><dd>{{ fmtNum(selectedShell.maxAmmo, 0) }}</dd></div>
            <div v-if="selectedShell.explosionRadius > 0"><dt>{{ t('agentTanks.configurator.explosion_radius') }}</dt><dd>{{ fmtNum(selectedShell.explosionRadius, 2) }} m</dd></div>
          </dl>
        </div>

        <dl class="tp-param-list">
          <div v-for="row in group.rows" :key="row.key" class="tp-param-row" :data-testid="`tank-param-${row.key}`">
            <dt>{{ t(`agentTanks.params.${row.key}`) }}</dt>
            <dd>
              <span
                v-if="row.delta"
                class="tp-param-delta"
                :class="row.good ? 'is-good' : 'is-bad'"
              >{{ fmtNum(Math.abs(row.delta), row.digits) }}<span aria-hidden="true">{{ row.delta > 0 ? '▲' : '▼' }}</span></span>
              <span class="tp-param-value">{{ fmtNum(row.value, row.digits) }}</span>
              <span v-if="row.unit" class="tp-param-unit">{{ t(`agentTanks.units.${row.unit}`) }}</span>
            </dd>
          </div>
        </dl>

        <GunArcDiagram
          v-if="group.group === 'gun' && pitchLimits"
          :pitch-limits="pitchLimits"
          :yaw-limits="yawLimits"
          :bonus="pitchBonus"
        />
      </section>
    </div>

    <p class="tp-muted">{{ t('agentTanks.params.armor_note') }}</p>
  </section>
</template>

<style scoped>
.tp-params {
  display: grid;
  gap: var(--space-3);
  padding: var(--space-3);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  background: var(--color-surface-1);
  box-shadow: var(--elevation-1);
}

.tp-params-head { display: grid; gap: var(--space-1); }
.tp-section-title { margin: 0; font: var(--type-h3); }
.tp-muted { margin: 0; color: var(--color-text-secondary); font: var(--type-caption); }

.tp-summary-strip {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: var(--space-1);
  margin: 0;
  padding: var(--space-2);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-surface-2);
}
.tp-summary-strip > div { display: grid; gap: 2px; min-inline-size: 0; }
.tp-summary-strip dt { color: var(--color-text-secondary); font: var(--type-caption); overflow-wrap: anywhere; }
.tp-summary-strip dd { display: inline-flex; align-items: baseline; gap: var(--space-1); margin: 0; font: var(--type-h3); font-variant-numeric: tabular-nums; }
.tp-summary-unit { color: var(--color-text-secondary); font: var(--type-caption); }

/* 分组卡片按 BlitzInfo 的 sheet-col 布局流动：每栏约 300–400px，行内标签/数值
   不会被拉到整栏两端；卡片高度独立（break-inside: avoid）。 */
.tp-param-grid { column-width: 280px; column-gap: var(--space-2); }
.tp-param-group {
  display: grid;
  gap: var(--space-1);
  align-content: start;
  break-inside: avoid;
  margin-block-end: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-surface-2);
}
.tp-param-group h3 {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  margin: 0;
  color: var(--color-text-secondary);
  font: var(--type-caption);
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.tp-gun-meta { margin-inline-start: var(--space-2); color: var(--color-text-secondary); font: var(--type-caption); font-weight: 400; letter-spacing: 0; text-transform: none; }

@media (width < 768px) {
  .tp-summary-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

.tp-armor-table { inline-size: 100%; margin-block-end: var(--space-1); border-collapse: collapse; font: var(--type-caption); font-variant-numeric: tabular-nums; }
.tp-armor-table th, .tp-armor-table td { padding: 2px 0; text-align: start; }
.tp-armor-table th:not(:first-child), .tp-armor-table td { text-align: end; }
.tp-armor-table thead th { color: var(--color-text-secondary); font: var(--type-caption); font-weight: 600; }
.tp-armor-table tbody th { color: var(--color-text-secondary); font: var(--type-caption); font-weight: 400; }
.tp-armor-table tbody tr + tr { border-block-start: 1px solid var(--color-border-subtle); }

.tp-shells { display: grid; gap: var(--space-1); padding-block-start: var(--space-2); border-block-start: 1px solid var(--color-border-subtle); }
.tp-shells-head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-2); color: var(--color-text-secondary); font: var(--type-caption); font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }
.tp-shell-icons { display: flex; flex-wrap: wrap; gap: var(--space-1); }
.tp-shell-btn {
  display: grid;
  place-items: center;
  inline-size: 44px;
  block-size: 44px;
  padding: 2px;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-surface-1);
  cursor: pointer;
}
.tp-shell-btn:hover { border-color: var(--color-border-strong); }
.tp-shell-btn.is-on { border-color: var(--color-accent); background: color-mix(in oklab, var(--color-accent) 16%, var(--color-surface-1)); }
.tp-shell-btn.is-premium:not(.is-on) { border-color: color-mix(in oklab, var(--color-warning) 55%, var(--color-border-subtle)); }
.tp-shell-btn:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }
.tp-shell-btn img { inline-size: 100%; block-size: 100%; object-fit: contain; }
.tp-shell-kind { padding: 0 var(--space-1); border-radius: var(--radius-sm); background: var(--color-surface-2); color: var(--color-text-secondary); font: var(--type-caption); font-weight: 700; }
.tp-shell-kind.is-premium { color: var(--color-warning); }
.tp-shell-stats { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 var(--space-2); margin: 0; }
.tp-shell-stats > div { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-1); padding: 2px 0; border-block-start: 1px solid var(--color-border-subtle); }
.tp-shell-stats dt { color: var(--color-text-secondary); font: var(--type-caption); }
.tp-shell-stats dd { margin: 0; color: var(--color-text-primary); font: var(--type-caption); font-weight: 600; font-variant-numeric: tabular-nums; }

.tp-param-list { display: grid; margin: 0; }
.tp-param-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-2);
  padding: 2px 0;
}
.tp-param-row + .tp-param-row { border-block-start: 1px solid var(--color-border-subtle); }
.tp-param-row dt { color: var(--color-text-secondary); font: var(--type-caption); }
.tp-param-row dd { display: inline-flex; align-items: baseline; gap: var(--space-1); margin: 0; font-variant-numeric: tabular-nums; white-space: nowrap; }

.tp-param-value { color: var(--color-text-primary); font: var(--type-body); font-weight: 600; }
.tp-param-unit { color: var(--color-text-secondary); font: var(--type-caption); }
.tp-param-delta { display: inline-flex; align-items: baseline; gap: var(--space-1); font: var(--type-caption); font-weight: 600; }
.tp-param-delta.is-good { color: var(--color-success); }
.tp-param-delta.is-bad { color: var(--color-danger); }
</style>
