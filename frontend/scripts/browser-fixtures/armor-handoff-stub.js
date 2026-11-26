import { initTankViewer as realInitTankViewer } from '/src/scene/tankViewer.js'
import { fetchReplayShots } from '/src/scene/agentData.js'

export function initTankViewer(options) {
  if (!window.__wsShotParse) {
    return realInitTankViewer(options)
  }
  window.__wsArmorScene = {
    query: Object.fromEntries(new URLSearchParams(location.search)),
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
