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
    // 替身按 #914 拆分后的 owner 命名：模型归 modelLifecycle（ml.models），炮塔/炮管归 turretRig（rig），
    // 装备状态归 equipmentState（eqs），轨迹卡归 trajectoryCard（tc）。
    const destroyed = false, contextLost = false, ARMOR_REF_DIST = 15;
    const ml = { models: { armorModel: {}, tankModel: { matrixWorld: new THREE.Matrix4() } } };
    const QP = new URLSearchParams();
    let currentTurretDeg = 0, currentGunDeg = 0;
    const rig = {
      gunPoseMatrix: new THREE.Matrix4(),
      getArmorPivotGun: () => new THREE.Vector3(0, 0, 2),
      updateTurretGun: (turret, gun) => { currentTurretDeg = turret; currentGunDeg = gun; },
    };
    const pitchAtBearing = () => ({ down: -20, up: 20 });
    const eqs = { effectivePitchDevice: () => false, getPitchDeviceBonusValue: () => 0 };
    const currentConfig = () => ({ pitch_limits: { down: -20, up: 20 } });
    const tc = { tidyTrajectory: () => {} };
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
  it.each(['hull_down', 'front'])('%s：平移惯性在途时点击，旋转中心与距离都不跳变', kind => {
    const { canvas, camera, controls } = makeScene()
    const preset = bindPreset(camera, controls)
    try {
      pointer(canvas, 'pointerdown', 300)
      for (let step = 1; step <= 10; step++) {
        pointer(document, 'pointermove', 300 + 14.3 * step)
        controls.update()
      }
      pointer(document, 'pointerup', 443)
      // 不再 update：平移惯性仍在途（panOffset 残余），此刻的 target 就是用户看到的旋转中心。
      const targetAtClick = controls.target.clone()
      const distanceAtClick = camera.position.distanceTo(targetAtClick)
      const positionAtClick = camera.position.clone()

      expect(preset.setCameraPreset(kind, { preserveView: true })).toBe(true)

      expect(controls.target.distanceTo(targetAtClick)).toBeLessThan(1e-9)
      expect(camera.position.distanceTo(targetAtClick)).toBeCloseTo(distanceAtClick, 8)
      // 预设确实接管了观察方向（新机位 ≠ 点击前机位）且惯性被清空。
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
