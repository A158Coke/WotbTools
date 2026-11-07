// 车模轮廓投影阴影（平面投影，不是 Shadow Map）：把坦克每个网格沿太阳传播方向压到车底的
// 局部地表平面上，用一份共享的近黑半透明材质画一次。几何与车模共享（悬挂形变自动跟随），
// 矩阵在 onBeforeRender 时按「投影 × 部件 matrixWorld」现算（炮塔 / 炮管转动自动跟随）。
// 模板缓冲保证同一像素只变暗一次（车体 / 炮塔 / 履带的投影大量重叠），故只在渲染器带
// stencil 时由 tankContactShadows 创建；生命周期（创建 / 隐藏 / 释放）同样由其持有。
import * as THREE from 'three'
import type { Material, Object3D, Scene } from 'three'

interface Vec3Like { x: number, y: number, z: number }

/** 光线必须至少以这个余弦「射向」接收面（n·light ≤ −MIN_INCIDENCE）；否则改为沿法线投影 */
const MIN_INCIDENCE = 0.05

/**
 * 方向光平面投影矩阵：点 p 沿 light（传播方向，单位向量）落到平面 n·x + d = 0。
 * p' = p − light · (n·p + d) / (n·light)。normal 须为单位向量（朝上）。
 * 只接受射向平面的入射：贴面入射会无限延伸，背光坡（n·light > 0）会沿光线**反方向**求交，
 * 把影子拉到迎光侧的上坡（复审反例：29° 背光坡 + 21° 太阳，影子落到太阳一侧 11.5 m 外）。
 */
export function planarShadowMatrix(normal: Vec3Like, d: number, light: Vec3Like, out: THREE.Matrix4): THREE.Matrix4 {
  let lx = light.x, ly = light.y, lz = light.z
  let k = normal.x * lx + normal.y * ly + normal.z * lz
  if (!(k <= -MIN_INCIDENCE)) { lx = -normal.x; ly = -normal.y; lz = -normal.z; k = -1 }
  const nx = normal.x / k, ny = normal.y / k, nz = normal.z / k
  return out.set(
    1 - lx * nx, -lx * ny, -lx * nz, -lx * d / k,
    -ly * nx, 1 - ly * ny, -ly * nz, -ly * d / k,
    -lz * nx, -lz * ny, 1 - lz * nz, -lz * d / k,
    0, 0, 0, 1,
  )
}

/** 共享材质：同一像素只变暗一次（NotEqual 1 → Replace 1），深度只测不写，双面（压扁后绕序会翻） */
export function makeSilhouetteMaterial(color: number, opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, toneMapped: false,
    depthTest: true, depthWrite: false, side: THREE.DoubleSide,
    stencilWrite: true, stencilRef: 1, stencilFunc: THREE.NotEqualStencilFunc,
    stencilFail: THREE.KeepStencilOp, stencilZFail: THREE.KeepStencilOp, stencilZPass: THREE.ReplaceStencilOp,
  })
}

export interface SilhouetteShadow {
  /** 当前投影（每次位姿 / 地面 / 太阳变化后写入；渲染时与部件 matrixWorld 相乘） */
  readonly projection: THREE.Matrix4
  /** visible=false 隐藏全部；否则按部件在车模内的显隐逐个同步（炮塔变体等） */
  setVisible(visible: boolean): void
  /** 当前可见的影子网格数（诊断 / 测试） */
  count(): number
  dispose(): void
}

/** root 之下（不含 root 自身）整条祖先链都可见 */
function visibleWithin(node: Object3D, root: Object3D): boolean {
  for (let n: Object3D | null = node; n && n !== root; n = n.parent) if (!n.visible) return false
  return true
}

/**
 * 为一台车模建轮廓影子。只引用车模几何（不 clone、不 dispose），影子网格自身由本对象移除。
 */
export function createSilhouetteShadow(scene: Scene, root: Object3D, material: Material): SilhouetteShadow {
  const projection = new THREE.Matrix4()
  const pairs: { part: THREE.Mesh, shadow: THREE.Mesh }[] = []
  root.traverse((node) => {
    const part = node as THREE.Mesh
    if (!part.isMesh || !part.geometry) return
    const shadow = new THREE.Mesh(part.geometry, material)
    shadow.name = 'tankSilhouetteShadow'
    shadow.matrixAutoUpdate = false
    shadow.matrixWorldAutoUpdate = false
    shadow.frustumCulled = false        // 包围体在投影前，剔除判据无意义
    shadow.visible = false
    // three 在 onBeforeRender 之后才算 modelViewMatrix：此处写入的 matrixWorld 生效
    shadow.onBeforeRender = () => { shadow.matrixWorld.multiplyMatrices(projection, part.matrixWorld) }
    scene.add(shadow)
    pairs.push({ part, shadow })
  })
  return {
    projection,
    setVisible(visible) {
      for (const { part, shadow } of pairs) shadow.visible = visible && visibleWithin(part, root)
    },
    count() {
      let n = 0
      for (const { shadow } of pairs) if (shadow.visible) n++
      return n
    },
    dispose() {
      for (const { shadow } of pairs) scene.remove(shadow)
      pairs.length = 0
    },
  }
}
