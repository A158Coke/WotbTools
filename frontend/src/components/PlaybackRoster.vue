<script setup>
/**
 * 两队阵容：2D 与 3D **同一份实现**，并且按**物理队伍**分组——左 = Team 1，右 = Team 2，
 * 与录像者属于哪一队无关（录像者视角的 friendly / enemy 只服务 HUD 总血量、比分与详情里的
 * 关系文案，不决定名册落在哪一侧）。两个渲染器只有**行数据**的来源不同：2D 的血量来自
 * `health` 投影（与地图标记同一个 healthDisplayAt），3D 的行自带 hp / maxHp / dead。
 *
 * 行的信息契约：玩家 / 车型 / 当前 HP / 百分比 / 阵亡，点行 → 选中该车。
 * 没有血条：HP 数值与百分比就是主信息（`hpPercentText` 在「没有可信血量上限」时返回 null，
 * 上屏成 `—` 而不是 `0%`——unknown ≠ 0，见 scene/rosterState.js）。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { hpPercentText } from '../scene/rosterState.js'

defineOptions({ name: 'PlaybackRoster' })

const props = defineProps({
  /**
   * 分组容器：`{ team1, team2, unknown }`（物理队伍）。一个车道可以只给其中一部分
   * （左车道 = team1 + unknown，右车道 = team2）。
   */
  teams: { type: Object, required: true },
  /** 当前时刻已被击毁的集合（accountId 或 eid，按行 id 匹配） */
  destroyed: { type: Set, default: () => new Set() },
  /**
   * 行的状态。两种形状（**同一个实现**的两套数据源，不复制组件）：
   *   2D：`{ [id]: { currentHp, maxHp } }` —— 与地图标记同一个 healthDisplayAt 投影
   *   3D：行自带 `hp` / `maxHp` / `dead` / `followed` —— 场景内核的 store.roster
   */
  health: { type: Object, default: null },
  /**
   * 行样式：'2d' 与 '3d' 的差异只在呈现（3D 多一个行首队色圆点 + 跟随态描边），
   * 行的信息契约相同。
   */
  variant: { type: String, default: '2d' },
  /** 当前选中行的 id（`selected` 与 `followed` 是两件事，这里只表达 selected） */
  selectedId: { type: null, default: null },
  /** 空分组不画标题（默认）；置 true 时即使没有行也保留标题。 */
  showEmptyTeams: { type: Boolean, default: false },
  /**
   * 紧凑密度：横屏侧车道用。行仍是两行（玩家 + HP + 百分比 / 车型），只收紧内边距与间距，
   * 让正常 7v7 不用车道滚动条就放得进正方形 Stage 两侧的空白——不是把行砍成只剩名字。
   */
  compact: { type: Boolean, default: false },
})
const emit = defineEmits(['select'])
const { t } = useI18n()

const SECTIONS = Object.freeze([
  { key: 'team1', labelKey: 'agentReplay.team1', className: 'pb-roster-team1 team team1' },
  { key: 'unknown', labelKey: 'agentReplay.teamUnknown', className: 'pb-roster-unknown team team-unknown' },
  { key: 'team2', labelKey: 'agentReplay.team2', className: 'pb-roster-team2 team team2' },
])

/**
 * 渲染哪些分组：默认只画**真正有行**的分组（unknown 常常是空的，空标题是噪音）。
 * `showEmptyTeams` 打开时保留空分组的标题——上传的分析在解析出名单之前就是这种状态，
 * 这时「队伍 1 / 队伍 2」两个空标题本身就是「还没有数据」的正确呈现。
 */
const groups = computed(() => SECTIONS
  .map((section) => ({ ...section, rows: (props.teams?.[section.key] || []).map(decorate) }))
  .filter((section) => section.rows.length > 0 || (props.showEmptyTeams && section.key in props.teams)))

function decorate(row) {
  const id = row.accountId ?? row.eid
  const subset = props.health?.[id] || null
  const rawHp = subset ? subset.currentHp : row.hp
  const currentHp = rawHp == null ? null : Math.max(0, Math.round(Number(rawHp) || 0))
  const maxHp = subset ? subset.maxHp : row.maxHp
  const pct = currentHp == null ? null : hpPercentText(currentHp, maxHp)
  return {
    ...row,
    id,
    player: row.playerName ?? row.nick ?? '—',
    tank: row.tankName || row.tank || row.tankId || '—',
    hpText: currentHp == null ? '—' : String(currentHp),
    hpPctText: pct == null ? '—' : `${pct}%`,
    destroyed: props.destroyed.has(id) || row.dead === true,
    followed: row.followed === true,
    selected: props.selectedId != null && props.selectedId === id,
  }
}
</script>

<template>
  <div class="pb-roster" :class="['pb-roster-' + variant, { 'pb-roster-compact': compact }]" data-test="pb-shell-roster">
    <section
      v-for="section in groups"
      :key="section.key"
      class="pb-roster-team team"
      :class="section.className"
      :data-team="section.key"
    >
      <h3 class="pb-team-head">{{ t(section.labelKey) }}</h3>
      <div class="pb-roster-list roster">
        <button
          v-for="row in section.rows"
          :key="row.id"
          type="button"
          class="pb-roster-row pl"
          :class="{ 'is-destroyed': row.destroyed, dead: row.destroyed, 'is-selected': row.selected, selected: row.selected, followed: row.followed }"
          data-test="pb-roster-row"
          :data-account-id="row.id"
          :aria-pressed="row.selected"
          @click="emit('select', row.id, $event)"
        >
          <span v-if="variant === '3d'" class="dot" :style="{ background: row.color }" aria-hidden="true" />
          <span class="nick pb-team-player" data-test="pb-roster-player">{{ row.player }}</span>
          <span class="hpv pb-roster-hp" data-test="roster-hp">{{ row.hpText }}</span>
          <span class="hpp pb-roster-hp-pct" data-test="roster-hp-pct">{{ row.hpPctText }}</span>
          <span class="tank pb-team-tank" data-test="pb-roster-tank">{{ row.tank }}</span>
        </button>
      </div>
    </section>
    <p v-if="!compact" class="pb-roster-hint">{{ t('workspace.playback_roster_hint') }}</p>
  </div>
</template>

<style scoped>
/* 名册行：两行网格。
   行 1 = 玩家 + **HP 数值** + **百分比**（数值列 `tabular-nums`、不截断；只有玩家与车型允许 ellipsis）
   行 2 = 车型（横跨整行）。没有血条：数值与百分比就是主信息。

   ⚠️ 用显式 grid-column / grid-row 定位，**不要用 grid-template-areas**：
   本行有两行结构，"HP 值行 1 占第 3 列 / 百分比行 1 占第 4 列"，若把它们写成同一个
   区域名，该区域就不是矩形 → 整条 `grid-template-areas` 被判无效并丢弃 → 所有单元格
   落进隐式单列、全部叠在 x=0（实测整行文字互相压在一起）。 */
.pb-roster-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  grid-template-rows: auto auto;
  align-items: center;
  column-gap: var(--space-2);
  width: 100%;
  min-height: var(--hit-min);
  padding: var(--space-1) var(--space-2);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-primary);
  font: var(--type-caption);
  text-align: start;
  cursor: pointer;
}
.pb-roster-dot,
.pb-roster-row .dot { grid-column: 1; grid-row: 1 / span 2; align-self: center; width: var(--space-2); height: var(--space-2); border-radius: var(--radius-full); }
.pb-roster-row .nick { grid-column: 1; grid-row: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pb-roster-row .hpv { grid-column: 2; grid-row: 1; }
.pb-roster-row .hpp { grid-column: 3; grid-row: 1; min-inline-size: 4ch; text-align: end; }
.pb-roster-row .hpv,
.pb-roster-row .hpp { font: var(--type-caption); font-variant-numeric: tabular-nums; white-space: nowrap; }
.pb-roster-row .tank { grid-column: 1 / -1; grid-row: 2; min-width: 0; overflow: hidden; color: var(--color-text-secondary); text-overflow: ellipsis; white-space: nowrap; }
/* 3D 变体：行首圆点独占第一列，其余列整体右移一格。 */
.pb-roster-3d .pb-roster-row { grid-template-columns: auto minmax(0, 1fr) auto auto; }
.pb-roster-3d .pb-roster-row .nick { grid-column: 2; }
.pb-roster-3d .pb-roster-row .hpv { grid-column: 3; }
.pb-roster-3d .pb-roster-row .hpp { grid-column: 4; }
.pb-roster-3d .pb-roster-row .tank { grid-column: 2 / -1; }

/* 状态视觉：`selected`（选择器语义，详情面板跟它走）与 `followed`（相机跟随语义）
   是**两个独立状态**，一行可以同时是两者，所以两条规则各按自己的类生效，不互相冒充。 */
.pb-roster-row.is-selected { background: var(--color-surface-3); outline: 1px solid var(--color-text-secondary); }
.pb-roster-row.followed { outline: 1px solid var(--color-accent); }
.pb-roster-row.selected.followed { outline-color: var(--color-accent); }
.pb-roster-row.is-destroyed { opacity: .42; }
.pb-roster-row.dead .nick { text-decoration: line-through; }
.pb-roster-row:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }

/* 分组：两个渲染器都按物理队伍着色（team-1 / team-2）——左右与颜色都不随录像者交换。
   `.team` / `.roster` 是与 3D 场景层共用的类名——行的布局只此一份。 */
/* 名册容器**不是**独立滚动区（审计 BZ-13：名册里不允许嵌套滚动条）。
   宽度永远跟着承载它的车道 / 纵向流走（车道自己定宽），这里不再写死 240px。 */
.pb-roster { display: grid; align-content: start; gap: var(--space-3); width: 100%; min-block-size: 0; padding: var(--space-3); }
.pb-roster-team { display: grid; gap: var(--space-1); min-width: 0; padding: var(--space-1); }
/* 3D 的车道里，队伍面板自己承担卡片外观（2D 的车道由外层 lane 承担）。 */
.pb-roster-3d { inline-size: 100%; max-inline-size: 100%; }
.pb-roster-3d .pb-roster-team { border: 1px solid var(--color-border-subtle); border-radius: var(--radius-sm); background: var(--color-surface-1); }
.pb-team-head { margin: 0; color: var(--color-text-secondary); font: var(--type-caption); font-weight: 800; }
.pb-roster-list { display: grid; gap: var(--space-1); margin: 0; padding: 0; }
.pb-roster-team.pb-roster-team1 .pb-roster-row { border-inline-start: 3px solid var(--color-team-1); }
.pb-roster-team.pb-roster-team2 .pb-roster-row { border-inline-start: 3px solid var(--color-team-2); }
.pb-roster-team.pb-roster-unknown .pb-roster-row { border-inline-start: 3px solid var(--color-border-subtle); opacity: .8; }
.pb-roster-team .pb-roster-row { background: var(--color-surface-2); }
.pb-roster-row:hover { background: var(--color-surface-3); }
.pb-roster-hint { margin: 0; color: var(--color-text-tertiary); font: var(--type-caption); }

/* 紧凑密度（横屏侧车道）：信息不减，只收紧留白。行高回到「两行文字 + 2px」，
   正常 7v7 因此不需要车道滚动条。 */
.pb-roster-compact { gap: var(--space-1); padding: 0; }
.pb-roster-compact .pb-roster-team { gap: 0; padding: 0; }
.pb-roster-compact .pb-roster-list { gap: 0; }
.pb-roster-compact .pb-roster-row { min-height: 0; padding: 0 var(--space-1); border-block-width: 0; }
</style>
