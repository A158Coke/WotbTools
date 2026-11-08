// 射击判定链（#820 Agent A 出仓）：点击判定、命中收集/分类、HE 溅射采样输入、
// 判定请求组装与概率链消费的唯一 owner。原 tankViewer.js 闭包内对应函数整体平移；
// 领域算法（penetration.js / armorInspectorChance.js / heSplash）保持既有实现不动。
import * as THREE from 'three'
import { isPrimary, hasPrimaryLayer, matchHitsByOccurrence, ricochetSurface, withContactRicochet, withGapOrigin } from '../penetration.js'
// 间隙甲同板去重键与判据：与厚度通道 per-key stencil 共用一处语义（order-independent）
import { resolveSpacedHitMask, spacedDedupKey, firstPhysicalHit } from '../armorMeshTopology.js'
import { isClippedModuleHit, isBackfaceNormal } from '../armorCollisionPack.js'
import { judgePenetration, shotBallisticLength, type PenetrationLayer, type PenetrationRequest } from '../agentData.js'
import { shellTypeOf } from './armorPlateModel.js'
import type { TankArmorConfig } from './armorPlateModel.js'
import type { ModelReferences } from './modelLifecycle.js'
import type { TrajectoryCardHandle, TrajectoryCardLayer } from './trajectoryCard.js'
import type { ProbabilityChainLayer } from '../armorInspectorChance.js'
import type { CollisionViewHandle } from './collisionView.js'
import type { createHeatmapPipeline } from './heatmap.js'
import type { ShellSpec, TankData } from './viewerContracts.js'
import { sampleHeSplash, HE_SAMPLE } from '../heSplash.js'
import { evaluateProbabilityChain } from '../armorInspectorChance.js'
import { RC } from '../armorCollisionPack.js'
import type { HeSplashResult } from '../heSplash.js'

/** 判定链依赖（composition root 注入）；字段语义见原 tankViewer 闭包。 */
export interface JudgmentDeps {
    models: ModelReferences
    hm: ReturnType<typeof createHeatmapPipeline>
    tc: TrajectoryCardHandle
    cvs: CollisionViewHandle
    getRenderer: () => THREE.WebGLRenderer
    getCamera: () => THREE.Camera
    getControls: () => { target: THREE.Vector3 }
    getRaycaster: () => THREE.Raycaster
    getMouse: () => THREE.Vector2
    getFxScene: () => THREE.Scene
    getCurrentConfigIdx: () => number | null
    getCollisionMode: () => boolean
    getPenetrationMode: () => boolean
    getWorldOverviewMode: () => boolean
    getTankData: () => TankData | null
    getCurrentConfig: () => TankArmorConfig | null
    getActiveGunNumber: () => number | null
    getSelectedShell: () => ShellSpec | null
    getShooterShells: () => ShellSpec[]
    getShooterCaliber: () => number | null
    getShooterData: () => { caliber?: number | null } | null
    isDestroyed: () => boolean
    isShooterLoading: () => boolean
    isShotReplay: () => boolean
    armorDebug: () => boolean
    getModuleMeshes: () => THREE.Mesh[]
    getWorldMetersPerUnit: () => number | null
    getPlateThickness: (section: string, plateId: string | number) => number
    equipmentCoeffs: () => { penMul: number; thickMul: number }
    effectiveCalibrated: (shell: ShellSpec | null) => number
    effectiveEnhanced: (shell: ShellSpec | null) => number
    shellPenMul: (shell: ShellSpec | null) => number
    L: { partName?: (name: string) => string; shellUnavailable: string }
    showShotError: (msg: string) => void
}

interface JudgmentHit {
    section: string
    plateId: number | string
    thickness: number
    point: THREE.Vector3
    normal: THREE.Vector3
    partName: string
    distance: number
    object: THREE.Object3D
    backface: boolean
    contact_normal?: THREE.Vector3
    contact_point?: THREE.Vector3
    contact_thickness?: number
    contact_part_name?: string | null
}

/** 轨迹层：在结果卡层契约上补世界法线（判定链内部消费）。 */
interface JudgmentLayer extends TrajectoryCardLayer {
    normal?: THREE.Vector3 | null
}

interface HitCandidate {
    entry: JudgmentHit
    spaced: boolean
    backface: boolean
    key: string
}

interface BounceDebugEntry {
    bounce: number
    result: string
    reflect: number[]
    layers: PenetrationLayer[]
    probability: PenetrationLayer[] | null
    hits: Array<{
        partName: string
        section: string
        thickness: number
        point: number[]
        normal: number[]
    }>
}

export function createJudgment(deps: JudgmentDeps) {
    const {
        models, hm, tc, cvs,
        getRenderer, getCamera, getControls, getRaycaster, getMouse, getFxScene,
        getCurrentConfigIdx, getCollisionMode, getPenetrationMode, getWorldOverviewMode,
        getTankData, getCurrentConfig, getActiveGunNumber,
        getSelectedShell, getShooterCaliber, getShooterData,
        isDestroyed, isShooterLoading, armorDebug,
        getModuleMeshes, getWorldMetersPerUnit, getPlateThickness,
        equipmentCoeffs, effectiveCalibrated, effectiveEnhanced, shellPenMul,
        L, showShotError,
    } = deps
    let __shotRayOrigin: THREE.Vector3 | null = null;   // 射击复现：射线起点（射手方向，固定距离）
    let __shotRayTarget: THREE.Vector3 | null = null;   // 射击复现：射线终点（瞄准点）
    let __penCheckSeq = 0;        // 判定代数序号：滑块连续重跑判定时丢弃过期的 /api/penetrate 响应
    let judgmentCount = 0;
    // 普通检视最后一次点击的 NDC：切弹种时重跑判定，避免球/热力图用新弹参数
    // 而结果卡仍是旧弹（评审 P2 切 HE 弹种场景）。
    let lastClickNdc: { x: number; y: number } | null = null;

function onClick(event: MouseEvent): void {
            if (!models.armorModel) return;
            // 世界模式(射击复现)：判定结果锁定——初始判定射线已切换为 DecodeShotSegment
            // 基准（P1 位置 + P1→P2 弹向），点击不重跑判定，始终显示该初始结果
            if (window.__worldPenMode) return;
            const rect = getRenderer().domElement.getBoundingClientRect();
            const ndcX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            const ndcY = -((event.clientY - rect.top) / rect.height) * 2 + 1;
            // 装甲厚度（碰撞）模式（2026-10-28 用户裁定）：不做击穿判定，只显示点击位置
            // 命中的装甲/模块信息（BlitzKit armor inspector 同语义）。
            if (getCollisionMode()) { showArmorPartInfo(event, ndcX, ndcY); return; }
            lastClickNdc = { x: ndcX, y: ndcY };
            doPenetrationCheck(ndcX, ndcY);
        }

// 第一个参数保留调用签名（onClick 统一传 event），停靠后不再按点击坐标摆位
function showArmorPartInfo(_event: MouseEvent, ndcX: number, ndcY: number): void {
            tc.tidyTrajectory();
            getRaycaster().setFromCamera(new THREE.Vector2(ndcX, ndcY), getCamera());
            const objects = models.armorModel ? [models.armorModel, ...getModuleMeshes()] : [];
            const rayDir = getRaycaster().ray.direction.clone().normalize();
            let info = null;
            for (const hit of getRaycaster().intersectObjects(objects, true)) {
                // 材质裁切不会删除几何命中：炮根在 hm.getGunClipPlane() 负侧被裁掉后，点击
                // 其后可见的装甲板仍可能先命中不可见炮根。与 collectJudgmentHits 同口径
                // 复用 isClippedModuleHit，厚度点选也不会选中被裁掉的炮管段。
                if (isClippedModuleHit(hit.object.userData.armorSection, hit.point, hm.getGunClipPlane())) continue;
                info = classifyHit(hit, rayDir);
                if (info) break;
            }
            const card = document.getElementById('click-info');
            if (!info) { cvs.resetArmorHighlight(); if (card) card.style.display = 'none'; return; }
            if (!card) return;
            cvs.applyArmorHighlight(info.object);
            const thickness = Number(info.thickness);
            document.getElementById('click-part')!.textContent = L.partName ? L.partName(info.partName) : info.partName;
            document.getElementById('click-armor')!.textContent = Number.isFinite(thickness) ? `${Math.round(thickness * 100) / 100} mm` : '—';
            // 结果停靠在场景顶部正中的固定胶囊（AgentArmorView 样式所有），不跟随命中点、不压车体。
            card.style.display = 'flex';
        }

function isEffectivelyVisible(node: THREE.Object3D): boolean {
            // 模型根节点的 visible 是视图模式开关（collision 视图会隐藏视觉车体），
            // 不是部件级隐藏；逐级检查到根之前即可。
            for (let n: THREE.Object3D | null = node; n && n !== models.tankModel && n !== models.armorModel; n = n.parent) {
                if (n.visible === false) return false;
                if (n.userData && n.userData.configHidden) return false;
            }
            return true;
        }

function classifyHit(hit: THREE.Intersection, rayDir: THREE.Vector3 | null = null): JudgmentHit | null {
            if (!isEffectivelyVisible(hit.object)) return null;
            if (hit.object.userData.armorSection === 'deco') return null;
            let section = null, plateId = null, thickness = null;
            if (hit.object.userData.armorSection) {
                section = hit.object.userData.armorSection;
                plateId = hit.object.userData.armorPlateId;
                thickness = hit.object.userData.armorThickness;
            } else {
                let node: THREE.Object3D | null = hit.object;
                while (node) {
                    const m = (node.name || '').match(/(hull|turret|gun)_\w*?_?armor_(\d+)/);
                    if (m) { section = m[1]; plateId = m[2]; break; }
                    node = node.parent;
                }
                if (section && plateId) thickness = getPlateThickness(section, plateId);
            }
            if (section === null || thickness === null || thickness === undefined) return null;
            const normal = hit.face ? hit.face.normal.clone() : new THREE.Vector3(0, 1, 0);
            const nm = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
            normal.applyNormalMatrix(nm).normalize();
            // 绕序法线朝来向 = 背面命中。间隙甲求交时临时 DoubleSide（见
            // intersectArmorDoubleSidedSpaced），背面法线先翻回来向再算角度；该层是否
            // 保留由 collectJudgmentHits 决定（只有间隙甲接受背面命中）。
            const backface = !!rayDir && isBackfaceNormal(normal, rayDir);
            if (backface) normal.negate();
            let partName;
            if (section === 'chassis') {
                partName = plateId === 'leftTrack' ? 'Track (Left)' : 'Track (Right)';
            } else if (section === 'gunBarrel') {
                partName = 'Gun Barrel';
            } else {
                const disp = hit.object.userData.armorSectionOrig || section;
                partName = `${disp.charAt(0).toUpperCase() + disp.slice(1)} Plate ${plateId}`;
            }
            return { section, plateId, thickness, point: hit.point, normal, partName, distance: hit.distance, object: hit.object, backface };
        }

function intersectArmorDoubleSidedSpaced(objects: THREE.Object3D[], caster: THREE.Raycaster): THREE.Intersection[] {
            const mats = new Set<THREE.Material>();
            if (models.armorModel) {
                models.armorModel.traverse(function(node) {
                    const mesh = node as THREE.Mesh;
                    if (!mesh.isMesh || node.userData.armorSection !== 'spaced') return;
                    if (mesh.material) {
                        if (Array.isArray(mesh.material)) for (const mat of mesh.material) mats.add(mat);
                        else mats.add(mesh.material);
                    }
                });
            }
            const saved: Array<[THREE.Material, THREE.Side]> = [];
            for (const m of mats) { saved.push([m, m.side]); m.side = THREE.DoubleSide; }
            try {
                return caster.intersectObjects(objects, true);
            } finally {
                for (const [m, side] of saved) m.side = side;
            }
        }

function collectJudgmentHits(intersects: THREE.Intersection[], rayDir: THREE.Vector3, minDistance = 0): { hits: JudgmentHit[]; firstContact: JudgmentHit | null } {
            const candidates: HitCandidate[] = [];
            for (const hit of intersects) {
                // 续飞链：先丢掉发射面自身的近零距离命中，再 classify/附加首触面——
                // 否则该命中会被同板去重删掉、却作为 contact_* 盖到更远的保留命中上，
                // 让续飞朝发射面再次跳弹。
                if (minDistance > 0 && hit.distance <= minDistance) continue;
                if (isClippedModuleHit(hit.object.userData.armorSection, hit.point, hm.getGunClipPlane())) continue;
                const entry = classifyHit(hit, rayDir);
                if (!entry) continue;
                // plateId 只在所属装甲表内唯一：hull/turret/gun 可以出现相同数字。
                // 正/背面去重必须带上原始 section，否则跨板的合法层会被误删。
                const origSection = entry.object?.userData?.armorSectionOrig || entry.section || '';
                candidates.push({
                    entry,
                    spaced: entry.section === 'spaced',
                    backface: !!entry.backface,
                    key: spacedDedupKey(origSection, entry.section, entry.plateId),
                });
            }
            // 有效判定区间 = 首个 Primary（含）；判定层链在它后面不再参与。
            let spanEnd = candidates.length;
            for (let i = 0; i < candidates.length; i++) {
                if (isPrimary(candidates[i].entry.section)) { spanEnd = i + 1; break }
            }
            const keep = resolveSpacedHitMask(candidates, spanEnd);
            const hits: JudgmentHit[] = [];
            for (let i = 0; i < candidates.length; i++) if (keep[i]) hits.push(candidates[i].entry);
            const contact = firstPhysicalHit(candidates);
            const contactEntry = contact < 0 ? null : candidates[contact].entry;
            // 首层跳弹/续飞几何取物理首触面（contact_normal/contact_point，不改厚度链几何）；
            // 与首层是否同键无关：中间夹别的板时物理跳弹仍发生在首触面上。
            return { hits: withContactRicochet(hits, contactEntry), firstContact: contactEntry };
        }

function resolveCaliberFor(shell: ShellSpec | null): number {
            // 不用目标车的 caliber 兜底：射手/弹体都没口径时套用目标口径会改变
            // overmatch/转正结果，属于跨车数据污染——返回 0 让判定 fail-closed。
            const candidates: Array<number | null | undefined> = [
                shell && shell.caliber,
                getShooterCaliber(),
                getShooterData()?.caliber,
            ];
            for (const value of candidates) {
                if (value != null && Number.isFinite(value) && value > 0) return value;
            }
            return 0;
        }

function resolveShotCaliber() {
            return resolveCaliberFor(getSelectedShell());
        }

function doPenetrationCheck(ndcX: number, ndcY: number): void {
            if (isDestroyed() || !models.armorModel || isShooterLoading()) return;
            // 缺客户端解码盒的 world shot 不得回退炮口弦出结论：初始化/时间轴重判/
            // 换弹都走这里，统一阻断并清掉上一发结果；普通相机点击路径不受影响。
            if (window.__worldPenMode === true && window.__segBoxMissing === true) {
                tc.tidyTrajectory();
                return;
            }
            const shellForGuard = getSelectedShell();
            const shellTypeNow = shellForGuard ? shellTypeOf(shellForGuard) : null;
            if (!shellForGuard || !shellTypeNow
                || !Number.isFinite(shellForGuard.penetration) || !(shellForGuard.damage != null && shellForGuard.damage > 0)
                || !(resolveShotCaliber() > 0)
                // 动能弹的转正角是判定输入；缺失（null/undefined）不能静默按 0 处理。
                || ((shellTypeNow === 'ap' || shellTypeNow === 'apcr')
                    && !Number.isFinite(shellForGuard.normalization))) {
                showShotError(L.shellUnavailable);
                return;
            }
            // 首次判定可能早于首帧渲染；raycast 必须使用已恢复的当前姿态。
            hm.updateCollisionWorldMatrices();
            judgmentCount++;
            // 代数序号：仅最新一次判定的响应可上屏（滑块拖动会连续触发判定）
            const penSeq = ++__penCheckSeq;

            models.armorModel!.traverse(function(node) {
                if (!(node as THREE.Mesh).isMesh) return;
                if (node.userData.configHidden) return;
                if (node.userData.armorSection === 'deco') { node.visible = false; return; }
                if (node.visible === false) node.visible = true;
            });
            const activeGun = getActiveGunNumber();
            const cfgForGun = getCurrentConfig();
            // BlitzKit 真值语义：mask=0 视同无 mask
            const gunHasMask = cfgForGun && typeof cfgForGun.gun_mask === 'number' && cfgForGun.gun_mask !== 0;
            hm.computeGunClipPlane();
            const activeModules = activeGun == null
                ? getModuleMeshes()   // 无法确定激活炮(如 configGunGroups 未填充)时退化为全部保留
                : getModuleMeshes().filter(m => {
                    if (m.userData.gunConfig != null) return m.userData.gunConfig === activeGun;
                    return true;
                }).filter(m => !(m.userData.gunMaskPart && !gunHasMask));
            for (const mesh of activeModules) {
                if (mesh.visible === false) mesh.visible = true;
            }

            if (window.__segRay) {
                // DecodeShotSegment 判定基准（P1 位置 + P1→P2 弹向）优先于一切
                getRaycaster().set(window.__segRay.origin.clone(), window.__segRay.dir);
            } else if (__shotRayOrigin && __shotRayTarget) {
                const dir = __shotRayTarget.clone().sub(__shotRayOrigin).normalize();
                getRaycaster().set(__shotRayOrigin.clone(), dir);
            } else {
                getMouse().x = ndcX;
                getMouse().y = ndcY;
                getRaycaster().setFromCamera(getMouse(), getCamera());
            }
            const objects = [models.armorModel, ...activeModules];
            // 间隙甲按双面参与判定：临时 DoubleSide 求交，背面命中在 collectJudgmentHits
            // 里按“同一块板只计一层”过滤（主装甲/外部模块仍只认迎面命中）。
            const intersects = intersectArmorDoubleSidedSpaced(objects, getRaycaster());
            const { hits: armorHits, firstContact } = collectJudgmentHits(intersects, getRaycaster().ray.direction);

            // BlitzKit 语义（SpacedArmorScene 的触发面）：判定只由【触达主装甲板】的射线发起——
            // shoot() 只挂在 Primary 网格的 onClick 上，spaced / 外部模块网格挂的是空 handler
            // （只为进入 event.intersections，从不触发判定）。所以整条射线没打到 hull/turret/gun
            // 装甲板（只穿间隙甲屏幕、只碰履带/炮管）→ 不构成一次击穿判定，不显示结果。
            // 漏了间隙甲这一条会把「末层 = 屏幕」判成击穿整车（56TP 炮塔 10mm 屏幕板 plate 12
            // 即此类：约四成点击方向只穿过屏幕，无主装甲参与）。
            // 仅作用于相机点击路径；射击复现的弹道弦判定需要外部模块层参与穿深链，保持原样。
            // HE/HESH 例外（2026-10-19 用户裁示）：爆炸弹命中履带/外部模块/炮管/间隙甲
            // 本身就是一次有效的爆炸点，不需要弹道继续触达主装；只有纯动能弹保持
            // “必须触达 Primary 才发起判定”的 BlitzKit 触发面语义。
            const isCameraClick = !window.__segRay && !(__shotRayOrigin && __shotRayTarget);
            if (isCameraClick && shellTypeNow !== 'he' && armorHits.length > 0
                && !armorHits.some(h => isPrimary(h.section))) {
                if (window.__hitMarker) { getFxScene().remove(window.__hitMarker); window.__hitMarker = null; }
                // 不构成判定 = 无结果态（与「点击未命中装甲」同款清理）：清掉上一次的判定
                // 面板/轨迹，避免旧结论被误读成本次点击的结论
                document.getElementById('click-info')!.style.display = 'none';
                document.getElementById('traj-info')!.style.display = 'none';
                tc.clearTrajInfoPos();
                tc.clearTrajGroup()
                return;
            }

            if (armorHits.length === 0) {
                console.warn('[shot-replay] check: 0 armor hits, intersects=' + intersects.length);
                // 无结果出口：卡片/轨迹与 HE 爆点/半径球一起清理（评审 P2）。
                tc.tidyTrajectory();
                // 弦不再与装甲相交（滑块拖到命中前位姿等）：同步清掉上次判定的命中
                // 标记，避免旧位置的绿/红点残留与"不相交"提示并存
                if (window.__hitMarker) { getFxScene().remove(window.__hitMarker); window.__hitMarker = null; }
                if (window.__shotIsHit) {
                    if (window.__worldPenMode) {
                        // 世界模式：默认 tick 在命中前 ≈0.2s，弦不相交是正常数据态而非几何错误。
                        // 浮动中性提示即可，不覆盖左下 World View 面板（tick 选择器在里面）；
                        // 切到命中时刻附近的 tick 会自动被真实判定替换。
                        const div = document.getElementById('traj-info');
                        div!.innerHTML = '<div style="background:var(--tooltip-bg);border-radius:10px;'
                            + 'border-left:4px solid #ffcf5c;padding:10px 16px;font-size:13px;color:var(--yellow);'
                            + 'white-space:nowrap;box-shadow:0 4px 20px rgba(0,0,0,0.5);">'
                            + '当前 tick 位姿与弹道弦不相交（命中前采样，坦克未到命中点）— 切换 tick 查看命中判定</div>';
                        tc.setTrajInfoPos(getControls().target.clone());
                    } else {
                        showShotError('服务器判定命中但射线未命中任何装甲板——弹道/模型几何错位');
                    }
                }
                return;
            }

            // ===== HE 弹命中层语义修正 =====
            // HE(与一切爆炸弹)命中【首个表面】即爆炸，不沿弹道穿透整车；弦判定沿弦收集
            // 全部连续命中会把两侧装甲都算进溅射衰减 → HE 溅射伤害被过度衰减而误判
            // BLOCKED(服务器同发判有伤害)。修正：HE 只保留【第一个非 deco 命中】为爆炸点——
            // 该首触面取自厚度累计去重之前（firstPhysicalHit），同板去重不得移动爆炸点。
            // AP/APCR/HEAT 的多层穿透语义不变。
            // HE 的爆炸点 = 去重前的首个物理接触面（firstContact）：厚度累计的同板去重
            // 只决定层链，不改变「HE 碰到第一层表面即爆炸」的契约（近背远正时若用层链
            // 首层，会把爆点推到更远的入射面）。
            const first = firstContact || armorHits[0];
            // HEAT 的间隙衰减从首个物理接触面量起：同板去重删掉近侧接触面后，把请求
            // 首层的间距原点前移到该接触点（GPU 以最近屏幕深度为原点），否则 gap 被
            // 缩短、衰减被低估（近背远正的空心壳会少算整段内部行程）。仅影响 HEAT。
            const checkHits: JudgmentHit[] = shellTypeNow === 'heat'
                ? withGapOrigin(armorHits, firstContact)
                : armorHits;
            const hitsForCheck: JudgmentHit[] = shellTypeNow === 'he' ? [first] : checkHits;
            const point = first.point;
            // ===== 片元交叉验证：raycast 装甲片 ↔ 游戏原生 segment armor_group =====
            // segment（type=32 命中通知，服务器权威）给出命中装甲组。一致 → 标记绿色（高置信），
            // 不一致 → 红色保留 raycast 点（差异可能来自炮塔/炮管姿态近似）。
            const segCtx = window.__shotCtx || {};
            let fragOk = null;
            if ((segCtx.segArmorGroup ?? 0) > 0) {
                const pid = parseInt(String(first.plateId), 10);
                fragOk = (!isNaN(pid)) && pid === segCtx.segArmorGroup;
            }
            if (window.__hitMarker) { getFxScene().remove(window.__hitMarker); window.__hitMarker = null; }
            const markerColor = fragOk === true ? 0x22cc44 : (fragOk === false ? 0xff2222 : 0xffcc00);
            const markerGeo = new THREE.SphereGeometry(0.08, 16, 12);
            const markerMat = new THREE.MeshBasicMaterial({ color: markerColor, transparent: true, opacity: 0.9, depthTest: false });
            const marker = new THREE.Mesh(markerGeo, markerMat);
            marker.position.copy(point);
            marker.renderOrder = 999;
            getFxScene().add(marker);
            window.__hitMarker = marker;
            const ringGeo = new THREE.RingGeometry(0.12, 0.18, 24);
            const ringMat = new THREE.MeshBasicMaterial({ color: markerColor, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthTest: false });
            const ring = new THREE.Mesh(ringGeo, ringMat);
            // 靶环永远在最上层（球壳 996 / 轨迹 997 / 命中点 999）：renderOrder 不继承父级。
            ring.renderOrder = 1000;
            // 圆环面垂直入射弹向（命中点的"靶环"语义）；无弹向时回退朝向相机
            const ringDir = (window.__segRay && window.__segRay.dir)
                ? point.clone().add(window.__segRay.dir.clone()) : getCamera().position;
            ring.lookAt(ringDir);
            marker.add(ring);
            window.__hitMarkerRing = ring;
            if (fragOk !== null && window.__shotCtx) {
                window.__shotCtx.fragValidated = fragOk;
                console.log('[shot-replay] 片元验证:', fragOk ? '✓ 一致' : '✗ 不一致',
                    'raycast=' + first.section + '#' + first.plateId, 'segment_group=' + segCtx.segArmorGroup);
            }
            // world 复现模式：射线/交点在世界系，判定请求需模型局部米制（/api/penetrate
            // 语义）——经 worldToLocal 刚体逆变换换算；相对模式模型在原点未旋转，世界=局部。
            const worldPen = window.__worldPenMode === true && !!models.armorModel.parent;
            const toLocalPt = (p: THREE.Vector3) => (worldPen ? models.armorModel!.worldToLocal(p.clone()) : p.clone());
            // 判定入射方向 = 实际判定射线的方向（§七补4/补5：__segRay = P1→P2 解码弦，
            // 世界系，与 raycast 同源）。勿用炮口弦或模型局部系方向：前者与 P1→P2 射线
            // 是两条不同方向的线（入射角会被弦方向污染），后者与世界系命中法线做点积
            // 属坐标系混用（模型有偏航/坡度俯仰时角度全错）。
            const viewDir = (window.__segRay)
                ? window.__segRay.dir.clone()
                : (__shotRayOrigin && __shotRayTarget)
                    ? __shotRayOrigin.clone().sub(point).normalize()
                    : getCamera().position.clone().sub(point).normalize();
            const incomingDirection = getRaycaster().ray.direction.clone();
            const shotRayO = (window.__segRay || __shotRayOrigin)
                ? getRaycaster().ray.origin.clone() : null;

            // 命中距离（米）：射击复现 = 真实炮口(method29 launchPoint) → 命中点，
            // × getWorldMetersPerUnit() 换算回真实米数；其他模式回退炮管几何/相机距离。
            // 交战距离（米）：射击复现 = 服务器解码弹道长度（ball_a→via…→ball_b 折线总长，
            // 跳弹链逐段计入——实弹飞行到命中点所走的距离，用户裁定 2026-10-13）；
            // 静态检视 = 相机 → 命中点。均 × getWorldMetersPerUnit() 换算真实米数。
            const shotLenForDist = (window.__shotCtx && window.__shotCtx.shot)
                ? shotBallisticLength(window.__shotCtx.shot) * (getWorldMetersPerUnit() || 1) : 0;
            const dist = shotLenForDist > 0
                ? shotLenForDist
                : point.distanceTo(getCamera().position) * (getWorldMetersPerUnit() || 1);

            const shellType = shellTypeOf(getSelectedShell()!);
            const pen = getSelectedShell() ? (getSelectedShell()!.penetration || 0) : 0;
            const dmg = getSelectedShell() ? (getSelectedShell()!.damage || 0) : 0;
            const modDmg = getSelectedShell() ? (getSelectedShell()!.module_damage || 0) : 0;   // 仅显示用
            // doPenetrationCheck 的入口 guard 已保证 > 0；这里不再有 120mm 静默默认。
            const caliber = resolveShotCaliber();
            const isHE = shellType === 'he';
            const eqCal = effectiveCalibrated(null);
            const eqEnh = effectiveEnhanced(null);
            // 距离衰减（对齐客户端指示器 0x719740）：交战距离 = 射线起点（射击复现 =
            // 真实炮口；静态检视 = 炮管几何/相机）到命中点，全模式自动检测。
            // d≤100m 或 HE 恒 near；d>100m 非 HE 线性衰减至 far。
            const effDistM = dist;
            const penDisp = pen * shellPenMul(getSelectedShell());
            const mpu = getWorldMetersPerUnit() || 1;
            // 每发弹参数（blitzkit：normalization ?? 0；ricochet 仅非 explosive 弹使用）
            const shellNormDeg = (getSelectedShell() && getSelectedShell()!.normalization != null) ? getSelectedShell()!.normalization : null;
            const shellRicoDeg = (getSelectedShell() && (getSelectedShell()!.ricochet ?? 0) > 0) ? (getSelectedShell()!.ricochet ?? null) : null;

            // HE：Armor Inspector func7695 的 800 条世界空间方向采样。
            // 复用点击链同一碰撞包（名义层厚 + section）。采样原点沿**射向反方向
            // （朝射手）**外移 10cm：AI 的最佳样本层距离逐个目标都等于
            // 0.1×|cos(shot, plateNormal)|（T-34 0.0496 / Pz IV 0.0751 /
            // D2 0.0593 / M3 0.0511 / Vickers 0.0607），沿命中法线固定 5cm 只
            // 能碰巧对上 T-34，会把 Pz IV 的 d 少算 2.5cm。半径缺失/<=0 时
            // fail-closed：不猜，回退单射线同公式兜底。
            const heRadius = isHE ? ((getSelectedShell() && getSelectedShell()!.explosion_radius) || 0) : 0;
            let heSplash: HeSplashResult | null = null;
            // 采样器**跑不了**时的显式错误（传给判定层 → ERROR 卡，不用单射线冒充）。
            // 采样器跑了但零有效射线不是错误：sampleHeSplash 返回 samples:0 的权威结果。
            let heSplashError: string | null = null;
            // 爆点外向方向：__segRay.dir 是 P1→P2（指向目标），反转得到朝射手方向；
            // 静态检视的 viewDir 已是“命中点→相机”。采样与可视化共用同一方向，
            // 保证采样失败时半径球/热力图中心仍是 0.1m 外移后的真实爆点。
            const heOutsideDir = isHE
                ? (window.__segRay ? window.__segRay.dir.clone().negate() : viewDir.clone())
                : null;
            if (heOutsideDir && heOutsideDir.lengthSq() < 1e-12) heOutsideDir.copy(first.normal);
            if (isHE) {
                if (!(heRadius > 0) || !(dmg > 0)) {
                    heSplashError = 'shell-data:explosion-radius-or-damage';
                    console.error('[he-splash] shell data incomplete — splash sampling unavailable:', heSplashError);
                } else {
                    // 姿态未变时复用跳弹包（世界系几何同一份）；姿态脏才重建。
                    const splashGeo = hm.buildSplashGeometry();
                    const hePack = splashGeo.pack;
                    const heGrid = splashGeo.grid;
                    if (!hePack.ok) {
                        heSplashError = 'collision-pack:' + (hePack.reason || 'unknown');
                        console.error('[he-splash] collision pack failed — splash sampling unavailable:', heSplashError);
                    } else {
                        if (!heGrid || !heGrid.ok) {
                            heSplashError = 'collision-grid:' + ((heGrid && heGrid.reason) || 'missing');
                            console.error('[he-splash] collision grid failed — splash sampling unavailable:', heSplashError);
                        } else {
                            heSplash = sampleHeSplash(hePack, point, {
                                originDir: heOutsideDir,
                                normal: first.normal,
                                damage: dmg,
                                explosionRadius: heRadius,
                                liningFactor: equipmentCoeffs().thickMul,
                                grid: heGrid,
                                // 与点击链同口径：gun_mask 裁切面之后的炮管命中不参与采样。
                                clipPlane: hm.getGunClipPlane(),
                            });
                            if (!heSplash) {
                                heSplashError = 'sampler:invalid-input';
                                console.error('[he-splash] sampler rejected its inputs:', heSplashError);
                            }
                        }
                    }
                }
            }
            // HE 热力图中心 + 半径球面。热力图基础色按每块板自身的
            // thickness + spacedThick 与到爆点的距离计算，不再用方向累计装甲。
            if (isHE && heRadius > 0) {
                // 半径球/热力图中心 = 采样器的真实爆点（点击面沿射向退 0.1m）；
                // 采样失败（无有效 Primary/碰撞包失败）也保持同一外移原点，
                // 不能退回未偏移的点击表面（评审 P2）。
                const heCenter = (heSplash && Array.isArray(heSplash.origin))
                    ? new THREE.Vector3(heSplash.origin[0], heSplash.origin[1], heSplash.origin[2])
                    : point.clone().addScaledVector(heOutsideDir || first.normal, HE_SAMPLE.ORIGIN_OFFSET);
                hm.setHeHeatmapCenter(heCenter);
                hm.updateHeHeatmapUniforms();
                hm.updateHeSplashVisual(heCenter, heRadius);
            } else {
                hm.clearHeBlast();
            }
            // 默认视图：HE 渐变叠加层随点击判定建/放（击穿视图下本调用是空操作）。
            hm.syncHeatOverlay();

            // blitzkit shoot() 只用 near 穿深（无距离衰减）；dist 仅用于显示
            // 射击复现：射线只命中外部模块/间隙甲时按 BLOCKED/0 伤处理（服务器 result=1/2/4）；
            // 相机点击保持 BlitzKit 末层语义（不传该门禁）。
            const requirePrimary = window.__worldPenMode === true;
            const req: PenetrationRequest = {
                shell_type: shellType, shell_type_id: getSelectedShell() ? (getSelectedShell()!.type_id ?? null) : null,
                penetration: pen,
                caliber: caliber,
                damage: dmg,
                // 与采样/半径球同一来源：缺失或 0 即 fail-closed（不再单方面回退 3m，
                // 否则卡片声称 3m 溅射而热力图/球体被禁用——评审 P2）。
                explosion_radius: isHE ? heRadius : 0,
                calibrated_shells: eqCal,
                enhanced_armor: eqEnh,
                normalization_deg: shellNormDeg,
                ricochet_deg: shellRicoDeg,
                allow_ricochet: true,
                require_primary: requirePrimary,
                // 距离衰减（对齐客户端指示器 0x719740）：d>100 且 far>0 才生效；
                // penetration_far 随 tank/{id}.json 透出（数据缺失 → undefined → 不衰减）
                distance_m: effDistM > 0 ? effDistM : undefined,
                penetration_far: (getSelectedShell() && (getSelectedShell()!.penetration_far ?? 0) > 0)
                    ? (getSelectedShell()!.penetration_far ?? undefined)
                    : undefined,
                // Armor Inspector 800 射线采样。三态：采样结果（samples 可为 0 = 权威零伤害）/
                // null + he_splash_error（采样器跑不了 → ERROR 卡）/ 两者皆无（仅上游纯函数）。
                he_splash: heSplash,
                he_splash_error: heSplashError,
                view_dir: [viewDir.x, viewDir.y, viewDir.z],
                hits: hitsForCheck.map(ah => {
                    const lp = toLocalPt(ah.point);
                    return {
                        section: ah.section,
                        plate_id: ah.plateId,
                        thickness: ah.thickness,
                        normal: [ah.normal.x, ah.normal.y, ah.normal.z],
                        point: [lp.x * mpu, lp.y * mpu, lp.z * mpu],
                        part_name: ah.partName,
                        // 客户端扩展：首层的物理首触面（只用于跳弹判定，不参与厚度几何）
                        ...(ah.contact_normal ? {
                            contact_normal: [ah.contact_normal.x, ah.contact_normal.y, ah.contact_normal.z],
                            contact_point: (() => {
                                const cp = toLocalPt(ah.contact_point!);
                                return [cp.x * mpu, cp.y * mpu, cp.z * mpu];
                            })(),
                            contact_thickness: ah.contact_thickness,
                            contact_part_name: ah.contact_part_name || null,
                        } : {}),
                    };
                }),
            };

            // 判定客户端执行（penetration.js 移植，上游 Rust calculate 同源单测锁定）；
            // wire 形状与 /api/penetrate 响应一致，消费链无感
            judgePenetration(req).then(async res => {
                if (isDestroyed() || penSeq !== __penCheckSeq) return;   // 过期响应：更新位姿的判定已在途，直接丢弃
                const deterministicMatches = matchHitsByOccurrence(res.layers, hitsForCheck) as Array<JudgmentHit | undefined>;
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
                const probabilityMatches = matchHitsByOccurrence(res.probability_layers, hitsForCheck) as Array<JudgmentHit | undefined>;
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
                            if (isDestroyed() || penSeq !== __penCheckSeq) return;
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
            }).catch(err => {
                if (isDestroyed() || penSeq !== __penCheckSeq) return;   // 过期请求的失败不覆盖最新结果
                console.error('Penetration API error:', err);
                tc.showTrajectory(point, 'ERROR', 0, [], penDisp, dmg, modDmg, dist, shotRayO, 0, null, null, false);
            });
        }
    return {
        onClick, showArmorPartInfo, classifyHit, intersectArmorDoubleSidedSpaced,
        collectJudgmentHits, resolveCaliberFor, doPenetrationCheck, isEffectivelyVisible,
        resolveShotCaliber: () => resolveCaliberFor(getSelectedShell()),
        setShotRay(origin: THREE.Vector3 | null, target: THREE.Vector3 | null) { __shotRayOrigin = origin; __shotRayTarget = target; },
        clearShotRay() { __shotRayOrigin = null; __shotRayTarget = null; },
        bumpPenSeq() { __penCheckSeq++; },
        getJudgmentCount: () => judgmentCount,
        getLastClickNdc: () => lastClickNdc,
        setLastClickNdc(v: { x: number; y: number } | null) { lastClickNdc = v; },
        clearLastClickNdc() { lastClickNdc = null; },
    };
}
