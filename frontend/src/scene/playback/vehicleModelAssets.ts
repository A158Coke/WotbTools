import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { neutralizeDefaultMetalness, dropDuplicateGunMasks } from '../glbRig.js'
import { assetProvider } from '../assetProvider.js'
import type { GlbStaticData } from './glbParts.js'
import type { GlbCacheEntry, SuspensionJson, VehicleRuntimeDeps } from './vehicleRuntimeTypes.js'

export function createVehicleModelAssets(deps: VehicleRuntimeDeps) {
  let glbCache = new Map<number, Promise<GlbCacheEntry | null>>()
  // ---------- GLB 真实车模 ----------
  // 姿态处理与装甲查看器 world 模式（poseFromYPR / poseShooterTurretGun）同构：
  // - GLB 内部系 x右/y前/z上（models.pb 原点已按 (x,z,y) 校正到该系）；根位姿 = qYaw·qPitch·qRoll·qFrame，
  //   qFrame = Ry(π)·Rx(−π/2) 的 z-up→y-up 帧变换；yaw 传镜像值（−游戏 yaw），pitch 原值，roll 滤波层恒 0；
  // - 炮塔/炮管 = 烘焙矩阵绕枢轴旋转：炮塔 Rz(−rel)（镜像系）@ tP=track+turret，炮管 Rx(俯仰)@ gP=tP+gun_origin；
  // - 部件数据（model_origins / configs[].gun_origin / initial_turret_rotation）来自资产平面 tank/{id}.json
  //  （WotBTools client-only：dump-tank-data 物化，与上游 /api/tank/{id} 同一形状）。

  async function loadGlb(tankId: number): Promise<GlbCacheEntry | null> {
    // 捕获当前会话的缓存实例：会话结束后迟到的完成写入旧 Map（已脱离新会话），
    // 不污染新会话缓存；teardown 时在册的 Promise 已被挂 then(dispose)——迟到
    // 模板到达即销毁，teardown 后才创建的残余随旧 Map GC
    const cache = glbCache;
    if (cache.has(tankId)) return cache.get(tankId)!;
    const p = (async (): Promise<GlbCacheEntry | null> => {
      try {
        const [glbBytes, sd, susp] = await Promise.all([
          assetProvider.bytes(`/glb/${tankId}/model.glb`),
          assetProvider.json<GlbStaticData | null>(`/tank/${tankId}.json`).catch(() => null),
          // 逐车悬挂数据（additive：tools/export_tank_suspension.py 产物；缺失/404 → null，
          // 整车回落刚体——与"该车客户端无悬挂数据"同路）
          assetProvider.json<SuspensionJson | null>(`/suspension/${tankId}.json`).catch(() => null),
        ]);
        // GLTFLoader.parse：bytes 经 provider（storage/network 与场景解耦），
        // GLB 自包含无外部资源，resourcePath 无关紧要
        const model = await new Promise<THREE.Object3D | null>((res) =>
          new GLTFLoader().parse(glbBytes.buffer as ArrayBuffer, '', (g) => res(g.scene), () => res(null)));
        if (!model) {
          console.warn('[playback] 坦克 GLB 解析返回空 tank_id=' + tankId)
          return null
        }
        model.scale.setScalar(1);
        // 老式车（无 metallicRoughness 贴图）金属度归零——否则无环境贴图下发黑；
        // 在模板上做一次，逐车 clone 共享材质即随带（见 glbRig.js）
        neutralizeDefaultMetalness(model);
        // 同名几何副本去重：Maus 的根级 mask_01 与 gun_01_mask 是同一块炮盾（实测唯一一台），
        // rig 不摆位 mask_NN → 炮塔转走后它会留在原地（见 glbRig.dropDuplicateGunMasks）
        dropDuplicateGunMasks(model);
        // hide_elements 拆件全部渲染（与装甲检视器同规则；位于部件子树内，姿态随父节点自动跟随）
        // 缓存模板 + 部件数据（sd）；每车实例化时 clone 并重收集节点引用
        //（同 tank_id 多车共用一个实例会互相抢对象、位姿互覆盖）
        return { template: model, sd, susp };
      } catch (e) {
        // 静默失败是"切真实车模后没有车"这类报障无从定位的根因（2026-10-09 实测）：
        // 资产 404 / 解析异常 / 模板处理抛错都落在这里，必须留痕（含 tank_id 与原始错误）
        console.warn('[playback] 坦克 GLB 加载失败 tank_id=' + tankId + ':', e)
        return null
      }
    })();
    cache.set(tankId, p);
    // 负结果不入缓存：失败（404/解析失败）只影响本次，资产补位后下次切换即可重试——
    // 缓存 null 会毒化整个会话（transient 缺资产被永久记住）
    p.then((entry) => { if (!entry) cache.delete(tankId); }).catch(() => cache.delete(tankId));
    return p;
  }

  function disposeCache() {
    for (const p of glbCache.values()) {
      p.then((entry) => { if (entry && entry.template) deps.disposeObject3D(entry.template) }).catch(() => {})
    }
    glbCache = new Map()
  }
  return { loadGlb, disposeCache }
}
