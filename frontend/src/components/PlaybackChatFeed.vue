<script setup lang="ts">
// 3D 快捷指令 / 聊天 / 地图标记滚动流（左下）：从 Replay3DPane 出仓（源码行预算回归
// 1500）。数据与呈现都在本组件：复用事件流的行文案事实源（eventRowTitle，同一 i18n 键
// 与「玩家 · 车名」身份纪律）+ useTankNames 单例 tankNames 表（事件流 pane 同消费）。
// 只列 ≤ 当前回放时刻最近 6 条（旧条淡显、marker 行 objective 强调色）；隐藏全部 UI 时
// 随覆盖层一并隐藏；pointer-events 关闭不拦截战场操作。
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AgentPlaybackFacet } from '../api/agent-replay-facets.js'
import { buildEventStream, eventRowTitle } from '../utils/playbackEventStream.ts'
import { useTankNames } from '../composables/useTankNames.js'

const props = defineProps<{
  /** 回放数据面（AgentPlaybackFacet；markers/chat_events 所在）。 */
  facet: AgentPlaybackFacet | null
  /** 回放时刻（秒）：只显示 t <= time 的事件。 */
  time: number
  /** 隐藏全部 UI / 无数据 → 整层隐藏（与覆盖层同语义）。 */
  hidden: boolean
}>()

const { t } = useI18n()
const feedTankNames = useTankNames()

const feedRows = computed(() => {
  if (!props.facet) return []
  return buildEventStream(props.facet, { tankNames: feedTankNames.value })
    .filter((ev) => ev.kind === 'chat' || ev.kind === 'command' || ev.kind === 'marker')
})
const feed = computed(() => feedRows.value.filter((ev) => ev.t <= props.time).slice(-6))
</script>

<template>
  <div class="pb-chat-feed" data-testid="pb-chat-feed" :hidden="hidden" aria-live="polite">
    <p v-for="(ev, i) in feed" :key="`${ev.t}-${ev.kind}-${i}`" class="pb-chat-feed-row" :data-kind="ev.kind">{{ eventRowTitle(ev, t) }}</p>
  </div>
</template>

<style scoped>
/* 快捷指令 / 聊天 / 地图标记滚动流（左下）：与游戏内聊天 feed 同位的呈现层。
   屏幕尺寸固定 px；行数由 JS 截尾（最近 6 条），越旧越淡；pointer-events 关闭——
   纯呈现层，不拦截战场点击/拖拽。 */
.pb-chat-feed {
  position: absolute;
  left: var(--space-4, 16px);
  bottom: calc(var(--space-4, 16px) + 56px);
  max-width: min(46ch, 60%);
  display: flex;
  flex-direction: column;
  gap: 2px;
  pointer-events: none;
  z-index: var(--pb-z-canvas);
}
.pb-chat-feed[hidden] { display: none; }
.pb-chat-feed-row {
  margin: 0;
  padding: 2px 10px;
  border-radius: var(--radius-sm);
  background: color-mix(in oklab, var(--color-canvas) 58%, transparent);
  color: var(--color-text-primary);
  font: var(--type-caption);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pb-chat-feed-row:nth-last-child(n + 4) { opacity: .55; }
.pb-chat-feed-row[data-kind='marker'] { color: var(--color-objective); }
</style>
