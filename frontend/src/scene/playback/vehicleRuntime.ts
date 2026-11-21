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
import { createVehicleGlb } from './vehicleGlb.js'
import {
  applyTankDestroyedVisual, destroyedVisualAmount, disposeTankDestroyedVisual, prepareTankDestroyedVisual,
} from '../tankDestroyedVisual.js'
import { sampleVehiclePoseGame } from '../../replay-local/pose/vehiclePose.js'
import { lastKnownPoseAt, replacedBySuccessorAt } from './lastKnown.js'
import type { VehiclePoseGame } from '../../replay-local/pose/vehiclePose.js'
import {
  clampTravel, rateLimitTravel, spinStep, treadScrollStep, groundDropLocal,
  solveChain, applyChainToVertices, chainChanged, chainDrift, sideTravel,
  applyWheelSpin, writeUvOffsetV,
} from '../suspension.js'
import { markPickBoundsStale } from './armorHighlight.js'
import { createTrailState } from '../treadMarks.js'
import type {
  GlbCacheEntry, RuntimeVehicle,
  VehicleRuntimeDeps, VehicleRuntimeHandle,
} from './vehicleRuntimeTypes.js'

/** 资产平面 suspension/{tank_id}.json 的消费面（缺失/404 → null，整车回落刚体）。 */

/** 最后已知代理的底盘盒中心相对记录位姿的抬升（= 低模履带盒在 group 内的 position.y，同高对齐）。 */
const LAST_KNOWN_PROXY_Y = 0.42

export function createVehicleRuntime(deps: VehicleRuntimeDeps): VehicleRuntimeHandle {
  let V: RuntimeVehicle[] = [];      // 车辆运行时 {def, group, turretG, gunPivot, labelAnchor, meshHull, glb}
  let glbCache = new Map<number, Promise<GlbCacheEntry | null>>();
  let suspDt = 0;          // 本帧 dt（0 = seek/跳变 ⇒ 行程限速退化为吸附）
  let suspSnap = false;    // 本 tick 为跳变（seek）：行程吸附、侧位移不积分

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
  // GLB 车模域 owner（#LOC 结构拆分出仓 vehicleGlb.ts；缓存/清单/位姿缓存仍在本闭包）
  const glbDomain = createVehicleGlb({
    deps,
    V: () => V,
    glbCache,
    yawAt,
    hullPitchAt,
    rollAt,
    turretAbsAt,
    gunPitchAt,
    suspensionStep,
    applyPose,
    wrapPi,
  });

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
      glbDomain.setLowPoly(v, true);
    }
  }

  // ---------- GLB 真实车模 ----------
  // 姿态处理与装甲查看器 world 模式（poseFromYPR / poseShooterTurretGun）同构：
  // - GLB 内部系 x右/y前/z上（models.pb 原点已按 (x,z,y) 校正到该系）；根位姿 = qYaw·qPitch·qRoll·qFrame，
  //   qFrame = Ry(π)·Rx(−π/2) 的 z-up→y-up 帧变换；yaw 传镜像值（−游戏 yaw），pitch 原值，roll 滤波层恒 0；
  // - 炮塔/炮管 = 烘焙矩阵绕枢轴旋转：炮塔 Rz(−rel)（镜像系）@ tP=track+turret，炮管 Rx(俯仰)@ gP=tP+gun_origin；
  // - 部件数据（model_origins / configs[].gun_origin / initial_turret_rotation）来自资产平面 tank/{id}.json
  //  （WotBTools client-only：dump-tank-data 物化，与上游 /api/tank/{id} 同一形状）。

  // ---------- 悬挂求解（轮/带逐帧解算，客户端同构） ----------
  // 依据：上游 `docs/tank-suspension-client-re.md` §六（第二轮反汇编）。与客户端逐条对应：
  //   · 负重轮（`chassis_wheel_{L,R}_NN`，yaml `wheels` 记录 1:1）= **纯竖直平移**，夹到
  //     `[pz−b, pz+a]`、按 `wheelsReactionSpeed` 限速、首次可见直接吸附；`flag=0`
  //     （诱导/主动/托带轮）不参与贴地解算（但照常自转）。
  //   · 自转 = 绕轮节点**局部 X 轴** `θ += −Δs_侧 / r`；Δs_侧 = 该侧履带接触线中心的纵向
  //     位移（左右各算 ⇒ 转向差速自动成立）。
  //   · 履带（`chassis_track_{L,R}`，多段模型为 `…_NN`）= 静止折线（链路）→ 逐轮偏移 →
  //     悬空段垂弧 → 铺地，随后**逐顶点形变**（只动模型 +z）+ 花纹 V 滚动
  //     （每米速率 = **网格实测**沿带 dV/ds × 底段走向；客户端形式常数
  //     `textureScale/chunkLength` 实测偏快 3.4~19×，见 collectSuspensionParts 内注释）。
  // 半径/挂点/链长由模型现算（客户端亦从骨骼现算）；数据缺失/命名不符/轮数不匹配 →
  // 返回 null，整车回落刚体（fail-closed，与数据面无 suspension 块的车同路）。
  const SUSP_SPIN_AXIS = new THREE.Vector3(1, 0, 0); // 轮局部 X（车宽）——自转轴（客户端同款）
  const _spQ = new THREE.Quaternion(), _spQ2 = new THREE.Quaternion();
  const _spP = new THREE.Vector3(), _spC = new THREE.Vector3();
  const _spUp = new THREE.Vector3(), _spFwd = new THREE.Vector3();
  const _spUpW = new THREE.Vector3();

  function suspensionStep(v: RuntimeVehicle) {
    const sp = v.suspParts;
    if (!sp || !v.glb) return;
    _spQ.copy(v.glb.quaternion);                       // 车体系（模型系）→ 世界
    _spUp.set(0, 0, 1).applyQuaternion(_spQ);          // 车体 up 的世界向量
    const upY = _spUp.y;
    _spFwd.set(0, 1, 0).applyQuaternion(_spQ);         // 车体前向（世界）
    const snap = suspSnap;
    const dt = suspDt;
    const reaction = Number.isFinite(v.def && v.def.suspReaction) ? v.def.suspReaction! : 1.0;
    for (const key of ['L', 'R'] as const) {
      const side = sp.sides[key];
      if (!side) continue;
      // 该侧履带接触线中心（世界）：车体系 (±halfW, 0, 0)
      _spP.set(key === 'L' ? -side.halfW : side.halfW, 0, 0).applyQuaternion(_spQ).add(v.glb.position);
      let dS = 0;
      if (side.prev && !snap) {
        dS = sideTravel(side.prev.x, side.prev.z, _spP.x, _spP.z, _spFwd.x, _spFwd.z);
      }
      if (!side.prev) side.prev = new THREE.Vector3();
      side.prev.copy(_spP);
      // 逐轮：贴地行程 + 自转
      for (let wi = 0; wi < side.wheels.length; wi++) {
        const w = side.wheels[wi];
        if (w.flag) {
          _spC.copy(w.centerHull).applyQuaternion(_spQ).add(v.glb.position);
          const terr = deps.sampleHeight(_spC.x, _spC.z);
          _spUpW.copy(w.upHull).applyQuaternion(_spQ);
          const upw = Math.abs(_spUpW.y) > 0.25 ? _spUpW.y : 0;
          if (upw) {
            const wantWorld = (terr + w.radius) - _spC.y;      // 世界竖直差
            const wantLocal = clampTravel(wantWorld / upw, w.up, w.down);
            w.travel = rateLimitTravel(w.travel, wantLocal, reaction, dt, snap);
          } else {
            w.travel = 0;
          }
        } else {
          w.travel = 0;                                        // 非负重轮：保持装定位
        }
        if (dS) w.spin = spinStep(w.spin, dS, w.radius);
        // 自转（绕轮局部 X）+ 枢轴补偿（导出的轮节点在原点，几何烘进顶点；见 applyWheelSpin）
        _spQ2.setFromAxisAngle(SUSP_SPIN_AXIS, w.spin);
        applyWheelSpin(w.node, w.restPos, w.restQuat, w.pivot, w.restPivotRot,
                       _spQ2, w.travelAxis, w.travel);
        side.wheelDelta[wi] = w.travel;
      }
      // 履带：链路解算 + 形变 + 花纹
      for (const tg of side.tracks) {
        const n = tg.chain.length;
        for (let i = 0; i < n; i++) {
          _spP.set(tg.lateral, tg.chain[i][0], tg.chain[i][1]).applyQuaternion(_spQ).add(v.glb.position);
          const terr = deps.sampleHeight(_spP.x, _spP.z);
          tg.groundDrop[i] = groundDropLocal(terr, _spP.y, upY);
        }
        solveChain(tg.chainZ, tg.chain, tg.attach, side.wheelDelta, tg.groundDrop, tg.wheelCfg, sp.bend, tg.spans);
        // 花纹：每米 V 变化 = 网格实测 dV/ds（见收集期注释）
        const uv = (dS && tg.dvPerM)
          ? (tg.uv = treadScrollStep(tg.uv, dS, tg.dvPerM))
          : tg.uv;
        // 顶点输出 = f(chainZ, basePos, params, restZ, axis)（纯函数）⇒ **按解算链**判定是否下发：
        // 只比形变最大幅度会漏"幅度相同、分布不同"的形变（2026-10-10 review P2：把 0.1 的形变
        // 从一处挪到另一处时 max 不变、顶点已变但 `version` 仍是 1，GPU 停在旧形状；法线同理）。
        // 逐链路点（~40）比较比逐顶点指纹便宜且**恰好充分**：链相同 ⇒ 顶点逐点相同。
        const chainMoved = snap || !tg.appliedChainZ || chainChanged(tg.appliedChainZ, tg.chainZ);
        if (chainMoved) {
          // 法线闸门：与**上次重算法线时的链**逐点比较取最大偏差（2026-10-10 review 复审 P2——
          // dmax/dmean 这类累计统计量表达不了空间分布：把 0.1 m 的形变从一处挪到另一处时两者
          // 都不变，法线却必须重算）。2 cm 阈值仍是成本刹车：行驶中偏差累积到 2 cm 才重算一次，
          // 而非逐帧重算（逐帧 = 每车每帧一次全顶点遍历）。
          const dNorm = (snap || !tg.normalChainZ) ? Infinity : chainDrift(tg.normalChainZ, tg.chainZ);
          const redoNormals = dNorm > 0.02;
          for (const gp of tg.parts) {
            applyChainToVertices(gp.posAttr.array as Float32Array, gp.basePos, gp.params,
                                 tg.chainZ, tg.restZ, gp.axis3);
            gp.posAttr.needsUpdate = true;
            markPickBoundsStale(gp.mesh.geometry);
            if (redoNormals) {
              gp.mesh.geometry.computeVertexNormals();
              const na = gp.mesh.geometry.getAttribute('normal');
              if (na) na.needsUpdate = true;
            }
          }
          if (redoNormals) {
            if (!tg.normalChainZ) tg.normalChainZ = new Float64Array(n);
            tg.normalChainZ.set(tg.chainZ);
          }
          if (!tg.appliedChainZ) tg.appliedChainZ = new Float64Array(n);
          tg.appliedChainZ.set(tg.chainZ);
        }
        // 花纹与形变解耦：UV 只随累计滚动量变（链静止时也照样滚），故独立于上面的形变闸门
        for (const gp of tg.parts) {
          if (gp.uvAttr && gp.uvBase && Math.abs(uv - gp.appliedUv) > 1e-3) {
            gp.appliedUv = uv;
            // 取模只作用于**偏移**（整带同相）：逐顶点取模会破坏跨 wrap 图元的 UV 插值
            // （长直段被拉成"没有纹理"，见 writeUvOffsetV 注释）
            writeUvOffsetV(gp.uvAttr.array, gp.uvBase, uv);
            gp.uvAttr.needsUpdate = true;
          }
        }
      }
    }
  }

  // GLB 位姿模块级 scratch：本函数每车每帧执行，原实现每次分配 ~20 个矩阵/欧拉/四元数
  // （14 车 × 60fps 的 GC 抖动源）。语义与逐次分配完全一致，只是复用容器。
  // applyPose 的零分配采样 scratch（原宿主 tmpV 同款，本模块独立持有）
  const tmpV = new THREE.Vector3();

  function applyPose(v: RuntimeVehicle) {
    glbDomain.applyDetachedTurrets(v);
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
    if (v.glb) glbDomain.poseGlb(v);
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
    // GLB 模板缓存（session-scoped）：unique shared resources dispose 一次并清缓存。
    // 未决 Promise 逐个挂 then(dispose)——迟到模板到达即销毁（未渲染未上传 GPU，
    // 不泄漏）；teardown 之后才创建的迟到 Promise 不在册，随旧缓存对象 GC
    for (const p of glbCache.values()) {
      p.then((entry) => { if (entry && entry.template) deps.disposeObject3D(entry.template); })
        .catch(() => {});
    }
    glbCache = new Map();
  }

  return {
    getVehicles: () => V,
    buildVehicles,
    syncContactShadow,
    loadGlb: (tankId: number) => glbDomain.loadGlb(tankId),
    applyGlbToggle: (on: boolean) => glbDomain.applyGlbToggle(on),
    glbOn: () => glbDomain.glbOn(),
    setLowPoly: (v: RuntimeVehicle, show: boolean) => glbDomain.setLowPoly(v, show),
    applyPose,
    applyDetachedTurrets: (v: RuntimeVehicle) => glbDomain.applyDetachedTurrets(v),
    poseGlbRig: (v: RuntimeVehicle, t: number, pos: THREE.Vector3) => glbDomain.poseGlbRig(v, t, pos),
    glbGunWorld: (v: RuntimeVehicle, pos: THREE.Vector3, dir: THREE.Vector3) => glbDomain.glbGunWorld(v, pos, dir),
    posAt, yawAt, hullPitchAt, turretAbsAt, gunPitchAt, rollAt,
    vehicleByEid,
    frameTiming: (dt, snap) => { suspDt = dt; suspSnap = snap; },
    markSeekSnap: () => { suspSnap = true; suspDt = 0; },
    clearSnap: () => { suspSnap = false; },
    dispose,
  };
}

// ---- 类型面（#LOC 结构拆分出仓 vehicleRuntimeTypes.ts，导入方零改动）----
export type {
  DetachedTurret,
  DetachedTurretTrack,
  GlbCacheEntry,
  RuntimeVehicle,
  RuntimeVehicleDef,
  SuspensionJson,
  SuspensionParts,
  SuspensionSide,
  SuspensionTrackPart,
  SuspensionWheelPart,
  TickPose,
  TreadRuntimeParams,
  VehicleRuntimeData,
  VehicleRuntimeDeps,
  VehicleRuntimeHandle,
} from './vehicleRuntimeTypes.js'
