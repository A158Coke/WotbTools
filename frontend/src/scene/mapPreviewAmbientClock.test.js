import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { playbackSceneSource } from './__tests__/sceneSource.ts'

const here = dirname(fileURLToPath(import.meta.url))
const src = playbackSceneSource().replace(/\r\n/g, '\n')
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
