// 车辆运行时 owner（#820 结构拆分，2026-11-05 自 initPlayback 闭包出仓）：
// 低模车体装配（buildVehicles）、位姿采样缓存（poseStash / posAt / yawAt / …）、
// GLB 真实车模装载与开关（loadGlb / applyGlbToggle）、悬挂求解（collectSuspensionParts /
// suspensionStep）、GLB 逐帧姿态（poseGlb / poseGlbRig / glbTurretMatrix / glbGunWorld）、
// 飞炮塔分离呈现（detachmentAppliesNow / applyDetachedTurrets）、击毁着色应用（applyPose）
// 与车辆会话 teardown（dispose：车辆循环 + GLB 模板缓存释放）的唯一归属。
// 代码与搬移前逐字一致；闭包读数改经 deps 注入（getter 快照）。canonical 生命事实
//（sceneLifeAt / visibleAt / hpAt）仍归宿主，本模块经 deps 消费；履带印逐车装配块
//（原 buildVehicles 的 tread 段）经 deps.treadAttachVehicle 委托给 treadRuntime，
// buildVehicles 保持 tread-free。
import * as THREE from 'three'
import {
  yprScene, cloneDetachedTurret,
} from '../glbRig.js'
import { collectGlbParts } from './glbParts.js'
import { resolveMountedConfig } from '../reloadBar.js'
import type { TankJsonLike } from '../reloadBar.js'
import {
  applyTankDestroyedVisual, destroyedVisualAmount, disposeTankDestroyedVisual, prepareTankDestroyedVisual,
} from '../tankDestroyedVisual.js'
import { sampleDetachedPose } from '../trackInterp.js'
import { sampleVehiclePoseGame } from '../../replay-local/pose/vehiclePose.js'
import { lastKnownPoseAt, replacedBySuccessorAt } from './lastKnown.js'
import type { VehiclePoseGame } from '../../replay-local/pose/vehiclePose.js'
import { measureShadowFootprint } from './tankContactShadows.js'
import { ASSET_CONCURRENCY, mapLimit } from './util.js'
import { createTrailState } from '../treadMarks.js'
import { createVehicleModelAssets } from './vehicleModelAssets.js'
import { createVehicleModelPose } from './vehicleModelPose.js'
import type {
  DetachedTurret, RuntimeVehicle,
  VehicleRuntimeDeps, VehicleRuntimeHandle,
} from './vehicleRuntimeTypes.js'
export type {
  DetachedTurret, DetachedTurretTrack, GlbCacheEntry, RuntimeVehicle, RuntimeVehicleDef,
  SuspensionJson, SuspensionParts, SuspensionSide, SuspensionTrackPart, SuspensionWheelPart,
  TickPose, TreadRuntimeParams, VehicleRuntimeData, VehicleRuntimeDeps, VehicleRuntimeHandle,
} from './vehicleRuntimeTypes.js'

/** 资产平面 suspension/{tank_id}.json 的消费面（缺失/404 → null，整车回落刚体）。 */
const LAST_KNOWN_PROXY_Y = 0.42

export function createVehicleRuntime(deps: VehicleRuntimeDeps): VehicleRuntimeHandle {
  let V: RuntimeVehicle[] = [];      // 车辆运行时 {def, group, turretG, gunPivot, labelAnchor, meshHull, glb}
  let glbOn = false;
  const wrapPi = (a: number) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

  // 位姿求值：**唯一实现**在 `replay-local/pose/vehiclePose.ts`（2D 俯视与 3D 场景共用）——
  // 含 `pose_kf` 关键帧优先 / 10Hz 网格回退、以及炮塔绝对角 → 相对角的换算。
  // 本处只施加「场景系 = 游戏系 x 取负」的帧变换（符号约定见 glbRig.js 头注释）；
  // 车体侧倾 hull_roll 取自原始 type=10 volatile（滤波层不输出侧倾），旧产物缺列 → 0。
  const poseOf = (v: RuntimeVehicle, t: number) => sampleVehiclePoseGame(
    v.def, deps.poseGrid, t, _poseOut, deps.visByEid().get(v.def.eid) ?? v.def.coverage,
  );
  // 位姿采样复用对象（每帧多车高频调用，零分配）
  const _poseOut: VehiclePoseGame = {
    x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, turretAbs: 0, turretRel: 0, gunPitch: 0,
  };
  // 每车「最近一次采样」缓存：applyPose 一帧内经 yawAt/hullPitchAt/rollAt/turretAbsAt/
  // gunPitchAt/posAt 对同一 (v, T) 触发 13 次全通道采样（网格插值 + 闭包分配 ×13 ≈ 纯
  // 重复）。采样是纯函数（grid/def/VIS_BY_EID 均只在数据/会话边界重建，tick 内不变），
  // 按 (车, t) 记忆后一帧只采一次；flushMuzzles 等以任意 t 摆位姿的调用点自动因 t 不匹配
  // 重采样，语义不变。
  function poseStash(v: RuntimeVehicle, t: number) {
    const s = v.tickPose || (v.tickPose = { t: NaN, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, turretAbs: 0, gunPitch: 0 });
    if (s.t !== t) {
      const p = poseOf(v, t);
      s.t = t;
      s.x = p.x; s.y = p.y; s.z = p.z;
      s.yaw = p.yaw; s.pitch = p.pitch; s.roll = p.roll;
      s.turretAbs = p.turretAbs; s.gunPitch = p.gunPitch;
    }
    return s;
  }
  function posAt(v: RuntimeVehicle, t: number, out: THREE.Vector3) {
    const p = poseStash(v, t);
    out.set(-p.x, p.y, p.z);
    return out;
  }
  function yawAt(v: RuntimeVehicle, t: number) { return poseStash(v, t).yaw; }
  function hullPitchAt(v: RuntimeVehicle, t: number) { return poseStash(v, t).pitch; }
  function turretAbsAt(v: RuntimeVehicle, t: number) { return poseStash(v, t).turretAbs; }
  function gunPitchAt(v: RuntimeVehicle, t: number) { return poseStash(v, t).gunPitch; }
  const rollAt = (v: RuntimeVehicle, t: number) => poseStash(v, t).roll;

  function buildVehicles() {
    const data = deps.getData();
    if (!data) return;
    const scene = deps.getScene();
    if (!scene) return;
    // 低模车体：俯视六边形轮廓（平尾 + 尖首）挤压成棱柱，配合尾部散热格栅——
    // 炮管之外的第二重车头方向提示（GLB 关闭时的代理模型）
    const hullProfile = new THREE.Shape();
    hullProfile.moveTo(-1.6, -3.1);   // 左后
    hullProfile.lineTo(1.6, -3.1);    // 右后（尾部平直）
    hullProfile.lineTo(1.6, 1.15);    // 右舷
    hullProfile.lineTo(0, 3.1);       // 车首尖点（+z = 车头，与炮管同向）
    hullProfile.lineTo(-1.6, 1.15);   // 左舷
    hullProfile.closePath();
    const hullGeo = new THREE.ExtrudeGeometry(hullProfile, { depth: 1.05, bevelEnabled: false });
    hullGeo.rotateX(Math.PI / 2);     // 轮廓 y（车首方向）→ 世界 +z，挤出方向翻向 −y
    hullGeo.translate(0, 1.45, 0);    // 车体占 y ∈ [0.40, 1.45]（顶面接炮塔底）
    const trackGeo = new THREE.BoxGeometry(3.6, 0.75, 6.5);
    const turretGeo = new THREE.BoxGeometry(2.35, 0.85, 3.3);
    const gunGeo = new THREE.CylinderGeometry(0.14, 0.18, 5.4, 8);
    const grilleGeo = new THREE.BoxGeometry(2.0, 0.4, 0.5);
    for (const def of data.vehicles) {
      const color = deps.teamColor({ def });
      const g = new THREE.Group(); g.userData.eid = def.eid;
      const hull = new THREE.Mesh(hullGeo, new THREE.MeshLambertMaterial({ color }));
      const tracks = new THREE.Mesh(trackGeo, new THREE.MeshLambertMaterial({ color: 0x333a44 })); tracks.position.y = 0.42;
      const grille = new THREE.Mesh(grilleGeo, new THREE.MeshLambertMaterial({ color: 0x272e38 })); grille.position.set(0, 1.62, -2.8);
      const turretG = new THREE.Group(); turretG.position.y = 1.85;
      const turret = new THREE.Mesh(turretGeo, new THREE.MeshLambertMaterial({ color: new THREE.Color(color).multiplyScalar(1.15) }));
      turret.position.z = -0.25;
      const gunPivot = new THREE.Group(); gunPivot.position.set(0, 0.05, 1.5);
      const gun = new THREE.Mesh(gunGeo, new THREE.MeshLambertMaterial({ color: 0x59636f }));
      gun.rotation.x = Math.PI / 2; gun.position.z = 2.4;
      gunPivot.add(gun); turretG.add(turret); turretG.add(gunPivot);
      // 低模侧同构：履带盒留组根、hull/grille/turretG 收进 __hullGroup（悬挂挂点，恒单位）
      const hullG = new THREE.Group(); hullG.name = '__hullGroup';
      hullG.add(hull); hullG.add(grille); hullG.add(turretG);
      g.add(tracks); g.add(hullG);
      if (def.is_author) {
        const ring = new THREE.Mesh(new THREE.RingGeometry(3.6, 4.3, 32),
          new THREE.MeshBasicMaterial({ color: 0xe8b23c, side: THREE.DoubleSide, transparent: true,
                                        opacity: .85, toneMapped: false }));
        ring.rotation.x = -Math.PI / 2; ring.position.y = 0.06;
        ring.userData.keepWithGlb = true;   // GLB 模式下保留作者标记环
        g.add(ring);
      }
      // 最后已知位置代理（可视性诚实呈现，语义见 playback/lastKnown.ts）：该车不在场时段
      // 在末段末采样位姿上的半透明低模盒（store.lastKnownOn 可关）。几何复用低模履带盒
      // （trackGeo 共享），材质逐车独立（阵营色 + 半透明），teardown 随 dispose 释放。
      const lastKnownProxy = new THREE.Mesh(trackGeo, new THREE.MeshLambertMaterial({
        color, transparent: true, opacity: 0.35, depthWrite: false,
      }));
      lastKnownProxy.visible = false;
      scene.add(lastKnownProxy);
      const v: RuntimeVehicle = { def, group: g, turretG, gunPivot, meshHull: hull, hullGroup: hullG,
        detachedTurrets: [], proxyVisual: null, glbVisual: null,
        labelAnchor: new THREE.Vector3(), lastKnownPose: null, lastKnownAt: NaN, lastReplaced: false, lastKnownProxy,
        trail: null, tread: null, treadMesh: null };
      // Capture clean proxy materials before the vehicle receives its wreck shader.
      v.detachedTurrets = (data.detached_turrets || []).filter(track => track.vehicle_eid === def.eid).map(track => {
        const root = new THREE.Group(); root.userData.eid = def.eid;
        const proxy = turretG.clone();
        proxy.position.set(0, 0, 0); proxy.quaternion.identity();
        // turretG is constructed immediately above as [turret mesh, gunPivot].
        proxy.children[1].rotation.x = -gunPitchAt(v, track.pose_kf.t[0]);
        root.add(proxy); root.visible = false; scene.add(root);
        return { track, root, proxy, proxyVisual: prepareTankDestroyedVisual(proxy), glb: null, glbVisual: null };
      });
      v.proxyVisual = prepareTankDestroyedVisual(g, { cloneMaterials: false });
      v.labelAnchor = new THREE.Vector3();
      // 履带印路径累积态（左右各一条；builtT = 已铺到的回放时刻，-∞ = 待全量重算）
      v.trail = { L: createTrailState(), R: createTrailState(), builtT: -Infinity };
      v.tread = null; v.treadMesh = null;
      // 履带印逐车装配（owner = treadRuntime；本模块保持 tread-free，#820 Step 4）
      if (deps.quality().treadMarks) deps.treadAttachVehicle(v);
      scene.add(g);
      V.push(v);
      setLowPoly(v, true);
    }
  }

  const { loadGlb, disposeCache } = createVehicleModelAssets(deps)
  const { collectSuspensionParts, poseGlb, poseGlbRig, glbGunWorld, frameTiming, markSeekSnap, clearSnap } = createVehicleModelPose(deps, { yawAt, hullPitchAt, turretAbsAt, gunPitchAt, rollAt, wrapPi })

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
            deps.onModelChanged?.(v.def.eid)
            deps.invalidate();
          }
        }
        if (v.glb) setLowPoly(v, false);
      });
    } else {
      for (const v of V) {
        const hadGlb = !!v.glb;
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
        if (hadGlb) deps.onModelChanged?.(v.def.eid);
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

  // applyPose 的零分配采样 scratch（原宿主 tmpV 同款，本模块独立持有）
  const tmpV = new THREE.Vector3();

  function applyPose(v: RuntimeVehicle) {
    applyDetachedTurrets(v);
    const T = deps.getT();
    const life = deps.sceneLifeAt(v, T);
    const dead = life?.lifeState === 'DESTROYED';
    const amount = destroyedVisualAmount(life, T);
    applyTankDestroyedVisual(v.proxyVisual, amount);
    applyTankDestroyedVisual(v.glbVisual, amount);
    // 死亡后模型不消失：coverage 在阵亡处截止，但残骸应留在最后已知位置
    // （posAt 对越界时间钳位到最后采样，即阵亡点），与游戏内残骸留场行为一致
    const vis = deps.visibleAt(v, T) || dead;
    v.group.visible = vis;
    if (v.glb) v.glb.visible = vis && !deps.classIconsVisible();
    if (!vis) {
      // 最后已知位姿（可视性诚实呈现）：语义判别器只允许协议 AoI 在场段（见
      // playback/lastKnown.ts）；位姿 = 段内末网格采样，不插值不外推。memo 按 (车, t)；
      // 计算与设置无关（lastKnownOn 只门控呈现），切换开关重入 applyPose 即生效。
      // 证据晚到也要刷新：仅按 T 记忆会把「同一时刻 canonical 身份稍后就绪」挡在门外
      //（评审反例：先 false 生成幽灵，同一 T 再 true，旧代码不重算）。
      const spansOfForIdentity = (eid: number) => deps.visByEid().get(eid)
        ?? deps.getData()?.vehicles.find((o) => o.eid === eid)?.coverage;
      const replacedNow = deps.replacedAt
        ? deps.replacedAt(v.def.eid, T) === true
        : deps.getData()
          ? replacedBySuccessorAt(deps.getData()!.vehicles, spansOfForIdentity, v.def.eid, T)
          : false;
      if (v.lastKnownAt !== T || v.lastReplaced !== replacedNow) {
        v.lastKnownAt = T;
        v.lastReplaced = replacedNow;
        // 同账号后继实体（AoI 重入/复活换 eid）在当前时刻已接管 → 抑制旧实体幽灵
        // （否则同一玩家同时出现在两个位置）。权威身份（canonical entityStartsByAccount）
        // 由宿主注入；缺省回退 coverage 段序（时间感知：接管前不隐藏）。
        v.lastKnownPose = replacedNow
          ? null
          : lastKnownPoseAt(
            deps.visByEid().get(v.def.eid) ?? v.def.coverage, T, v.def.pos, deps.poseGrid.tStart);
      }
      const ghost = v.lastKnownProxy;
      if (ghost) {
        const lk = v.lastKnownPose;
        ghost.visible = deps.store.lastKnownOn && lk != null;
        if (ghost.visible && lk) {
          // game 系 → 场景系 x 取负（帧变换契约与 posAt 一致，禁止在别处再补符号）
          ghost.position.set(-lk.pos[0], lk.pos[1] + LAST_KNOWN_PROXY_Y, lk.pos[2]);
        }
      }
      syncContactShadow(v);
      // 悬挂积分复位：不可见期间不累积侧位移（复现时首帧吸附，不跳变）
      if (v.suspParts) {
        for (const k of ['L', 'R'] as const) if (v.suspParts.sides[k]) v.suspParts.sides[k]!.prev = null;
      }
      return;
    }
    // 在场：正常呈现，无幽灵（清掉上一段的 memo 与代理显隐）
    v.lastKnownPose = null;
    v.lastKnownAt = T;
    if (v.lastKnownProxy) v.lastKnownProxy.visible = false;
    posAt(v, T, tmpV);
    v.group.position.copy(tmpV);
    if (v.glb) poseGlb(v);
    // 低模位姿（GLB 显示时保留低模位姿更新，切回低模无跳变）：与 GLB 侧同口径 = **记录位姿**
    v.group.rotation.order = 'YXZ';
    v.group.rotation.y = -yawAt(v, T);
    v.group.rotation.x = hullPitchAt(v, T);
    v.group.rotation.z = -rollAt(v, T);   // 横滚（符号约定见 rollAt 注释）
    if (v.hullGroup) {
      v.hullGroup.quaternion.identity();
      v.hullGroup.position.set(0, 0, 0);
    }
    const rel = wrapPi(turretAbsAt(v, T) - yawAt(v, T));
    v.turretG.rotation.y = -rel;
    v.gunPivot.rotation.x = -gunPitchAt(v, T);
    syncContactShadow(v);
  }

  /** 阴影只读已变换完成的场景位姿（posAt 已含镜像）；车辆不可见或被类型图标替代时隐藏。 */
  function syncContactShadow(v: RuntimeVehicle) {
    const shadows = deps.contactShadows();
    if (!shadows) return;
    const p = v.group.position;
    shadows.update(v, p.x, p.z, v.group.rotation.y,
      v.group.visible && !deps.classIconsVisible() && v.def.eid !== deps.scopedHiddenEid());
  }

  function vehicleByEid(eid: number) { return V.find((x) => x.def.eid === eid); }

  /** 会话 teardown：车辆循环 + GLB 模板缓存释放（原 teardownSession 的车辆段逐字保留；
   *  履带印逐车回收归 treadRuntime.dispose（宿主先调它，保持原相对顺序）。 */
  function dispose() {
    const scene = deps.getScene();
    for (const v of V) {
      for (const head of v.detachedTurrets) {
        scene?.remove(head.root);
        disposeTankDestroyedVisual(head.proxyVisual);
        disposeTankDestroyedVisual(head.glbVisual);
      }
      if (v.glb) scene?.remove(v.glb);          // only material clones are instance-owned
      disposeTankDestroyedVisual(v.glbVisual);
      v.glbVisual = null;
      // 最后已知代理：材质逐车独立（几何与低模共享，dispose 幂等），随会话一并释放
      if (v.lastKnownProxy) {
        scene?.remove(v.lastKnownProxy);
        deps.disposeObject3D(v.lastKnownProxy);
        v.lastKnownProxy = null;
      }
      // 悬挂求解为逐车 clone 的履带几何（唯一持有者）：显式释放
      if (v.suspParts && v.suspParts.disposables) {
        for (const g of v.suspParts.disposables) g.dispose();
      }
      v.suspParts = null;
      if (v.group) { scene?.remove(v.group); deps.disposeObject3D(v.group); }
    }
    V = [];
    disposeCache();
  }

  return {
    getVehicles: () => V,
    buildVehicles,
    syncContactShadow,
    loadGlb,
    applyGlbToggle,
    glbOn: () => glbOn,
    setLowPoly,
    applyPose,
    applyDetachedTurrets,
    poseGlbRig,
    glbGunWorld,
    posAt, yawAt, hullPitchAt, turretAbsAt, gunPitchAt, rollAt,
    vehicleByEid,
    frameTiming, markSeekSnap, clearSnap,
    dispose,
  };
}
