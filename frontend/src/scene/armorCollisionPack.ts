// 碰撞打包/续飞链门面：类型与 GLSL 注入串留在此处（源码契约测试直接读取本文件），
// 实现（build / query / RC 常量）已出仓（#LOC 拆分，原样平移）。既有消费方
// （armorShaders / judgment / heatmap / diagnosticProbe / heSplash / 各单测）仍从本入口导入。
import type { Vector3, Plane } from 'three';
import { RC, RC_DIAG } from './armorPackConstants.js';
import { AI_NORMAL_CDF_GLSL, penetrationChanceForInterval } from './armorInspectorChance.js';
import { isPrimary } from './penetration.js';
import { raycastPackAll } from './armorPackQuery.js';
import type { CollisionHit, ContinuationLayer, CollisionPack } from './armorPackTypes.js';

export {
  RC, RC_DIAG,
} from './armorPackConstants.js';
export type {
  ArmorSection, PackEntry, PackUnit, CollisionPack, CollisionPackFailure, BuildPackResult,
  CollisionHit, GridCollisionHit, RicochetGrid, BuildRicochetGridResult, ContinuationLayer,
} from './armorPackTypes.js';
export {
  buildPack, snapshotPackPose, packPoseChanged, updatePackMatrices,
  buildRicochetGrid, createGridTextures,
} from './armorPackBuild.js';
export {
  raycastPackAll, raycastGridAll, isClippedModuleHit, isBackfaceNormal,
} from './armorPackQuery.js';

/** GLSL 常量声明（注入 PBR_FRAG；由 RC 生成，禁止手写数值） */
export const RC_GLSL_CONST = `
${Object.entries(RC_DIAG).map(([key, value]) => `#define RC_DIAG_${key} ${value}.0`).join("\n")}
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
#define RC_SEC_GUN_BARREL ${RC.SECTION.gunBarrel}
`;

/**
 * GLSL 续飞实现（uniforms + rcContinue），注入 PBR_FRAG 的 main() 之前。
 * 依赖主着色器既有 uniform：caliber / normalization（弧度）。
 * 精度：几何量全部 highp；注入的片元 shader 现在整体 `precision highp float`
 * （PR #713），这里仍保留显式标注，避免被误改回 mediump。
 */
export const RC_GLSL_FUNCS = `
${AI_NORMAL_CDF_GLSL}
// ==== 跳弹续飞：反射线网格 DDA 求交 + 出射段层链（语义=penetration.js calculate；每段首个命中层可再跳弹）====
// 数据面：世界系均匀网格（炮塔/配置变化时 CPU 重建上传）——每 cell 一条目表（triSlot+section+thickness），
// 世界系三角形顶点纹理。着色器沿 DDA 步进，只测路径覆盖的 cell 内三角形（~10² 级，替代全量 10³ 级扫描），
// 命中天然按 t 有序（无需逐层重扫）；背面剔除 = Raycaster FrontSide 口径（绕序法线）。
uniform int rcMode;                 // 1/2=全分辨率逐像素续飞（v5.3） 0=关闭
uniform float rcThickMul;     // 每层厚度乘子：参与后续层判定，不得先量化成 mediump
uniform highp sampler2D rcWorldTris;  // 世界系顶点：每 texel 一顶点 (x,y,z)（网格重建时上传）
uniform float rcTriRows;
uniform highp sampler2D rcGridCells;   // 每 cell 1 texel: (entryOffset, entryCount)
uniform highp sampler2D rcGridEntries; // 每条目 1 texel: (triSlot, sectionCode, thickness, 0)
// issue #711 第二批：网格原点是世界系米制坐标（可达数百米），mediump 在该量级
// 只有分米级分辨率——DDA 的 cell 归属与 t 会成块翻转。原点/步长/尺寸统一 highp。
uniform vec3 rcGridMin;
uniform float rcCell;
uniform vec3 rcGridDimsF;
uniform float rcCellRows;
uniform float rcEntryRows;
uniform int rcEntryTotal;
// gun_mask 裁切面（世界系）：xyz=法线, w=constant；只过滤 gunBarrel 命中。
// 与 THREE.Plane.distanceToPoint 同式：dot(n, p) + w < 0 → 被裁掉。
uniform vec4 rcClipPlane;
uniform bool rcClipEnabled;

vec3 rcVertW(int vid) {
    return texelFetch(rcWorldTris, ivec2(vid % RC_TRI_ROW_I, vid / RC_TRI_ROW_I), 0).xyz;
}
vec4 rcCellAt(int idx) {
    return texelFetch(rcGridCells, ivec2(idx % RC_CELL_ROW_I, idx / RC_CELL_ROW_I), 0);
}
vec4 rcEntryAt(int idx) {
    return texelFetch(rcGridEntries, ivec2(idx % RC_ENTRY_ROW_I, idx / RC_ENTRY_ROW_I), 0);
}
// Möller–Trumbore（世界系；t ∈ (tLo, tHi]；背面剔除）
bool rcTriW(int slot, vec3 ro, vec3 rd, float tLo, float tHi, out float tHit) {
    vec3 a = rcVertW(slot * 3), b = rcVertW(slot * 3 + 1), c = rcVertW(slot * 3 + 2);
    vec3 e1 = b - a, e2 = c - a;
    if (dot(cross(e1, e2), rd) >= 0.0) return false;
    vec3 pv = cross(rd, e2);
    float det = dot(e1, pv);
    if (abs(det) < 1e-9) return false;
    float invD = 1.0 / det;
    vec3 tv = ro - a;
    float u = dot(tv, pv) * invD;
    if (u < 0.0 || u > 1.0) return false;
    vec3 qv = cross(tv, e1);
    float v = dot(rd, qv) * invD;
    if (v < 0.0 || u + v > 1.0) return false;
    float t = dot(e2, qv) * invD;
    if (t <= tLo || t > tHi) return false;
    tHit = t;
    return true;
}
// 出射段层链（网格 DDA 在线推进）。返回 0=无续飞(维持紫) 1=续飞击穿(绿, penOut=±5%带概率) 2=续飞被挡(红)
int rcSegment(vec3 bouncePos, vec3 reflDir, float remIn, out float penOut, out float rcDiag, out vec3 nextOrigin, out vec3 nextDir, out float nextRem) {
    penOut = 0.0;
    rcDiag = 0.0;
    vec3 ro = bouncePos + reflDir * RC_OFF;
    // 整车包围盒（= 网格包围盒）裁剪：反射线不穿整车 → 直接无续飞（掠射视角下大多数
    // 跳弹反射向空处，一次 AABB 测试代替求交）
    ivec3 dims = ivec3(rcGridDimsF);
    vec3 gMax = rcGridMin + rcGridDimsF * rcCell;
    // 已知数值边界（评审记录，非 merge blocker）：分量恰为 0 的 slab 走 1/0=inf 口径——
    // 射线不在该 slab 内时 t 区间为 (-inf,inf)，结果正确；恰在边界（ro 面向分量 == gMin/gMax）
    // 时可能出 0*inf=NaN，NaN 比较为假 → 走不到 return 0 而给出无命中 → 维持紫（fail-closed，
    // 不会伪造续飞结论）。如需严格化：改显式 zero-direction slab 分支（逐轴 if 判定 inside/miss），
    // 代价是热路径多三条分支——当前口径在 GPU↔CPU 差分校准下已验证。
    vec3 ginv = 1.0 / reflDir;
    vec3 ga = (rcGridMin - ro) * ginv;
    vec3 gb = (gMax - ro) * ginv;
    vec3 gsm = min(ga, gb), gbg = max(ga, gb);
    float tEnd = min(min(gbg.x, gbg.y), gbg.z);
    float tStart = max(max(gsm.x, gsm.y), gsm.z);
    if (tEnd <= RC_TSKIP) { rcDiag = RC_DIAG_NO_HIT; return 0; }
    tStart = max(tStart, RC_TSKIP);    // 初始接受阈（三路一致）：t > RC_TSKIP 才接受（rcTriW 的 t<=tLo 滤）
    if (tStart >= tEnd) { rcDiag = RC_DIAG_NO_HIT; return 0; }
    // DDA 初始化（Amanatides & Woo）
    vec3 p0 = ro + reflDir * (tStart + RC_ADV_EPS * 4.0);
    ivec3 cell = clamp(ivec3(floor((p0 - rcGridMin) / rcCell)), ivec3(0), dims - ivec3(1));
    ivec3 stp = ivec3(reflDir.x > 0.0 ? 1 : (reflDir.x < 0.0 ? -1 : 0),
                      reflDir.y > 0.0 ? 1 : (reflDir.y < 0.0 ? -1 : 0),
                      reflDir.z > 0.0 ? 1 : (reflDir.z < 0.0 ? -1 : 0));
    vec3 nb = rcGridMin + (vec3(cell) + max(vec3(stp), vec3(0.0))) * rcCell;
    vec3 tMax = vec3(1e30);
    if (stp.x != 0) tMax.x = (nb.x - ro.x) / reflDir.x;
    if (stp.y != 0) tMax.y = (nb.y - ro.y) / reflDir.y;
    if (stp.z != 0) tMax.z = (nb.z - ro.z) / reflDir.z;
    vec3 tDelta = abs(rcCell / reflDir);
    float tCur = tStart;         // 层游标：剩余命中须 t > tCur（吞层后 tCur = bestT + RC_ADV_EPS）
    bool anyPrimary = false;           // 前端门：整条射线存在主装甲原始命中（ricHasPrimary）
    bool blocked = false;              // 链中途被挡（待定：anyPrimary→红 否则紫）
    float rem = remIn;
    // Armor Inspector 概率区间：±5% = ±3σ；后续层两端一起平移，σ 不随 rem 重算。
    float pMin = remIn * (1.0 - RC_BAND);
    float pMax = remIn * (1.0 + RC_BAND);
    float probChance = 1.0;
    int variantSeen = 0;
    int prevTri = -1;                  // 同三角形跨 cell 重复列表去重（凸区域连续出现）
    int L = 0;
    int hitIndex = 0;                  // 段内已消费层（模块/间隙/主装）序号
    int budget = RC_BUDGET;            // 全局取数预算：超出即保守退出（防执行超时杀 draw）
    rcDiag = RC_DIAG_STEP_LIMIT;
    for (int s = 0; s < RC_MAX_STEPS; s++) {
        if (budget <= 0) { rcDiag = RC_DIAG_FETCH_BUDGET; return 0; }
        float tCell = min(min(tMax.x, tMax.y), tMax.z);
        float hi = min(tCell + RC_ADV_EPS, tEnd);
        int cidx = cell.x + dims.x * (cell.y + dims.y * cell.z);
        vec4 cel = rcCellAt(cidx);
        int cnt = int(cel.y + 0.5);
        int off = int(cel.x + 0.5);
        // 当前 cell 窗口 (tCur, hi] 内逐层收集（同一 cell 可含多层）
        for (int l = 0; l < RC_MAX_LAYER; l++) {
            if (L >= RC_MAX_LAYER) { rcDiag = RC_DIAG_LAYER_LIMIT; return 0; }            // 层上限 → 保守紫
            float bestT = hi;
            int bestSlot = -1;
            vec4 bestEnt = vec4(0.0);
            for (int e = 0; e < RC_MAX_CELL; e++) {
                if (e >= cnt) break;
                budget -= 1;
                if (budget < 0) { rcDiag = RC_DIAG_FETCH_BUDGET; return 0; }
                vec4 ent = rcEntryAt(off + e);
                int slot = int(ent.x + 0.5);
                if (slot == prevTri) continue;
                int candidateSection = int(ent.y + 0.5);
                float tHit;
                if (!rcTriW(slot, ro, reflDir, tCur, hi, tHit)) continue;
                // gun_mask 裁切面负侧的炮管后段在视觉上被裁掉，不是外部模块层。
                // 与点击链 isClippedModuleHit / THREE.Raycaster 侧同一判据；其它 section
                // （包括炮盾装甲板）不受影响。
                if (rcClipEnabled && candidateSection == RC_SEC_GUN_BARREL) {
                    vec3 clipPoint = ro + reflDir * tHit;
                    if (dot(rcClipPlane.xyz, clipPoint) + rcClipPlane.w < 0.0) continue;
                }
                // 首个候选即使恰好落在 cell 窗口上界（tHit == hi）也必须接受；
                // 严格的 tHit < bestT 会把 cell 边界上的主装甲/模块静默丢掉。
                if (bestSlot < 0 || tHit < bestT) {
                    bestT = tHit; bestSlot = slot; bestEnt = ent;
                }
            }
            if (bestSlot < 0) break;                    // 本 cell 无更多层 → 前进
            prevTri = bestSlot;
            int sec = int(bestEnt.y + 0.5);
            float th = bestEnt.z * rcThickMul;
            if (sec <= 2) anyPrimary = true;            // 主装甲原始命中在场（无论链是否已断）
            // 注意：blocked 后不能立即返回——点击卡的概率链仍会继续评估到首个
            // Primary（例如 spaced100 → hull1 名义被挡但概率约 13.7%）；这里继续
            // 累计概率，但确定性结论保持 BLOCKED，由首个 Primary 分支统一返回 2。
            if (sec >= RC_SEC_CHASSIS) {                // 外部模块：variant 去重 + flat 消耗
                int vbit = (sec == RC_SEC_CHASSIS) ? 1 : 2;
                if ((variantSeen & vbit) != 0) { tCur = bestT + RC_ADV_EPS; continue; }   // 同 variant 已消耗（不计层）
                variantSeen |= vbit;
                hitIndex++;
                bool modPen = rem > th;
                if (modPen) rem -= th;
                // 概率区间按 Armor Inspector 的 flat 消耗平移（即便确定性模块已挡下，
                // 也继续让概率链看到后续层；结论由首个 Primary 决定）。
                pMin -= th;
                pMax -= th;
                if (!modPen) blocked = true;   // 模块挡下：余下只查主装甲存在性
                tCur = bestT + RC_ADV_EPS; continue;
            }
            // 间隙/主装甲：角度等效 + 2×口径增强转正
            vec3 a = rcVertW(bestSlot * 3), b = rcVertW(bestSlot * 3 + 1), c = rcVertW(bestSlot * 3 + 2);
            vec3 nW = normalize(cross(b - a, c - a));   // 背面已剔除，恒朝来向 = face.normal 同口径
            float cosA = min(abs(dot(nW, reflDir)), 1.0);
            float angle = acos(cosA);
            // 0mm 合法板厚：2× 增强转正在 thickness=0、normalization=0 时是 0/0，
            // 只对正厚度应用（与 penetration.js 同规则），0mm 板等效保持 0。
            bool twoCal = th > 0.0 && caliber > th * 2.0;
            // BlitzKit：每个非外部层都用自身 thickness/angle 重新套用转正
            // （2× 口径增强转正也按本层厚度计算）；外部模块 flat 不计入。
            float normR = twoCal
                ? (RC_TWO_CAL * normalization * caliber) / (2.0 * th)
                : normalization;
            float finA = max(angle - normR, 0.0);
            float eff = th / max(cos(finA), RC_COS_EPS);
            // 每层先用当前区间乘 CDF，再把两端平移一次 eff（σ 保持初值/段首值）。
            float sigma = max((pMax - pMin) / 6.0, 1e-4);
            float mu = 0.5 * (pMin + pMax);
            probChance *= pMax > 0.0
                ? clamp(aiNormalCdf((mu - eff) / sigma), 0.0, 1.0)
                : 0.0;
            pMin -= eff;
            pMax -= eff;
            bool layPen = rem > eff;                    // 严格大于才穿透（penetration.js 同）
            // 跳弹后的炮弹可以再次跳弹：仅本段首个非外部层（主装甲或间隙甲）、
            // 非 3× 口径、入射角达到当前弹种跳弹角时，带 75% 剩余穿深反射进入下一段。
            // 外部模块（chassis/gunBarrel）已在上面 flat 消费并递增 hitIndex，不会走到这里。
            // 0mm 是合法板厚：3× 口径规则按 0 计算为 true（与 penetration.js 同），
            // 不能因厚度为 0 而漏掉 overmatch 并误判跳弹。
            bool threeCal = caliber > th * 3.0;
            if (sec <= 3 && hitIndex == 0 && !threeCal && angle >= ricochet) {
                nextOrigin = ro + reflDir * bestT;
                nextDir = normalize(reflect(reflDir, nW));
                nextRem = rem * RC_RICO_MUL;
                penOut = 0.0;
                rcDiag = RC_DIAG_NO_HIT;
                return 3;
            }
            if (sec <= 2) {                             // 首个主装甲 = 末层，定结论
                if (!blocked && layPen) {
                    // 确定性 layPen 已成立；补充概率为 0 时仍呈现确定性击穿（不把绿翻红）。
                    penOut = probChance > 0.0 ? clamp(probChance, 0.0, 1.0) : 1.0;
                    rcDiag = RC_DIAG_PENETRATED;
                    return 1;
                }
                // 名义被挡（本层或之前层）也可能是 1–99% 的边界情形：把部分概率
                // 交给状态通道，让热力图与点击卡“可能击穿 p%”一致（review 2026-10-18）。
                penOut = clamp(probChance, 0.0, 1.0);
                rcDiag = RC_DIAG_BLOCKED;
                return 2;
            }
            if (!layPen) { blocked = true; hitIndex++; tCur = bestT + RC_ADV_EPS; continue; }
            rem -= eff;
            hitIndex++;
            tCur = bestT + RC_ADV_EPS;
            L++;                                        // 消耗一层才计数
        }
        // 前进到下一 cell
        if (tMax.x <= tMax.y && tMax.x <= tMax.z) { cell.x += stp.x; tCur = max(tCur, tMax.x); tMax.x += tDelta.x; }
        else if (tMax.y <= tMax.z) { cell.y += stp.y; tCur = max(tCur, tMax.y); tMax.y += tDelta.y; }
        else { cell.z += stp.z; tCur = max(tCur, tMax.z); tMax.z += tDelta.z; }
        if (cell.x < 0 || cell.x >= dims.x || cell.y < 0 || cell.y >= dims.y || cell.z < 0 || cell.z >= dims.z || tCur >= tEnd) {
            rcDiag = RC_DIAG_NO_HIT;
            break;
        }
    }
    if (blocked) {
        rcDiag = anyPrimary ? RC_DIAG_BLOCKED : RC_DIAG_NO_HIT;
        return anyPrimary ? 2 : 0;
    }
    rcDiag = RC_DIAG_NO_HIT;
    return 0;
}

// 总跳弹次数上限 = 2：首段一次 + 续飞段一次。续飞段若再次跳弹（第二次），
// 炮弹消失，返回 0（无后续判定）。
int rcContinue(vec3 bouncePos, vec3 reflDir, float remIn, out float penOut, out float rcDiag) {
    vec3 no;
    vec3 nd;
    float nr;
    int cls = rcSegment(bouncePos, reflDir, remIn, penOut, rcDiag, no, nd, nr);
    if (cls == 3) {
        penOut = 0.0;
        rcDiag = RC_DIAG_NO_HIT;
        return 0;
    }
    return cls;
}
`;

/**
 * JS 参考实现：跳弹续飞层链（与 GLSL rcContinue 同常量同语义，在线推进 tCur）。
 * params: { remIn(=pen×0.75), caliber, normalizationRad, thickMul, ricochetRad?, clipPlane? }。
 * 跳弹后的炮弹可以再次跳弹：首段之后执行一段续飞（剩余穿深 ×0.75）；该段
 * 首个命中层若满足跳弹角/3×口径规则，则发生第二次跳弹，炮弹消失，不再有第三段。
 * clipPlane = 世界系 gun_mask 裁切面；负侧 gunBarrel 命中在命中收集阶段即剔除。
 * 返回 { cls(0 紫|1 绿|2 红), penChance, layers[层快照（调试/测试）] }。
 */
export function simulateContinuation(
    pack: CollisionPack,
    bouncePos: Vector3,
    reflDir: Vector3,
    params: {
        remIn: number
        caliber: number
        normalizationRad: number
        thickMul: number
        ricochetRad?: number | null
        clipPlane?: Plane | null
    },
): { cls: 0 | 1 | 2; penChance: number; layers: ContinuationLayer[] } {
    const { remIn, caliber, normalizationRad, thickMul } = params;
    const ricochetRad = params.ricochetRad != null ? params.ricochetRad : 70 * Math.PI / 180;
    const clipPlane = params.clipPlane || null;
    let rem = remIn;
    let origin = bouncePos.clone();
    let dir = reflDir.clone();
    const allLayers: ContinuationLayer[] = [];
    // 本函数从第一次跳弹点开始：只执行第二段；该段若再次跳弹即为终态。
    for (let seg = 1; seg <= 1; seg++) {
        const ro = origin.clone().addScaledVector(dir, RC.ORIGIN_OFFSET);
        const hits = raycastPackAll(pack, ro, dir, RC.MIN_CONTINUATION_T, RC.FAR, false, clipPlane);
        // 前端门：原始命中无主装甲 → 不做二次判定（维持紫）
        if (!hits.some(h => isPrimary(h.section))) break;
        // 收集：variant 去重；确定性判定与概率链都停在首个 primary（含）
        const seen = new Set<number>();
        const collected: CollisionHit[] = [];
        for (const h of hits) {
            const prev = collected[collected.length - 1];
            if (prev && Math.abs(h.t - prev.t) < 1e-6 && h.section === prev.section) continue;
            if (h.variant) {
                if (seen.has(h.variant)) continue;
                seen.add(h.variant);
                collected.push(h);
            } else {
                collected.push(h);
                if (isPrimary(h.section)) break;
            }
        }
        if (collected.length > RC.MAX_LAYER) return { cls: 0, penChance: 0, layers: allLayers };
        let probMin = rem * (1 - RC.BAND);
        let probMax = rem * (1 + RC.BAND);
        let probChance = 1;
        let blocked = false;
        let hitIndex = 0;
        for (const h of collected) {
            const th = h.thickness * thickMul;
            let eff: number, layPen: boolean;
            const primaryLayer = isPrimary(h.section);
            if (h.variant) {
                eff = th;
                layPen = rem > eff;
                if (layPen) rem -= eff;
                probMin -= eff;
                probMax -= eff;
                allLayers.push({ meshName: pack.meshes[h.meshIdx].name, plateId: pack.meshes[h.meshIdx].userData.armorPlateId, triangleId: h.triangleId, slot: h.slot, point: h.point.toArray(), normal: h.normal.toArray(), section: h.section, t: h.t, thickness: th, eff, remBefore: rem + (layPen ? eff : 0), penetrated: layPen, ricochet: false, seg });
                if (!layPen) blocked = true;
                hitIndex++;
                continue;
            }
            const cosA = Math.min(Math.abs(h.normal.dot(dir)), 1);
            const angle = Math.acos(cosA);
            // 与 penetration.js 一致：0mm 板也满足 3× 口径规则（overmatch）。
            const threeCal = caliber > th * 3;
            // 与 penetration.js 相同：只有本段首个非外部层可以新跳弹（首个命中可以是
            // 间隙甲；外部模块已在 variant 分支 flat 消费并递增 hitIndex）。
            const ricocheted = (primaryLayer || h.section === 'spaced') && hitIndex === 0 && !threeCal && angle >= ricochetRad;
            if (ricocheted) {
                allLayers.push({ meshName: pack.meshes[h.meshIdx].name, plateId: pack.meshes[h.meshIdx].userData.armorPlateId, triangleId: h.triangleId, slot: h.slot, point: h.point.toArray(), normal: h.normal.toArray(), section: h.section, t: h.t, thickness: th, eff: 0, remBefore: rem, penetrated: false, ricochet: true, angle, seg });
                // 第二次跳弹：炮弹消失，不再做后续判定。
                return { cls: 0, penChance: 0, layers: allLayers };
            }
            // 0mm 合法板厚：只对正厚度应用 2× 增强转正。
            const twoCal = th > 0 && caliber > th * 2;
            const normR = twoCal
              ? (RC.TWO_CAL_NORM * normalizationRad * caliber) / (2 * th)
              : normalizationRad;
            const finA = Math.max(angle - normR, 0);
            eff = th / Math.max(Math.cos(finA), RC.COS_EPS);
            layPen = rem > eff;
            probChance *= penetrationChanceForInterval(probMin, probMax, eff);
            probMin -= eff;
            probMax -= eff;
            allLayers.push({ meshName: pack.meshes[h.meshIdx].name, plateId: pack.meshes[h.meshIdx].userData.armorPlateId, triangleId: h.triangleId, slot: h.slot, point: h.point.toArray(), normal: h.normal.toArray(), section: h.section, t: h.t, thickness: th, eff, remBefore: rem, penetrated: layPen, ricochet: false, seg });
            if (primaryLayer) {
                if (!blocked && layPen) {
                    return { cls: 1, penChance: probChance > 0 ? Math.max(0, Math.min(1, probChance)) : 1, layers: allLayers };
                }
                const p = Math.max(0, Math.min(1, probChance));
                const pct = Math.round(p * 100);
                return { cls: 2, penChance: pct >= 1 && pct <= 99 ? p : 0, layers: allLayers };
            }
            if (!layPen) blocked = true;
            else rem -= eff;
            hitIndex++;
        }
    }
    return { cls: 0, penChance: 0, layers: allLayers };
}
