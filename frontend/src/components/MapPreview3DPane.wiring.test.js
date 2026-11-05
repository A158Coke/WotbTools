// 场景接线守卫（source regression，与 BattlePlayback.coordinate 同款）：
// 地图预览 3D 面板必须走 loadMapOnly 会话，绝不触碰回放数据路径 loadData。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const paneSrc = readFileSync(fileURLToPath(new URL('./MapPreview3DPane.vue', import.meta.url)), 'utf8')
const kernelSrc = readFileSync(fileURLToPath(new URL('../scene/playbackScene.js', import.meta.url)), 'utf8')

describe('MapPreview3DPane 场景接线（source regression）', () => {
  it('面板只经 loadMapOnly 装载，不出现 loadData 回放路径', () => {
    expect(paneSrc).toContain('loadMapOnly(')
    expect(paneSrc).not.toMatch(/sceneApi\.loadData\b|\bawait .*loadData\(/)
    expect(paneSrc).not.toContain('<PlaybackVehicleLabels3D')
    expect(paneSrc).not.toContain('<PlaybackTransport')
    expect(paneSrc).not.toContain('<PlaybackRoster')
    expect(paneSrc).not.toContain('<VehicleDetailsPanel')
  })

  it('画质与相机走 SegmentedControl，与 Replay3DPane 同一控件（DC-SEL-08）', () => {
    expect(paneSrc).toContain("import SegmentedControl from './SegmentedControl.vue'")
    expect(paneSrc).not.toContain('<select')
    expect(paneSrc).toContain('class="map3d-quality-label"')
    expect(paneSrc).toMatch(/data-testid="map-3d-quality"\s+@update:model-value="changeQuality"/)
    expect(paneSrc).toMatch(/data-testid="map-3d-camera"\s+@update:model-value="chooseCamera"/)
  })

  it('换图判定只看 mapId：locale 化的 mapName 变化不得清空标注（回归锁）', () => {
    // 切语言 → selected.name（locale 派生）→ mapName prop 变化；图身份未变，
    // 标注与撤销栈必须保留（Codex 复审 #4431969638）
    expect(paneSrc).not.toContain('[props.mapId, props.mapName]')
    expect(paneSrc).toMatch(/watch\(\(\) => props\.mapId/)
  })

  it('destroyScene（GPU teardown/离线销毁）不触碰标注会话（回归锁）', () => {
    // 断网 → reconcile destroyScene：未导出的绘制与撤销栈必须保留，
    // 重连后由 mapReady watcher 补推（Codex #4431990895）。
    const start = paneSrc.indexOf('function destroyScene')
    const end = paneSrc.indexOf('function shouldHaveScene')
    const body = paneSrc.slice(start, end)
    expect(body).not.toContain('resetAnnotationState')
  })

  it('基地点位：唯一推送方向 pane→scene（setMapBasesKind），三触发点齐全', () => {
    // kind 变化 / 场景创建（先于装载记意图）/ 会话就绪（teardown 复位内核意图后补推）
    expect(paneSrc).toContain('setMapBasesKind')
    expect(paneSrc).toContain('function pushBasesKind')
    expect(paneSrc).toContain('watch(() => props.basesKind, pushBasesKind)')
    const ensure = paneSrc.indexOf('function ensureScene')
    const ensureEnd = paneSrc.indexOf('function reloadMap')
    expect(paneSrc.slice(ensure, ensureEnd)).toContain('pushBasesKind()')
    const readyStart = paneSrc.indexOf('watch(() => store.mapReady')
    const readyBody = paneSrc.slice(readyStart, paneSrc.indexOf('})', readyStart))
    expect(readyBody).toContain('pushBasesKind()')
  })

  it('出生点：唯一推送方向 pane→scene（setMapSpawns），三触发点齐全（#835）', () => {
    // 点列变化 / 场景创建（先于装载记意图）/ 会话就绪（teardown 复位内核意图后补推）
    expect(paneSrc).toContain('setMapSpawns')
    expect(paneSrc).toContain('function pushSpawnPoints')
    expect(paneSrc).toContain('watch(() => props.spawnPoints, pushSpawnPoints)')
    const ensure = paneSrc.indexOf('function ensureScene')
    const ensureEnd = paneSrc.indexOf('function reloadMap')
    expect(paneSrc.slice(ensure, ensureEnd)).toContain('pushSpawnPoints()')
    const readyStart = paneSrc.indexOf('watch(() => store.mapReady')
    const readyBody = paneSrc.slice(readyStart, paneSrc.indexOf('})', readyStart))
    expect(readyBody).toContain('pushSpawnPoints()')
  })

  it('UI Profile 切换：pane watch uiProfile → 内核 refreshSpawnColors 原位重着色（#877 review P3）', () => {
    // useUiProfile 不 reload/remount：2D 随 CSS 换色，3D 材质快照必须显式同步
    expect(paneSrc).toContain("import { uiProfile } from '../composables/useUiProfile.js'")
    expect(paneSrc).toMatch(/watch\(uiProfile,/)
    expect(paneSrc).toContain('refreshSpawnColors?.()')
    // 内核侧：map 会话门控 + 原位 refreshColors + invalidate（回放会话 no-op）
    expect(kernelSrc).toContain('function refreshSpawnColors()')
    expect(kernelSrc).toMatch(/refreshSpawnColors\(\) \{[\s\S]*?SESSION_MODE !== 'map'[\s\S]*?spawnMarkers\.refreshColors\(\)[\s\S]*?invalidate\(\)/)
    expect(kernelSrc).toContain('refreshSpawnColors() {')
  })

  it('内核 map 会话：stub DATA + 就绪门控 mapReady（hasData 保持回放专用）', () => {
    expect(kernelSrc).toContain('async function loadMapOnly(')
    expect(kernelSrc).toContain("SESSION_MODE = 'map'")
    expect(kernelSrc).toContain('if (SESSION_MODE === \'map\') {')
    expect(kernelSrc).toContain('store.mapReady = true')
    // 地图会话提前收口必须发生在 buildVehicles 之前（回放尾部不得执行）
    expect(kernelSrc.indexOf('if (SESSION_MODE === \'map\') {'))
      .toBeLessThan(kernelSrc.indexOf('buildVehicles();'))
    // 出生点（#835）：会话态 + map 会话建点 + teardown 复位清场景 + 回放不消费
    expect(kernelSrc).toContain('setMapSpawns(points)')
    expect(kernelSrc).toContain('function buildSpawns()')
    expect(kernelSrc).toContain("spawnMarkers.build(SESSION_MODE === 'map' ? MAP_SPAWN_POINTS : null)")
    expect(kernelSrc).toContain('MAP_SPAWN_POINTS = null;')
    expect(kernelSrc).toContain('clearSpawns();   // 出生点贴地标记随会话释放')
    // 触屏手势接线同源（#835 项 3）：触屏 pan/look/pinch 全部在内核 capture 链（与回放同一实现），
    // 面板只经 initPlayback 继承——不存在 Map-only 缺失的第二套 touch 实现；真机可用性验收归用户。
    expect(kernelSrc).toContain("container.addEventListener('pointerdown', onFlyCaptureDown, true)")
    expect(kernelSrc).toContain("container.addEventListener('pointermove', onFlyCaptureMove, true)")
    expect(kernelSrc).toContain("container.addEventListener('pointerup', onFlyCaptureUp, true)")
  })
})
