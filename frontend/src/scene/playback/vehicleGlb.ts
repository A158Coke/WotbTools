// GLB 车模域（模板装载 / 开关装配 / 逐帧姿态 / 飞炮塔分离呈现 / 低模显隐）——自
// vehicleRuntime.ts 出仓（2026-11-21 #LOC 结构拆分：代码与搬移前逐字一致；工厂闭包读数
// 改经 ctx 注入）。GLB 缓存 Map 与车辆清单的 owner 仍在宿主 vehicleRuntime；位姿采样
// 缓存（poseStash）与悬挂逐帧求解（suspensionStep）经 ctx 回调消费。
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { poseFromYPR, yprScene, cloneDetachedTurret, neutralizeDefaultMetalness, dropDuplicateGunMasks } from '../glbRig.js'
import { collectGlbParts } from './glbParts.js'
import type { GlbParts, GlbStaticData } from './glbParts.js'
import { resolveMountedConfig } from '../reloadBar.js'
import type { TankJsonLike } from '../reloadBar.js'
import {
  applyTankDestroyedVisual, destroyedVisualAmount, disposeTankDestroyedVisual, prepareTankDestroyedVisual,
} from '../tankDestroyedVisual.js'
import { sampleDetachedPose } from '../trackInterp.js'
import { collectSuspensionParts } from './vehicleSuspension.js'
import { measureShadowFootprint } from './tankContactShadows.js'
import { ASSET_CONCURRENCY, mapLimit } from './util.js'
import { assetProvider } from '../assetProvider.js'
import type {
  DetachedTurret, GlbCacheEntry, RuntimeVehicle, SuspensionJson, VehicleRuntimeDeps,
} from './vehicleRuntimeTypes.js'

/** GLB 域消费的宿主闭包（getter 快照；语义见 vehicleRuntime.ts 原注释）。 */
export interface VehicleGlbCtx {
  deps: VehicleRuntimeDeps
  /** 车辆清单（owner = 宿主 vehicleRuntime）。 */
  V(): RuntimeVehicle[]
  /** GLB 模板缓存（owner = 宿主 vehicleRuntime；按会话整体替换）。 */
  glbCache: Map<number, Promise<GlbCacheEntry | null>>
  /** 位姿采样（owner = 宿主 poseStash 缓存）。 */
  yawAt(v: RuntimeVehicle, t: number): number
  hullPitchAt(v: RuntimeVehicle, t: number): number
  rollAt(v: RuntimeVehicle, t: number): number
  turretAbsAt(v: RuntimeVehicle, t: number): number
  gunPitchAt(v: RuntimeVehicle, t: number): number
  /** 悬挂逐帧求解（owner = 宿主；poseGlb 消费）。 */
  suspensionStep(v: RuntimeVehicle): void
  /** applyPose（owner = 宿主；applyGlbToggle 迟挂载帧消费）。 */
  applyPose(v: RuntimeVehicle): void
  /** 角度归一（宿主共享工具）。 */
  wrapPi(a: number): number
}

export interface VehicleGlbHandle {
  loadGlb(tankId: number): Promise<GlbCacheEntry | null>
  poseGlb(v: RuntimeVehicle): void
  poseGlbRig(v: RuntimeVehicle, t: number, pos: THREE.Vector3): void
  glbGunWorld(v: RuntimeVehicle, pos: THREE.Vector3, dir: THREE.Vector3): boolean
  applyGlbToggle(on: boolean): Promise<void>
  glbOn(): boolean
  setLowPoly(v: RuntimeVehicle, show: boolean): void
  applyDetachedTurrets(v: RuntimeVehicle): void
}

export function createVehicleGlb(ctx: VehicleGlbCtx): VehicleGlbHandle {
  const { deps } = ctx
  let glbOn = false;
  const glbCache = ctx.glbCache;
  const V = ctx.V();
  const yawAt = ctx.yawAt;
  const hullPitchAt = ctx.hullPitchAt;
  const rollAt = ctx.rollAt;
  const turretAbsAt = ctx.turretAbsAt;
  const gunPitchAt = ctx.gunPitchAt;
  const suspensionStep = ctx.suspensionStep;
  const applyPose = ctx.applyPose;
  const wrapPi = ctx.wrapPi;
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
          new GLTFLoader().parse(glbBytes.buffer as ArrayBuffer, '', (g: { scene: THREE.Object3D }) => res(g.scene), () => res(null)));
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


  const _glbQuat = new THREE.Quaternion();
  const _glbEuler = new THREE.Euler();
  const _mRot = new THREE.Matrix4(), _mTmpA = new THREE.Matrix4(), _mTmpB = new THREE.Matrix4();
  const _mTmpC = new THREE.Matrix4(), _mTmpD = new THREE.Matrix4(), _mT = new THREE.Matrix4();
  const _mG = new THREE.Matrix4(), _mAcc = new THREE.Matrix4();

  // GLB 根位姿 = poseFromYPR(−yaw, pitch, roll)（共享 rig，见 scene/glbRig.js）——
  // **车体位姿照回放记录摆**（客户端同构：车体收记录的 yaw/pitch/roll + y）。
  // ⚠️ 2026-10-10：曾试过"根吃地形局部平面 + 车体吃限幅残差"的近似，观感被判"怪"且与客户端
  // 结构相反（客户端：车体 = 记录位姿；轮/带由 `Suspension*System` 按模型几何解算——逆向证据见
  // 上游 docs/tank-suspension-client-re.md），已整段回退。`__hullGroup` 保留但**恒归单位**：
  // 它是下一步"逐轮贴地 + 履带分段"的挂点，现在不参与摆放。
  function poseGlb(v: RuntimeVehicle) {
    poseGlbRig(v, deps.getT(), v.group.position);
    // 悬挂：轮带宽高/自转/履带形变（客户端同构；v.suspParts 缺失 = 整车刚体）。只读根位姿。
    suspensionStep(v);
  }
  // 根位姿 + 炮塔 / 炮管：t 时刻的纯函数（不碰悬挂积分状态）。开火定位炮口时临时摆到 t_fire
  // 量完再摆回 T（见 flushMuzzles）。
  function poseGlbRig(v: RuntimeVehicle, t: number, pos: THREE.Vector3) {
    if (!v.glb) return;
    v.glb.position.copy(pos);
    v.glb.quaternion.copy(poseFromYPR(-yawAt(v, t), hullPitchAt(v, t), -rollAt(v, t), _glbQuat));
    const p = v.glbParts;
    if (p && p.hullGroup) {
      p.hullGroup.quaternion.identity();
      p.hullGroup.position.set(0, 0, 0);
    }
    if (!p) return;
    const gr = gunPitchAt(v, t);           // glb 系 Rx(θ)：θ>0 = 前向(+Y)抬向 +Z = 仰角
    const mT = glbTurretMatrix(v, p, t);
    const mG = _mG.copy(_mT).multiply(_mTmpB.makeTranslation(p.gP[0], p.gP[1], p.gP[2]))
      .multiply(_mTmpC.makeRotationX(gr))
      .multiply(_mTmpD.makeTranslation(-p.gP[0], -p.gP[1], -p.gP[2]));
    p.poseT.copy(mT);
    p.poseG.copy(mG);
    const tn = p.turretNode;
    if (tn) {
      // 回转炮塔：横转（含 itr 补偿）写炮塔节点；炮管随父链继承横转。
      tn.updateMatrix();
      if (!tn.userData.__bake) { tn.userData.__bake = tn.matrix.clone(); tn.matrixAutoUpdate = false; }
      tn.matrix.copy(_mAcc.copy(mT).multiply(tn.userData.__bake as THREE.Matrix4));
    }
    // 固定战斗室（turretNode=null，歼击车）：炮管组直接吃 mG——mG = mT·Rx(gr)，
    // 已含绕 tP 的横转（itr 补偿在内）与绕 gP 的俯仰，与客户端「TD 炮塔 = 炮管」同构。
    for (const gn of p.gunNodes) {
      gn.updateMatrix();
      if (!gn.userData.__bake) { gn.userData.__bake = gn.matrix.clone(); gn.matrixAutoUpdate = false; }
      gn.matrix.copy(_mAcc.copy(mG).multiply(gn.userData.__bake as THREE.Matrix4));
    }
    // 世界矩阵不在此强制刷新：renderer.render 的 scene.updateMatrixWorld() 从根向下传播足矣。
    // v.glb 根 matrixAutoUpdate=true → updateMatrix 置脏 → force 覆盖 matrixAutoUpdate=false
    // 的炮塔/炮管节点，本行是每车全树一遍纯重复的 compose+multiply（14 车 ×60fps）。
    // tick 与 render 之间唯一的车辆世界矩阵读者是开火定位炮口（flushMuzzles），它自己
    // tick 把射手一台摆到 t_fire、刷新、量完再摆回 T 并刷新；标签投影用位姿，
    // 只打静态场景网格。
  }
  /** 炮塔节点的枢轴旋转矩阵（模型系）：炮塔横转绕 tP，含 itr 补偿。 */
  function glbTurretMatrix(v: RuntimeVehicle, p: GlbParts, t: number) {
    const rel = wrapPi(turretAbsAt(v, t) - yawAt(v, t));
    const tr = -rel;                       // 镜像系节点旋转角 = −rel
    if (p.itr) {
      // Euler 序 'ZYX'：yaw (Z) 最外层 → pitch/roll 补偿在炮塔局部系内执行。
      // 'XYZ' 会把 pitch 放在全局系，炮塔转开 90° 时 pitch 变成侧倾。
      _glbEuler.set(-THREE.MathUtils.degToRad(p.itr.pitch || 0), -THREE.MathUtils.degToRad(p.itr.roll || 0),
                    tr - THREE.MathUtils.degToRad(p.itr.yaw || 0), 'ZYX');
      _mRot.makeRotationFromEuler(_glbEuler);
    } else {
      _mRot.makeRotationZ(tr);
    }
    return _mT.makeTranslation(p.tP[0], p.tP[1], p.tP[2]).multiply(_mRot)
      .multiply(_mTmpA.makeTranslation(-p.tP[0], -p.tP[1], -p.tP[2]));
  }
  /**
   * 本车配置的真实炮位与炮管方向（世界系），与 poseGlbRig 走同一条变换链；低模代理
   * 没有 itr 补偿，不能代表渲染出的炮管。没有 GLB 时返回 false，由调用方退回低模枢轴。
   */
  function glbGunWorld(v: RuntimeVehicle, pos: THREE.Vector3, dir: THREE.Vector3): boolean {
    const p = v.glb ? v.glbParts : null;
    const parent = p && (p.turretNode ?? p.gunNodes[0])?.parent;
    if (!parent) return false;
    parent.updateWorldMatrix(true, false);
    const turret = glbTurretMatrix(v, p, deps.getT());
    const pitch = gunPitchAt(v, deps.getT());        // 模型前向 +Y，绕 X 俯仰，见 poseGlbRig
    dir.set(0, Math.cos(pitch), Math.sin(pitch)).transformDirection(turret).transformDirection(parent.matrixWorld);
    pos.set(p!.gP[0], p!.gP[1], p!.gP[2]).applyMatrix4(turret).applyMatrix4(parent.matrixWorld);
    return true;
  }
  async function applyGlbToggle(on: boolean) {
    const gen = deps.sessionGen();
    glbOn = on;
    deps.store.glbOn = on;
    const scene = deps.getScene();
    if (on) {
      if (!scene) return;
      // 有限并发加载（上限 4）：单个大模型慢解析不阻塞其余车辆，又不会让 14 台车
      // 的主线程 GLTF 解析同时排队。每车 clone 独立实例。
      // generation guard：回放替换后迟到的完成不得挂载到新会话场景
      await mapLimit(V.filter(v => v.def.tank_id > 0), ASSET_CONCURRENCY, async (v) => {
        if (!v.glb) {
          const loaded = await loadGlb(v.def.tank_id);
          if (gen !== deps.sessionGen()) return;   // 迟到：模板留在旧缓存对象里随 GC 回收
          if (loaded && glbOn && !v.glb) {
            const inst = loaded.template.clone();
            inst.scale.setScalar(1);
            // 炮塔/主炮变体（dense 节点索引）按**实际搭载配置**选：facet 的 turret_index/
            // gun_index 只有服务器路径产出；WASM 客户端产物用同一三级证据链
            // （comp locals → 发射弹种 → 初始血量，resolveMountedConfig）联表 tank 数据
            // 派生——多炮坦克各炮 GLB 节点组不同（实测同队两台 B-C 25t 分别 100/105mm），
            // 不钉定会整场显示顶级炮。sd 拉取失败 → 回退 facet 字段 → 顶级。
            const mounted = loaded.sd ? resolveMountedConfig(v.def, loaded.sd as TankJsonLike) : null;
            const parts = collectGlbParts(inst, loaded.sd, mounted
              ? { turret_index: (mounted as { turret_index?: number | null }).turret_index ?? null, gun_index: (mounted as { gun_index?: number | null }).gun_index ?? null }
              : { turret_index: v.def.turret_index ?? null, gun_index: v.def.gun_index ?? null });
            if (!parts) {
              // 部位/枢轴链不全（sd 缺失等）：不受姿的 GLB 会停在世界原点被地形埋住，
              // 看起来就是"没加载出来"——此时保持代理车（失败可见，且与日志对应）
              console.warn('[playback] GLB 部位不全，保留代理车 tank_id=' + v.def.tank_id)
              return
            }
            v.glb = inst;                       // 通过部位检查后才落库（否则会卡在半装载态）
            v.glbParts = parts;
            deps.contactShadows()?.setFootprint(v, measureShadowFootprint(inst));   // 受姿前一次性实测
            deps.contactShadows()?.attachModel(v, inst);   // 轮廓投影（渲染器带 stencil 时）
            v.tankData = loaded.sd;             // Sniper 穿深着色的配置/弹表来源
            // 悬挂部件（轮/带）逐车收集：几何逐车 clone（模板共享），数据缺 → null 回落刚体
            v.suspParts = collectSuspensionParts(inst, loaded.susp, v.def.tank_id);
            v.def.suspReaction = loaded.susp ? loaded.susp.wheels_reaction_speed ?? null : null;
            v.glb.visible = v.group.visible && !deps.classIconsVisible();
            scene.add(v.glb);
            // Clone before shader patching: templates keep shared textures/geometry only.
            // The material module composes the existing tank ambient-light isolation.
            for (const head of v.detachedTurrets) {
              head.glb = cloneDetachedTurret(inst, parts, gunPitchAt(v, head.track.pose_kf.t[0]));
              head.glbVisual = prepareTankDestroyedVisual(head.glb);
              head.root.add(head.glb);
            }
            v.glbVisual = prepareTankDestroyedVisual(v.glb);
            applyPose(v);   // late attach while paused must reflect the current replay time
            deps.invalidate();
          }
        }
        if (v.glb) setLowPoly(v, false);
      });
    } else {
      for (const v of V) {
        if (v.glb) {
          for (const head of v.detachedTurrets) {
            if (head.glb) head.root.remove(head.glb);
            disposeTankDestroyedVisual(head.glbVisual);
            head.glb = null; head.glbVisual = null;
          }
          scene?.remove(v.glb);            // borrowed geometry/textures stay with the template
          disposeTankDestroyedVisual(v.glbVisual);
          v.glbVisual = null;
          // 悬挂求解为逐车 clone 的履带几何（见 collectSuspensionParts 的 disposables）
          // ——清引用前必须释放，否则反复开关 GLB 逐次累积 GPU 缓冲（2026-10-10 review P2）。
          if (v.suspParts && v.suspParts.disposables) {
            for (const g of v.suspParts.disposables) g.dispose();
          }
          v.glb = null; v.glbParts = null; v.suspParts = null;
        }
        setLowPoly(v, true);
        applyDetachedTurrets(v);
      }
    }
  }
  // 低模显隐（标签与作者标记环除外；GLB 根在 scene 上不经过 group）
  function setLowPoly(v: RuntimeVehicle, show: boolean) {
    for (const c of v.group.children) {
      c.visible = c.userData.keepWithGlb ? deps.showMarkerStatus() : show && !deps.classIconsVisible();
    }
    // 车体收在 `__hullGroup` 包装内（悬挂挂点），上面的循环只切到包装层；
    // 而契约按 `meshHull.visible` 读低模显隐（class-icon 用例断言此标志），故同步自身。
    if (v.meshHull) v.meshHull.visible = show && !deps.classIconsVisible();
  }

  const detachedPose: { x: number; y: number; z: number; yaw: number; pitch: number; roll: number } = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0 };
  /**
   * 分离事实是否属于**当前这一世**（issue #622 review P2）：复活模式下车会带着炮塔复活——上一世的
   * 飞头不应让新车继续无炮塔。分离从 detached 轨道首帧起生效，到该车**下一次复活**为止（规则与
   * `defLifeAt` 同一份上游字段，原始时钟域）；复活后的新死亡若再飞头，会有新的 detached 轨道
   * （新首帧）重新接管。飞头实体自身的渲染不受此判据影响（它有自己的 coverage 与位姿轨道）。
   */
  function detachmentAppliesNow(v: RuntimeVehicle, head: DetachedTurret) {
    const T = deps.getT();
    const startRaw = head.track.pose_kf.t[0];
    if (!(T >= startRaw)) return false;
    for (const r of v.def.resurrection_times || []) {
      if (r > startRaw && r <= T + 1e-6) return false;
    }
    return true;
  }
  function applyDetachedTurrets(v: RuntimeVehicle) {
    const T = deps.getT();
    let separated = false;
    for (const head of v.detachedTurrets) {
      const known = T >= head.track.pose_kf.t[0];
      separated ||= known && detachmentAppliesNow(v, head);
      head.root.visible = known && !deps.classIconsVisible() && sampleDetachedPose(head.track, T, detachedPose);
      if (head.root.visible) {
        head.root.position.set(detachedPose.x, detachedPose.y, detachedPose.z);
        yprScene(detachedPose.yaw, detachedPose.pitch, detachedPose.roll, head.root.quaternion);
      }
      head.proxy.visible = !head.glb;
      if (head.glb) head.glb.visible = true;
      // Detachment is itself known destruction evidence for this part, even if
      // canonical vehicle life is still loading. Rewind simply hides the part.
      const amount = destroyedVisualAmount({ lifeState: 'DESTROYED', destroyedKnownAtSec: head.track.pose_kf.t[0] }, T);
      applyTankDestroyedVisual(head.proxyVisual, amount);
      applyTankDestroyedVisual(head.glbVisual, amount);
    }
    v.turretG.visible = !separated;
    if (v.glbParts) {
      // 固定战斗室（turretNode=null，歼击车）没有炮塔节点可摘——脱落时只藏炮管组
      //（TD 的炮架横转就是它的「炮塔」，脱落件一并带走）。
      if (v.glbParts.turretNode) v.glbParts.turretNode.visible = !separated;
      for (const node of v.glbParts.gunNodes) node.visible = !separated;
    }
  }


  return {
    loadGlb,
    poseGlb,
    poseGlbRig,
    glbGunWorld,
    applyGlbToggle,
    glbOn: () => glbOn,
    setLowPoly,
    applyDetachedTurrets,
  }
}
