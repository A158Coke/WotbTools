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
import { Check, Zap } from 'lucide-vue-next'
import AppButton from './AppButton.vue'
import SegmentedControl from './SegmentedControl.vue'
import { useBreakpoint } from '../composables/useBreakpoint.js'
import { availableItems, itemIconUrl, moduleIconUrl, resolveDeviceIds, skillIconUrl } from '../utils/researchCatalog.js'
import { configIndexFor, consumableTiming, pickGun, pickTurret, presetSlots, tankRef } from '../replay-local/compute/tankSetup'
import { fmtNum } from '../scene/tankMeta.js'
import { romanLevel } from '../utils/tierFormat.js'
import { resolveUpgradeSelection, upgradeMechanicEffects } from '../replay-local/compute/tankUpgrades'
import { parseAugmentProgression, researchGroupChoice } from '../replay-local/compute/tankAugmentTree'
import { isConditionalCrewSkill } from '../replay-local/compute/crewStats'

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
})
const emit = defineEmits(['update', 'reset', 'preset', 'cycle-skill', 'max-skills', 'clear-skills'])
const { isCompact } = useBreakpoint()

const { t, locale } = useI18n()

const GROUPS = ['attack', 'defence', 'specialization']
const LEVELS = [0, 1, 2]

/** 客户端物品名只有 en / zh-Hans 两套；ru 回退 en（数据文档已记录）。 */
const lang = computed(() => (locale.value === 'zh' ? 'zh-Hans' : 'en'))
function itemName(item) {
  if (!item) return ''
  return item[`name_${lang.value}`] || item['name_zh-Hans'] || item.name_en || item.stem || ''
}

const currentTurret = computed(() => props.modules?.turrets?.[props.selection.turret] || null)
const upgrades = computed(() => {
  if (Number(props.detail?.tier) !== 11) return { available: false }
  const state = resolveUpgradeSelection(props.modules, props.selection.upgrade, props.selection.abilities)
  return { ...state, supported: state.supported && props.upgradeSupported }
})
const upgradeOptions = computed(() => [
  { value: 'stock', label: t('agentTanks.configurator.upgrade_stock'), testid: 'tank-upgrade-stock' },
  { value: 'top', label: t('agentTanks.configurator.upgrade_top'), testid: 'tank-upgrade-top', disabled: !upgrades.value.supported },
])
// 同版 hangarAbilityParamsConfig 明确标注 PERCENT 的三项；其他机制系数不做统一百分化。
const PERCENT_MECHANIC_ATTRIBUTES = new Set([
  'COMBAT_FRENZY_RELOAD_SPEED_BONUS_PER_STACK', 'SAS_AIMING_SPEED', 'SAS_GUN_DISPERSION',
])
function upgradeAmount(value, modifier = 'MODIFIER_ADD', name) {
  if (value == null) return '—'
  if (typeof value === 'boolean') return upgradeValue(value, name)
  const points = modifier === 'MODIFIER_ADD' && PERCENT_MECHANIC_ATTRIBUTES.has(name)
  const amount = `${modifier === 'MODIFIER_MULTIPLY' ? '×' : value > 0 ? '+' : ''}${fmtNum(points ? value * 100 : value, 3)}`
  return points ? t('agentTanks.configurator.upgrade_percentage_points', { value: amount }) : amount
}
function upgradeValue(value, name) {
  if (value == null) return '—'
  if (name === 'SAS_ALLOW_ACTIVATE_ON_HIT' && typeof value === 'boolean') {
    return t(`agentTanks.configurator.upgrade_trigger_${value ? 'hit' : 'damage'}`)
  }
  if (name === 'COMBAT_FRENZY_ALLOW_SWITCH_AFTER_KILL' && typeof value === 'boolean') {
    return t(`agentTanks.configurator.upgrade_${value ? 'yes' : 'no'}`)
  }
  if (typeof value === 'number' && PERCENT_MECHANIC_ATTRIBUTES.has(name)) return `${fmtNum(value * 100, 3)}%`
  return typeof value === 'boolean' ? t(`agentTanks.configurator.upgrade_${value ? 'enabled' : 'disabled'}`) : fmtNum(value, 3)
}
const mechanicEffects = computed(() => upgradeMechanicEffects(upgrades.value, props.modules, props.catalog))
const abilityGroups = computed(() => (upgrades.value.groups || []).map((group, groupIndex) => ({
  ...group,
  label: itemName(group) || t('agentTanks.configurator.upgrade_skill_group', { index: groupIndex + 1 }),
  description: group[`description_${lang.value}`] || group.description_en || '',
  options: group.choices.map((id, index) => {
    const node = upgrades.value.nodes.find(node => node.id === id)
    const effects = (node?.attributes || []).map(({ name, value }) => ({
      name, label: t(`agentTanks.configurator.upgrade_attributes.${name}`),
      amount: upgradeAmount(value, upgrades.value.attributeDefinitions[name]?.modifier, name),
    }))
    return {
      value: String(id),
      label: itemName(node) || effects.map(effect => effect.label).join(' · ') || t('agentTanks.configurator.upgrade_skill_option', { index: index + 1 }),
      description: node?.[`description_${lang.value}`] || node?.description_en || '',
      disabled: !upgrades.value.supported,
      effects,
      testid: `tank-ability-${id}`,
    }
  }),
})))
/** 升级状态文案：custom（部分研发）效果已生效，不能沿用 stock 的「未生效」。 */
const upgradeStatusKey = computed(() => (upgrades.value.mode === 'top' ? 'upgrade_top'
  : upgrades.value.mode === 'custom' ? 'upgrade_custom' : 'upgrade_inactive'))
function selectAbility(group, value) {
  // custom（研发树联动）：abilities 即已研发表——选卡 = 组内换选，其余已研发节点保留。
  // 组前置必须与研发树同口径补齐（共享 researchGroupChoice），否则配置卡能装出
  // “缺前置却有机制效果”的非法状态。
  if (props.selection.upgrade === 'custom') {
    const progression = parseAugmentProgression(props.modules)
    const installed = new Set(props.selection.abilities)
    const next = progression
      ? researchGroupChoice(progression, group.id, Number(value), installed)
      : installed
    emit('update', { abilities: [...next] })
    return
  }
  const choices = { ...upgrades.value.choices, [group.id]: Number(value) }
  const next = resolveUpgradeSelection(props.modules, props.selection.upgrade, choices)
  emit('update', { abilities: next.abilities })
}

/** 四个模块槽的候选（图标 = 客户端 ModulesTechTree 类型图；名称/等级来自数据）。 */
const moduleRows = computed(() => {
  const turrets = props.modules?.turrets || []
  const guns = currentTurret.value?.guns || []
  return [
    {
      key: 'turret',
      icon: moduleIconUrl('turret'),
      selected: props.selection.turret,
      options: turrets.map((turret, index) => ({ value: index, level: turret.level, name: itemName(turret) })),
      select: value => emit('update', pickTurret(props.selection, props.modules, props.detail, value)),
    },
    {
      key: 'gun',
      icon: moduleIconUrl('gun'),
      selected: props.selection.gun,
      // 炮候选 = 全车炮的全集（跨炮塔去重）：当前炮塔不能直接装配的置灰禁用，
      // 不隐藏（用户 2026-10-27 要求）。value 只对当前炮塔内的炮有效（pickGun 下标）。
      options: (() => {
        const seen = new Set()
        const all = []
        for (const turret of props.modules?.turrets || []) {
          for (const gun of turret.guns || []) {
            const id = gun.stem || gun.localId
            if (seen.has(id)) continue
            seen.add(id)
            all.push(gun)
          }
        }
        const currentTurretId = currentTurret.value?.localId
        return all.map(gun => {
          const index = guns.findIndex(item => item.stem === gun.stem)
          const currentGun = index >= 0 ? guns[index] : null
          const hasConfig = currentGun != null && currentTurretId != null
            && configIndexFor(props.detail?.configs || [], currentTurretId, currentGun.localId) >= 0
          const disabled = !hasConfig
          const reason = t('agentTanks.configurator.gun_unavailable')
          return {
            key: gun.stem || gun.localId,
            value: index >= 0 ? index : null,
            level: gun.level,
            name: itemName(gun),
            disabled,
            testId: index >= 0 ? undefined : `tank-gun-unavailable-${gun.stem || gun.localId}`,
            title: disabled
              ? `${itemName(gun)} — ${reason}`
              : t('agentTanks.configurator.gun_option', { name: itemName(gun), reload: fmtNum(gun?.stats?.reloadTime, 1) }),
            ariaLabel: disabled ? `${itemName(gun)} — ${reason}` : itemName(gun),
          }
        })
      })(),
      select: value => {
        if (value != null) emit('update', pickGun(props.selection, props.modules, props.detail, value))
      },
    },
    {
      key: 'engine',
      icon: moduleIconUrl('engine'),
      selected: props.selection.engine,
      options: (props.modules?.engines || []).map((engine, index) => ({
        value: index,
        level: engine.level,
        name: itemName(engine),
        title: t('agentTanks.configurator.engine_option', { name: itemName(engine), power: fmtNum(engine?.stats?.power, 0) }),
      })),
      select: value => emit('update', { engine: value }),
    },
    {
      key: 'track',
      icon: moduleIconUrl('chassis'),
      selected: props.selection.track,
      options: (props.modules?.chassis || []).map((track, index) => ({
        value: index,
        level: track.level,
        name: itemName(track),
        title: t('agentTanks.configurator.track_option', {
          name: itemName(track),
          rotation: fmtNum(track?.stats?.rotationSpeed, 1),
          // 客户端 chassis maxLoad 单位是 kg（T-34 31300），tooltip 显示吨
          load: Number(track?.stats?.maxLoad) > 0 ? fmtNum(Number(track.stats.maxLoad) / 1000, 1) : '—',
        }),
      })),
      select: value => emit('update', { track: value }),
    },
  ]
})

/** 模块矩阵的选项行：按选项序号逐行展开，4 列一起对齐（炮塔1|火炮1|发动机1|履带1…）。 */
const moduleMatrix = computed(() => {
  const rows = moduleRows.value
  const depth = Math.max(0, ...rows.map(row => row.options.length))
  return Array.from({ length: depth }, (_, index) =>
    rows.map(row => ({ row, option: row.options[index] || null })))
})

/** 手机布局按类型分组；没有选项的类型连标题都不渲染，避免孤立标签。 */
const moduleGroups = computed(() => moduleRows.value.filter(row => row.options.length > 0))

/** 装备槽位按 (level, group) 定位：presetSlots 数组顺序是 level-major。 */
const slots = computed(() => presetSlots(props.modules, props.catalog))
/** 已选装备 id（101/118 等计时加成与参数区同源）。 */
const deviceIds = computed(() => new Set(resolveDeviceIds(slots.value, props.selection.devices, props.catalog.devices)))

function slotIndex(level, group) {
  return slots.value.findIndex(slot => Number(slot?.level) === level && slot?.group === group)
}

function device(stem) {
  if (!stem) return null
  return props.catalog.devices.find(item => item.stem === stem) || null
}

function deviceLabel(stem) {
  const item = device(stem)
  return item ? itemName(item) : stem
}

function deviceIcon(stem) {
  const item = device(stem)
  return item ? itemIconUrl('devices', item.icon) : null
}

/** 只影响模块耐久/被击中概率、参数表没有对应行的装备（悬停明确说明，避免误判未生效）。 */
const MODULE_DEFENCE_DEVICE_IDS = new Set([108, 109, 112, 120, 121])

/** 客户端 description 占位符 → 当前车型可读数值（百分比/角度/秒）。 */
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
/** 模板自带 + 或单位（° / % / s）的占位符：只填数值，避免 ++ / %% 双符号。 */
const DEVICE_RAW_KEYS = new Set([
  'upperPitchLimitIncrease', 'lowerPitchLimitIncrease',
  'circularVisionRadiusIncrease', 'activateWhenStillSec',
])
const DEVICE_CLASS_KEYS = {
  lightTank: 'Light', mediumTank: 'Medium', heavyTank: 'Heavy', 'AT-SPG': 'AT_SPG', SPG: 'AT_SPG',
}
const vehicleClassKey = computed(() => DEVICE_CLASS_KEYS[props.detail?.type] || null)

/** 装备 script 的 percent 是符号权威（displayParams 只给绝对值，104/105 会漏负号）。 */
function deviceScriptPercent(item, key) {
  const params = item.script?.params || {}
  const attr = String(params.attribute || '').split('/').pop()
  const percent = Number(params.bonusValues?.percent)
  return attr === key && Number.isFinite(percent) ? percent : null
}

function deviceDisplayValue(item, key) {
  let raw = item.displayParams?.[key]
  if (raw != null && typeof raw === 'object') {
    const classKey = vehicleClassKey.value
    raw = classKey != null && raw[classKey] != null ? raw[classKey] : Object.values(raw)[0]
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

function deviceHint(stem) {
  const item = device(stem)
  if (!item) return stem || ''
  const description = item[`description_${lang.value}`] || item.description_en || ''
  const note = MODULE_DEFENCE_DEVICE_IDS.has(Number(item.id))
    ? ` · ${t('agentTanks.configurator.equipment_no_stat_note')}`
    : ''
  const filled = description
    .replace(/%\(([^)]+)\)/g, (_, key) => (key === 'highlight_start' || key === 'highlight_end' ? '' : deviceDisplayValue(item, key)))
    .replace(/%%/g, '%')
  return `${itemName(item)} — ${filled}${note}`
}

function deviceChoice(index, choice) {
  if (index < 0) return // 预设缺该 (level, group) 槽位时不猜，直接忽略
  const devices = props.selection.devices.slice()
  devices[index] = devices[index] === choice ? null : choice
  emit('update', { devices })
}

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
const SKILL_CLASS_ORDER = [
  { key: 'lightTank', labelKey: 'light' },
  { key: 'mediumTank', labelKey: 'medium' },
  { key: 'heavyTank', labelKey: 'heavy' },
  { key: 'AT-SPG', labelKey: 'tank_destroyer' },
]

function skillText(item, field) {
  return item?.[`${field}_${lang.value}`] || item?.[`${field}_en`] || ''
}

/**
 * 客户端 effect 模板的占位符替换：模板在占位符后带 `%` 时，effects 值是**比例**
 * （0.15 → 15%，1.0 → 100%）；`*PerLevel` 再乘当前等级。其余计数/半径等原样；
 * 未提供的参数不显示（不猜）。数值全部来自 avatar.xml。
 */
function skillEffectText(item, level) {
  const effects = item?.effects || {}
  return skillText(item, 'effect')
    .replace(/%\(highlight_start\)|%\(highlight_end\)/g, '')
    .replace(/%\(([^)]+)\)(%)?/g, (_match, key, percent) => {
      if (key === 'level') return `7${percent || ''}`
      const value = Number(effects[key])
      if (!Number.isFinite(value)) return ''
      const isPercent = percent === '%'
      const scaled = value *
        (isPercent ? 100 : 1) *
        (key.endsWith('PerLevel') ? level : 1)
      const rendered = isPercent
        ? Math.round(scaled * 10) / 10
        : (Number.isInteger(scaled) ? scaled : Math.round(scaled * 1000) / 1000)
      return `${rendered}${percent || ''}`
    })
    .trim() || skillText(item, 'tip')
}

/** 全部 20 个车型技能（训练资格按车型，效果全局；这里按类分组展示）。 */
const skillGroups = computed(() => SKILL_CLASS_ORDER.map(({ key, labelKey }) => {
  const ids = props.catalog?.crewSkillClasses?.[key] || []
  return {
    key,
    label: t(`agentTanks.configurator.skill_classes.${labelKey}`),
    skills: ids.map(id => {
      const item = props.catalog?.skills?.[id] || null
      const level = Number(props.selection.skills?.[id]) || 0
      const effect = skillEffectText(item, level || 1)
      return {
        id,
        level,
        name: skillText(item, 'name') || id,
        effect,
        title: level
          ? `${skillText(item, 'name') || id} — ${effect}`
          : `${skillText(item, 'name') || id} — ${t('agentTanks.configurator.skill_untrained')} · ${effect}`,
        icon: skillIconUrl(id),
        active: level > 0,
        conditional: isConditionalCrewSkill(id),
      }
    }),
  }
}))

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
  <section class="tp-config" :class="{ 'is-embedded': embedded }" :aria-label="t('agentTanks.configurator.title')" data-testid="tank-configurator">
    <header class="tp-config-head">
      <h2 v-if="!embedded" class="tp-section-title">{{ t('agentTanks.configurator.title') }}</h2>
      <SegmentedControl
        v-if="embedded && upgrades.available"
        :model-value="upgrades.mode"
        :options="upgradeOptions"
        :aria-label="t('agentTanks.configurator.upgrade_title')"
        @update:model-value="emit('update', { upgrade: $event })"
      />
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

    <section v-if="upgrades.available && (!embedded || showCrew || !upgrades.supported)" class="tp-config-block" data-testid="tank-upgrades">
      <h3 v-if="!embedded">{{ t('agentTanks.configurator.upgrade_title') }}</h3>
      <SegmentedControl
        v-if="!embedded"
        :model-value="upgrades.mode"
        :options="upgradeOptions"
        :aria-label="t('agentTanks.configurator.upgrade_title')"
        @update:model-value="emit('update', { upgrade: $event })"
      />
      <p v-if="!embedded" class="tp-muted">{{ t('agentTanks.configurator.upgrade_hint') }}</p>
      <p v-if="!upgrades.supported" class="tp-muted" role="status">{{ t('agentTanks.configurator.upgrade_unsupported') }}</p>
      <template v-if="showCrew">
        <div v-for="group in abilityGroups" :key="group.id" class="tp-config-block" data-testid="tank-upgrade-skills">
          <h3>{{ group.label }}</h3>
          <SegmentedControl class="tp-ability-options" presentation="tiles" :aria-label="group.label"
            :options="group.options" :model-value="String(upgrades.choices[group.id])"
            @update:model-value="selectAbility(group, $event)">
            <template #option="{ option, index, selected }">
            <span class="tp-ability-content">
              <span class="tp-ability-top"><span class="tp-ability-number">{{ String(index + 1).padStart(2, '0') }}</span>
                <Check v-if="selected" :size="16" aria-hidden="true" />
              </span>
              <span class="tp-ability-name">{{ option.label }}</span>
              <strong class="tp-ability-value">{{ option.effects.map(effect => effect.amount).join(' / ') }}</strong>
              <span v-if="option.description" class="tp-muted">{{ option.description }}</span>
            </span>
            </template>
          </SegmentedControl>
          <p v-if="group.description" class="tp-muted">{{ group.description }}</p>
        </div>
        <p v-if="abilityGroups.length" class="tp-muted">{{ t('agentTanks.configurator.upgrade_skill_hint') }}</p>
        <section v-if="mechanicEffects.length" class="tp-mechanic-effects" aria-live="polite" data-testid="tank-mechanic-effects">
          <header class="tp-block-head"><h3>{{ t('agentTanks.configurator.upgrade_effects') }}</h3>
            <span class="tp-ability-status">{{ t(`agentTanks.configurator.${upgradeStatusKey}`) }}</span>
          </header>
          <table>
            <thead><tr><th scope="col">{{ t('agentTanks.configurator.upgrade_effect_attribute') }}</th>
              <th scope="col">{{ t('agentTanks.configurator.upgrade_stock') }}</th>
              <th scope="col">{{ t('agentTanks.configurator.upgrade_effect_current') }}</th></tr></thead>
            <tbody><tr v-for="effect in mechanicEffects" :key="effect.name" :data-testid="`tank-mechanic-${effect.name}`">
              <th scope="row">{{ t(`agentTanks.configurator.upgrade_attributes.${effect.name}`) }}</th>
              <td>{{ upgradeValue(effect.initial, effect.name) }}</td>
              <td class="tp-effect-current"><strong>{{ upgradeValue(effect.value, effect.name) }}</strong>
                <span v-if="effect.current != null" class="tp-effect-delta">{{ t('agentTanks.configurator.upgrade_effect_change', { value: upgradeAmount(effect.current, effect.modifier, effect.name) }) }}</span>
              </td>
            </tr></tbody>
          </table>
          <p class="tp-muted">{{ t('agentTanks.configurator.upgrade_effect_delta_note') }}</p>
        </section>
      </template>
    </section>

    <!-- 桌面/平板：首行 = 4 个类型标签，之后按选项序号逐行展开（炮塔1|火炮1|发动机1|履带1，
         下一行炮塔2|火炮2…），4 列严格对齐，避免右侧空白。 -->
    <div v-if="!upgrades.available && !isCompact" class="tp-module-matrix">
      <div v-for="row in moduleRows" :key="row.key" class="tp-module-head" :data-testid="`tank-module-${row.key}`">
        <span>{{ t(`agentTanks.configurator.${row.key}`) }}</span>
      </div>
      <template v-for="(cells, index) in moduleMatrix" :key="index">
        <div v-for="cell in cells" :key="`${cell.row.key}-${index}`" class="tp-module-cell">
          <button
            v-if="cell.option"
            type="button"
            class="tp-module-tile"
            :class="{ 'is-on': cell.row.selected === cell.option.value, 'is-disabled': cell.option.disabled }"
            :disabled="cell.option.disabled"
            :aria-disabled="cell.option.disabled ? 'true' : undefined"
            :aria-pressed="!cell.option.disabled && cell.row.selected === cell.option.value"
            :aria-label="cell.option.ariaLabel || cell.option.name"
            :title="cell.option.title || cell.option.name"
            :data-testid="cell.option.testId || `tank-${cell.row.key}-${cell.option.value}`"
            @click="cell.option.disabled ? null : cell.row.select(cell.option.value)"
          >
            <span class="tp-module-pic">
              <img v-if="cell.row.icon" :src="cell.row.icon" alt="" width="32" height="32" loading="lazy">
              <span v-else class="tp-module-pic-fallback">{{ cell.option.name.slice(0, 1) }}</span>
            </span>
            <span v-if="cell.option.level != null" class="tp-module-level">{{ romanLevel(cell.option.level) }}</span>
            <span class="tp-module-name">{{ cell.option.name }}</span>
          </button>
        </div>
      </template>
    </div>

    <!-- 手机：按类型 2×2 分组（炮塔|火炮 // 发动机|履带），每组一个标题 + 纵向选项；
         不按序号拼行，因此只有 1 个选项的类型不会留下带标题的空格子。 -->
    <div v-else-if="!upgrades.available" class="tp-module-groups">
      <section
        v-for="row in moduleGroups"
        :key="row.key"
        class="tp-module-group"
        :data-testid="`tank-module-group-${row.key}`"
      >
        <h3 class="tp-module-group-head">{{ t(`agentTanks.configurator.${row.key}`) }}</h3>
        <div class="tp-module-group-list">
          <button
            v-for="option in row.options"
            :key="option.testId ?? option.key ?? option.value"
            type="button"
            class="tp-module-tile"
            :class="{ 'is-on': row.selected === option.value, 'is-disabled': option.disabled }"
            :disabled="option.disabled"
            :aria-disabled="option.disabled ? 'true' : undefined"
            :aria-pressed="!option.disabled && row.selected === option.value"
            :aria-label="option.ariaLabel || option.name"
            :title="option.title || option.name"
            :data-testid="option.testId || `tank-${row.key}-${option.value}`"
            @click="option.disabled ? null : row.select(option.value)"
          >
            <span class="tp-module-pic">
              <img v-if="row.icon" :src="row.icon" alt="" width="28" height="28" loading="lazy">
              <span v-else class="tp-module-pic-fallback">{{ option.name.slice(0, 1) }}</span>
            </span>
            <span v-if="option.level != null" class="tp-module-level">{{ romanLevel(option.level) }}</span>
            <span class="tp-module-name">{{ option.name }}</span>
          </button>
        </div>
      </section>
    </div>

    <!-- 装备：3×3，每格左右两件图标 -->
    <section v-if="showEquipment" class="tp-config-block">
      <div class="tp-block-head">
        <h3>{{ t('agentTanks.configurator.equipment') }}</h3>
        <span class="tp-muted">{{ t('agentTanks.configurator.equipment_hint') }}</span>
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

    <!-- 补给 / 消耗品：图标格（名称走 aria-label / tooltip） -->
    <section v-if="showProvisions" class="tp-config-block">
      <div class="tp-block-head">
        <h3>{{ t('agentTanks.configurator.provisions') }}</h3>
        <span class="tp-muted">{{ selection.provisions.length }}/{{ provisionSlots }}</span>
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
      <div class="tp-block-head">
        <h3>{{ t('agentTanks.configurator.consumables') }}</h3>
        <span class="tp-muted">{{ selection.consumables.length }}/{{ consumableSlots }}</span>
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

    <section v-if="showCrew" class="tp-config-block tp-skills-block">
      <div class="tp-block-head tp-skill-head">
        <div class="tp-skill-heading">
          <h3>{{ t('agentTanks.configurator.crew_skills') }}</h3>
          <span class="tp-muted">{{ t('agentTanks.configurator.crew_count') }} {{ modules.crewRoles.length }} · {{ Object.values(selection.skills).filter(level => level > 0).length }}/20</span>
        </div>
        <div class="tp-skill-actions">
          <AppButton variant="ghost" size="sm" data-testid="tank-skills-max" @click="emit('max-skills')">
            {{ t('agentTanks.configurator.skill_max') }}
          </AppButton>
          <AppButton variant="ghost" size="sm" data-testid="tank-skills-clear" @click="emit('clear-skills')">
            {{ t('agentTanks.configurator.skill_clear') }}
          </AppButton>
        </div>
      </div>
      <label class="tp-skill-trigger-control" data-testid="tank-skill-trigger-control">
        <input type="checkbox" data-testid="tank-skill-triggers" :checked="selection.conditionalSkills === true"
          @change="emit('update', { conditionalSkills: $event.target.checked })">
        <span><strong>{{ t('agentTanks.configurator.skill_triggers') }}</strong>
          <span class="tp-muted">{{ t('agentTanks.configurator.skill_triggers_hint') }}</span></span>
      </label>
      <div class="tp-skill-groups">
        <div v-for="group in skillGroups" :key="group.key" class="tp-skill-group" role="group" :aria-label="group.label">
          <h4 class="tp-skill-class">{{ group.label }}</h4>
          <div v-for="conditional in [false, true].filter(value => group.skills.some(skill => skill.conditional === value))"
            :key="String(conditional)" class="tp-skill-section">
            <span class="tp-skill-category">
              {{ t(`agentTanks.configurator.${conditional ? 'skill_conditional' : 'skill_permanent'}`) }}
            </span>
            <div class="tp-skill-row">
            <button
              v-for="skill in group.skills.filter(skill => skill.conditional === conditional)"
              :key="skill.id"
              type="button"
              class="tp-skill-btn"
              :class="{ 'is-on': skill.active, 'is-pending': skill.active && skill.conditional && !selection.conditionalSkills }"
              :aria-pressed="skill.active"
              :aria-label="skill.title"
              :title="skill.title"
              :data-testid="`tank-skill-${skill.id}`"
              @click="emit('cycle-skill', skill.id, $event.shiftKey)"
            >
              <img v-if="skill.icon" :src="skill.icon" alt="" width="32" height="32" loading="lazy">
              <span v-else class="tp-skill-fallback">{{ skill.name.slice(0, 2) }}</span>
              <span v-if="skill.active" class="tp-skill-level">{{ skill.level }}</span>
              <Zap v-if="skill.conditional" class="tp-skill-condition-icon" :size="12" aria-hidden="true" />
            </button>
            </div>
          </div>
        </div>
      </div>
      <div class="tp-skill-notes">
        <p class="tp-muted">{{ t('agentTanks.configurator.skill_level_hint') }}</p>
        <p class="tp-muted">{{ t('agentTanks.configurator.skill_note') }}</p>
      </div>
    </section>

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
.tp-config.is-embedded .tp-config-head > .segmented { margin-inline-end: auto; }

.tp-config-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); flex-wrap: wrap; }
.tp-config-actions { display: flex; flex-wrap: wrap; gap: var(--space-1); }
.tp-section-title { margin: 0; font: var(--type-body); font-weight: 700; }

.tp-muted { margin: 0; color: var(--color-text-secondary); font: var(--type-caption); }

.tp-ability-options { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-2); }
.tp-ability-options :deep(.segmented-option) {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: var(--space-2);
  min-inline-size: 0;
  min-block-size: var(--control-h-lg);
  padding: var(--space-3);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-surface-2);
  color: var(--color-text-primary);
  text-align: start;
  cursor: pointer;
}
.tp-ability-options :deep(.segmented-option:hover) { border-color: var(--color-border-strong); }
.tp-ability-options :deep(.segmented-option.is-active) { border-color: var(--color-accent); }
.tp-ability-content { display: flex; flex-direction: column; gap: var(--space-2); block-size: 100%; }
.tp-ability-options :deep(.segmented-label) { flex: 1; }
.tp-ability-top { display: flex; align-items: center; justify-content: space-between; color: var(--color-accent-text); }
.tp-ability-number { font: var(--type-caption); font-variant-numeric: tabular-nums; }
.tp-ability-name { flex: 1; font: var(--type-caption); overflow-wrap: anywhere; }
.tp-ability-value { font: var(--type-h3); font-variant-numeric: tabular-nums; color: var(--color-accent-text); }
.tp-mechanic-effects { display: grid; gap: var(--space-2); min-inline-size: 0; padding-block-start: var(--space-2); }
.tp-ability-status { color: var(--color-text-secondary); font: var(--type-caption); }
.tp-mechanic-effects table { inline-size: 100%; border-collapse: collapse; font: var(--type-caption); }
.tp-mechanic-effects th, .tp-mechanic-effects td { padding: var(--space-2) var(--space-1); border-block-end: 1px solid var(--color-border-subtle); text-align: end; font-variant-numeric: tabular-nums; }
.tp-mechanic-effects th:first-child { text-align: start; font-weight: 400; overflow-wrap: anywhere; }
.tp-mechanic-effects thead { color: var(--color-text-secondary); }
.tp-effect-current { color: var(--color-accent-text); font-weight: 600; }
.tp-effect-delta { display: block; color: var(--color-text-secondary); font: var(--type-caption); }
.tp-skill-trigger-control { display: flex; gap: var(--space-2); align-items: center; min-block-size: var(--hit-min-comfortable); padding-block: var(--space-2); cursor: pointer; }
.tp-skill-trigger-control > span { display: grid; gap: var(--space-1); min-inline-size: 0; font: var(--type-caption); }
.tp-skill-trigger-control input { flex: 0 0 var(--control-check); inline-size: var(--control-check); block-size: var(--control-check); margin: 0; accent-color: var(--color-accent); }
.tp-skill-section { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-1) var(--space-2); min-inline-size: 0; }
.tp-skill-category { flex: 0 1 auto; color: var(--color-text-secondary); font: var(--type-caption); overflow-wrap: anywhere; }
.tp-skill-condition-icon { position: absolute; inset-inline-start: 0; inset-block-start: 0; color: var(--color-accent-text); background: var(--color-surface-1); border-radius: var(--radius-sm); }

/* ---------- 模块矩阵：4 列（炮塔/火炮/发动机/履带），选项按序号逐行对齐 ---------- */
.tp-module-matrix {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--space-1) var(--space-2);
  align-items: stretch;
}
.tp-module-head { display: grid; justify-items: center; align-content: end; gap: 2px; min-inline-size: 0; padding-block-end: var(--space-1); color: var(--color-text-secondary); font: var(--type-caption); font-weight: 600; text-align: center; overflow-wrap: anywhere; }
.tp-module-cell { min-inline-size: 0; }

.tp-module-tile {
  position: relative;
  display: grid;
  justify-items: center;
  gap: 2px;
  inline-size: 100%;
  min-inline-size: 0;
  padding: var(--space-1);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-surface-2);
  color: var(--color-text-secondary);
  font: var(--type-caption);
  cursor: pointer;
}
.tp-module-tile:hover { border-color: var(--color-border-strong); color: var(--color-text-primary); }
.tp-module-tile.is-disabled { opacity: 0.42; cursor: not-allowed; filter: grayscale(1); }
.tp-module-tile.is-disabled:hover { border-color: var(--color-border-subtle); }
.tp-module-tile.is-on { border-color: var(--color-accent); background: color-mix(in oklab, var(--color-accent) 16%, var(--color-surface-1)); color: var(--color-accent-text); }
.tp-module-tile:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }

.tp-module-pic { display: grid; place-items: center; inline-size: 40px; block-size: 40px; }
.tp-module-pic img { inline-size: 100%; block-size: 100%; object-fit: contain; }
.tp-module-pic-fallback { font: var(--type-h3); }
.tp-module-level {
  position: absolute;
  inset-block-start: var(--space-1);
  inset-inline-end: var(--space-1);
  min-inline-size: 16px;
  padding: 0 3px;
  border-radius: var(--radius-full);
  corner-shape: round;
  background: var(--color-surface-1);
  color: var(--color-text-secondary);
  font: var(--type-caption);
  font-weight: 700;
  text-align: center;
}
.tp-module-tile.is-on .tp-module-level { color: var(--color-accent-text); }
.tp-module-name { inline-size: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: center; }

/* ---------- 装备 3×3 ---------- */
.tp-config-block { display: grid; gap: var(--space-2); min-inline-size: 0; }
.tp-config > .tp-config-block + .tp-config-block { padding-block-start: var(--space-4); border-block-start: 1px solid var(--color-border-subtle); }
.tp-block-head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: var(--space-1) var(--space-2); }
.tp-config-block > h3, .tp-block-head h3 { margin: 0; font: var(--type-body); font-weight: 600; }

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

.tp-skill-head { align-items: center; }
.tp-skill-heading { display: grid; gap: var(--space-1); }
.tp-skill-actions { display: flex; gap: var(--space-1); }
.tp-skill-groups { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, var(--tank-skill-group-min)), 1fr)); gap: var(--space-4); }
.tp-skill-group { display: grid; align-content: start; gap: var(--space-2); min-inline-size: 0; }
.tp-skill-class { margin: 0; color: var(--color-text-primary); font: var(--type-caption); font-weight: 600; }
.tp-skill-row { display: flex; flex: 1 1 auto; flex-wrap: wrap; gap: var(--space-1); min-inline-size: 0; }
.tp-skill-notes { display: grid; gap: var(--space-1); padding-block-start: var(--space-2); }
.tp-skill-btn {
  position: relative;
  display: grid;
  place-items: center;
  flex: 0 0 var(--control-h-lg);
  inline-size: var(--control-h-lg);
  block-size: var(--control-h-lg);
  padding: var(--space-1);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-surface-2);
  cursor: pointer;
}
.tp-skill-btn:hover { border-color: var(--color-border-strong); }
.tp-skill-btn.is-on { border-color: var(--color-accent); background: color-mix(in oklab, var(--color-accent) 14%, var(--color-surface-1)); }
.tp-skill-btn.is-pending { border-style: dashed; background: var(--color-surface-2); }
.tp-skill-btn:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }
.tp-skill-btn img { inline-size: 100%; block-size: 100%; object-fit: contain; }
.tp-skill-fallback { color: var(--color-text-secondary); font: var(--type-caption); font-weight: 600; }
.tp-skill-level {
  position: absolute;
  inset-block-end: 0;
  inset-inline-end: 0;
  padding: 0 var(--space-1);
  border-radius: var(--radius-sm);
  background: var(--color-surface-1);
  color: var(--color-accent-text);
  font: var(--type-caption);
  font-weight: 700;
}

.tp-camo-block { display: grid; gap: var(--space-1); }
.tp-camo { display: inline-flex; align-items: center; gap: var(--space-2); min-block-size: var(--hit-min-comfortable); font: var(--type-body); cursor: pointer; }
.tp-camo-summary { margin: 0; color: var(--color-text-secondary); font: var(--type-caption); }
.tp-camo input { inline-size: var(--control-check); block-size: var(--control-check); margin: 0; accent-color: var(--color-accent); }

@media (width < 768px) {
  /* 手机：类型分组 2×2（炮塔|火炮 // 发动机|履带），每组标题 + 纵向选项 */
  .tp-module-groups { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-2); }
  .tp-module-group { display: grid; align-content: start; gap: var(--space-1); min-inline-size: 0; }
  .tp-module-group-head { margin: 0; color: var(--color-text-secondary); font: var(--type-caption); font-weight: 600; }
  .tp-module-group-list { display: grid; gap: var(--space-1); }
  /* 横向紧凑卡片：小图标 + 名称 + 等级徽标，44px 触控高度 */
  .tp-module-tile {
    grid-template-columns: 28px minmax(0, 1fr) auto;
    grid-template-areas: "pic name level";
    justify-items: stretch;
    align-items: center;
    column-gap: var(--space-2);
    min-block-size: var(--hit-min-comfortable);
    padding: var(--space-1) var(--space-2);
    text-align: start;
  }
  .tp-module-pic { grid-area: pic; inline-size: 28px; block-size: 28px; }
  .tp-module-name { grid-area: name; inline-size: auto; text-align: start; }
  .tp-module-level {
    position: static;
    grid-area: level;
    justify-self: end;
    align-self: center;
  }
  /* 装备矩阵 3 行 × 3 类共 9 对候选：组内 2px、组间 12px，避免六列糊成一片 */
  .tp-dev-matrix { gap: var(--space-2) var(--space-3); }
  /* 极窄屏两个 44px 候选放不进同一槽位时自动改为纵向排列，避免 44px 触控目标互相覆盖 */
  .tp-dev-slot { grid-template-columns: repeat(auto-fit, minmax(var(--hit-min-comfortable), 1fr)); gap: calc(var(--space-1) / 2); }
  .tp-dev-btn { min-inline-size: var(--hit-min-comfortable); min-block-size: var(--hit-min-comfortable); padding: 2px; }
  .tp-dev-btn img { inline-size: 32px; block-size: 32px; }
  /* 补给 / 消耗品图标与装备图标同比缩小到 32px，同时保留 44px 触控区域 */
  .tp-icon-tile { inline-size: var(--hit-min-comfortable); block-size: var(--hit-min-comfortable); padding: 3px; }
  .tp-icon-tile img { inline-size: 32px; block-size: 32px; }
}

</style>
