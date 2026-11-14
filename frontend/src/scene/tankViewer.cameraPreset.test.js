// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { URL as NodeURL } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { armorCameraPreset, armorPresetGunPitch, armorPresetViewPlacement } from './viewer/cameraPresets.js'

// 执行场景内真实 setCameraPreset（不复制实现）；模型/炮管闭包用测试替身，
// 保留真实 OrbitControls 数学、输入处理与 cameraPresets 纯函数。
const source = readFileSync(new NodeURL('./tankViewer.js', import.meta.url), 'utf8')
const presetSource = source.slice(
  source.indexOf('        function setCameraPreset('),
  source.indexOf('        function applyUrlOptionsOnce()'),
)

function bindPreset(camera, controls) {
  return new Function('THREE', 'camera', 'controls', 'armorPresetGunPitch', 'armorCameraPreset', 'armorPresetViewPlacement', `
    const destroyed = false, contextLost = false, ARMOR_REF_DIST = 15;
    const QP = new URLSearchParams();
    // #820 拆分后：模型/世界米制 owner = modelLifecycle.ts（ml），炮塔/炮管 owner = turretRig.ts（rig），
    // 瞄准设备 owner = equipmentState.ts（eqs），轨迹 owner = trajectoryCard.ts（tc）。
    const ml = { models: { tankModel: { matrixWorld: new THREE.Matrix4() }, armorModel: {} } };
    const rig = {
      gunPoseMatrix: new THREE.Matrix4(),
      getArmorPivotGun: () => new THREE.Vector3(0, 0, 2),
      updateTurretGun: (turret, gun) => { currentTurretDeg = turret; currentGunDeg = gun; },
    };
    const eqs = { effectivePitchDevice: () => false, getPitchDeviceBonusValue: () => 0 };
    const tc = { tidyTrajectory: () => {} };
    let currentTurretDeg = 0, currentGunDeg = 0;
    const pitchAtBearing = () => ({ down: -20, up: 20 });
    const currentConfig = () => ({ pitch_limits: { down: -20, up: 20 } });
    ${presetSource}
    return { setCameraPreset, pose: () => ({ turretDeg: currentTurretDeg, gunDeg: currentGunDeg }) };
  `)(THREE, camera, controls, armorPresetGunPitch, armorCameraPreset, armorPresetViewPlacement)
}

function makeScene() {
  const canvas = document.createElement('canvas')
  Object.defineProperties(canvas, { clientWidth: { value: 800 }, clientHeight: { value: 600 } })
  canvas.setPointerCapture = () => {}
  canvas.releasePointerCapture = () => {}
  document.body.append(canvas)
  // setCameraPreset 会写 #turret-val / #gun-val 读数。
  document.body.insertAdjacentHTML('beforeend', '<span id="turret-val"></span><span id="gun-val"></span>')
  const camera = new THREE.PerspectiveCamera(50, 800 / 600, 0.1, 1000)
  camera.position.set(0, 0, 15)
  const controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true
  controls.minDistance = 3
  controls.maxDistance = 500
  return { canvas, camera, controls }
}

const pointer = (target, type, x) => target.dispatchEvent(new PointerEvent(type, {
  pointerId: 1, pointerType: 'mouse', button: 0, clientX: x, clientY: 300,
  shiftKey: true, bubbles: true,
}))

describe('装甲相机预设保留用户取景（preserveView）', () => {
  it.each(['hull_down', 'front'])('%s：平移惯性在途时点击，旋转中心保持不变、只换观察方向，距离不跳变', kind => {
    const { canvas, camera, controls } = makeScene()
    const preset = bindPreset(camera, controls)
    try {
      pointer(canvas, 'pointerdown', 300)
      for (let step = 1; step <= 10; step++) {
        pointer(document, 'pointermove', 300 + 14.3 * step)
        controls.update()
      }
      pointer(document, 'pointerup', 443)
      // 不再 update：平移惯性仍在途（panOffset 残余）。取景快照在清惯性之前完成，
      // 因此旋转中心 = 点击前的默认轨道中心（stub 初始 (0,0,0)），不被预设移动。
      const distanceAtClick = camera.position.distanceTo(controls.target)
      const positionAtClick = camera.position.clone()
      const targetAtClick = controls.target.clone()
      // stub 炮线方向 = (0,1,0)（matrixWorld=identity）。

      expect(preset.setCameraPreset(kind, { preserveView: true })).toBe(true)

      // 约束 1：旋转中心不动（快照在清惯性之前，placement 用的是同一份快照）。
      expect(controls.target.distanceTo(targetAtClick)).toBeLessThan(1e-9)
      // 约束 2：机位在炮轴线上（stub 轴线 = x=0、z=2 的竖线）→ 炮管正对镜头。
      expect(camera.position.x).toBeCloseTo(0, 6)
      expect(camera.position.z).toBeCloseTo(2, 6)
      // 距离按中心量（缩放层级保留），且机位在枢轴上方（沿炮线方向的前方）。
      expect(camera.position.distanceTo(controls.target)).toBeCloseTo(distanceAtClick, 6)
      expect(camera.position.y).toBeGreaterThan(2)
      // 预设确实接管了机位（新机位 ≠ 点击前机位）且惯性被清空。
      expect(camera.position.distanceTo(positionAtClick)).toBeGreaterThan(0.01)
      for (let frame = 0; frame < 30; frame++) {
        controls.update()
        expect(controls.target.distanceTo(targetAtClick)).toBeLessThan(1e-9)
      }
    } finally {
      canvas.remove()
      document.getElementById('turret-val')?.remove()
      document.getElementById('gun-val')?.remove()
      controls.dispose()
    }
  })

  it.each(['hull_down', 'front'])('%s：炮管姿态切换为预设俯角', kind => {
    const { canvas, camera, controls } = makeScene()
    const preset = bindPreset(camera, controls)
    try {
      expect(preset.setCameraPreset(kind, { preserveView: true })).toBe(true)
      expect(preset.pose()).toEqual({ turretDeg: 0, gunDeg: kind === 'hull_down' ? -20 : 0 })
    } finally {
      canvas.remove()
      document.getElementById('turret-val')?.remove()
      document.getElementById('gun-val')?.remove()
      controls.dispose()
    }
  })

  it.each(['hull_down', 'front'])('%s：真实 OrbitControls 不可达场景（中心远离炮轴）：中心不动、机位仍在轴上', kind => {
    const { canvas, camera, controls } = makeScene()
    const preset = bindPreset(camera, controls)
    try {
      // 用户平移到远离炮轴的位置（垂距 50m > maxDistance 内的用户距离 15m）：
      // 站位策略取安全站位（枢轴 + 炮线方向 × 15m），中心保持不动。
      controls.target.set(50, 0, 0)
      camera.position.set(50, 0, 15)
      controls.update()
      const distanceAtClick = camera.position.distanceTo(controls.target)
      const targetAtClick = controls.target.clone()

      expect(preset.setCameraPreset(kind, { preserveView: true })).toBe(true)

      expect(controls.target.distanceTo(targetAtClick)).toBeLessThan(1e-9)
      // stub 炮轴 = x=0、z=2 的竖线：机位在轴上且在枢轴前方。
      expect(camera.position.x).toBeCloseTo(0, 6)
      expect(camera.position.z).toBeCloseTo(2, 6)
      expect(camera.position.y).toBeGreaterThan(2)
      // 不可达时距离让位于指向：由站位策略给出（≥ 安全站位 15m，≤ maxDistance）。
      const d = camera.position.distanceTo(controls.target)
      expect(d).toBeGreaterThanOrEqual(15)
      expect(d).toBeLessThanOrEqual(500)
      void distanceAtClick
    } finally {
      canvas.remove()
      document.getElementById('turret-val')?.remove()
      document.getElementById('gun-val')?.remove()
      controls.dispose()
    }
  })

  it('无 preserveView（URL 首载）保持完整预设摆位：target = 炮线枢轴、距离 = 15m', () => {
    const { canvas, camera, controls } = makeScene()
    const preset = bindPreset(camera, controls)
    try {
      expect(preset.setCameraPreset('front')).toBe(true)
      // stub 无根旋转（matrixWorld=identity）：世界炮线枢轴 = (0,0,2)。
      expect(controls.target.toArray()).toEqual([0, 0, 2])
      expect(camera.position.distanceTo(controls.target)).toBeCloseTo(15, 8)
    } finally {
      canvas.remove()
      document.getElementById('turret-val')?.remove()
      document.getElementById('gun-val')?.remove()
      controls.dispose()
    }
  })
})
