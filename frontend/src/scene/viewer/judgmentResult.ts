import * as THREE from 'three'
import { isPrimary, hasPrimaryLayer, matchHitsByOccurrence, ricochetSurface, withGapOrigin } from '../penetration.js'
import { judgePenetration, type PenetrationLayer, type PenetrationRequest, type PenetrationResult } from '../agentData.js'
import { evaluateProbabilityChain, type ProbabilityChainLayer } from '../armorInspectorChance.js'
import { RC } from '../armorCollisionPack.js'
import type { JudgmentDeps } from './judgment.js'
import type { JudgmentHit } from './judgmentHits.js'
import type { TrajectoryCardLayer } from './trajectoryCard.js'
import type { shellTypeOf } from './armorPlateModel.js'

interface JudgmentLayer extends TrajectoryCardLayer { normal?: THREE.Vector3 | null }
interface BounceDebugEntry { bounce: number; result: string; reflect: number[]; layers: PenetrationLayer[]; probability: PenetrationLayer[] | null;
  hits: Array<{ partName: string; section: string; thickness: number; point: number[]; normal: number[] }> }
type ResultDeps = Pick<JudgmentDeps, 'tc' | 'armorDebug' | 'getCurrentConfig' | 'getTankData' | 'getCurrentConfigIdx' | 'getSelectedShell' | 'equipmentCoeffs' | 'getCamera' | 'getControls' | 'getWorldOverviewMode' | 'getPenetrationMode'> & {
  isStale: () => boolean; hitsForCheck: JudgmentHit[]; point: THREE.Vector3; isHE: boolean; pen: number; dmg: number; first: JudgmentHit
  heRadius: number; eqCal: number; eqEnh: number; dist: number; viewDir: THREE.Vector3; incomingDirection: THREE.Vector3
  intersectArmorDoubleSidedSpaced: (objects: THREE.Object3D[], caster: THREE.Raycaster) => THREE.Intersection[]
  collectJudgmentHits: (hits: THREE.Intersection[], dir: THREE.Vector3, minDistance?: number) => { hits: JudgmentHit[]; firstContact: JudgmentHit | null }
  objects: THREE.Object3D[]; shellType: ReturnType<typeof shellTypeOf>; shellNormDeg: number | null | undefined; shellRicoDeg: number | null
  requirePrimary: boolean; mpu: number; penDisp: number; modDmg: number; shotRayO: THREE.Vector3 | null; caliber: number; ndcX: number; ndcY: number
}
export async function renderJudgmentResult(res: PenetrationResult, context: ResultDeps): Promise<void> {
  const { tc, armorDebug, getCurrentConfig, getTankData, getCurrentConfigIdx, getSelectedShell, equipmentCoeffs, getCamera, getControls,
    getWorldOverviewMode, getPenetrationMode, isStale, hitsForCheck, point, isHE, pen, dmg, first, heRadius, eqCal, eqEnh,
    dist, viewDir, incomingDirection, intersectArmorDoubleSidedSpaced, collectJudgmentHits, objects, shellType, shellNormDeg,
    shellRicoDeg, requirePrimary, mpu, penDisp, modDmg, shotRayO, caliber, ndcX, ndcY } = context
                if (isStale()) return;   // 过期响应：更新位姿的判定已在途，直接丢弃
                const deterministicMatches = matchHitsByOccurrence(res.layers, hitsForCheck);
                let trajLayers: JudgmentLayer[] = res.layers.map((l, i) => {
                    const ah = deterministicMatches[i];
                    // 跳弹/续飞用物理首触面（contact_*），显示点也落在实际先碰到的面。
                    const surface = ricochetSurface(ah);
                    return {
                        point: surface?.point || point,
                        // 跳弹层显示首触板（名字/厚度），普通层仍是厚度链那一层。
                        name: l.contact_part_name || l.part_name,
                        thickness: l.contact_thickness != null ? l.contact_thickness : l.thickness,
                        eff: l.effective,
                        remainBefore: l.remaining_before,
                        penetrated: l.penetrated,
                        ricochet: l.ricochet,
                        angle: l.angle_deg != null ? l.angle_deg : null,
                        normal: surface?.normal,
                        seg: 0,
                    };
                });
                // 判定模式不再写五行点选卡（2026-11-15 用户裁示：只保留更详细的逐层
                // 结果卡；两张卡同时出现属于重复窗口）。厚度模式仍走 showArmorPartInfo。
                // 概率必须使用完整命中链（res.probability_layers），不能复用上面会在
                // 首个未穿透层截断的确定性 layers。显示层仍保持 BlitzKit 语义不变。
                const probabilityLayers: ProbabilityChainLayer[] = Array.isArray(res.probability_layers) && res.probability_layers.length
                    ? res.probability_layers.map(l => ({ ...l, seg: 0 }))
                    : trajLayers;
                const probabilityPen = Number.isFinite(res.probability_penetration)
                    ? res.probability_penetration : null;
                // AP/APCR/HEAT 的统一显示判定：用完整概率链作为唯一层链，
                // 逐层累计概率决定层点颜色，整体概率决定标题与伤害。
                // HE（isHE）与跳弹/续飞保留原确定性分支。
                const hasProbabilityChain = Array.isArray(res.probability_layers) && res.probability_layers.length > 0;
                // HE 命中首个 Primary 时也有穿深浮动；只有命中非 Primary 的
                // 间隙甲/模块才保持 HE 首面爆炸/溅射（不把 CDF 当穿透概率）。
                const heFirstPrimary = isHE && hitsForCheck.length > 0
                    && isPrimary(hitsForCheck[0].section);
                // 0mm Primary 也是合法主装甲（与其它板一致）：与下方 useProbabilityMode
                // 的 hasPrimaryLayer 门同源，不能把 0mm 当“必穿/无主装甲”。
                const hePenChance = heFirstPrimary && hasProbabilityChain
                    && hasPrimaryLayer(res.probability_layers)
                    ? evaluateProbabilityChain(probabilityPen ?? pen, res.probability_layers).chance
                    : 0;
                // HE 溅射面板：he_min/he_max 是采样器给出的两个浮动界最大值，
                // 期望 = 满伤×概率 + 未击穿溅射×(1-概率)。
                const heInfo = (isHE && res.he) ? {
                    ...res.he,
                    chance: hePenChance,
                    expected_damage: dmg * hePenChance + res.he.splash_avg * (1 - hePenChance),
                } : null;
                // HE 卡片只展示直接命中的装甲板（位置 + 名义厚度），
                // 不展示等效/角度/概率链；hitsForCheck[0] 是爆炸面。
                const heDirectHit = (isHE && first)
                    ? { name: first.partName, thickness: first.thickness }
                    : null;
                const useProbabilityMode = !res.ricochet && !res.blocked_no_primary
                    && res.result !== '-' && res.result !== 'ERROR' && hasProbabilityChain
                    // 纯外部模块/0mm 板链没有可被 CDF 评估的主装甲：概率模式会把
                    // 模块 flat 消耗后的剩余区间误读成“必穿”；保持确定性卡片。
                    && hasPrimaryLayer(res.probability_layers)
                    // HE 还必须有合法 splash data（positive explosion radius / res.he）。
                    // 半径缺失或 <=0 时计算层已 fail-closed：res.result=BLOCKED、damage=0、
                    // res.he=null；不能再因 first Primary + chain 进入 generic probability card，
                    // 否则会显示 May penetrate / PENETRATION full damage 覆盖底层结果。
                    && (!isHE || (heInfo != null && heRadius > 0 && heFirstPrimary && hePenChance > 0));
                const isGapProbLayer = (layer: PenetrationLayer) => layer.gap === true
                    || String(layer.part_name || '').startsWith('Gap ');
                const probabilityMatches = matchHitsByOccurrence(res.probability_layers, hitsForCheck);
                const probRawLayers: TrajectoryCardLayer[] | null = useProbabilityMode
                    ? res.probability_layers.map((l, i) => {
                        // 概率层的 point 是判定局部坐标（world 模式会被换算）；轨迹/层点
                        // 必须用 hitsForCheck 的世界点。同名板按命中次序匹配（第二块
                        // 同名间隙板的轨迹点不能复用第一块）；gap 层借用相邻装甲层。
                        let ah = probabilityMatches[i];
                        if (!ah && isGapProbLayer(l)) {
                            for (let j = i + 1; j < res.probability_layers.length && !ah; j++) {
                                if (isGapProbLayer(res.probability_layers[j])) continue;
                                ah = probabilityMatches[j];
                            }
                            for (let j = i - 1; j >= 0 && !ah; j--) {
                                if (isGapProbLayer(res.probability_layers[j])) continue;
                                ah = probabilityMatches[j];
                            }
                        }
                        return {
                            ...l,
                            name: l.contact_part_name || l.part_name,
                            thickness: l.contact_thickness != null ? l.contact_thickness : l.thickness,
                            eff: l.effective,
                            angle: l.angle_deg != null ? l.angle_deg : null,
                            point: ah?.point || (Array.isArray(l.point)
                                ? new THREE.Vector3(l.point[0], l.point[1], l.point[2])
                                : point),
                            normal: ah?.normal || (Array.isArray(l.normal)
                                ? new THREE.Vector3(l.normal[0], l.normal[1], l.normal[2])
                                : null),
                            // 距离衰减标头只读首层 remainBefore；概率链没有逐层剩余值。
                            remainBefore: i === 0 ? (probabilityPen ?? pen) : undefined,
                            seg: 0,
                        };
                    })
                    : null;
                if (armorDebug()) {
                    const cfg = getCurrentConfig();
                    tc.armorDebugPanel({
                        url: location.href,
                        tank: {
                            id: getTankData()?.tank_id,
                            name: getTankData()?.name,
                            configIndex: getCurrentConfigIdx(),
                            config: cfg ? {
                                caliber: cfg.caliber,
                                turret_plates: cfg.turret_plates,
                                gun_plates: cfg.gun_plates,
                                turret_spaced: cfg.turret_spaced,
                                gun_spaced: cfg.gun_spaced,
                            } : null,
                        },
                        shell: getSelectedShell() ? { ...getSelectedShell() } : null,
                        equipment: { ...equipmentCoeffs(), calibrated_shells: eqCal, enhanced_armor: eqEnh },
                        camera: {
                            position: getCamera().position.toArray(),
                            target: getControls().target.toArray(),
                            fov: (getCamera() as THREE.PerspectiveCamera).fov, near: (getCamera() as THREE.PerspectiveCamera).near, far: (getCamera() as THREE.PerspectiveCamera).far,
                            worldOverview: getWorldOverviewMode(),
                        },
                        click: { ndcX, ndcY },
                        point: point.toArray(),
                        distance: dist,
                        viewDir: viewDir.toArray(),
                        hits: hitsForCheck.map(ah => ({
                            section: ah.section,
                            plateId: ah.plateId,
                            thickness: ah.thickness,
                            point: ah.point.toArray(),
                            normal: ah.normal.toArray(),
                            partName: ah.partName,
                        })),
                        deterministic: { result: res.result, damage: res.damage, layers: res.layers, he: res.he, heDirectHit },
                        probability: { penetration: res.probability_penetration, layers: res.probability_layers },
                        heatmap: getPenetrationMode(),
                    });
                }

                if (res.ricochet && res.ricochet_remaining_pen > 0) {
                    const firstLast = trajLayers[trajLayers.length - 1];
                    if (firstLast && firstLast.point) {
                        let current = res;
                        let currentPoint = firstLast.point.clone();
                        let currentNormal = firstLast.normal ? firstLast.normal.clone() : null;
                        let currentDir = incomingDirection.clone();
                        const allLayers: JudgmentLayer[] = trajLayers.slice();
                        const allProbability: ProbabilityChainLayer[] = Array.isArray(probabilityLayers) ? probabilityLayers.slice() : [];
                        const segmentResults = [res.result];
                        const bounceDebug: BounceDebugEntry[] = [];
                        let finalDamage = res.damage || 0;
                        let bounced = 0;

                        while (current.ricochet && current.ricochet_remaining_pen > 0
                            && bounced < RC.MAX_CONTINUATIONS && currentNormal) {
                            const reflect = currentDir.clone()
                                .sub(currentNormal.clone().multiplyScalar(2 * currentDir.dot(currentNormal)))
                                .normalize();
                            const rc = new THREE.Raycaster(currentPoint, reflect);
                            // 与点击主链同一收集口径：间隙甲双面 + 同一块板只计一层
                            const ricIntersects = intersectArmorDoubleSidedSpaced(objects, rc);
                            const ricCollect = collectJudgmentHits(ricIntersects, rc.ray.direction, RC.MIN_CONTINUATION_T);
                            // 续飞链同口径：HEAT 的间隙同样从首个物理接触面量起。
                            // （近零距离命中已在收集前过滤，contact_* 不会来自发射面。）
                            const ricHits: JudgmentHit[] = shellType === 'heat'
                                ? withGapOrigin(ricCollect.hits, ricCollect.firstContact)
                                : ricCollect.hits;
                            ricHits.sort((a, b) => a.distance - b.distance);
                            if (!ricHits.length || !ricHits.some(h => isPrimary(h.section))) break;

                            const ricReq: PenetrationRequest = {
                                shell_type: shellType, shell_type_id: getSelectedShell() ? (getSelectedShell()!.type_id ?? null) : null,
                                penetration: current.ricochet_remaining_pen, caliber,
                                damage: dmg,
                                enhanced_armor: eqEnh,
                                normalization_deg: shellNormDeg,
                                ricochet_deg: shellRicoDeg,
                                // 跳弹后的炮弹可以再次跳弹；API 的 layerIndex>0 仍会
                                // 抑制“先穿过模块/间隙甲再跳弹”的情形。
                                allow_ricochet: true,
                                require_primary: requirePrimary,
                                view_dir: [reflect.x, reflect.y, reflect.z],
                                hits: ricHits.map(ah => ({
                                    section: ah.section, plate_id: ah.plateId, thickness: ah.thickness,
                                    normal: [ah.normal.x, ah.normal.y, ah.normal.z],
                                    point: [ah.point.x * mpu, ah.point.y * mpu, ah.point.z * mpu],
                                    part_name: ah.partName,
                                    ...(ah.contact_normal ? {
                                        contact_normal: [ah.contact_normal.x, ah.contact_normal.y, ah.contact_normal.z],
                                        contact_point: [ah.contact_point!.x * mpu, ah.contact_point!.y * mpu, ah.contact_point!.z * mpu],
                                        contact_thickness: ah.contact_thickness,
                                        contact_part_name: ah.contact_part_name || null,
                                    } : {}),
                                })),
                            };
                            const ricRes = await judgePenetration(ricReq);
                            if (isStale()) return;
                            if (!ricRes || ricRes.result === '-') break;

                            const seg = bounced + 1;
                            segmentResults.push(ricRes.result);
                            const matched = matchHitsByOccurrence(ricRes.layers, ricHits);
                            const ricLayers = ricRes.layers.map((l, i) => {
                                const hit = matched[i] || null;
                                const surface = ricochetSurface(hit);
                                return {
                                    point: surface?.point || currentPoint,
                                    name: l.contact_part_name || l.part_name,
                                    thickness: l.contact_thickness != null ? l.contact_thickness : l.thickness,
                                    eff: l.effective,
                                    remainBefore: l.remaining_before,
                                    penetrated: l.penetrated,
                                    ricochet: l.ricochet,
                                    angle: l.angle_deg != null ? l.angle_deg : null,
                                    seg,
                                };
                            });
                            allLayers.push(...ricLayers);
                            const ricProbability = Array.isArray(ricRes.probability_layers) && ricRes.probability_layers.length
                                ? ricRes.probability_layers.map((l, i) => ({
                                    ...l,
                                    seg,
                                    ...(i === 0 ? { remaining_before: Number.isFinite(ricRes.probability_penetration) ? ricRes.probability_penetration : current.ricochet_remaining_pen } : {}),
                                }))
                                : ricLayers;
                            allProbability.push(...ricProbability);
                            finalDamage = ricRes.damage || 0;
                            bounceDebug.push({
                                bounce: seg,
                                result: ricRes.result,
                                reflect: [reflect.x, reflect.y, reflect.z],
                                layers: ricRes.layers,
                                probability: ricRes.probability_layers || null,
                                hits: ricHits.map(h => ({
                                    partName: h.partName, section: h.section,
                                    thickness: h.thickness,
                                    point: h.point.toArray(), normal: h.normal.toArray(),
                                })),
                            });

                            const lastMatch = matched[matched.length - 1];
                            if (!ricRes.ricochet || !lastMatch) {
                                current = ricRes;
                                break;
                            }
                            const nextSurface = ricochetSurface(lastMatch);
                            if (!nextSurface) { current = ricRes; break; }
                            currentPoint = nextSurface.point.clone();
                            currentNormal = nextSurface.normal.clone();
                            currentDir = reflect;
                            current = ricRes;
                            bounced++;
                        }

                        if (armorDebug() && window.__armorDebugLast) {
                            window.__armorDebugLast.ricochet = {
                                shellDir: [incomingDirection.x, incomingDirection.y, incomingDirection.z],
                                result: segmentResults.join(' → '),
                                bounces: bounceDebug,
                            };
                            tc.armorDebugPanel(window.__armorDebugLast);
                        }
                        tc.showTrajectory(point, segmentResults.join(' → '), res.total_effective, allLayers, penDisp, dmg, modDmg, dist, shotRayO, finalDamage, allProbability, probabilityPen, !isHE && !res.blocked_no_primary, {
                            ...(heInfo ? { heInfo, heDirectHit } : {}),
                            blockedNoPrimary: res.blocked_no_primary === true,
                        });
                        return;
                    }
                }

                const blockedNoPrimary = res.blocked_no_primary === true;
                if (useProbabilityMode) {
                    tc.showTrajectory(point, res.result, res.total_effective, probRawLayers!, penDisp, dmg, modDmg, dist, shotRayO, res.damage || 0, probRawLayers!, probabilityPen, true, { probabilityMode: true, heInfo, heDirectHit, blockedNoPrimary });
                } else {
                    tc.showTrajectory(point, res.result, res.total_effective, trajLayers, penDisp, dmg, modDmg, dist, shotRayO, res.damage || 0, probabilityLayers, probabilityPen, !isHE && !blockedNoPrimary, { ...(heInfo ? { heInfo, heDirectHit } : {}), blockedNoPrimary });
                }
}
