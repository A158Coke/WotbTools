<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useBreakpoint } from '../composables/useBreakpoint.js'
import { moduleIconUrl } from '../utils/researchCatalog.js'
import { configIndexFor, pickGun, pickTurret } from '../replay-local/compute/tankSetup'
import { fmtNum } from '../scene/tankMeta.js'
import { romanLevel } from '../utils/tierFormat.js'
import type { SetupSelection } from '../replay-local/compute/tankSetupTypes'

interface TankModule { stem?: string; localId?: number; level?: number; guns?: TankModule[]; stats?: Record<string, number | undefined> }
interface ModuleOption { value: number | null; level?: number; name: string; key?: string | number; disabled?: boolean; testId?: string; title?: string; ariaLabel?: string }
interface ModuleRow { key: string; icon: string | null; selected: number; options: ModuleOption[]; select: (value: number | null) => void }

const props = defineProps<{
  detail: { configs?: unknown[] }; modules: { turrets?: TankModule[]; engines?: TankModule[]; chassis?: TankModule[] }
  selection: SetupSelection; itemName: (item: TankModule) => string
}>()
const emit = defineEmits(['update'])
const { t } = useI18n()
const { isCompact } = useBreakpoint()
const currentTurret = computed(() => props.modules?.turrets?.[props.selection.turret] || null)
/** 四个模块槽的候选（图标 = 客户端 ModulesTechTree 类型图；名称/等级来自数据）。 */
const moduleRows = computed<ModuleRow[]>(() => {
  const turrets = props.modules?.turrets || []
  const guns = currentTurret.value?.guns || []
  return [
    {
      key: 'turret',
      icon: moduleIconUrl('turret'),
      selected: props.selection.turret,
      options: turrets.map((turret, index) => ({ value: index, level: turret.level, name: props.itemName(turret) })),
      select: value => { if (value != null) emit('update', pickTurret(props.selection, props.modules, props.detail, value)) },
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
            && configIndexFor(props.detail?.configs || [], currentTurretId, currentGun.localId ?? null) >= 0
          const disabled = !hasConfig
          const reason = t('agentTanks.configurator.gun_unavailable')
          return {
            key: gun.stem || gun.localId,
            value: index >= 0 ? index : null,
            level: gun.level,
            name: props.itemName(gun),
            disabled,
            testId: index >= 0 ? undefined : `tank-gun-unavailable-${gun.stem || gun.localId}`,
            title: disabled
              ? `${props.itemName(gun)} — ${reason}`
              : t('agentTanks.configurator.gun_option', { name: props.itemName(gun), reload: fmtNum(gun?.stats?.reloadTime, 1) }),
            ariaLabel: disabled ? `${props.itemName(gun)} — ${reason}` : props.itemName(gun),
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
        name: props.itemName(engine),
        title: t('agentTanks.configurator.engine_option', { name: props.itemName(engine), power: fmtNum(engine?.stats?.power, 0) }),
      })),
      select: value => { if (value != null) emit('update', { engine: value }) },
    },
    {
      key: 'track',
      icon: moduleIconUrl('chassis'),
      selected: props.selection.track,
      options: (props.modules?.chassis || []).map((track, index) => ({
        value: index,
        level: track.level,
        name: props.itemName(track),
        title: t('agentTanks.configurator.track_option', {
          name: props.itemName(track),
          rotation: fmtNum(track?.stats?.rotationSpeed, 1),
          // 客户端 chassis maxLoad 单位是 kg（T-34 31300），tooltip 显示吨
          load: Number(track?.stats?.maxLoad) > 0 ? fmtNum(Number(track.stats?.maxLoad) / 1000, 1) : '—',
        }),
      })),
      select: value => { if (value != null) emit('update', { track: value }) },
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
</script>

<template>
    <!-- 桌面/平板：首行 = 4 个类型标签，之后按选项序号逐行展开（炮塔1|火炮1|发动机1|履带1，
         下一行炮塔2|火炮2…），4 列严格对齐，避免右侧空白。 -->
    <div v-if="!isCompact" class="tp-module-matrix">
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
    <div v-else class="tp-module-groups">
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
            :key="option.testId ?? option.key ?? option.value ?? undefined"
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

</template>

<style scoped>
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
}
</style>
