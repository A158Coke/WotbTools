
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
  events: 'agent-events',
  shots: 'agent-shots',
  ai: 'ai-review',
})

export function viewFor(cap: string): string {
  return VIEW_BY_CAPABILITY[cap] || 'replay'
}
