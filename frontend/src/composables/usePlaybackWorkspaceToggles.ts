import { ref, useId, watch, type Ref } from 'vue'

/**
 * 2D 回放工作台的会话级视图开关（不持久化）：底部工具栏折叠 + 横屏名册浮层开合。
 * 持久化偏好仍归 usePlaybackPreferences（`uiPrefs.showRoster` 等）唯一所有；这里的状态只
 * 决定呈现形态，刷新 / 重建回到形态默认值，不产生第二个持久化来源。
 *
 * §2d-toolbar-collapse：工具栏折叠复用 3D Replay3DPane 的 controlsCollapsed 交互机制，但不复制
 * 其高度滑动状态机——2D 传输条是流内布局，v-show 足够。折叠瞬间的连带收起（Display 面、标注
 * 会话）由宿主经 `onCollapse` 注入，保持「收起 = 只留恢复入口」的同一语义。
 *
 * §roster-overlay：名册浮层开关（手机横屏默认收纳、其余形态默认展开；形态切换回到该形态默认）。
 */
export function usePlaybackWorkspaceToggles({ phoneLandscape, onCollapse }: {
  phoneLandscape: Ref<boolean>
  onCollapse: () => void
}) {
  const controlsCollapsed = ref(false)
  const controlsContentId = useId()
  function toggleControlsCollapsed() {
    controlsCollapsed.value = !controlsCollapsed.value
    if (controlsCollapsed.value) onCollapse()
  }

  const rosterLanesOpen = ref(!phoneLandscape.value)
  watch(phoneLandscape, (landscape) => { rosterLanesOpen.value = !landscape })
  function toggleRosterLanes() { rosterLanesOpen.value = !rosterLanesOpen.value }

  return { controlsCollapsed, controlsContentId, toggleControlsCollapsed, rosterLanesOpen, toggleRosterLanes }
}
