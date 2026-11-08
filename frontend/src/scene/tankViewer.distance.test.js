// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { URL as NodeURL } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

// 执行场景内真实 setter，不复制实现；只提供其闭包依赖，保留真实 OrbitControls 数学和输入处理。
const source = readFileSync(new NodeURL('./tankViewer.js', import.meta.url), 'utf8')
const setterSource = source.slice(source.indexOf('        function setDistance(value)'), source.indexOf('        function setCameraPreset(kind)'))
function bindSetter(camera, controls) {
  return new Function('THREE', 'camera', 'controls', 'reportDistance', `
    const destroyed = false, contextLost = false, tankModel = {}, armorModel = {};
    const QP = new URLSearchParams(), worldMetersPerUnit = 1, worldOverviewMode = false;
    // #820 拆分后：模型引用与场景米制 owner = viewer/modelLifecycle.ts（ml handle）
    const ml = { getWorldMetersPerUnit: () => worldMetersPerUnit, models: { tankModel, armorModel } };
    const applyLongRangeCompensation = () => {};
    ${setterSource}
    return setDistance;
  `)(THREE, camera, controls, vi.fn())
}

describe('装甲距离调节保留惯性中的观察姿态', () => {
  it.each(['rotate', 'pan', 'stationary'])('%s：只改变距离，后续帧也不继续漂移', mode => {
    const canvas = document.createElement('canvas')
    Object.defineProperties(canvas, { clientWidth: { value: 800 }, clientHeight: { value: 600 } })
    canvas.setPointerCapture = () => {}
    canvas.releasePointerCapture = () => {}
    document.body.append(canvas)
    const camera = new THREE.PerspectiveCamera(50, 800 / 600, 0.1, 1000)
    camera.position.set(0, 0, 15)
    const controls = new OrbitControls(camera, canvas)
    controls.enableDamping = true
    controls.minDistance = 3
    controls.maxDistance = 500
    const setter = bindSetter(camera, controls)
    const pointer = (target, type, x) => target.dispatchEvent(new PointerEvent(type, {
      pointerId: 1, pointerType: 'mouse', button: 0, clientX: x, clientY: 300,
      shiftKey: mode === 'pan', bubbles: true,
    }))
    try {
      if (mode !== 'stationary') {
        pointer(canvas, 'pointerdown', 300)
        for (let step = 1; step <= 10; step++) {
          pointer(document, 'pointermove', 300 + 14.3 * step)
          controls.update()
        }
        pointer(document, 'pointerup', 443)
        for (let frame = 0; frame < 12; frame++) controls.update()
        // 先证明真实输入留下未消退惯性，防止测试在静止空跑。
        const position = camera.position.clone(), target = controls.target.clone()
        controls.update()
        expect(mode === 'pan' ? controls.target.distanceTo(target) : camera.position.distanceTo(position)).toBeGreaterThan(1e-4)
      }
      const target = controls.target.clone()
      const direction = camera.position.clone().sub(target).normalize()
      expect(setter(300)).toBe(true)
      expect(controls.enableDamping).toBe(true)
      for (let frame = 0; frame < 30; frame++) {
        expect(controls.target.distanceTo(target)).toBeLessThan(1e-9)
        expect(camera.position.distanceTo(target)).toBeCloseTo(300, 8)
        expect(camera.position.clone().sub(target).normalize().distanceTo(direction)).toBeLessThan(1e-9)
        controls.update()
      }
    } finally {
      controls.dispose()
      canvas.remove()
    }
  })
})
