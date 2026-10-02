/**
 * 2D 战局回放本地数据（服务端 battle-playback-v2 / map-overview 的客户端替代）。
 *
 * 接入点（cutover 由 BattlePlaybackPanel 完成，组件契约不变）：
 *   const { dataset, overview } = await parseLocalPlayback(file)
 *   mapPlaybackV2.value = dataset          // 原 fetchBattlePlaybackDataset(...).data
 *   mapOverview.value = overview           // 原 fetchMapOverviewArtifact(...).data
 *   playbackV2State = dataset ? (dataset.capability === 'PARTIAL' ? 'PARTIAL' : 'FULL') : 'UNAVAILABLE'
 */
export { parseLocalPlayback, type LocalPlayback, type ParseLocalPlaybackOptions } from './parseLocalPlayback.js'
export {
  PERSPECTIVE_TEAM_UNRESOLVED,
  REPLAY_STREAM_TRUNCATED,
  resolvePlaybackClock,
  settlementInitialHp,
  toBattlePlaybackDataset,
  type PlaybackClock,
  type ToDatasetOptions,
} from './toBattlePlaybackDataset.js'
export {
  indexMapGridProfiles,
  parseMapGridProfile,
  toMapOverview,
  type LocalMapOverview,
  type MapGridProfile,
} from './toMapOverview.js'
