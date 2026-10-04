/**
 * 跳弹续飞 GPU 求交数据包（装甲查看器热力图 v5.2，网格加速版）：
 * 装甲板 + 外部模块的碰撞几何 → 世界系均匀网格（cell 条目表 + 条目表 + 世界
 * 三角形顶点三张浮点纹理），供热力图低清类通道 pass 在跳弹分支做 DDA 求交 +
 * 续飞层链模拟（只测路径 cell 内三角形，~10² 级；全量逐三角形扫描是 v5.1 的
 * 性能事故，已废弃）。网格随炮塔/配置变化重建（相机移动不重建），静止视图
 * 复用上一帧类通道 RT——开销与原热力图同量级。
 *
 * 语义对齐：续飞段 = penetration.js `calculate(allow_ricochet=false)` 的出射段
 * （即点击判定跳弹后 judgePenetration 二次判定的内核）——外部模块按 variant
 * 去重 + flat 消耗、间隙/主装甲角度等效 + 2×口径增强转正、强制不跳弹、
 * 严格大于才穿透、末层状态定结论；反射线几何口径 = 点击链的出射 raycaster
 * （起点=跳弹点无偏移、近段仅滤数值自命中、射程 60m、不看 gun 裁剪面、
 * FrontSide 背面剔除）。
 *
 * 单一事实来源：所有数值常量只在本文件 RC 定义；GLSL 常量串由它生成注入
 * tankViewer 的 PBR_FRAG——着色器里禁止手写这些字面量。
 *
 * 本模块同时导出 JS 参考实现（raycastPackAll / simulateContinuation，暴力全量、
 * 与 GLSL 网格版语义等价），供单测对拍 THREE.Raycaster 与 penetration.js
 * （等价性锁）及浏览器差分调试（window.__armorRicochet.predict/readClass）。
 *
 * 坐标口径：buildPack 打包网格局部三角形（几何属性原样）；buildRicochetGrid
 * 以当前 matrixWorld 变换到世界系建网格。打包时逐网格校验矩阵刚性（缩放≈1），
 * 非刚性/超限/网格过密 → fail-closed，调用方禁用续飞（跳弹维持紫色 = 现状）。
 */
import * as THREE from 'three';

/** 续飞链常量（GLSL 与 JS 参考实现共用；改这里即改两边） */
export const RC = Object.freeze({
    /** 续飞射程（点击链出射 Raycaster far=60） */
    FAR: 60.0,
    /**
     * 续飞射线【初始命中接受阈】（评审 P1：click / JS 参考 / GLSL 三路唯一语义常量）：
     * 反射线上 t ≤ 该值的命中一律滤除——只是滤数值级自命中（0.1mm），不是"推进步长"。
     * 起点=跳弹点（BlitzKit 对齐，无偏移）；BlitzKit 无过滤但依赖浮点侥幸，这里确定性兜底。
     * 原实现 0.05 偏移 + 0.1m 窗口曾把接缝另一侧板丢弃（接缝点击 bug 根因）。
     * 三路一致口径：click `hit.distance <= RC.MIN_CONTINUATION_T → 滤`、
     * JS `raycastPackAll(..., RC.MIN_CONTINUATION_T)`、GLSL `tStart = max(tStart, RC_TSKIP)`。
     */
    MIN_CONTINUATION_T: 0.0001,
    /**
     * 【层推进 eps】（评审 P1 拆出）：仅用于"已命中一层之后"的推进——下一层必须比
     * 已吞掉的层严格更远（DDA 游标 tCur = bestT + ADV、cell 窗口上界容差），
     * 不得叠加到初始接受阈上（此前 tStart = TSKIP + T_EPS = 0.2mm → 三路阈值不一致）。
     */
    ADVANCE_EPSILON: 0.0001,
    /** 兼容别名（GLSL 定义名不变） */
    ORIGIN_OFFSET: 0.0,
    /** 跳弹剩余穿深系数（penetration.js ricochetRemainingPen = remaining*0.75） */
    RICO_REMAIN_MUL: 0.75,
    /** 层链上限（碰撞模型实际 ≤4/射线；超限按"无续飞"保守处理=维持紫） */
    MAX_LAYER: 8,
    /** DDA 步进上限 = RC_GRID_DIM_MAX×3（144）：cell 交叉上界 = dims.x+dims.y+dims.z ≤ 48×3 */
    MAX_STEPS: 144,
    /** 单 cell 条目上限（构建器超限自动放粗 cell；着色器循环常量上界） */
    MAX_CELL_ENTRIES: 256,
    /** 单片元求交全局纹理取数预算（正常路径 ~300；超预算保守返回紫——防着色器执行超时被驱动杀 draw） */
    FETCH_BUDGET: 1024,
    /** 顶点纹理每行 texel 数（= 256 三角形 × 3 顶点，着色器与打包器共用） */
    TRI_ROW: 768,
    /** cell 纹理每行 texel 数 */
    CELL_ROW: 256,
    /** 条目纹理每行 texel 数 */
    ENTRY_ROW: 1024,
    /** 网格目标 cell 尺寸（米；重建时超限自动 ×2 放粗） */
    GRID_CELL_SIZE: 0.45,
    /** 网格各轴 cell 数上限（纹理行数与步进常量的约束） */
    GRID_DIM_MAX: 48,
    MAX_MESH: 128,
    MAX_TRI_PER_MESH: 256,
    /** ±5% 显示概率带（与主着色器 rand = rem*0.05 同源） */
    BAND: 0.05,
    /** 90° 防 f32 负 cos 下限（penetration.js 同值） */
    COS_EPS: 1e-6,
    /** 2×口径增强转正系数（BlitzKit/penetration.js 同源） */
    TWO_CAL_NORM: 1.4,
    /** 装甲 section 码（texel0.w；primary = 码≤2，外部模块 = 码≥4） */
    SECTION: Object.freeze({ hull: 0, turret: 1, gun: 2, spaced: 3, chassis: 4, gunBarrel: 5 }),
    /** 外部模块 variant 去重位（texel2.z） */
    VARIANT_BIT: Object.freeze({ track: 1, gun: 2 }),
});

/** GLSL 常量声明（注入 PBR_FRAG；由 RC 生成，禁止手写数值） */
export const RC_GLSL_CONST = `
// ==== 跳弹续飞常量（单一来源 armorCollisionPack.js RC；禁止手改数值）====
#define RC_FAR ${RC.FAR.toFixed(1)}
#define RC_OFF ${RC.ORIGIN_OFFSET.toFixed(6)}
#define RC_TSKIP ${RC.MIN_CONTINUATION_T.toFixed(6)}
#define RC_ADV_EPS ${RC.ADVANCE_EPSILON.toFixed(6)}
#define RC_RICO_MUL ${RC.RICO_REMAIN_MUL.toFixed(3)}
#define RC_MAX_LAYER ${RC.MAX_LAYER}
#define RC_MAX_STEPS ${RC.MAX_STEPS}
#define RC_BUDGET ${RC.FETCH_BUDGET}
#define RC_MAX_CELL ${RC.MAX_CELL_ENTRIES}
#define RC_TRI_ROW ${RC.TRI_ROW}
#define RC_TRI_ROW_I ${RC.TRI_ROW}
#define RC_CELL_ROW ${RC.CELL_ROW}
#define RC_CELL_ROW_I ${RC.CELL_ROW}
#define RC_ENTRY_ROW ${RC.ENTRY_ROW}
#define RC_ENTRY_ROW_I ${RC.ENTRY_ROW}
#define RC_BAND ${RC.BAND.toFixed(3)}
#define RC_COS_EPS ${RC.COS_EPS.toFixed(8)}
#define RC_TWO_CAL ${RC.TWO_CAL_NORM.toFixed(1)}
#define RC_SEC_HULL ${RC.SECTION.hull}
#define RC_SEC_SPACED ${RC.SECTION.spaced}
#define RC_SEC_CHASSIS ${RC.SECTION.chassis}
`;

/**
 * GLSL 续飞实现（uniforms + rcContinue），注入 PBR_FRAG 的 main() 之前。
 * 依赖主着色器既有 uniform：caliber / normalization（弧度）。
 * 精度：几何量全部显式 highp（全局默认 mediump，f16 级精度撑不住求交）。
 */
export const RC_GLSL_FUNCS = `
// ==== 跳弹续飞：反射线网格 DDA 求交 + 出射段层链（语义=penetration.js calculate(allow_ricochet=false)）====
// 数据面：世界系均匀网格（炮塔/配置变化时 CPU 重建上传）——每 cell 一条目表（triSlot+section+thickness），
// 世界系三角形顶点纹理。着色器沿 DDA 步进，只测路径覆盖的 cell 内三角形（~10² 级，替代全量 10³ 级扫描），
// 命中天然按 t 有序（无需逐层重扫）；背面剔除 = Raycaster FrontSide 口径（绕序法线）。
uniform int rcMode;                 // 1/2=全分辨率逐像素续飞（v5.3） 0=关闭
uniform float rcThickMul;
uniform highp sampler2D rcWorldTris;  // 世界系顶点：每 texel 一顶点 (x,y,z)（网格重建时上传）
uniform float rcTriRows;
uniform highp sampler2D rcGridCells;   // 每 cell 1 texel: (entryOffset, entryCount)
uniform highp sampler2D rcGridEntries; // 每条目 1 texel: (triSlot, sectionCode, thickness, 0)
uniform vec3 rcGridMin;
uniform float rcCell;
uniform vec3 rcGridDimsF;
uniform float rcCellRows;
uniform float rcEntryRows;
uniform int rcEntryTotal;

highp vec3 rcVertW(int vid) {
    return texelFetch(rcWorldTris, ivec2(vid % RC_TRI_ROW_I, vid / RC_TRI_ROW_I), 0).xyz;
}
highp vec4 rcCellAt(int idx) {
    return texelFetch(rcGridCells, ivec2(idx % RC_CELL_ROW_I, idx / RC_CELL_ROW_I), 0);
}
highp vec4 rcEntryAt(int idx) {
    return texelFetch(rcGridEntries, ivec2(idx % RC_ENTRY_ROW_I, idx / RC_ENTRY_ROW_I), 0);
}
// Möller–Trumbore（世界系；t ∈ (tLo, tHi]；背面剔除）
bool rcTriW(int slot, highp vec3 ro, highp vec3 rd, highp float tLo, highp float tHi, out highp float tHit) {
    highp vec3 a = rcVertW(slot * 3), b = rcVertW(slot * 3 + 1), c = rcVertW(slot * 3 + 2);
    highp vec3 e1 = b - a, e2 = c - a;
    if (dot(cross(e1, e2), rd) >= 0.0) return false;
    highp vec3 pv = cross(rd, e2);
    highp float det = dot(e1, pv);
    if (abs(det) < 1e-9) return false;
    highp float invD = 1.0 / det;
    highp vec3 tv = ro - a;
    highp float u = dot(tv, pv) * invD;
    if (u < 0.0 || u > 1.0) return false;
    highp vec3 qv = cross(tv, e1);
    highp float v = dot(rd, qv) * invD;
    if (v < 0.0 || u + v > 1.0) return false;
    highp float t = dot(e2, qv) * invD;
    if (t <= tLo || t > tHi) return false;
    tHit = t;
    return true;
}
// 出射段层链（网格 DDA 在线推进）。返回 0=无续飞(维持紫) 1=续飞击穿(绿, penOut=±5%带概率) 2=续飞被挡(红)
int rcContinue(highp vec3 bouncePos, highp vec3 reflDir, highp float remIn, out highp float penOut, out highp float rcDiag) {
    penOut = 0.0;
    rcDiag = 0.0;
    highp vec3 ro = bouncePos + reflDir * RC_OFF;
    // 整车包围盒（= 网格包围盒）裁剪：反射线不穿整车 → 直接无续飞（掠射视角下大多数
    // 跳弹反射向空处，一次 AABB 测试代替求交）
    ivec3 dims = ivec3(rcGridDimsF);
    highp vec3 gMax = rcGridMin + rcGridDimsF * rcCell;
    highp vec3 ginv = 1.0 / reflDir;
    highp vec3 ga = (rcGridMin - ro) * ginv;
    highp vec3 gb = (gMax - ro) * ginv;
    highp vec3 gsm = min(ga, gb), gbg = max(ga, gb);
    highp float tEnd = min(min(gbg.x, gbg.y), gbg.z);
    highp float tStart = max(max(gsm.x, gsm.y), gsm.z);
    if (tEnd <= RC_TSKIP) return 0;
    tStart = max(tStart, RC_TSKIP);    // 初始接受阈（三路一致）：t > RC_TSKIP 才接受（rcTriW 的 t<=tLo 滤）
    if (tStart >= tEnd) return 0;
    // DDA 初始化（Amanatides & Woo）
    highp vec3 p0 = ro + reflDir * (tStart + RC_ADV_EPS * 4.0);
    ivec3 cell = clamp(ivec3(floor((p0 - rcGridMin) / rcCell)), ivec3(0), dims - ivec3(1));
    ivec3 stp = ivec3(reflDir.x > 0.0 ? 1 : (reflDir.x < 0.0 ? -1 : 0),
                      reflDir.y > 0.0 ? 1 : (reflDir.y < 0.0 ? -1 : 0),
                      reflDir.z > 0.0 ? 1 : (reflDir.z < 0.0 ? -1 : 0));
    highp vec3 nb = rcGridMin + (vec3(cell) + max(vec3(stp), vec3(0.0))) * rcCell;
    highp vec3 tMax = vec3(1e30);
    if (stp.x != 0) tMax.x = (nb.x - ro.x) / reflDir.x;
    if (stp.y != 0) tMax.y = (nb.y - ro.y) / reflDir.y;
    if (stp.z != 0) tMax.z = (nb.z - ro.z) / reflDir.z;
    highp vec3 tDelta = abs(rcCell / reflDir);
    highp float tCur = tStart;         // 层游标：剩余命中须 t > tCur（吞层后 tCur = bestT + RC_ADV_EPS）
    bool anyPrimary = false;           // 前端门：整条射线存在主装甲原始命中（ricHasPrimary）
    bool blocked = false;              // 链中途被挡（待定：anyPrimary→红 否则紫）
    highp float rem = remIn;
    int variantSeen = 0;
    int prevTri = -1;                  // 同三角形跨 cell 重复列表去重（凸区域连续出现）
    int L = 0;
    int budget = RC_BUDGET;            // 全局取数预算：超出即保守退出（防执行超时杀 draw）
    for (int s = 0; s < RC_MAX_STEPS; s++) {
        if (budget <= 0) return 0;
        highp float tCell = min(min(tMax.x, tMax.y), tMax.z);
        highp float hi = min(tCell + RC_ADV_EPS, tEnd);
        int cidx = cell.x + dims.x * (cell.y + dims.y * cell.z);
        highp vec4 cel = rcCellAt(cidx);
        int cnt = int(cel.y + 0.5);
        int off = int(cel.x + 0.5);
        // 当前 cell 窗口 (tCur, hi] 内逐层收集（同一 cell 可含多层）
        for (int l = 0; l < RC_MAX_LAYER; l++) {
            if (L >= RC_MAX_LAYER) return 0;            // 层上限 → 保守紫
            highp float bestT = hi;
            int bestSlot = -1;
            highp vec4 bestEnt = vec4(0.0);
            for (int e = 0; e < RC_MAX_CELL; e++) {
                if (e >= cnt) break;
                budget -= 1;
                if (budget < 0) return 0;
                highp vec4 ent = rcEntryAt(off + e);
                int slot = int(ent.x + 0.5);
                if (slot == prevTri) continue;
                highp float tHit;
                if (rcTriW(slot, ro, reflDir, tCur, hi, tHit) && tHit < bestT) {
                    bestT = tHit; bestSlot = slot; bestEnt = ent;
                }
            }
            if (bestSlot < 0) break;                    // 本 cell 无更多层 → 前进
            prevTri = bestSlot;
            int sec = int(bestEnt.y + 0.5);
            highp float th = bestEnt.z * rcThickMul;
            if (sec <= 2) anyPrimary = true;            // 主装甲原始命中在场（无论链是否已断）
            if (blocked) {
                if (anyPrimary) return 2;
                tCur = bestT + RC_ADV_EPS; continue;
            }
            if (sec >= RC_SEC_CHASSIS) {                // 外部模块：variant 去重 + flat 消耗
                int vbit = (sec == RC_SEC_CHASSIS) ? 1 : 2;
                if ((variantSeen & vbit) != 0) { tCur = bestT + RC_ADV_EPS; continue; }   // 同 variant 已消耗（不计层）
                variantSeen |= vbit;
                if (rem > th) { rem -= th; tCur = bestT + RC_ADV_EPS; continue; }          // 穿过模块（不计层）
                blocked = true;                         // 模块挡下：余下只查主装甲存在性
                tCur = bestT + RC_ADV_EPS; continue;
            }
            // 间隙/主装甲：角度等效 + 2×口径增强转正；出射段强制不跳弹（threeCal 恒真）
            highp vec3 a = rcVertW(bestSlot * 3), b = rcVertW(bestSlot * 3 + 1), c = rcVertW(bestSlot * 3 + 2);
            highp vec3 nW = normalize(cross(b - a, c - a));   // 背面已剔除，恒朝来向 = face.normal 同口径
            highp float cosA = min(abs(dot(nW, reflDir)), 1.0);
            highp float angle = acos(cosA);
            bool twoCal = caliber > th * 2.0;
            highp float normR = twoCal ? (RC_TWO_CAL * normalization * caliber) / (2.0 * th) : normalization;
            highp float finA = max(angle - normR, 0.0);
            highp float eff = th / max(cos(finA), RC_COS_EPS);
            bool layPen = rem > eff;                    // 严格大于才穿透（penetration.js 同）
            if (sec <= 2) {                             // 主装甲 = 末层，定结论
                if (layPen) {
                    highp float randB = rem * RC_BAND;  // ±5% 带显示概率（与主图公式同源）
                    penOut = clamp(1.0 - ((eff - rem) + randB) / (2.0 * randB), 0.0, 1.0);
                    return 1;
                }
                return 2;
            }
            if (!layPen) { blocked = true; tCur = bestT + RC_ADV_EPS; continue; }
            rem -= eff;
            tCur = bestT + RC_ADV_EPS;
            L++;                                        // 消耗一层才计数
        }
        // 前进到下一 cell
        if (tMax.x <= tMax.y && tMax.x <= tMax.z) { cell.x += stp.x; tCur = max(tCur, tMax.x); tMax.x += tDelta.x; }
        else if (tMax.y <= tMax.z) { cell.y += stp.y; tCur = max(tCur, tMax.y); tMax.y += tDelta.y; }
        else { cell.z += stp.z; tCur = max(tCur, tMax.z); tMax.z += tDelta.z; }
        if (cell.x < 0 || cell.x >= dims.x || cell.y < 0 || cell.y >= dims.y || cell.z < 0 || cell.z >= dims.z) break;
        if (tCur >= tEnd) break;
    }
    if (blocked) return anyPrimary ? 2 : 0;
    return 0;
}
`;

const PRIMARY_SECTIONS = new Set(['hull', 'turret', 'gun']);
const MODULE_SECTIONS = new Set(['chassis', 'gunBarrel']);
const VARIANTS = { chassis: RC.VARIANT_BIT.track, gunBarrel: RC.VARIANT_BIT.gun };

/**
 * 打包碰撞几何。entries: [{ mesh, section('hull'|'turret'|'gun'|'spaced'|'chassis'|'gunBarrel'),
 * thickness(基础厚度), variant('track'|'gun'|null, 模块去重用) }]。
 * 单网格三角形数超过 RC.MAX_TRI_PER_MESH 时按连续三角形段【分块】为多个包单元
 * （同 section/thickness/variant/矩阵）——命中集合与整网格完全一致；履带等多块
 * 同 variant 在判定链里照常去重，与点击链（raycaster 对整网格多命中 + variant 去重）等价。
 * 返回 { ok, reason?, meshCount(=包单元数), triTotal, triRows, triData, metaData, matsData }；
 * ok=false 表示超限/非刚性，调用方必须禁用续飞（fail-closed）。
 */
export function buildPack(entries) {
    const units = [];   // 打包单元：{ mesh, section, thickness, variant, triStart, triCount }
    const triChunks = [];
    const metaOut = [];
    let triTotal = 0;
    const _pos = new THREE.Vector3();
    const _quat = new THREE.Quaternion();
    const _scale = new THREE.Vector3();
    for (const e of entries) {
        if (!PRIMARY_SECTIONS.has(e.section) && e.section !== 'spaced' && !MODULE_SECTIONS.has(e.section)) {
            return { ok: false, reason: 'bad-section:' + e.section };
        }
        const mesh = e.mesh;
        mesh.updateWorldMatrix(true, false);
        mesh.matrixWorld.decompose(_pos, _quat, _scale);
        // 刚性校验：着色器用 R^T 求逆，非刚性矩阵会让求交失真
        if (Math.abs(_scale.x - 1) > 1e-3 || Math.abs(_scale.y - 1) > 1e-3 || Math.abs(_scale.z - 1) > 1e-3) {
            return { ok: false, reason: 'non-rigid-matrix:' + (mesh.name || '?') };
        }
        const pos = mesh.geometry && mesh.geometry.attributes && mesh.geometry.attributes.position;
        if (!pos) continue;
        const idx = mesh.geometry.index;
        const triCountAll = Math.floor((idx ? idx.count : pos.count) / 3);
        if (triCountAll <= 0) continue;

        const secCode = RC.SECTION[e.section];
        const variantBit = VARIANTS[e.section] || 0;
        // 局部 AABB + 三角形顶点（局部坐标原样，无世界烘焙）；按段分块写入包单元
        const chunkCount = Math.ceil(triCountAll / RC.MAX_TRI_PER_MESH);
        const chunkTri = Math.ceil(triCountAll / chunkCount);
        const verts = new Float32Array(triCountAll * 9);
        // 顶点读取必须走抽象访问（getX/getY/getZ）：GLB 属性可能是 interleaved buffer，
        // 直接 pos.array[vi*3] 裸索引在交叉布局下会读到垃圾（包围盒错乱、求交全错）
        for (let t = 0; t < triCountAll; t++) {
            for (let k = 0; k < 3; k++) {
                const vi = idx ? idx.getX(t * 3 + k) : t * 3 + k;
                verts[t * 9 + k * 3] = pos.getX(vi);
                verts[t * 9 + k * 3 + 1] = pos.getY(vi);
                verts[t * 9 + k * 3 + 2] = pos.getZ(vi);
            }
        }
        for (let c = 0; c < chunkCount; c++) {
            if (units.length >= RC.MAX_MESH) return { ok: false, reason: 'too-many-meshes' };
            const from = c * chunkTri;
            const to = Math.min(from + chunkTri, triCountAll);
            const n = to - from;
            if (n <= 0) break;
            let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
            for (let t = from; t < to; t++) {
                for (let k = 0; k < 3; k++) {
                    const x = verts[t * 9 + k * 3], y = verts[t * 9 + k * 3 + 1], z = verts[t * 9 + k * 3 + 2];
                    if (x < minX) minX = x; if (x > maxX) maxX = x;
                    if (y < minY) minY = y; if (y > maxY) maxY = y;
                    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
                }
            }
            metaOut.push(minX, minY, minZ, secCode, maxX, maxY, maxZ, triTotal, n, e.thickness, variantBit, 0);
            units.push({ mesh, section: e.section, thickness: e.thickness, variant: variantBit, triStart: triTotal, triCount: n, localFrom: from });
            triChunks.push(verts.subarray(from * 9, to * 9));
            triTotal += n;
        }
    }
    if (!units.length || !triTotal) return { ok: false, reason: 'empty' };

    // 顶点纹理数据：RGBA 每 texel 一顶点（xyz + 0）
    const texels = triTotal * 3;
    const triRows = Math.ceil(texels / RC.TRI_ROW);
    const triData = new Float32Array(triRows * RC.TRI_ROW * 4);
    let w = 0;
    for (const chunk of triChunks) {
        for (let i = 0; i < chunk.length; i += 3) {
            triData[w] = chunk[i]; triData[w + 1] = chunk[i + 1]; triData[w + 2] = chunk[i + 2];
            w += 4;
        }
    }
    const metaData = new Float32Array(metaOut);
    const meshes = units.map(u => u.mesh);
    const matsData = new Float32Array(units.length * 16);
    updatePackMatrices({ meshes, matsData, metaData });
    return { ok: true, units, meshes, meshCount: units.length, triTotal, triRows, triData, metaData, matsData };
}

/**
 * 每帧把 pack.meshes 的当前世界矩阵写入矩阵纹理数据，并计算整车世界包围盒
 * （pack.worldMin/worldMax，供着色器早退 uniform）。tankViewer 渲染循环调用。
 */
export function updatePackMatrices(pack) {
    if (!pack || !pack.meshes) return;
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    const withAabb = !!pack.metaData;   // buildPack 内部先于 metaData 落盘调用（只写矩阵）
    const corner = new THREE.Vector3();
    for (let i = 0; i < pack.meshes.length; i++) {
        const m = pack.meshes[i];
        m.updateWorldMatrix(true, false);
        m.matrixWorld.toArray(pack.matsData, i * 16);
        if (!withAabb) continue;
        const base = i * 12;
        const lo = [pack.metaData[base], pack.metaData[base + 1], pack.metaData[base + 2]];
        const hi = [pack.metaData[base + 4], pack.metaData[base + 5], pack.metaData[base + 6]];
        for (let c = 0; c < 8; c++) {
            corner.set(c & 1 ? hi[0] : lo[0], c & 2 ? hi[1] : lo[1], c & 4 ? hi[2] : lo[2])
                .applyMatrix4(m.matrixWorld);
            if (corner.x < minX) minX = corner.x; if (corner.x > maxX) maxX = corner.x;
            if (corner.y < minY) minY = corner.y; if (corner.y > maxY) maxY = corner.y;
            if (corner.z < minZ) minZ = corner.z; if (corner.z > maxZ) maxZ = corner.z;
        }
    }
    if (withAabb) {
        pack.worldMin = [minX, minY, minZ];
        pack.worldMax = [maxX, maxY, maxZ];
    }
    if (pack.textures) pack.textures.matsTex.needsUpdate = true;
}


/**
 * 世界系均匀网格加速结构（GPU DDA 求交数据面）。
 * 以各单元【当前 matrixWorld】把三角形变换到世界系：顶点写入 worldTrisData（全局
 * triSlot 与 pack 一致），三角形 AABB 覆盖的每个 cell 追加一条 entry（triSlot +
 * sectionCode + thickness）。炮塔/配置变化时重建（相机移动无需重建）——这就是
 * 着色器只测路径 cell 内三角形（~10² 级）代替全量扫描的结构基础。
 * cell 条目超限时按对半【细化】重试（0.45 → 0.225 → … → coverageFloor，最多 4 次尝试；
 * 细化降低单 cell 条目数），到覆盖下界仍超限 → ok=false（调用方禁用续飞，fail-closed）。
 */
export function buildRicochetGrid(pack) {
    if (!pack || !pack.ok || !pack.units) return { ok: false, reason: 'no-pack' };
    // 世界系顶点（全局 triSlot 布局）
    const worldVerts = new Float32Array(pack.triTotal * 9);
    const secOf = new Int32Array(pack.triTotal);
    const thOf = new Float32Array(pack.triTotal);
    const v = new THREE.Vector3();
    let nanCount = 0;
    for (let u = 0; u < pack.units.length; u++) {
        const unit = pack.units[u];
        const mesh = unit.mesh;
        mesh.updateWorldMatrix(true, false);
        const mw = mesh.matrixWorld;
        const pos = mesh.geometry.attributes.position;
        const idx = mesh.geometry.index;
        const secCode = RC.SECTION[unit.section];
        for (let t = 0; t < unit.triCount; t++) {
            const lt = unit.localFrom + t;
            const slot = unit.triStart + t;
            secOf[slot] = secCode;
            thOf[slot] = unit.thickness;
            for (let k = 0; k < 3; k++) {
                const vi = idx ? idx.getX(lt * 3 + k) : lt * 3 + k;
                v.set(pos.getX(vi), pos.getY(vi), pos.getZ(vi)).applyMatrix4(mw);
                if (!Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(v.z)) {
                    nanCount++;
                    v.set(0, 0, 0);   // 保持数组有限，包围盒不致 NaN 化
                }
                worldVerts[slot * 9 + k * 3] = v.x;
                worldVerts[slot * 9 + k * 3 + 1] = v.y;
                worldVerts[slot * 9 + k * 3 + 2] = v.z;
            }
        }
    }
    if (nanCount > 0) return { ok: false, reason: 'nan-verts:' + nanCount };
    // 稳健性诊断：包围盒异常膨胀时定位元凶单元（防单个坏矩阵拖垮整个网格）。
    // 阈值 80m：高于一切真实车辆几何（含长炮管整车 ~12m），只拦矩阵腐蚀的天文坐标；
    // 覆盖不变量测试（长几何 60m）不受影响。
    {
        let culprits = [];
        const bb = new THREE.Box3();
        const sz = new THREE.Vector3();
        for (let u = 0; u < pack.units.length; u++) {
            const unit = pack.units[u];
            bb.setFromObject(unit.mesh);
            if (bb.isEmpty()) continue;
            bb.getSize(sz);
            const diag = sz.length();
            if (diag > 80) culprits.push(`${unit.mesh.name || '?'}(${sz.x.toFixed(1)},${sz.y.toFixed(1)},${sz.z.toFixed(1)})`);
        }
        if (culprits.length) {
            return { ok: false, reason: 'bad-unit:' + culprits.slice(0, 3).join('|') + (culprits.length > 3 ? `+${culprits.length - 3}` : '') };
        }
    }
    // 世界包围盒
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < worldVerts.length; i += 3) {
        const x = worldVerts[i], y = worldVerts[i + 1], z = worldVerts[i + 2];
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    if (!Number.isFinite(minX)) return { ok: false, reason: 'empty' };
    const ext = [maxX - minX, maxY - minY, maxZ - minZ];
    // 覆盖不变量（评审 P1）：cellSize 下界 = max(extAxis)/GRID_DIM_MAX —— 该尺寸下任何轴
    // 都不超过 cell 数上限，网格恒覆盖全部几何；后续放细只在该下界之内，被截断的
    // capped 成功路径（GPU 网格 AABB 小于几何 → DDA 永不可达 → 静默紫）不可能再出现。
    const coverageFloor = Math.max(ext[0], ext[1], ext[2]) / RC.GRID_DIM_MAX;
    // 初始 cell 尺寸：目标 0.45m，但不低于覆盖下界（长几何抬高初始值）。注意这与覆盖下界
    // 是两个概念——此前把 GRID_CELL_SIZE 也并入 floor，初始 cell 恰等于 floor →
    // `cellSize/2 < floor` 恒真 → 密度细化重试的 attempt 2..4 成为死代码（评审 P1）。
    let cellSize = Math.max(RC.GRID_CELL_SIZE, coverageFloor);
    let dims, cells;
    for (let attempt = 0; attempt < 4; attempt++) {
        dims = [0, 1, 2].map(a => Math.min(RC.GRID_DIM_MAX, Math.max(1, Math.ceil((ext[a] + 1e-4) / cellSize))));
        const capped = dims.some((d, a) => d === RC.GRID_DIM_MAX && ext[a] / RC.GRID_DIM_MAX > cellSize);
        if (capped) return { ok: false, reason: 'grid-capped' };   // 防御断言：下界保证下不可达
        const total = dims[0] * dims[1] * dims[2];
        cells = new Map();
        let maxCnt = 0;
        for (let slot = 0; slot < pack.triTotal; slot++) {
            let tx0 = Infinity, ty0 = Infinity, tz0 = Infinity, tx1 = -Infinity, ty1 = -Infinity, tz1 = -Infinity;
            for (let k = 0; k < 3; k++) {
                const x = worldVerts[slot * 9 + k * 3], y = worldVerts[slot * 9 + k * 3 + 1], z = worldVerts[slot * 9 + k * 3 + 2];
                if (x < tx0) tx0 = x; if (x > tx1) tx1 = x;
                if (y < ty0) ty0 = y; if (y > ty1) ty1 = y;
                if (z < tz0) tz0 = z; if (z > tz1) tz1 = z;
            }
            const cx0 = Math.min(dims[0] - 1, Math.max(0, Math.floor((tx0 - minX) / cellSize)));
            const cx1 = Math.min(dims[0] - 1, Math.max(0, Math.floor((tx1 - minX) / cellSize)));
            const cy0 = Math.min(dims[1] - 1, Math.max(0, Math.floor((ty0 - minY) / cellSize)));
            const cy1 = Math.min(dims[1] - 1, Math.max(0, Math.floor((ty1 - minY) / cellSize)));
            const cz0 = Math.min(dims[2] - 1, Math.max(0, Math.floor((tz0 - minZ) / cellSize)));
            const cz1 = Math.min(dims[2] - 1, Math.max(0, Math.floor((tz1 - minZ) / cellSize)));
            for (let cz = cz0; cz <= cz1; cz++)
                for (let cy = cy0; cy <= cy1; cy++)
                    for (let cx = cx0; cx <= cx1; cx++) {
                        const ci = cx + dims[0] * (cy + dims[1] * cz);
                        let list = cells.get(ci);
                        if (!list) { list = []; cells.set(ci, list); }
                        list.push(slot);
                        if (list.length > maxCnt) maxCnt = list.length;
                    }
        }
        void total;
        if (maxCnt <= RC.MAX_CELL_ENTRIES) {
            // 展平：cellsData（offset,count）+ entriesData（triSlot,section,thickness,0）
            const cellTotal = dims[0] * dims[1] * dims[2];
            const cellsData = new Float32Array(cellTotal * 4);
            const entryLists = [...cells.entries()];
            let entryTotal = 0;
            for (const [, list] of entryLists) entryTotal += list.length;
            const entriesData = new Float32Array(entryTotal * 4);
            let off = 0;
            for (const [ci, list] of entryLists) {
                cellsData[ci * 4] = off;
                cellsData[ci * 4 + 1] = list.length;
                for (let i = 0; i < list.length; i++) {
                    const slot = list[i];
                    entriesData[(off + i) * 4] = slot;
                    entriesData[(off + i) * 4 + 1] = secOf[slot];
                    entriesData[(off + i) * 4 + 2] = thOf[slot];
                }
                off += list.length;
            }
            // 世界顶点纹理数据（RGBA 每 texel 一顶点）
            const triRows = Math.ceil((pack.triTotal * 3) / RC.TRI_ROW);
            const worldTrisData = new Float32Array(triRows * RC.TRI_ROW * 4);
            let w = 0;
            for (let i = 0; i < worldVerts.length; i += 3) {
                worldTrisData[w] = worldVerts[i];
                worldTrisData[w + 1] = worldVerts[i + 1];
                worldTrisData[w + 2] = worldVerts[i + 2];
                w += 4;
            }
            return {
                ok: true, dims, cellSize,
                gridMin: [minX, minY, minZ],
                cellTotal, entryTotal, triRows,
                cellsData, entriesData, worldTrisData,
            };
        }
        // 密度重试：只要还没到覆盖下界就继续对半细化（0.45 → 0.225 → … → coverageFloor，
        // 最多 4 次尝试）；细化到覆盖下界仍过密 → fail-closed（跳弹紫），不允许截断成功
        if (cellSize <= coverageFloor) break;
        cellSize = Math.max(cellSize / 2, coverageFloor);
    }
    return { ok: false, reason: 'grid-too-dense' };
}

/** 网格三张纹理（cell 表 / 条目表 / 世界顶点）。
 * 数据长度必须补齐到 w×h×4：行宽向上取整后纹理需求常大于有效数据，
 * 缓冲不足的 texImage2D 会触发 GL INVALID_OPERATION（1282）→ 纹理不完整 →
 * 采样恒零（条目表全零 → DDA 永不命中 → 跳弹区永久紫——本 bug 的根因）。 */
export function createGridTextures(grid) {
    const mk = (data, w, h) => {
        const need = w * h * 4;
        let buf = data;
        if (data.length < need) {
            buf = new Float32Array(need);
            buf.set(data);
        }
        const t = new THREE.DataTexture(buf, w, h, THREE.RGBAFormat, THREE.FloatType);
        t.minFilter = THREE.NearestFilter;
        t.magFilter = THREE.NearestFilter;
        t.generateMipmaps = false;
        t.needsUpdate = true;
        return t;
    };
    return {
        cellsTex: mk(grid.cellsData, RC.CELL_ROW, Math.ceil(grid.cellTotal / RC.CELL_ROW)),
        entriesTex: mk(grid.entriesData, RC.ENTRY_ROW, Math.ceil(grid.entryTotal / RC.ENTRY_ROW)),
        worldTrisTex: mk(grid.worldTrisData, RC.TRI_ROW, grid.triRows),
    };
}

const _inv = new THREE.Matrix4();

function meshData(pack, m) {
    const u = pack.units[m];
    const base = m * 12;
    return {
        sec: pack.metaData[base + 3],
        localFrom: u.localFrom,   // 该块在源几何内的起始三角形（分块网格 >256 三角形）
        triCount: u.triCount,
        thickness: u.thickness,
        variant: u.variant,
        aabbMin: [pack.metaData[base], pack.metaData[base + 1], pack.metaData[base + 2]],
        aabbMax: [pack.metaData[base + 4], pack.metaData[base + 5], pack.metaData[base + 6]],
        mesh: pack.meshes[m],
    };
}

/**
 * JS 参考实现：沿射线收集全部命中（不去重、不截断），t 从 ro 起量，世界系输出。
 * 与 THREE.Raycaster(intersectObjects) 同口径（AABB/求交顺序内各异但全量+按 t 排序）。
 * 供单测与差分调试；GLSL rcContinue 与本函数+simulateContinuation 同语义。
 */
export function raycastPackAll(pack, ro, dir, tMin = 0, tMax = RC.FAR) {
    const hits = [];
    for (let m = 0; m < pack.meshCount; m++) {
        const md = meshData(pack, m);
        if (md.triCount <= 0) continue;
        const mw = md.mesh.matrixWorld;
        _inv.copy(mw).invert();
        const lro = new THREE.Vector3(ro.x, ro.y, ro.z).applyMatrix4(_inv);
        // 方向的世界→局部同样过逆矩阵（transformDirection(mw) 是局部→世界，方向会反）
        const lrd = new THREE.Vector3(dir.x, dir.y, dir.z).transformDirection(_inv);
        // 局部 AABB slab
        let tmin = -Infinity, tmax = Infinity;
        let miss = false;
        for (let a = 0; a < 3; a++) {
            const o = a === 0 ? lro.x : a === 1 ? lro.y : lro.z;
            const d = a === 0 ? lrd.x : a === 1 ? lrd.y : lrd.z;
            const lo = md.aabbMin[a], hi = md.aabbMax[a];
            if (Math.abs(d) < 1e-12) {
                if (o < lo || o > hi) { miss = true; break; }
                continue;
            }
            let t1 = (lo - o) / d, t2 = (hi - o) / d;
            if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
            if (t1 > tmin) tmin = t1;
            if (t2 < tmax) tmax = t2;
        }
        // 与 GLSL 同式：窗口 (tMin, tMax) 相交即保留（平面类零厚度包围盒 tmin==tmax，相切不可剔除）
        if (miss || !(tmax > tMin && tmin < tMax)) continue;
        const pos = md.mesh.geometry.attributes.position;
        const idx = md.mesh.geometry.index;
        for (let t = 0; t < md.triCount; t++) {
            const lt = md.localFrom + t;
            const vi = [0, 1, 2].map(k => (idx ? idx.getX(lt * 3 + k) : lt * 3 + k));
            const P = vi.map(i2 => new THREE.Vector3(pos.getX(i2), pos.getY(i2), pos.getZ(i2)));
            const e1 = P[1].clone().sub(P[0]);
            const e2 = P[2].clone().sub(P[0]);
            const pv = new THREE.Vector3().crossVectors(lrd, e2);
            const det = e1.dot(pv);
            if (Math.abs(det) < 1e-9) continue;
            const invD = 1 / det;
            const tv = lro.clone().sub(P[0]);
            const u = tv.dot(pv) * invD;
            if (u < 0 || u > 1) continue;
            const qv = new THREE.Vector3().crossVectors(tv, e1);
            const v = lrd.dot(qv) * invD;
            if (v < 0 || u + v > 1) continue;
            const tHit = e2.dot(qv) * invD;
            if (tHit <= tMin || tHit >= tMax) continue;
            // 背面剔除（= THREE.Raycaster FrontSide）；法线由绕序给出，恒朝来向
            const n0 = new THREE.Vector3().crossVectors(e1, e2);
            if (n0.dot(lrd) >= 0) continue;
            hits.push({
                t: tHit, meshIdx: m, section: sectionName(md.sec), thickness: md.thickness,
                variant: md.variant, slot: pack.units[m].triStart + t,   // 全局三角形槽（网格验证用）
                point: lro.clone().addScaledVector(lrd, tHit).applyMatrix4(mw),
                normal: n0.transformDirection(mw),
            });
        }
    }
    hits.sort((x, y) => x.t - y.t);
    return hits;
}

function sectionName(code) {
    for (const [k, v] of Object.entries(RC.SECTION)) if (v === code) return k;
    return '?';
}

const _PRIM = new Set(['hull', 'turret', 'gun']);

/**
 * JS 参考实现：跳弹续飞层链（与 GLSL rcContinue 同常量同语义，在线推进 tCur）。
 * params: { remIn(=pen×0.75), caliber, normalizationRad, thickMul }。
 * 返回 { cls(0 紫|1 绿|2 红), penChance, layers[层快照（调试/测试）] }。
 */
export function simulateContinuation(pack, bouncePos, reflDir, params) {
    const ro = bouncePos.clone().addScaledVector(reflDir, RC.ORIGIN_OFFSET);
    const hits = raycastPackAll(pack, ro, reflDir, RC.MIN_CONTINUATION_T);   // 初始接受阈与 GLSL/click 同一常量（评审 P1）
    // 前端门：原始命中无主装甲 → 不做二次判定（维持紫）
    if (!hits.some(h => _PRIM.has(h.section))) return { cls: 0, penChance: 0, layers: [] };
    // 收集：variant 去重 + 首 primary 止（calculate 收集段）
    const seen = new Set();
    const collected = [];
    for (const h of hits) {
        if (h.variant) {
            if (seen.has(h.variant)) continue;
            seen.add(h.variant);
            collected.push(h);
        } else {
            collected.push(h);
            if (_PRIM.has(h.section)) break;
        }
    }
    if (collected.length > RC.MAX_LAYER) return { cls: 0, penChance: 0, layers: [] }; // 上限保守：紫
    // 模拟（allowRicochet=false 动能出射段）
    const { remIn, caliber, normalizationRad, thickMul } = params;
    let rem = remIn;
    const layers = [];
    for (const h of collected) {
        const th = h.thickness * thickMul;
        let eff, layPen;
        const isPrimary = _PRIM.has(h.section);
        if (h.variant) {
            eff = th;
            layPen = rem > eff;
        } else {
            const cosA = Math.min(Math.abs(h.normal.dot(reflDir)), 1);
            const angle = Math.acos(cosA);
            const twoCal = caliber > th * 2;
            const normR = twoCal ? (RC.TWO_CAL_NORM * normalizationRad * caliber) / (2 * th) : normalizationRad;
            const finA = Math.max(angle - normR, 0);
            eff = th / Math.max(Math.cos(finA), RC.COS_EPS);
            layPen = rem > eff;
        }
        layers.push({ section: h.section, t: h.t, thickness: th, eff, remBefore: rem, penetrated: layPen });
        if (layPen) {
            rem -= eff;
        } else {
            return { cls: 2, penChance: 0, layers };
        }
        if (isPrimary) {
            // ±5% 带显示概率（末层穿透概率，与主着色器公式同源）
            const remBefore = layers[layers.length - 1].remBefore;
            const band = remBefore * RC.BAND;
            const chance = Math.max(0, Math.min(1, 1 - ((eff - remBefore) + band) / (2 * band)));
            return { cls: 1, penChance: chance, layers };
        }
    }
    return { cls: 0, penChance: 0, layers };
}
