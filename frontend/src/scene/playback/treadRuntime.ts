// 地面履带印运行时 owner（#820 结构拆分，2026-11-05 自 initPlayback 闭包出仓）：
// 逐车履带参数/贴图缓存（treadParamCache / treadTexCache / treadMetaPromise）、网格装配
//（ensureTreadMesh / attachVehicle）、路径喂样（feedTrail）、GPU Buffer 调度
//（writeTrailQuads / treadBufferInput / ageTrailAlphas）与游标泵（updateTrails）的唯一归属。
// 代码与搬移前逐字一致；闭包读数改经 deps 注入（getter 快照）。会话 teardown（dispose：
// 逐车 treadMesh 回收 + 贴图缓存释放）由本模块一次性完成；宿主 teardownSession 先调
// tread.dispose() 再调 vehicles.dispose()，保持原相对顺序。
// 生成/摆放纯函数在 ../treadMarks.ts（SSOT）；槽位编排/量化在 ./treadBufferWriter.ts；
// 数据面 = 包内 tread/（上游 tools/export_tank_tread.py），可行性与回落口径见上游
// docs/feasibility-track-marks.md。
import * as THREE from 'three'
import type { Scene } from 'three'
import {
  advanceTrail, resetTrailState, resolveTreadParams,
  treadScaleFor,
  TREAD_FALLBACK, TREAD_RING,
} from '../treadMarks.js'
import type { TrailState, TreadParams, TreadTextureMeta } from '../treadMarks.js'
// 履带印 GPU Buffer 写入器（#820 Wave B4A 出仓）：槽位编排/fround 门控/needsUpdate
// 判定在 ./treadBufferWriter.ts；路径事实仍由 treadMarks 生成、本文件调度
import { writeTreadBuffer, ageTreadBuffer } from './treadBufferWriter.js'
import type { TreadBufferInput } from './treadBufferWriter.js'
import { GRID_DT } from './util.js'
import { assetProvider } from '../assetProvider.js'
import { defLifeAt } from '../../utils/battlePlaybackV2.ts'
import type { RuntimeVehicle, TreadRuntimeParams } from './vehicleRuntime.js'

/** 宿主注入的依赖（getter 快照；语义见各字段处原文注释）。 */
export interface TreadRuntimeDeps {
  /** 宿主 store 的履带印开关投影（ensureTreadMesh 显隐 / updateTrails 门控读它）。 */
  store: { treadOn: boolean }
  /** 画质档（宿主持有 QUALITY_PRESETS 解析结果；仅高清/极致出印记）。 */
  quality(): { treadMarks?: boolean; anisotropy: number }
  getScene(): Scene | null
  /** 实例是否已 destroy（attachVehicle 的迟到守卫）。 */
  destroyed(): boolean
  invalidate(): void
  /** 回放时钟（宿主唯一 owner；喂样终点与 Buffer 时间戳）。 */
  getT(): number
  /** 开战时刻（喂样网格对齐锚点；宿主唯一 owner 的 START）。 */
  getStart(): number
  /** 当前会话回放数据（updateTrails 的会话门控）。 */
  getData(): unknown | null
  /** 车辆清单（owner = vehicleRuntime）。 */
  getVehicles(): RuntimeVehicle[]
  /** 位姿采样（owner = vehicleRuntime 的 poseStash 缓存，经 handle 转发）。 */
  vehicles: {
    posAt(v: RuntimeVehicle, t: number, out: THREE.Vector3): THREE.Vector3
    yawAt(v: RuntimeVehicle, t: number): number
  }
  /** 协议精确可见性（canonical 事实 owner = 宿主 visibleAt）。 */
  visibleAt(v: RuntimeVehicle, t: number): boolean
  /** 地形高度采样（owner = mapWorld；印记四角贴地）。 */
  heightAt(x: number, z: number): number
  /** 高度场是否就绪（未就绪时 Buffer 高度恒 0，与原实现同口径）。 */
  heightFieldReady(): boolean
}

/** 履带印运行时对外句柄（宿主的唯一消费面）。 */
export interface TreadRuntimeHandle {
  /** buildVehicles 的逐车履带装配段（原 `if (Q.treadMarks) {...}` 块整体迁入）。 */
  attachVehicle(v: RuntimeVehicle): void
  /** tick 游标泵（seek 后退 = 全量重算，前进 = 增量；开关关断期确定性复位）。 */
  updateTrails(): void
  /** 会话 teardown：逐车 treadMesh 回收（几何+材质+scene.remove，v.tread/v.trail 置空）
   *  + 逐车参数缓存清空 + 共享贴图缓存逐张 dispose 后清空。 */
  dispose(): void
}

export function createTreadRuntime(deps: TreadRuntimeDeps): TreadRuntimeHandle {
  // 履带印（tread/）逐车参数与贴图缓存：会话域（与 glbCache 同生命周期）。
  // 缺 json（424/735 辆无 authored 块）→ resolveTreadParams(null) 的产品回落（上游
  // feasibility §四），**不视为失败**——缓存正结果，避免逐帧重试 404。
  const treadParamCache = new Map<number, Promise<TreadParams>>();
  const treadTexCache = new Map<string, THREE.Texture>();   // texture 相对路径 → THREE.Texture（逐会话共享、逐会话释放）
  // /tread/textures.json（alpha 归一化系数表；失败 → {} 即全 1）
  let treadMetaPromise: Promise<{ textures?: Record<string, TreadTextureMeta> | null }> | null = null;

  /** 每侧戳环槽数 = 客户端 TreadSystem 的固定环（反汇编 `(i+0x32)%0x32`，50 槽/侧）。
   *  ⚠️ **50 槽含 active/open 槽**（落锚函数 0x727b80：`head=write; write=(write+1)%50;
   *  count 封顶 50`）——逐帧拉伸的活戳占 write 槽（= total % cap），落锚后定型并推进，
   *  **没有独立的第 51 槽**。印记长度预算 = 50 × manualSpace 米，车后滚动收尾。 */
  const TRAIL_CAP_PER_SIDE = TREAD_RING;
  /** 槽位总数（左右交错）：50 槽/侧（含活戳）。 */
  const TRAIL_SLOTS = TRAIL_CAP_PER_SIDE * 2;
  /** 无 suspension 数据时的履带中心线横距（m）：低模履带盒半宽量级（产品回落，上游 feasibility §四） */
  const TREAD_HALF_GAUGE = 0.9;

  function treadParamsFor(tankId: number): Promise<TreadParams> {
    // tank_id 缺失/非法（车队识别失败等）：不发请求，直接产品回落（键 0 共享一个正结果）
    const key = Number.isFinite(tankId) && tankId > 0 ? tankId : 0;
    let p = treadParamCache.get(key);
    if (!p) {
      p = key > 0
        ? assetProvider.json<Record<string, unknown> | null>(`/tread/${key}.json`)
          .then((j) => resolveTreadParams(j))
          .catch(() => resolveTreadParams(null))
        : Promise.resolve(resolveTreadParams(null));
      treadParamCache.set(key, p);
    }
    return p;
  }

  function treadMetaFor() {
    if (!treadMetaPromise) {
      treadMetaPromise = assetProvider.json<{ textures?: Record<string, TreadTextureMeta> | null }>('/tread/textures.json').catch(() => ({}));
    }
    return treadMetaPromise;
  }

  /** 模型履带条宽（两侧履带盒横向尺寸均值；无 suspension 数据 → 0 ⇒ 调用方回落常量） */
  function beltWidthOf(v: RuntimeVehicle) {
    const sp = v.suspParts && v.suspParts.sides;
    if (!sp) return 0;
    let sum = 0, n = 0;
    for (const key of ['L', 'R'] as const) {
      const s = sp[key];
      if (s && s.beltW > 1e-3) { sum += s.beltW; n++; }
    }
    return n ? sum / n : 0;
  }

  /** 未 authored 车（`manual_width: null`，客户端 forceManualWidth=false 语义）的当前宽度：
   *  模型履带盒实测 beltW → 常量回落。authored 车恒用 manual_width、不走这里。 */
  function resolvedTreadWidth(v: RuntimeVehicle) {
    const beltW = beltWidthOf(v);
    return beltW > 1e-3 ? beltW : TREAD_FALLBACK.width;
  }

  function ensureTreadMesh(v: RuntimeVehicle, tp: TreadRuntimeParams) {
    const scene = deps.getScene();
    if (v.treadMesh || !scene) return;
    const SLOTS = TRAIL_SLOTS;                    // 50 槽/侧（含活戳，客户端 0x727b80 同构）
    const geo = new THREE.BufferGeometry();
    // 逐段 4 顶点的**动态合并几何**（不是 InstancedMesh）：四角必须各自独立贴地
    // （trailStampCorners），单个实例矩阵表达不了四角异高——正是首版"单平面 + 中心梯度"
    // 被粗格地形网格盖住（印记断续可见）的根因。position 逐段写；uv/index 全槽位恒定。
    const pos = new THREE.BufferAttribute(new Float32Array(SLOTS * 4 * 3), 3);
    pos.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', pos);
    const uvArr = new Float32Array(SLOTS * 4 * 2);
    for (let s = 0; s < SLOTS; s++) uvArr.set([0, 0, 1, 0, 1, 1, 0, 1], s * 8);
    geo.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2));
    // RGBA 顶点色：rgb 恒 1，a = 寿命淡出系数（treadAlphaAt，按回放时钟老化）——
    // 初始 0（未写槽位不可见；drawRange 之外本就不画，这里是防御）
    const col = new THREE.BufferAttribute(new Float32Array(SLOTS * 4 * 4), 4);
    col.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('color', col);
    const idx = new Uint32Array(SLOTS * 6);
    for (let s = 0; s < SLOTS; s++) {
      const b = s * 4, o = s * 6;
      idx[o] = b; idx[o + 1] = b + 1; idx[o + 2] = b + 2;
      idx[o + 3] = b; idx[o + 4] = b + 2; idx[o + 5] = b + 3;
    }
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.setDrawRange(0, 0);               // 未写段的位置是全零：drawRange 挡住 + seek 回退缩窗口
    // 双面（review P2 2026-10-11）：戳的角序 [L0,R0,R1,L1] 跟车体朝向走，**倒车**时位移
    // 反向 ⇒ 固定索引产生朝下法线，默认 FrontSide 下被背面剔除（实测倒车印记从地面以上
    // 完全不可见：从上方向下 Raycaster 命中 0 三角形，DoubleSide 后命中）。贴地覆盖层
    // 走 MeshBasicMaterial 无光照，双面零代价。
    const mat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, vertexColors: true,
                                              side: THREE.DoubleSide });
    let tex = treadTexCache.get(tp.texture);
    if (!tex) {
      tex = new THREE.TextureLoader().load(assetProvider.url(tp.texture));
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = deps.quality().anisotropy;
      treadTexCache.set(tp.texture, tex);
    }
    mat.map = tex;
    mat.needsUpdate = true;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;           // 段遍布全场：包围球无意义
    mesh.renderOrder = 2;                 // 地形/底图之后
    mesh.matrixAutoUpdate = false;
    mesh.visible = deps.store.treadOn;
    scene.add(mesh);
    v.treadMesh = mesh;
  }

  /** 单侧履带中心线的世界横距：suspension 解析出的 halfW 优先（模型实测），低模/无悬挂回落常数 */
  function trailHalfGauge(v: RuntimeVehicle, side: 'L' | 'R') {
    const s = v.suspParts && v.suspParts.sides[side];
    return s && s.halfW > 1e-3 ? s.halfW : TREAD_HALF_GAUGE;
  }

  /** feedTrail 的单点横截面 scratch（原宿主 tmpV 同款，本模块独立持有，零分配）。 */
  const tmpV = new THREE.Vector3();

  /**
   * 采样 [t0,T] 的两侧接地点序列并推进路径态（coverage 空洞断链；阵亡后静止不再出段）。
   *
   * **固定网格喂样**（review P2 2026-10-11）：只喂**完整 0.1 s 网格片**（片界按 [START] 对齐），
   * 且首点固定为 t0 时刻的横截面——片内交会点的插值只依赖片界样本 ⇒ seek 重算与逐帧连续
   * 播放**逐值一致**。旧实现从任意帧的 builtT 重切网格、首锚取第一次子步的 tt：首锚随帧
   * 时刻漂移（实测同一直线同终点：一次 seek 首锚 z=0.5/t=0.3，60fps 泵 z=0.083/t=0.217，
   * 转弯处几何还有差异）。不足整片的尾巴**留待下次**：返回值为最后已喂的网格时刻（不是 T），
   * 调用方以此作 builtT——尾巴在网格片完成前不上屏，语义与"逐帧推进"等价。
   *
   * @returns {number} 已喂到的回放时刻（网格对齐；无完整片可喂时 = t0）
   */
  function feedTrail(v: RuntimeVehicle, tr: { L: TrailState; R: TrailState; builtT: number }, t0: number) {
    const tread = v.tread!;
    const space = tread.space;
    const hwL = trailHalfGauge(v, 'L'), hwR = trailHalfGauge(v, 'R');
    const def = v.def;
    const pendL: Array<{ x: number; z: number; t: number; yaw: number }> = [];
    const pendR: Array<{ x: number; z: number; t: number; yaw: number }> = [];
    let broken = false;
    // flush = 纯批次收尾（只把已在批内的点喂给 advanceTrail），**不再兼职复位**——
    // 复位一律由调用点在"断链时刻"显式执行（2026-10-11 review blocker：旧写法把复位藏在
    // flush 的 `if (broken)` 里，而进入空洞的首帧 broken 还是 false ⇒ 不复位 ⇒ 出空洞的
    // 首点仍挂空洞前的旧锚，桥接出一段横跨空洞的长印记，违背"跨空洞不连铺"契约）。
    const flush = () => {
      if (pendL.length) advanceTrail(tr.L, pendL, space, TRAIL_CAP_PER_SIDE);
      if (pendR.length) advanceTrail(tr.R, pendR, space, TRAIL_CAP_PER_SIDE);
      pendL.length = 0; pendR.length = 0;
    };
    /** 单点：阵亡/可见性过滤后按该时刻位姿推两侧接地点（yaw 随点携带，横截面戳据此定向） */
    const pushPoint = (tt: number) => {
      // 阵亡期：残骸不出段，且必须**断链**——复活会把车放到新位置（或渐进迁移），若沿用死前锚，
      // 复活后的首个接地点会与死前锚连铺，跨阵亡期盖出一段长印记（3.1.0 review P2，issue #622）。
      // 与 AoI 空洞同语义：历史印记保留，出阵亡期从新锚开始。
      if (defLifeAt(def, tt)?.lifeState === 'DESTROYED') {
        if (!broken) {
          flush();
          resetTrailState(tr.L);
          resetTrailState(tr.R);
          broken = true;
        }
        return;
      }
      if (!deps.visibleAt(v, tt)) {                           // AoI 外：断链（跨空洞不连铺）
        if (!broken) {
          flush();
          resetTrailState(tr.L);                              // 显式复位：出空洞从新锚开始
          resetTrailState(tr.R);
          broken = true;
        }
        return;
      }
      broken = false;
      deps.vehicles.posAt(v, tt, tmpV);
      const yaw = deps.vehicles.yawAt(v, tt);
      const fx = -Math.sin(yaw), fz = Math.cos(yaw);          // 场景系前向（group.rotation.y = −yaw）
      const rx = -fz, rz = fx;                                // 横向（左右对称，命名不承载语义）
      pendL.push({ x: tmpV.x - rx * hwL, z: tmpV.z - rz * hwL, t: tt, yaw });
      pendR.push({ x: tmpV.x + rx * hwR, z: tmpV.z + rz * hwR, t: tt, yaw });
    };
    // 首锚 = t0 横截面（固定起始面；t0 落在空洞/阵亡内时由出空洞的首个可见点建锚）
    pushPoint(t0);
    const START = deps.getStart();
    const k0 = Math.round((t0 - START) / GRID_DT);
    const kEnd = Math.floor((deps.getT() - START) / GRID_DT + 1e-9);
    let fedTo = t0;
    for (let k = Math.max(0, k0); k < kEnd; k++) {
      const tA2 = START + k * GRID_DT, tB2 = START + (k + 1) * GRID_DT;
      const pa = deps.vehicles.posAt(v, tA2, tmpV); const ax = pa.x, az = pa.z;
      const pb = deps.vehicles.posAt(v, tB2, tmpV); const bx = pb.x, bz = pb.z;   // 先取值：子步 posAt 覆写 tmpV
      const segLen = Math.hypot(bx - ax, bz - az);
      if (segLen > 2.5) {
        // 大步 = 断链（出生摆放 / AoI 传送 / pose_kf 保持-跳变）：跨过去不铺印，
        // 否则位姿折线被 stamp 成一小段斜折线（用户报"刚进入对局时印记有一小段折线"）
        flush();
        resetTrailState(tr.L);
        resetTrailState(tr.R);
        fedTo = tB2;          // 断链片已消费：不补点，下一片的点从新锚开始
        continue;
      }
      // 自适应子步：步内弧长 ≤ ~0.6 m（高速时 0.1 s 网格步会到 2 m+，段方向成弦切角）
      const nSub = Math.min(6, Math.max(1, Math.ceil(segLen / 0.6)));
      for (let s = 1; s <= nSub; s++) pushPoint(tA2 + (GRID_DT * s) / nSub);
      fedTo = tB2;
    }
    flush();
    return fedTo;
  }

  /**
   * 路径态 → GPU Buffer（#820 Wave B4A 出仓到 ./playback/treadBufferWriter.ts）。
   * 本文件保留调度与门控职责：terrain 高度采样选择（heightField 就绪与否）、回放时钟 T、
   * 槽位常量与 needsUpdate 上传门控；槽位编排/显示权/fround 量化在新模块。
   */
  function writeTrailQuads(v: RuntimeVehicle, tr: { L: TrailState; R: TrailState; builtT: number }) {
    const mesh = v.treadMesh!
    const geo = mesh.geometry;
    if (writeTreadBuffer(treadBufferInput(v, tr))) {
      (geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      (geo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    }
  }

  /** 输入装配：显式参数逐帧取自场景事实（无二次状态副本）。 */
  function treadBufferInput(v: RuntimeVehicle, tr: { L: TrailState; R: TrailState; builtT: number }): TreadBufferInput {
    const tread = v.tread!;
    return {
      geometry: v.treadMesh!.geometry,
      trail: tr,
      width: tread.width,
      texScale: tread.texScale,
      now: deps.getT(),
      heightAt: deps.heightFieldReady() ? deps.heightAt : () => 0,
      cap: TRAIL_CAP_PER_SIDE,
      slots: TRAIL_SLOTS,
    };
  }

  /** 寿命老化扫描（出仓同上）：color 通道按各戳自身出生时刻刷新，门控同原实现。 */
  function ageTrailAlphas(v: RuntimeVehicle, tr: { L: TrailState; R: TrailState; builtT: number }) {
    if (ageTreadBuffer(treadBufferInput(v, tr))) {
      ((v.treadMesh!.geometry.getAttribute("color")) as THREE.BufferAttribute).needsUpdate = true;
    }
  }

  function updateTrails() {
    if (!deps.getData()) return;
    const on = deps.store.treadOn && !!deps.quality().treadMarks;   // 仅高清/极致（低档车模轨距与印记口径不一致）
    for (const v of deps.getVehicles()) {
      const tr = v.trail;
      if (!tr) continue;
      if (v.treadMesh) v.treadMesh.visible = on;
      if (!on) {
        // 关断期间不推进游标：重开时从 START 全量补铺（印记 = 全程确定性重算）。
        // ⚠️ 路径态必须**一起复位**（review P2 2026-10-11）：旧写法只回退 builtT，重开时
        // 整条路径被追加到旧末端——反向桥接、重复段、出生时刻非单调，后面的时间二分也失去
        // 前提（实测同一 t=52 关→seek→开→seek 后每侧段数 49 → 148）。
        if (tr.builtT !== -Infinity || tr.L.total || tr.R.total) {
          resetTrailState(tr.L); resetTrailState(tr.R);
          tr.builtT = -Infinity;
        }
        continue;
      }
      if (!v.tread || !v.treadMesh) continue;   // 参数/网格未就绪：builtT 保持 -∞，就绪后全量补铺
      // 宽度晚到（review P2 2026-10-11）：参数 JSON 通常早于 GLB 到达，未 authored 车首解析
      // 时无 suspension 实测（beltW=0）⇒ 宽度被锁成常量回落。模型挂载实测就位后在此重解析，
      // 变了就复位全量重建（旧段是按旧宽度铺的，混宽会视觉分层）。authored 车恒用 manual_width。
      if (!v.tread.authoredWidth) {
        const w = resolvedTreadWidth(v);
        if (Math.abs(w - v.tread.width) > 1e-3) {
          v.tread.width = w;
          resetTrailState(tr.L); resetTrailState(tr.R);
          tr.builtT = -Infinity;
        }
      }
      if (deps.getT() < tr.builtT) {            // seek 后退：全量重算（destructibles 同构）
        resetTrailState(tr.L); resetTrailState(tr.R);   // written 随复位归零 ⇒ 全量重写实例
        tr.builtT = -Infinity;
      }
      const t0 = Math.max(tr.builtT, deps.getStart());
      tr.builtT = feedTrail(v, tr, t0);          // 返回最后已喂网格时刻；不足整片的尾巴留待下次
      writeTrailQuads(v, tr);
      ageTrailAlphas(v, tr);
    }
  }

  /** buildVehicles 的逐车履带装配段（原 `if (Q.treadMarks) { Promise.all(...) }` 块逐字迁入；
   *  车辆模块保持 tread-free，经 deps.treadAttachVehicle 委托到这里）。 */
  function attachVehicle(v: RuntimeVehicle) {
    if (!deps.quality().treadMarks) return;
    const def = v.def;
    Promise.all([treadParamsFor(def.tank_id), treadMetaFor()]).then(([tp, meta]) => {
      if (deps.destroyed() || !v.trail) return;
      // 宽度解析（客户端语义：forceManualWidth=false ⇒ 从履带几何现算）：
      // authored → 模型履带盒实测（suspParts.beltW）→ 常量回落。
      // ⚠️ 此刻 suspension 往往还没就位（参数 JSON 早于 GLB 到达），未 authored 车会先
      // 落到常量回落；`authoredWidth:false` 标记让 updateTrails 在 beltW 就位后**重解析
      // 并全量重建**（review P2 2026-10-11：旧写法把宽度永久锁成 0.6）。
      v.tread = {
        ...tp,
        authoredWidth: tp.width != null,
        width: tp.width != null ? tp.width : resolvedTreadWidth(v),
        texScale: treadScaleFor(meta, tp.texture),
      };
      ensureTreadMesh(v, v.tread);
      deps.invalidate();   // 参数晚到：下一帧从 -∞ 全量补铺（builtT 未推进过，无空洞）
    }).catch((e: unknown) => {
      // fail-soft：资产源未配置（assetProvider.url 抛错）/贴图装配异常 ⇒ 该车无印记，
      // 绝不冒未处理拒绝（2026-10-11 CI 复盘：vitest 以 unhandled error 判失败——本机
      // .env.local 掩盖了无资产源形态；会话/地图资产链路本身有各自的错误呈现）。
      console.warn('[playback] 履带印装配失败（该车无印记）tank=' + def.tank_id + ':', e);
    });
  }

  /** 会话 teardown：逐车 treadMesh 回收 + 缓存释放（原 teardownSession 车辆循环内的履带段
   *  与 treadParamCache/treadTexCache 段逐字保留；宿主先调本方法再调 vehicles.dispose()）。 */
  function dispose() {
    const scene = deps.getScene();
    for (const v of deps.getVehicles()) {
      // 履带印：几何/材质逐车持有，贴图会话共享（treadTexCache 统一释放）
      if (v.treadMesh) {
        scene?.remove(v.treadMesh);
        v.treadMesh.geometry.dispose();
        const mat = v.treadMesh.material as THREE.Material
        mat.dispose();
        v.treadMesh = null;
      }
      v.tread = null;
      v.trail = null;
    }
    treadParamCache.clear();
    for (const tex of treadTexCache.values()) tex.dispose();
    treadTexCache.clear();
  }

  return {
    attachVehicle,
    updateTrails,
    dispose,
  };
}
