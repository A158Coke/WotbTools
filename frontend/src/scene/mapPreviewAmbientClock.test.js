// 地图预览环境动画冻结守卫（2026-11-17 用户裁示）。
//
// 背景：地图预览与 3D 回放共用 playbackScene.initPlayback + mapWorld。地图会话没有
// 回放传输（T 恒 0），此前用墙钟 AMBIENT_T 驱动草风摆/动画混合层/水面法线滚动。
// 但动画会把反射/贴图里的硬边（白云、地平线）放大成锐利白边——用户裁示地图预览
// **放弃环境动画，固定初始静态**：只在回放会话（!mapMode）按回放时钟 T 写 uTime；
// 地图模式不写，材质保持初值 0。水面材质另在装配期排除出动画材质表。
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(resolve(here, 'playbackScene.js'), 'utf8').replace(/\r\n/g, '\n')
const asmSrc = readFileSync(resolve(here, 'sceneryAssembly.ts'), 'utf8').replace(/\r\n/g, '\n')

describe('地图预览环境动画冻结', () => {
  it('只在回放模式写 uTime；地图模式保持静态', () => {
    expect(src).toMatch(/const mapMode = !!store\.mapReady && !store\.hasData;/)
    expect(src).toMatch(/if \(!mapMode\) \{/)
    expect(src).toMatch(/for \(const mm of animLayerMats\) mm\.uniforms\.uTime\.value = secs;/)
    expect(src).not.toMatch(/AMBIENT_T/)
  })

  it('水面材质不登记进动画材质表（uTime 固定 0）', () => {
    expect(asmSrc).toMatch(/u\.uTime && !\(mm\.userData && mm\.userData\.water\)/)
  })

  it('换图/重载复位回放时钟', () => {
    expect(src).toMatch(/T = 0; battle\.resetShotPtr\(\);/)
  })
})
