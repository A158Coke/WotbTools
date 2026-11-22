import * as THREE from 'three'
import { poseFromYPR } from '../glbRig.js'
import { clampTravel, rateLimitTravel, spinStep, treadScrollStep, groundDropLocal,
  attachChainToWheels, chainSpanBoundaries, solveChain, vertexChainParams, applyChainToVertices, chainChanged, chainDrift, sideTravel,
  parseWheelNodeName, parseTrackNodeName, wheelRadiusFromExtents,
  applyWheelSpin, measureBeltUvSlope, chainBottomRunDir, writeUvOffsetV } from '../suspension.js'
import { markPickBoundsStale } from './armorHighlight.js'
import type { GlbParts } from './glbParts.js'
import type { RuntimeVehicle, SuspensionJson, SuspensionParts, SuspensionSide, SuspensionTrackPart, SuspensionWheelPart, VehicleRuntimeDeps } from './vehicleRuntimeTypes.js'

export function createVehicleModelPose(deps: VehicleRuntimeDeps, pose: {
  yawAt: (v: RuntimeVehicle, t: number) => number; hullPitchAt: (v: RuntimeVehicle, t: number) => number
  turretAbsAt: (v: RuntimeVehicle, t: number) => number; gunPitchAt: (v: RuntimeVehicle, t: number) => number
  rollAt: (v: RuntimeVehicle, t: number) => number; wrapPi: (angle: number) => number
}) {
  const { yawAt, hullPitchAt, turretAbsAt, gunPitchAt, rollAt, wrapPi } = pose
  let suspDt = 0, suspSnap = false
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
  const SUSP_AXIS = new THREE.Vector3(0, 0, 1);      // 模型 +z（上）——行程方向
  const SUSP_SPIN_AXIS = new THREE.Vector3(1, 0, 0); // 轮局部 X（车宽）——自转轴（客户端同款）
  const _spQ = new THREE.Quaternion(), _spQ2 = new THREE.Quaternion();
  const _spV = new THREE.Vector3(), _spP = new THREE.Vector3(), _spC = new THREE.Vector3();
  const _spUp = new THREE.Vector3(), _spFwd = new THREE.Vector3();
  const _spUpW = new THREE.Vector3(), _spBox = new THREE.Box3(), _spBox2 = new THREE.Box3();

  function collectSuspensionParts(root: THREE.Object3D, susp: SuspensionJson | null, tankId: number): SuspensionParts | null {
    if (!susp || !Array.isArray(susp.wheels) || !susp.chains) return null;
    const chainsBySide = { L: susp.chains.left, R: susp.chains.right };
    if (!Array.isArray(chainsBySide.L) || !Array.isArray(chainsBySide.R)) return null;
    root.updateMatrixWorld(true);          // clone 未入 scene：matrixWorld 即"相对模型根"
    const disposables: Array<{ dispose(): void }> = [];
    const sides: Partial<Record<'L' | 'R', SuspensionSide>> = {};
    for (const side of ['L', 'R'] as const) {
      const wheelNodes: Array<[number, THREE.Object3D]> = [];
      const trackNodes: Array<[number, THREE.Object3D]> = [];
      root.traverse((n) => {
        const wp = parseWheelNodeName(n.name);
        if (wp && wp.side === side) wheelNodes.push([wp.index, n]);
        const tp = parseTrackNodeName(n.name);
        if (tp && tp.side === side) trackNodes.push([tp.segment, n]);
      });
      wheelNodes.sort((a, b) => a[0] - b[0]);
      trackNodes.sort((a, b) => a[0] - b[0]);
      const chains = chainsBySide[side];
      // 客户端断言 `wheelInfos.size() == suspension.wheels.size()`：轮数不符即 fail-closed
      if (!wheelNodes.length || wheelNodes.length !== susp.wheels.length) return null;
      if (!trackNodes.length || trackNodes.length !== chains.length) return null;
      const wheels: SuspensionWheelPart[] = [];
      for (const [idx, node] of wheelNodes) {
        const rec = susp.wheels[idx - 1];
        if (!Array.isArray(rec) || rec.length < 3) return null;
        const flag = rec[0], up = rec[1], down = rec[2];
        _spBox.makeEmpty();
        node.traverse((o) => {
          const mesh = o as THREE.Mesh
          if (!(mesh as THREE.Mesh).isMesh || !mesh.geometry) return;
          if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
          if (mesh.geometry.boundingBox) {
            _spBox.union(_spBox2.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld));
          }
        });
        if (_spBox.isEmpty()) return null;
        const ctr = _spBox.getCenter(new THREE.Vector3());
        const size = _spBox.getSize(new THREE.Vector3());
        const radius = wheelRadiusFromExtents(size.y, size.z);
        const travelAxis = SUSP_AXIS.clone().applyQuaternion(node.quaternion.clone().invert());
        const upHull = SUSP_AXIS.clone().applyQuaternion(node.quaternion);
        // 导出器把轮几何烘进顶点、节点留在原点（实测平移/旋转皆 identity）：直接给节点写
        // 旋转会绕**整车原点**转（轮公转 = 观感"旋转混乱"）。故按轮心做枢轴补偿——
        // 与炮塔/炮管同一套"节点原点 + 显式枢轴"约定（见 model_origins 那条链）。
        const pivot = node.parent ? node.parent.worldToLocal(ctr.clone()) : ctr.clone();
        const restPivotRot = pivot.clone().applyQuaternion(node.quaternion);
        wheels.push({
          node, flag,
          up: flag ? up : 0, down: flag ? down : 0,     // flag=0：不参与贴地（客户端同款）
          radius, centerHull: ctr, travelAxis, upHull, pivot, restPivotRot,
          restPos: node.position.clone(), restQuat: node.quaternion.clone(),
          travel: 0, spin: 0,
        });
      }
      const tracks: SuspensionTrackPart[] = [];
      for (let ti = 0; ti < trackNodes.length; ti++) {
        const node = trackNodes[ti][1];
        const chain = chains[ti];
        if (!Array.isArray(chain) || chain.length < 4) return null;
        _spBox.makeEmpty();
        const meshes: THREE.Mesh[] = [];
        node.traverse((o) => {
          const mesh = o as THREE.Mesh
          if (!mesh.isMesh || !mesh.geometry) return;
          meshes.push(mesh);
          if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
          if (mesh.geometry.boundingBox) {
            _spBox.union(_spBox2.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld));
          }
        });
        if (!meshes.length || _spBox.isEmpty()) return null;
        const lateral = _spBox.getCenter(new THREE.Vector3()).x;   // 履带中心线（模型系横向）
        const beltW = _spBox.getSize(new THREE.Vector3()).x;        // 履带条宽（回落实测宽度用）
        const chain2: Array<[number, number]> = chain.map((pt): [number, number] => [pt[0], pt[1]]);   // [纵向 y, 高度 z]
        const restZ = chain.map((pt) => pt[1]);
        // 段弧长（花纹速率与顶点弧长参数用）
        const segArc: number[] = [];
        const cumArc = [0];
        for (let i = 0; i + 1 < chain2.length; i++) {
          segArc.push(Math.hypot(chain2[i + 1][0] - chain2[i][0], chain2[i + 1][1] - chain2[i][1]));
          cumArc.push(cumArc[cumArc.length - 1] + segArc[i]);
        }
        const uvSamples: Array<[number, number]> = [];
        const wheelCfg = wheels.map((w) => ({
          longitudinal: w.centerHull.y, centerZ: w.centerHull.z, radius: w.radius,
        }));
        const attach = attachChainToWheels(chain2, wheelCfg);
        // 悬空段边界 = 挂接点 ∪ 客户端链点 flag（1 = 分段标记；语义未定，只作**额外**细分，
        // 不参与选轮——见 suspension.ts `chainSpanBoundaries` / `attachChainToWheels` 注释）。
        const spans = chainSpanBoundaries(attach,
          chain.some((pt) => Number.isFinite(pt[2])) ? chain.map((pt) => Number(pt[2])) : null);
        const parts: SuspensionTrackPart['parts'] = [];
        for (const mesh of meshes) {
          mesh.geometry = mesh.geometry.clone();      // 形变逐车独立（模板几何共享）
          disposables.push(mesh.geometry);
          const posAttr = mesh.geometry.getAttribute('position') as THREE.BufferAttribute | null;
          if (!posAttr) continue;
          const basePos = new Float32Array(posAttr.array);
          const nv = basePos.length / 3;
          // 顶点 → 链路映射在**模型根系**里做（链路即模型根系的纵剖面折线）
          const rootPos = new Float32Array(basePos.length);
          const m = mesh.matrixWorld;
          for (let vi = 0; vi < nv; vi++) {
            _spV.set(basePos[vi * 3], basePos[vi * 3 + 1], basePos[vi * 3 + 2]).applyMatrix4(m);
            rootPos[vi * 3] = _spV.x; rootPos[vi * 3 + 1] = _spV.y; rootPos[vi * 3 + 2] = _spV.z;
          }
          const params = vertexChainParams(rootPos, chain2);
          // 位移方向：模型根 +z 在该网格局部系里的方向（网格可能带旋转）
          const localAxis = SUSP_AXIS.clone().applyQuaternion(mesh.quaternion.clone().invert());
          const uvAttr = mesh.geometry.getAttribute('uv') as THREE.BufferAttribute | null;
          const uvBase = uvAttr ? new Float32Array(uvAttr.array) : null;
          // 花纹速率样本：[沿带弧长, V]（沿带弧长由顶点→链路映射给出）
          if (uvAttr) {
            for (let vi = 0; vi < nv; vi++) {
              const sg = params.seg[vi];
              const arc = cumArc[sg] + params.t[vi] * segArc[sg];
              uvSamples.push([arc, uvAttr.array[vi * 2 + 1]]);
            }
          }
          parts.push({ mesh, posAttr, basePos, params, axis3: [localAxis.x, localAxis.y, localAxis.z],
                       uvAttr, uvBase, appliedUv: 0 });
        }
        if (!parts.length) return null;
        // 花纹滚动速率：**网格实测**沿带 dV/ds（客户端形式 textureScale/chunkLength 实测偏快
        // 3.4~19×——那条常数在客户端自己的 shader V 空间里，与导出网格的图集式 per-link V
        // 不同量纲）。方向：ΔV = dir·k·Δs，dir = 链路底段走向（材料在底段向后流），
        // k 的符号自带模型的 V 朝向 ⇒ 两个符号方向都自动正确（见 suspension.js 推导）。
        const uvFit = measureBeltUvSlope(uvSamples);
        const dvPerM = uvFit.ok ? chainBottomRunDir(chain2) * uvFit.slope : 0;
        if (!uvFit.ok) {
          console.warn('[playback] 履带 UV 沿带斜率不可测（花纹停滚）tank=' + (tankId || '?')
            + ' pairs=' + uvFit.pairs);
        }
        tracks.push({
          node, parts, chain: chain2, restZ, attach, spans, wheelCfg, lateral, beltW,
          groundDrop: new Float64Array(chain2.length),
          chainZ: new Float64Array(chain2.length),
          appliedChainZ: null,    // 已下发的解算链（顶点输出的唯一形状输入，见 suspensionStep）
          normalChainZ: null,     // 上次**重算法线**时的链（法线闸门逐点比较用）
          dvPerM, uv: 0,
        });
      }
      // 侧接触线横向偏移：履带中心线 |x| 的均值；同时累计履带条宽（beltW 均值）
      let sum = 0, wsum = 0;
      for (const tg of tracks) { sum += Math.abs(tg.lateral); wsum += tg.beltW || 0; }
      sides[side] = {
        wheels, tracks, wheelDelta: new Float64Array(wheels.length),
        halfW: tracks.length ? sum / tracks.length : 0,
        beltW: tracks.length ? wsum / tracks.length : 0, prev: null,
      };
    }
    return {
      sides, disposables, bend: susp.track_bending || null,
    };
  }

  // 逐帧：贴地（轮）→ 自转 → 链路解算 → 逐顶点形变 + 花纹滚动
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
  return { collectSuspensionParts, poseGlb, poseGlbRig, glbGunWorld,
    frameTiming: (dt: number, snap: boolean) => { suspDt = dt; suspSnap = snap },
    markSeekSnap: () => { suspSnap = true; suspDt = 0 }, clearSnap: () => { suspSnap = false } }
}
