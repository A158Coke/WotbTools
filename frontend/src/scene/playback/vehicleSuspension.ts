// 悬挂部件装配（轮/履带节点收集 + 几何现算 + 链路静态解）——自 vehicleRuntime.ts 出仓
//（2026-11-21 #LOC 结构拆分：代码与搬移前逐字一致）。逐帧求解（suspensionStep）仍归宿主
// vehicleRuntime.ts；本模块只做装配期一次性收集。
import * as THREE from 'three'
import {
  parseWheelNodeName, parseTrackNodeName, wheelRadiusFromExtents, measureBeltUvSlope, chainBottomRunDir,
  attachChainToWheels, chainSpanBoundaries, vertexChainParams,
} from '../suspension.js'
import type { SuspensionJson, SuspensionParts, SuspensionSide, SuspensionTrackPart, SuspensionWheelPart } from './vehicleRuntimeTypes.js'

const SUSP_AXIS = new THREE.Vector3(0, 0, 1);      // 模型 +z（上）——行程方向
const _spV = new THREE.Vector3()
const _spBox = new THREE.Box3(), _spBox2 = new THREE.Box3()

/** 装配期一次性收集（宿主 buildVehicles 的 GLB 实例装配段消费）。 */
export function collectSuspensionParts (root: THREE.Object3D, susp: SuspensionJson | null, tankId: number): SuspensionParts | null {
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
