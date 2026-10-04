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
import { hpPresentationFor } from '../scene/rosterState.js'

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
   * 每行的 reload（共享 resolver 的输出数组，按行 id）。缺省 / 该行为空 → **不显示 reload**
   * （没有权威 telemetry 时不得假设满弹），阵亡行同样隐藏。
   */
  reload: { type: Object, default: null },
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
  // 血量事实：2D 传 healthDisplayAt 投影（含 relative / knowledge），3D 传 store.roster 行自带的
  // hp / maxHp。两种形状都只是**事实源**；展示判定统一交给 hpPresentationFor，渲染层不自己猜。
  const rawHp = subset ? subset.currentHp : row.hp
  const currentHp = rawHp == null ? null : Math.max(0, Math.round(Number(rawHp) || 0))
  const maxHp = subset ? subset.maxHp : row.maxHp
  const destroyed = props.destroyed.has(id) || row.dead === true
  const hp = hpPresentationFor({
    currentHp,
    maxHp,
    pct: subset?.pct,
    relativeFull: subset?.relativeFull,
    state: destroyed ? 'DESTROYED' : (subset?.state ?? null),
  }, destroyed)
  // reload 是次级瞬时状态：优先取共享 resolver 的输出（props.reload 按行 id），
  // 其次取行自带的（3D 的 store.roster 行已经把 resolver 结果投影进去）。
  // 两者都没有 → null：不显示 reload，绝不假设满弹；阵亡时隐藏。
  const shells = props.reload?.[id] ?? row.reload
  const reload = Array.isArray(shells) && shells.length > 0 ? shells : null
  return {
    ...row,
    id,
    player: row.playerName ?? row.nick ?? '—',
    tank: row.tankName || row.tank || row.tankId || '—',
    hp,
    hpMode: hp.mode,
    // reload 是次级瞬时状态：没有权威 telemetry 时**不显示**（绝不假设满弹），阵亡时隐藏。
    reload: destroyed ? null : reload,
    destroyed,
    followed: row.followed === true,
    selected: props.selectedId != null && props.selectedId === id,
  }
}
/**
 * 纵向铺满（宽档侧车道）：紧凑行 + 高度由车道给足时，让 header 固定、列表吃满剩余高度、
 * 每行 `minmax(<可读下限>, 1fr)` 均匀分布——而不是全部堆在顶部、下面留一大片空白。
 * 竖屏纵向流（`compact === false`）保持自然高，不参与铺满。
 */
const fillHeight = computed(() => props.compact === true)

/**
 * 每行的可读下限：固定值只是 guard，正常高度由 `1fr` 连续决定。
 *
 * 取 26px 而不是触控尺寸：短横屏（740×360）整个 workspace 只有 ~256px，7 行 × 44px
 * 直接就溢出去顶开传输控件了。行仍带 `min-height: var(--hit-min)` 之外的可点区域由整行
 * 承担，这里只保证文字不互相压住。高视口下 1fr 会把行拉得很开（这才是均匀分布的目标）。
 */
const ROSTER_ROW_MIN_PX = 26

/** 每个分组的列表轨道：N 行 × minmax(下限, 1fr)。 */
function listRows(rowCount) {
  return `repeat(${Math.max(1, rowCount)}, minmax(${ROSTER_ROW_MIN_PX}px, 1fr))`
}
</script>

<template>
  <div
    class="pb-roster"
    :class="['pb-roster-' + variant, { 'pb-roster-compact': compact, 'pb-roster-fill': fillHeight }]"
    data-test="pb-shell-roster"
  >
    <section
      v-for="section in groups"
      :key="section.key"
      class="pb-roster-team team"
      :class="section.className"
      :data-team="section.key"
    >
      <h3 class="pb-team-head">{{ t(section.labelKey) }}</h3>
      <div class="pb-roster-list roster" :style="{ gridTemplateRows: listRows(section.rows.length) }">
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
          <span class="tank pb-team-tank" data-test="pb-roster-tank">{{ row.tank }}</span>
          <!-- HP 是主 combat state：条内文字叠加。文字**不能**放进 fill 节点里，
               否则 30% 血量会把文字一起裁掉（见下方 CSS 的 z-index 分层）。 -->
          <span
            class="pb-roster-hpbar pb-roster-hp"
            :class="'hp-mode-' + row.hp.mode"
            data-test="roster-hp"
            role="img"
            :aria-label="row.hp.text"
          >
            <span v-if="row.hp.fill > 0" class="pb-roster-hpfill" :style="{ width: (row.hp.fill * 100) + '%' }" aria-hidden="true"></span>
            <span class="pb-roster-hptext" data-test="roster-hp-text" aria-hidden="true">{{ row.hp.text }}</span>
          </span>
          <!-- reload 是次级瞬时状态：更短更细，仅在有权威 telemetry 时出现 -->
          <span v-if="row.reload" class="pb-roster-reload" data-test="roster-reload" aria-hidden="true">
            <span
              v-for="(shell, index) in row.reload"
              :key="index"
              class="pb-roster-shell"
              :data-state="shell.state"
            >
              <span
                class="pb-roster-shellfill"
                :style="{ width: (shell.state === 'full' ? 100 : shell.state === 'loading' ? Math.max(0, Math.min(1, shell.progress)) * 100 : 0) + '%' }"
              ></span>
            </span>
          </span>
        </button>
      </div>
    </section>
    <p v-if="!compact" class="pb-roster-hint">{{ t('workspace.playback_roster_hint') }}</p>
  </div>
</template>

<style scoped>
/* 名册行：**纵向四层**，信息层级固定为
      PlayerName → TankName → [ HP 条（文字叠加在条内） ] → [ reload ]
   昵称独占第一行（长昵称因此有完整宽度，不再和 HP 数字挤同一行）。 */
.pb-roster-row {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: var(--space-1);
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
.pb-roster-row .nick { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pb-roster-row .tank { min-width: 0; overflow: hidden; color: var(--color-text-secondary); text-overflow: ellipsis; white-space: nowrap; }
/* 3D 变体的行首队色圆点：绝对定位，不参与纵向四层的排布。 */
.pb-roster-3d .pb-roster-row .dot {
  position: absolute;
  inset-block-start: calc(var(--space-1) + 5px);
  inset-inline-start: calc(var(--space-2) - 1px);
  width: var(--space-2);
  height: var(--space-2);
  border-radius: var(--radius-full);
}
.pb-roster-3d .pb-roster-row .nick { padding-inline-start: var(--space-3); }

/* —— HP 条（主 combat state）：绿色 fill + 条内文字叠加 ——
   fill 与 text 是**兄弟**节点：文字若放进 fill 里，低血量时会被 fill 的宽度一起裁掉。
   条内文字必须始终完整可读 → text 用 `position:absolute` + `inset:0` + 居中，独立于 fill。 */
.pb-roster-hpbar {
  position: relative;
  display: block;
  inline-size: 100%;
  block-size: var(--roster-hpbar-h, 14px);
  border-radius: var(--radius-full);
  background: var(--color-playback-label-track);
  overflow: hidden;
}
.pb-roster-hpfill {
  position: absolute;
  inset-block: 0;
  inset-inline-start: 0;
  border-radius: var(--radius-full);
  /* 绿色 = 「这也是 HP」的语义（与名牌的 HP fill 同一族 token：team-1/ally = green-400）。 */
  background: var(--color-team-ally);
}
.pb-roster-hptext {
  position: absolute;
  inset: 0;
  z-index: var(--pb-z-hud);
  display: flex;
  align-items: center;
  justify-content: center;
  font: var(--type-caption);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  color: var(--color-playback-label-text);
  text-shadow: var(--text-shadow-playback-label);
}
/* unknown / destroyed 没有可画的填充：fill 节点根本不渲染（见模板的 v-if），
   所以这里不需要 !important 去覆盖 inline width —— unknown ≠ 0%，也不画满绿。 */
.pb-roster-hpbar.hp-mode-unknown { background: var(--color-surface-3); }

/* —— reload（次级瞬时状态）：比 HP 更短、更细，保留弹夹分段。
   分段语义与名牌共用同一批 token：locked 用 `--color-playback-label-locked`，fill 用
   `--color-playback-label-text`（弹夹已装填的那一格是白/亮色，不是绿色——绿色属于 HP）。 —— */
.pb-roster-reload {
  display: flex;
  align-items: center;
  gap: calc(var(--space-1) / 2);
  inline-size: var(--roster-reload-w, 60%);
  block-size: var(--roster-reload-h, 3px);
}
.pb-roster-shell {
  position: relative;
  flex: 1 1 0;
  block-size: 100%;
  border-radius: var(--radius-full);
  background: var(--color-playback-label-track);
  overflow: hidden;
}
.pb-roster-shell[data-state="locked"] { background: var(--color-playback-label-locked); }
.pb-roster-shellfill {
  position: absolute;
  inset-block: 0;
  inset-inline-start: 0;
  border-radius: var(--radius-full);
  background: var(--color-playback-label-text);
}

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

/* 纵向铺满（宽档侧车道 / 竖向流）——
   目标形状：Team header 固定顶部，列表吃满 section 剩余高度，行**纵向均匀分布**。
   所有权链条：`.pb-roster`（行 = header / list 两条轨道）
     → `.pb-roster-team`（行 = header 自动 + list `minmax(0,1fr)`）
     → `.pb-roster-list`（行 = N × `minmax(<可读下限>, 1fr)`，N 由行内 style 给出）
   每行只拿「剩余高度 ÷ N」，没有固定大 px。

   ⚠️ 必须显式把 grid track 的自动最小尺寸压到 0（`min-block-size: 0` 不够，轨道要
   `minmax(0, …)`）：grid 轨道的 `auto` 下限等于内容高，短横屏（740×360、workspace 只有
   246px）下 section 会撑到 394px 溢出车道、把传输控件顶出视口。压到 0 之后内容才真正
   在车道内被压缩（行距随之收紧），而不是把父级顶开。 */
.pb-roster.pb-roster-fill { align-content: stretch; block-size: 100%; }
.pb-roster.pb-roster-fill .pb-roster-team { grid-template-rows: auto minmax(0, 1fr); min-block-size: 0; }
.pb-roster.pb-roster-fill .pb-roster-list { align-content: stretch; min-block-size: 0; }
.pb-roster.pb-roster-fill .pb-roster-row { min-block-size: var(--roster-row-min, 26px); }

.pb-roster-team { display: grid; gap: var(--space-1); min-width: 0; padding: var(--space-1); }
/* 3D 的车道里，名册栏自己承担卡片外观（2D 的车道由外层 lane 承担）。
   卡片必须**填满车道高度**：`.team-lane` 是 flex column 且已拉满网格行高，卡片若是
   `flex: 0 1 auto` 就只占内容高（实测 1600×900：车道 890px、卡片只有 242px），
   两侧名册退化成贴在左上/右上角的两个浮块，下面整列空着 —— 那不是名册栏。
   主轴（纵向）要 `flex-grow`；`align-self` 只会拉交叉轴（横向），对高度无效。 */
.pb-roster-3d {
  inline-size: 100%;
  max-inline-size: 100%;
  flex: 1 1 auto;
  min-block-size: 0;
  padding: var(--space-3);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-sm);
  background: var(--color-surface-1);
}
/* 队伍面板不再自绘卡片：面与边框已上移到整条名册栏（`.pb-roster-3d`），
   否则会出现「框里的框」，而名册栏下方的留白仍然没有归属。 */
.pb-roster-3d .pb-roster-team { background: none; border: 0; }
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
