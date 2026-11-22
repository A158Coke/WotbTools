/**
 * ReplayWorkspace —— 能力元数据（纯常量与映射；拆分自 ReplayWorkspace.vue，行为原样）。
 */

/** 六个能力始终公开显示。数据 / 2D 匿名可用；官方示例额外开放 3D / 射击，AI 仍要求登录，
 * 管理员角色不改变工作台能力。登录门禁位于实际解析与场景挂载之前。 */
export const capabilityOptions = [
  { key: 'data', labelKey: 'workspace.tab_data' },
  { key: 'playback', labelKey: 'workspace.tab_playback' },
  { key: '3d', labelKey: 'workspace.tab_3d' },
  { key: 'events', labelKey: 'workspace.tab_events' },
  { key: 'shots', labelKey: 'workspace.tab_shots' },
  { key: 'ai', labelKey: 'workspace.tab_ai' },
]

const VIEW_BY_CAPABILITY: Readonly<Record<string, string>> = Object.freeze({
  data: 'replay',
  playback: 'battle-playback',
  '3d': 'agent-replay',
  // 事件流是一等能力：必须有自己的 view 槽位，否则 navigate('replay') 会被 ViewHost
  // 映射回 data（切到事件流立刻被路由同步撤销）。
  events: 'agent-events',
  shots: 'agent-shots',
  ai: 'ai-review',
})

/** capability → 路由 view（Back / Forward 与深链仍由 Vue Router 唯一持有）。 */
export function viewFor(cap: string): string {
  return VIEW_BY_CAPABILITY[cap] || 'replay'
}
