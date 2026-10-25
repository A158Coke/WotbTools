/** Record the production armor host's scene handoff without loading any remote assets. */
import { initTankViewer as realInitTankViewer } from '/src/scene/tankViewer.js'
import { fetchReplayShots } from '/src/scene/agentData.js'

export function initTankViewer(options) {
  if (!window.__wsShotParse) {
    return realInitTankViewer(options)
  }
  window.__wsArmorScene = {
    query: Object.fromEntries(new URLSearchParams(location.search)),
    // 2026-10-24 起初始车/射手经 initTankViewer 显式参数注入（window.__INITIAL_* 全局
    // 已随 B3 契约化移除）——stub 直读 options，比读全局更贴近生产契约本身
    tank: options.initialTankId, shooter: options.initialShooterId,
    shot: null,
  }
  fetchReplayShots().then(({ shots }) => {
    const index = Number(window.__wsArmorScene.query.shot)
    window.__wsArmorScene.shot = shots.find((shot) => shot.index === index) || null
    options.onLoadState({ state: 'ready' })
  })
  return { destroy() {} }
}
