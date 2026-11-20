<script setup>
/**
 * 车辆配置面板（模块 / 装备 3×3 / 补给 / 消耗品 / 涂装）。
 *
 * 唯一状态 owner 是 URL（pages 侧解析后以 selection 传入）；本组件只把用户动作折算成
 * 下一份 selection 并通过 update 事件交回，不保存副本、不做第二套默认值。
 * 公式与对号规则在 replay-local/compute/tankSetup.ts（纯函数，golden 覆盖）。
 *
 * 视觉对齐客户端：模块行 = 类型图标 + 该槽候选（图标/等级/名称）；装备 = 3×3 图标格
 * （左右两件）；补给/消耗品 = 图标格。图标来自客户端 UI 样式表的 bg-sprite 映射
 * （上游导出 icons/items + icons/modules），缺失时回退名称文本（仅美术层，fail-soft）。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import AppButton from './AppButton.vue'
import { availableItems, itemIconUrl, resolveDeviceIds } from '../utils/researchCatalog.js'
import { consumableTiming, presetSlots, tankRef } from '../replay-local/compute/tankSetup'
import { resolveUpgradeSelection } from '../replay-local/compute/tankUpgrades'
import CrewSkillsPanel from './CrewSkillsPanel.vue'
import TankUpgradeOptions from './TankUpgradeOptions.vue'
import TankModuleSelection from './TankModuleSelection.vue'
import TankEquipmentGrid from './TankEquipmentGrid.vue'

const props = defineProps({
  /** tank/{id}.json */
  detail: { type: Object, required: true },
  /** 资产包 research/modules/{nation}.json 的单车条目 */
  modules: { type: Object, required: true },
  /** tankSetup.SetupSelection */
  selection: { type: Object, required: true },
  /** 资产包 research 全局目录（物品目录 + 预设 + 过滤器） */
  catalog: { type: Object, required: true },
  /** 宿主可拒绝缺少投影源字段的满级状态。 */
  upgradeSupported: { type: Boolean, default: true },
  /** 乘员技能 / 涂装块 */
  showCrew: { type: Boolean, default: true },
  showEquipment: { type: Boolean, default: true },
  showConsumables: { type: Boolean, default: true },
  showProvisions: { type: Boolean, default: true },
  /** 嵌入查看器已有分区，只调整表面与标题，不复制配置状态。 */
  embedded: { type: Boolean, default: false },
  comparisonLayout: { type: Boolean, default: false },
  showUpgradeDetails: { type: Boolean, default: true },
})
const emit = defineEmits(['update', 'reset', 'preset', 'cycle-skill', 'max-skills', 'clear-skills'])

const { t, locale } = useI18n()


/** 客户端物品名只有 en / zh-Hans 两套；ru 回退 en（数据文档已记录）。 */
const lang = computed(() => (locale.value === 'zh' ? 'zh-Hans' : 'en'))
function itemName(item) {
  if (!item) return ''
  return item[`name_${lang.value}`] || item['name_zh-Hans'] || item.name_en || item.stem || ''
}

const upgrades = computed(() => {
  if (Number(props.detail?.tier) !== 11) return { available: false }
  const state = resolveUpgradeSelection(props.modules, props.selection.upgrade, props.selection.abilities)
  return { ...state, supported: state.supported && props.upgradeSupported }
})
const slots = computed(() => presetSlots(props.modules, props.catalog))
/** 已选装备 id（101/118 等计时加成与参数区同源）。 */
const deviceIds = computed(() => new Set(resolveDeviceIds(slots.value, props.selection.devices, props.catalog.devices)))

const consumables = computed(() => availableItems(props.catalog.consumables, tankRef(props.detail, props.modules)))
const provisions = computed(() => availableItems(props.catalog.provisions, tankRef(props.detail, props.modules)))
const consumableSlots = computed(() => Number(props.modules?.consumableSlots) || 0)
const provisionSlots = computed(() => Number(props.modules?.provisionSlots) || 0)

/** 多选：已选则取消；未选且未满槽则追加；满槽时不动作（客户端同语义）。 */
function toggleStem(key, stem, limit) {
  const current = props.selection[key]
  if (current.includes(stem)) {
    emit('update', { [key]: current.filter(item => item !== stem) })
    return
  }
  if (current.length >= limit) return
  emit('update', { [key]: [...current, stem] })
}

function setCamo(event) {
  emit('update', { camouflage: event.target.checked })
}

/** 消耗品计时：客户端 script 原值 × 装备 101/118（见 tankSetup.consumableTiming）。 */
function itemTiming(item) {
  return consumableTiming(item?.script, deviceIds.value, props.catalog)
}

/** 秒数徽标：整数省略小数（12s），非整数保留两位（1.15s）。 */
function secondsText(value) {
  const n = Number(value)
  return `${Number.isInteger(n) ? n : Math.round(n * 100) / 100}s`
}

function consumableHint(item) {
  const { cooldown, duration } = itemTiming(item)
  if (cooldown == null && duration == null) return itemName(item)
  return t('agentTanks.configurator.consumable_timing', {
    name: itemName(item),
    duration: duration ?? '—',
    cooldown: cooldown ?? '—',
  })
}

/**
 * 当前生效的隐蔽加成（百分比本身，不是点数）：迷彩网 script 的逐车型 bonus 与静止翻倍，
 * 涂装 camouflages.xml 默认类别。参数区的 delta 是“百分点”，这里显示“加成比例”，
 * 避免把 +0.5 个百分点误读成只加了 0.5%。
 */
const camoBonus = computed(() => {
  const classKey = props.detail?.type
  const pick = (map) => {
    const raw = map?.[classKey] ?? (classKey === 'SPG' ? map?.['AT-SPG'] : undefined)
    const value = Number(raw)
    return Number.isFinite(value) ? value : 0
  }
  const net = props.catalog?.devices?.find(device => device.stem === 'camouflageNet')?.script?.params
  const paintTable = props.catalog?.camouflage?.categories?.[props.catalog.camouflage.defaultCategory]
  const netMoving = deviceIds.value.has(115) ? pick(net?.bonus) : 0
  return {
    netMoving,
    netStill: netMoving * (Number(net?.activateBonusFactor) || 0),
    paint: props.selection.camouflage ? pick(paintTable) : 0,
  }
})
const percent = value => `${Math.round(value * 1000) / 10}`
const camoBonusParts = computed(() => {
  const parts = []
  if (camoBonus.value.netMoving > 0) {
    parts.push(t('agentTanks.configurator.net_bonus', {
      moving: percent(camoBonus.value.netMoving),
      still: percent(camoBonus.value.netStill),
    }))
  }
  if (camoBonus.value.paint > 0) {
    parts.push(t('agentTanks.configurator.paint_bonus', { paint: percent(camoBonus.value.paint) }))
  }
  return parts
})
</script>

<template>
  <section class="tp-config" :class="{ 'is-embedded': embedded, 'is-comparison': comparisonLayout }" :aria-label="t('agentTanks.configurator.title')" data-testid="tank-configurator">
    <header v-if="!embedded || !upgrades.available" class="tp-config-head">
      <h2 v-if="!embedded" class="tp-section-title">{{ t('agentTanks.configurator.title') }}</h2>
      <div class="tp-config-actions">
        <AppButton v-if="!upgrades.available" variant="ghost" size="sm" data-testid="tank-preset-stock" @click="emit('preset', 'stock')">
          {{ t('agentTanks.configurator.stock') }}
        </AppButton>
        <AppButton v-if="!upgrades.available" variant="ghost" size="sm" data-testid="tank-preset-top" @click="emit('preset', 'top')">
          {{ t('agentTanks.configurator.top') }}
        </AppButton>
        <AppButton variant="ghost" size="sm" data-testid="tank-config-reset" @click="emit('reset')">
          {{ t('agentTanks.configurator.reset') }}
        </AppButton>
      </div>
    </header>

    <TankUpgradeOptions :detail="detail" :modules="modules" :selection="selection" :catalog="catalog"
      :upgrades="upgrades" :embedded="embedded" :show-upgrade-details="showUpgradeDetails" :item-name="itemName"
      @update="emit('update', $event)" @reset="emit('reset')" />

    <TankModuleSelection v-if="!upgrades.available" :detail="detail" :modules="modules" :selection="selection"
      :item-name="itemName" @update="emit('update', $event)" />

    <TankEquipmentGrid v-if="showEquipment" :detail="detail" :selection="selection" :catalog="catalog"
      :slots="slots" :item-name="itemName" :lang="lang" :comparison-layout="comparisonLayout" @update="emit('update', $event)">
      <template v-if="$slots.devices" #devices><slot name="devices" /></template>
    </TankEquipmentGrid>

    <!-- 补给 / 消耗品：图标格（名称走 aria-label / tooltip） -->
    <section v-if="showProvisions" class="tp-config-block">
      <div class="tp-block-head tp-loadout-head">
        <h3>{{ t('agentTanks.configurator.provisions') }}</h3>
        <span v-if="comparisonLayout" class="tp-muted tp-loadout-hint">{{ t('mob1016.provisionsHint') }}</span>
        <div v-if="$slots.provisions" class="tp-loadout-action"><slot name="provisions" /></div>
        <span class="tp-muted tp-loadout-count">{{ selection.provisions.length }}/{{ provisionSlots }}</span>
      </div>
      <div class="tp-icon-grid">
        <button
          v-for="item in provisions"
          :key="item.stem"
          type="button"
          class="tp-icon-tile"
          :class="{ 'is-on': selection.provisions.includes(item.stem) }"
          :aria-pressed="selection.provisions.includes(item.stem)"
          :aria-label="itemName(item)"
          :title="itemName(item)"
          :data-testid="`tank-provision-${item.stem}`"
          @click="toggleStem('provisions', item.stem, provisionSlots)"
        >
          <img v-if="itemIconUrl('provisions', item.icon)" :src="itemIconUrl('provisions', item.icon)" alt="" width="48" height="48" loading="lazy">
          <span v-else class="tp-tile-fallback">{{ itemName(item).slice(0, 2) }}</span>
        </button>
      </div>
    </section>

    <section v-if="showConsumables" class="tp-config-block">
      <div class="tp-block-head tp-loadout-head">
        <h3>{{ t('agentTanks.configurator.consumables') }}</h3>
        <span v-if="comparisonLayout" class="tp-muted tp-loadout-hint">{{ t('mob1016.consumablesHint') }}</span>
        <div v-if="$slots.consumables" class="tp-loadout-action"><slot name="consumables" /></div>
        <span class="tp-muted tp-loadout-count">{{ selection.consumables.length }}/{{ consumableSlots }}</span>
      </div>
      <div class="tp-icon-grid">
        <button
          v-for="item in consumables"
          :key="item.stem"
          type="button"
          class="tp-icon-tile"
          :class="{ 'is-on': selection.consumables.includes(item.stem) }"
          :aria-pressed="selection.consumables.includes(item.stem)"
          :aria-label="itemName(item)"
          :title="consumableHint(item)"
          :data-testid="`tank-consumable-${item.stem}`"
          @click="toggleStem('consumables', item.stem, consumableSlots)"
        >
          <img v-if="itemIconUrl('consumables', item.icon)" :src="itemIconUrl('consumables', item.icon)" alt="" width="48" height="48" loading="lazy">
          <span v-else class="tp-tile-fallback">{{ itemName(item).slice(0, 2) }}</span>
          <span
            v-if="itemTiming(item).duration"
            class="tp-icon-duration"
            :data-testid="`tank-consumable-duration-${item.stem}`"
          >{{ secondsText(itemTiming(item).duration) }}</span>
          <span v-if="itemTiming(item).cooldown" class="tp-icon-badge">{{ secondsText(itemTiming(item).cooldown) }}</span>
        </button>
      </div>
    </section>

    <CrewSkillsPanel v-if="showCrew" :catalog="catalog" :selection="selection" :crew-count="modules.crewRoles.length"
      @update="emit('update', $event)" @cycle-skill="(id, max) => emit('cycle-skill', id, max)"
      @max-skills="emit('max-skills')" @clear-skills="emit('clear-skills')" />

    <div v-if="showCrew" class="tp-camo-block">
      <label class="tp-camo">
        <input type="checkbox" data-testid="tank-camo" :checked="selection.camouflage" @change="setCamo">
        <span>{{ t('agentTanks.configurator.camouflage') }}</span>
      </label>
      <p v-if="camoBonusParts.length" class="tp-camo-summary" data-testid="tank-camo-summary">
        {{ t('agentTanks.configurator.camo_bonus_title') }} {{ camoBonusParts.join(' · ') }}
      </p>
    </div>
  </section>
</template>

<style scoped>
.tp-config {
  display: grid;
  gap: var(--space-4);
  min-inline-size: 0;
  padding: var(--space-4);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  background: var(--color-surface-1);
  box-shadow: var(--elevation-1);
}
.tp-config.is-embedded { gap: var(--space-2); padding: 0; border: 0; border-radius: 0; background: transparent; box-shadow: none; }
.tp-config.is-embedded .tp-config-head { justify-content: flex-end; }


.tp-config-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); flex-wrap: wrap; }
.tp-config-actions { display: flex; flex-wrap: wrap; gap: var(--space-1); }
.tp-section-title { margin: 0; font: var(--type-body); font-weight: 700; }

.tp-muted { margin: 0; color: var(--color-text-secondary); font: var(--type-caption); }

/* ---------- 装备 3×3 ---------- */
.tp-config-block { display: grid; gap: var(--space-2); min-inline-size: 0; }
.tp-config > .tp-config-block + .tp-config-block { padding-block-start: var(--space-4); border-block-start: 1px solid var(--color-border-subtle); }
.is-comparison { --loadout-action-width: 16rem; --loadout-count-width: 3.5rem; }
.is-comparison .tp-loadout-head { display: grid; grid-template-columns: max-content minmax(0, 1fr) var(--loadout-action-width) var(--loadout-count-width); align-items: center; gap: var(--space-3); }
.is-comparison .tp-loadout-head h3 { grid-column: 1; }
.is-comparison .tp-loadout-hint { grid-column: 2; }
.is-comparison .tp-loadout-action { grid-column: 3; }
.is-comparison .tp-loadout-action :deep(.app-button) { inline-size: 100%; min-block-size: var(--hit-min-comfortable); }
.is-comparison .tp-loadout-count { grid-column: 4; text-align: end; font-variant-numeric: tabular-nums; }
@media (width < 768px) {
  .is-comparison .tp-loadout-head { grid-template-columns: minmax(0, 1fr) var(--loadout-count-width); }
  .is-comparison .tp-loadout-head h3 { grid-column: 1; grid-row: 1; }
  .is-comparison .tp-loadout-hint { grid-column: 1 / -1; grid-row: 2; }
  .is-comparison .tp-loadout-action { grid-column: 1; grid-row: 3; }
  .is-comparison .tp-loadout-count { grid-column: 2; grid-row: 3; }
  .is-comparison .tp-loadout-action :deep(.app-button) { inline-size: min(100%, var(--loadout-action-width)); }
}
.tp-block-head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: var(--space-1) var(--space-2); }
.tp-config-block > h3, .tp-block-head h3 { margin: 0; font: var(--type-body); font-weight: 600; }

/* ---------- 补给 / 消耗品 ---------- */
.tp-icon-grid { display: flex; flex-wrap: wrap; gap: var(--space-1); }
.tp-icon-tile {
  position: relative;
  display: grid;
  place-items: center;
  inline-size: var(--space-12);
  block-size: var(--space-12);
  padding: var(--space-1);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-surface-2);
  cursor: pointer;
}
.tp-icon-tile:hover { border-color: var(--color-border-strong); }
.tp-icon-tile.is-on { border-color: var(--color-accent); background: color-mix(in oklab, var(--color-accent) 16%, var(--color-surface-1)); }
.tp-icon-tile:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }
.tp-icon-tile img { inline-size: 100%; block-size: 100%; object-fit: contain; }
.tp-icon-badge {
  position: absolute;
  inset-block-end: 0;
  inset-inline-end: 0;
  padding: 0 3px;
  border-radius: var(--radius-sm);
  background: var(--color-surface-1);
  color: var(--color-text-secondary);
  font: var(--type-caption);
  font-variant-numeric: tabular-nums;
}
/* 生效时间（duration）与冷却（cooldown）分开：左上角强调色 = 持续，右下角次要色 = 冷却 */
.tp-icon-duration {
  position: absolute;
  inset-block-start: 0;
  inset-inline-start: 0;
  padding: 0 3px;
  border-radius: var(--radius-sm);
  background: var(--color-surface-1);
  color: var(--color-accent-text);
  font: var(--type-caption);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.tp-tile-fallback { color: var(--color-text-secondary); font: var(--type-caption); font-weight: 600; overflow-wrap: anywhere; }


.tp-camo-block { display: grid; gap: var(--space-1); }
.tp-camo { display: inline-flex; align-items: center; gap: var(--space-2); min-block-size: var(--hit-min-comfortable); font: var(--type-body); cursor: pointer; }
.tp-camo-summary { margin: 0; color: var(--color-text-secondary); font: var(--type-caption); }
.tp-camo input { inline-size: var(--control-check); block-size: var(--control-check); margin: 0; accent-color: var(--color-accent); }

@media (width < 768px) {
  /* 补给 / 消耗品图标与装备图标同比缩小到 32px，同时保留 44px 触控区域 */
  .tp-icon-tile { inline-size: var(--hit-min-comfortable); block-size: var(--hit-min-comfortable); padding: 3px; }
  .tp-icon-tile img { inline-size: 32px; block-size: 32px; }
}

</style>
