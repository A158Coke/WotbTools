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

  it('换图判定只看 mapId：locale 化的 mapName 变化不得清空标注（回归锁）', () => {
    // 切语言 → selected.name（locale 派生）→ mapName prop 变化；图身份未变，
    // 标注与撤销栈必须保留（Codex 复审 #4431969638）
    expect(paneSrc).not.toContain('[props.mapId, props.mapName]')
    expect(paneSrc).toMatch(/watch\(\(\) => props\.mapId/)
  })

  it('内核 map 会话：stub DATA + 就绪门控 mapReady（hasData 保持回放专用）', () => {
    expect(kernelSrc).toContain('async function loadMapOnly(')
    expect(kernelSrc).toContain("SESSION_MODE = 'map'")
    expect(kernelSrc).toContain('if (SESSION_MODE === \'map\') {')
    expect(kernelSrc).toContain('store.mapReady = true')
    // 地图会话提前收口必须发生在 buildVehicles 之前（回放尾部不得执行）
    expect(kernelSrc.indexOf('if (SESSION_MODE === \'map\') {'))
      .toBeLessThan(kernelSrc.indexOf('buildVehicles();'))
  })
})
