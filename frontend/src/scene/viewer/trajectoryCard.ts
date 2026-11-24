// 轨迹与结果卡（#820 Agent A 出仓）：trajGroup/trajInfoPos 的唯一 owner、
// 结果卡 DOM 摆位与 dev armor-debug 面板。原 tankViewer.js 闭包内对应函数整体平移。
// 判定结果卡是判定模式唯一结果窗口（2026-11-15 用户裁示）。定位契约（2026-11-16 用户裁示）：
// 卡片跟随**世界命中点的屏幕投影**——每帧用当前相机重投影，旋转视角时贴着命中点移动；
// 命中点转到相机后方时隐藏（没有可解释的屏幕位置），不再固定点击坐标或顶部停靠。
// 避让固定 HUD 仍由共享 resultCardPosition 纯函数负责；卡片与命中点额外错开
// 水平 24px / 垂直 40px（2026-11-24 用户裁示：不能贴住命中点遮挡附近装甲，
// 且卡片要再往下让一些）。
import * as THREE from 'three'
import { createShotTrajectoryGroup } from './shotTrajectoryGeometry.js'
import { disposeOverlayObject, setOverlayDotColor } from './overlayStroke.js'
import { layerResultRole, resultRoleForCardDisplay, resultRoleForHitPoint, sceneResultColor, type ShotResultRole } from './shotResultPalette.js'
import { isCompactShotResultCard, shotResultCardMaxWidth as resultCardMaxWidth, shotResultCardMetrics, shotResultCardScale } from '../../utils/shotResultCardMetrics.js'
import { createPartialChanceResolver, renderShotResultCardHtml } from './shotResultCard.js'
import { chooseResultCardPosition, type ResultCardRect } from './resultCardPosition.js'
import { projectCardAnchor } from './resultCardAnchor.js'
import { penetrationChance, evaluateProbabilityChain, resolveCardChance } from '../armorInspectorChance.js'
import type { ProbabilityChainLayer } from '../armorInspectorChance.js'
import type { ShotResultCardHeInfo, ShotResultCardLabels, ShotResultCardLayer } from './shotResultCard.js'
import type { ShotTrajectoryGeometryLayer } from './shotTrajectoryGeometry.js'

/** 卡片与轨迹共用的层链：判定保证每条展示层都已解析世界点（几何直接消费）。 */
export interface TrajectoryCardLayer extends ShotResultCardLayer {
    point: THREE.Vector3
}

/** showTrajectory 的可选展示输入（HE 卡片 / 概率模式 / 无主装甲终态）。 */
export interface TrajectoryCardOptions {
    blockedNoPrimary?: boolean
    probabilityMode?: boolean
    heInfo?: ShotResultCardHeInfo | null
    heDirectHit?: { name: string; thickness: number } | null
}

/** 轨迹/结果卡 owner 的公开句柄（调用方只通过这些方法访问本模块状态）。 */
export interface TrajectoryCardHandle {
    showTrajectory(
        firstPoint: THREE.Vector3,
        result: string,
        totalEff: number,
        layers: ReadonlyArray<TrajectoryCardLayer>,
        penVal: number,
        dmgVal: number,
        modDmgVal: number,
        distVal: number,
        trajOrigin: THREE.Vector3 | null,
        dmgDealt: number,
        probabilityLayers?: ReadonlyArray<ProbabilityChainLayer> | null,
        probabilityPen?: number | null,
        allowChance?: boolean,
        options?: TrajectoryCardOptions,
    ): void
    updateTrajInfoPos(): void
    /** 卡片尺寸/视口变化后标记重新定位（resize、展开/收起）。 */
    markTrajInfoDirty(): void
    armorDebugPanel(snapshot: NonNullable<Window['__armorDebugLast']>): void
    tidyTrajectory(): void
    clearTrajInfoPos(): void
    setTrajInfoPos(v: THREE.Vector3 | null): void
    clearTrajGroup(): void
    getTrajInfoPos(): THREE.Vector3 | null
}

/**
 * 显式依赖（composition root 注入）：本模块不持有 scene / camera / 文案。
 */
export interface TrajectoryCardDeps {
    isDestroyed: () => boolean
    /** 射击复现错误条清理（debug UI owner）。 */
    clearShotError: () => void
    /** HE 爆点/半径球清理（heatmap owner）。 */
    clearHeBlast: () => void
    getFxScene: () => THREE.Scene
    getCamera: () => THREE.Camera
    /** 界面文案。 */
    L: ShotResultCardLabels
    /** ?armordebug=1 开关。 */
    armorDebug: () => boolean
}

export function createTrajectoryCard(deps: TrajectoryCardDeps): TrajectoryCardHandle {
    const { isDestroyed, clearShotError, clearHeBlast, getFxScene, getCamera, L, armorDebug } = deps
    let trajGroup: THREE.Group | null = null;
    let trajInfoPos: THREE.Vector3 | null = null;
    /** 本次判定的世界命中点（轨迹首点）；每帧投影到画布容器，旋转视角时卡片随命中点移动。 */
    let trajAnchorWorld: THREE.Vector3 | null = null;
    /** 上次投影锚点/写入位置：仅锚点移动或 dirty 时重排，静止帧不写样式。 */
    let lastAnchor: { x: number; y: number } | null = null;
    /** 位置/宽度需要重算（内容更新、resize、展开/收起）。渲染循环每帧调用时据此跳过布局。 */
    let trajLayoutDirty = true;

function tidyTrajectory(): void {
            if (trajGroup) { getFxScene().remove(trajGroup); disposeOverlayObject(trajGroup); trajGroup = null; }
            trajInfoPos = null;
            trajAnchorWorld = null;
            lastAnchor = null;
            const trajInfo = document.getElementById('traj-info');
            if (trajInfo) trajInfo.style.display = 'none';
            const clickInfo = document.getElementById('click-info');
            if (clickInfo) clickInfo.style.display = 'none';
            // HE 爆点/半径球属于上一发判定：无命中、切车或清空轨迹时必须一起清掉，
            // 否则空白短按/不相交 tick 会保留上次爆炸的着色与球体（评审 P2）。
            clearHeBlast();
        }

function armorDebugPanel(snapshot: NonNullable<Window['__armorDebugLast']>): void {
            if (!armorDebug()) return;
            window.__armorDebugLast = snapshot;
            console.log('[armor-debug]', JSON.stringify(snapshot));
            let panel = document.getElementById('armor-debug-panel');
            if (!panel) {
                panel = document.createElement('div');
                panel.id = 'armor-debug-panel';
                // 面板挂在 body（不在 .armor-view 内），只能用全局 semantic token。
                panel.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:2147483000;max-width:min(52ch,48vw);max-height:42vh;overflow:auto;background:var(--color-surface-1);color:var(--color-text-primary);border:1px solid var(--color-border-strong);border-radius:8px;padding:8px;font:11px/1.35 ui-monospace,Consolas,monospace;box-shadow:var(--elevation-2);';
                const bar = document.createElement('div');
                bar.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:4px;';
                const title = document.createElement('b');
                title.textContent = 'armor debug';
                const copy = document.createElement('button');
                copy.type = 'button';
                copy.textContent = '复制 JSON';
                copy.style.cssText = 'margin-left:auto;padding:2px 6px;border:1px solid var(--color-border-subtle);border-radius:4px;background:var(--color-surface-2);color:var(--color-text-primary);cursor:pointer;';
                copy.addEventListener('click', () => {
                    const text = document.getElementById('armor-debug-json')?.textContent || '';
                    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject(new Error('no clipboard')))
                        .then(() => { copy.textContent = '已复制'; setTimeout(() => { copy.textContent = '复制 JSON'; }, 1200); })
                        .catch(() => { copy.textContent = '复制失败'; });
                });
                bar.append(title, copy);
                const pre = document.createElement('pre');
                pre.id = 'armor-debug-json';
                pre.style.cssText = 'margin:0;white-space:pre-wrap;overflow-wrap:anywhere;';
                panel.append(bar, pre);
                document.body.append(panel);
            }
            const pre = panel.querySelector('#armor-debug-json');
            if (pre) pre.textContent = JSON.stringify(snapshot, null, 2);
        }

function showTrajectory(
            firstPoint: THREE.Vector3,
            result: string,
            // 保留原参数位（调用方按位置传参）；总有效厚度/修正伤害不参与展示。
            _totalEff: number,
            layers: ReadonlyArray<TrajectoryCardLayer>,
            penVal: number,
            dmgVal: number,
            _modDmgVal: number,
            distVal: number,
            trajOrigin: THREE.Vector3 | null,
            dmgDealt: number,
            probabilityLayers: ReadonlyArray<ProbabilityChainLayer> | null = null,
            probabilityPen: number | null = null,
            allowChance = true,
            options: TrajectoryCardOptions = {},
        ): void {
            if (isDestroyed()) return;
            clearShotError();
            const blockedNoPrimary = options.blockedNoPrimary === true;
            const probabilityMode = options.probabilityMode === true && !blockedNoPrimary;
            // 无主装甲门禁的 BLOCKED/0 是终态：不能再用概率链的 rawChance/chancePartial
            // 把标题/伤害回填成“可能击穿 + 满伤”。
            allowChance = allowChance && !blockedNoPrimary;
            // HE 采样（Armor Inspector func7695）：min/max 是两个 roll 界的最大值，
            // avg 取中点；概率由外层 CDF 给出，expected = full*p + avg*(1-p)。
            const heInfo = options.heInfo || null;
            const rawHeChance = heInfo ? heInfo.chance : 0;
            // 卡片 HE 字段经索引签名透传（unknown）：非有限数字按 0 处理，与旧运行时一致。
            const heChance = typeof rawHeChance === 'number' && Number.isFinite(rawHeChance) ? rawHeChance : 0;
            const heDirectHit = options.heDirectHit || null;
            if (armorDebug()) {
                window.__heCardDebug = {
                    heDirectHit,
                    l0: layers[0] ? { name: layers[0].name, thickness: layers[0].thickness, eff: layers[0].eff, angle: layers[0].angle } : null,
                    heBest: heInfo && heInfo.best ? { armor: heInfo.best.armor, layers: heInfo.best.layers } : null,
                };
            }
            // AP/APCR/HEAT 的统一判定：使用完整概率链作为唯一层链，逐层累计概率
            // 决定层点颜色；HE/跳弹/续飞仍走确定性分支。
            const probLayers: ReadonlyArray<ProbabilityChainLayer> = Array.isArray(probabilityLayers) && probabilityLayers.length > 0
                ? probabilityLayers : layers;
            const firstRemain = probLayers.length > 0
                ? (probLayers[0].remaining_before ?? probLayers[0].remainBefore)
                : null;
            const chancePen = typeof probabilityPen === 'number' && Number.isFinite(probabilityPen)
                ? probabilityPen
                : (typeof firstRemain === 'number' && Number.isFinite(firstRemain) ? firstRemain : penVal);
            let probabilityEval: ReturnType<typeof evaluateProbabilityChain> | null = null;
            let overallChance: number | null = null;
            let chancePct = 0;
            // 精确概率（未取整）用于卡片显示：0.4% 必须显示 <1%、99.6% 显示 >99%，
            // 不能先取整成 0/100 再交给 formatProbabilityPercent（评审 P2）。
            let rawChance = 0;
            // 展示层链：概率模式替换为累计概率链；所有展示层都携带世界点（领域不变量）。
            let displayLayers: ReadonlyArray<ShotResultCardLayer> = layers;
            if (probabilityMode) {
                probabilityEval = evaluateProbabilityChain(chancePen, probLayers);
                overallChance = probabilityEval.chance;
                rawChance = overallChance;
                chancePct = Math.round(overallChance * 100);
                displayLayers = probabilityEval.layers;
            } else {
                rawChance = probLayers.length > 0 ? penetrationChance(chancePen, probLayers) : 0;
                chancePct = Math.round(rawChance * 100);
            }
            const overall = overallChance ?? 0;
            const hasChance = probabilityMode && overall > 0;
            const probabilityPartial = hasChance && overall < 1;
            const chancePartial = probabilityMode
                ? probabilityPartial
                : (allowChance && chancePct > 0 && chancePct < 100);
            // 统一击穿概率（所有弹种卡片都显示，含 0% / 100%）：
            // AP/APCR/HEAT 用概率链/穿透链，HE 用 CDF 概率；模块首面 HE 为 0%。
            // 无效 HE 数据（零/缺失半径 → heInfo=null, allowChance=false）由该 helper
            // fail-closed 为 0%，概率行不会沿用 rawChance 显示 100%/50%。
            const { chance: cardChance } = resolveCardChance({
                heInfo, heChance, probabilityMode, overallChance, rawChance, allowChance,
            });
            // 续飞 1–99% 的逐层局部概率链：卡片层行与 3D 接触点共用同一份结果。
            const partialChainLayers = !probabilityMode && chancePartial
                ? evaluateProbabilityChain(chancePen, probLayers).layers
                : null;
            const nextPartialChance = createPartialChanceResolver(partialChainLayers);
            // 逐层结果角色只算一次：结果卡行圆点与轨迹层点都直接消费该数组，
            // 不再各自维护颜色分支（2026-11-24 用户裁示）。
            const layerRoles = (displayLayers as ReadonlyArray<ShotResultCardLayer>).map((l) => layerResultRole({
                layer: l,
                probabilityMode,
                blockedNoPrimary,
                partialChance: probabilityMode ? null : nextPartialChance(l),
            }));

            if (trajGroup) { getFxScene().remove(trajGroup); disposeOverlayObject(trajGroup); trajGroup = null; }

            // 射线/卡片标题共用最终展示结果：HE 0% 但有溅射 = SPLASH 橙、
// 续飞最终段 1–99% = 可能击穿黄、HE 采样不可用 = 红；不能只按确定性结果串，
// 否则射线会与卡片标题/边框不一致（2026-11-24 用户反馈）。
            const resultRole: ShotResultRole = resultRoleForCardDisplay({
                result,
                heInfo,
                heChance,
                probabilityMode,
                overallChance,
                chancePartial,
            });
            // 命中点在判定请求期间是中性色；结果返回后改用**首层角色**：
            // 普通弹的命中点落在首层接触面，必须和卡片第一层行同色。双层装甲
            // 首层可穿、次层挡下时，命中点为绿，整体“未击穿”由射线/标题表达。
            // HE 溅射没有逐层穿透语义，回退到最终展示结果（橙/红）。
            const hitPointRole = resultRoleForHitPoint({
                layerRoles,
                resultRole,
                hasPerLayerDisplay: !heInfo,
            });
            if (window.__hitMarker) setOverlayDotColor(window.__hitMarker, sceneResultColor(hitPointRole));
            // 轨迹几何已出仓 viewer/shotTrajectoryGeometry.ts（Wave B3B）：场景仍拥有
            // 判定/概率计算、getFxScene()/trajGroup 生命周期与 DOM 挂载；factory 按已算好的
            // 层链/角色构建屏幕空间射线，不挂载到任何 scene。
            // 概率评估链由原始层链 spread 而来，展示层世界点随之保留（领域不变量）。
            const { group: builtTrajGroup, lastPoint } = createShotTrajectoryGroup({
                firstPoint,
                cameraPosition: getCamera().position,
                trajOrigin,
                layers: displayLayers as ReadonlyArray<ShotTrajectoryGeometryLayer>,
                layerRoles,
                resultRole,
                probabilityMode,
            });
            trajGroup = builtTrajGroup;
            trajInfoPos = lastPoint;
            const div = document.getElementById('traj-info');
            if (!div) return;
            // 结果面板 presentation 已出仓 viewer/shotResultCard.ts（Wave B3A）：场景仍拥有
            // 判定/概率计算、轨迹几何与 DOM 挂载；卡片 HTML 由纯 renderer 按已算好的输入渲染。
            // 卡片宽度以画布容器为界（不是视口）：窄屏/侧栏画布下整张卡片（含顶行、
            // 标题/伤害行）都能换行，不能只限制最佳样本子行（评审 P1/P2）。
            const cardHost = document.getElementById('canvas-container');
            const cardHostRect = cardHost ? cardHost.getBoundingClientRect() : null;
            const compactCard = isCompactShotResultCard(window.innerWidth, window.innerHeight);
            // 手机端按视口短边比例缩小字号/间距（2026-11-15 用户裁示），桌面档恒为 1。
            const cardMetrics = shotResultCardMetrics(compactCard, shotResultCardScale(window.innerWidth, window.innerHeight));
            const cardMaxWidth = resultCardMaxWidth(cardHostRect ? cardHostRect.width : 0, window.innerWidth, window.innerHeight);
            // 世界命中点即定位锚点（轨迹首点 = 首触/爆点）：旋转视角后由渲染循环重新投影。
            // 射击复现/初始自动判定同样有世界命中点，不再走顶部停靠（2026-11-16 用户裁示）。
            trajAnchorWorld = firstPoint.clone();
            lastAnchor = null;
            trajLayoutDirty = true;
            // 跳弹续飞的非 probabilityMode 分支也保留逐层概率色（最终段 1–99% 时标题是
            // “可能击穿”）：概率链累计是领域计算，在调用方预算后交给 renderer 着色。
            div.innerHTML = renderShotResultCardHtml({
                result, layers: displayLayers, layerRoles, partialChainLayers, chancePen,
                dmgVal, distVal, dmgDealt, resultRole,
                fragValidated: window.__shotCtx?.fragValidated ?? null,
                cardChance, heInfo, heChance, heDirectHit,
                probabilityMode, overallChance: overall, hasChance, chancePartial, blockedNoPrimary,
                cardMetrics, cardMaxWidth, labels: L,
            });
            if (armorDebug() && window.__armorDebugLast) {
                window.__armorDebugLast.card = (div.textContent || '').replace(/\s+/g, ' ').slice(0, 600);
                window.__armorDebugLast.chancePct = chancePct;
                window.__armorDebugLast.chancePartial = chancePartial;
                armorDebugPanel(window.__armorDebugLast);
            }
            // 轨迹线与轨迹面板无条件展示(用户要求:与正常点击判定一致的轨迹展示)
            updateTrajInfoPos();
            // renderOrder 997（溅射球壳 996 之上、命中标记 999 之下）由 factory 统一设置。
            getFxScene().add(trajGroup);
        }

function updateTrajInfoPos(): void {
            // 无判定结果时不做任何事：隐藏由清理路径（tidyTrajectory / 无结果出口）显式负责。
            // 这里若顺手隐藏，宿主在“卡片只是被夹具/外部显示”时会被误清（门禁与调试夹具）。
            if (!trajInfoPos) return;
            const div = document.getElementById('traj-info');
            if (!div) return;
            const host = document.getElementById('canvas-container');
            const rect = host ? host.getBoundingClientRect() : null;
            if (!rect || !(rect.width > 0) || !(rect.height > 0)) { div.style.display = 'none'; return; }
            // 渲染循环每帧都会调到这里：锚点 = 世界命中点，相机一旋转投影就变，必须逐帧重排。
            // 静止帧仅在 dirty（内容/resize/展开）或锚点移动 ≥0.5px 时写样式。
            if (!trajAnchorWorld) {
                // 防御回退：正常路径（showTrajectory/setTrajInfoPos）总会同时设置世界锚点；
                // 没有锚点时交还 CSS 顶部停靠，而不是留下上一次的脚本定位。
                if (!trajLayoutDirty) return;
                trajLayoutDirty = false;
                lastAnchor = null;
                div.style.maxInlineSize = '';
                div.style.left = '';
                div.style.top = '';
                div.style.insetInlineStart = '';
                div.style.insetBlockStart = '';
                div.style.transform = '';
                return;
            }
            const projected = projectCardAnchor(trajAnchorWorld, getCamera(), rect.width, rect.height);
            if (!projected || !projected.inFront) {
                // 命中点不可解释（非有限值 / 在相机后方或近平面内）：隐藏卡片。
                // 旋转视角经过背面时不做“固定到某个边角”的假跟随，转到正面会重新显示。
                div.style.display = 'none';
                lastAnchor = null;
                return;
            }
            const moved = !lastAnchor
                || Math.abs(projected.x - lastAnchor.x) >= 0.5
                || Math.abs(projected.y - lastAnchor.y) >= 0.5;
            if (!trajLayoutDirty && !moved) return;
            lastAnchor = { x: projected.x, y: projected.y };
            const wasHidden = div.style.display === 'none';
            if (trajLayoutDirty) {
                // 卡片宽度跟画布容器走（侧栏/窄画布不能按视口算），窗口缩放后同步刷新；
                // 紧凑档（竖屏手机 / 横屏矮视口）再封顶 360px 且不超过画布宽 82%，
                // 跟随命中点后不能铺满手机视口（2026-11-15 用户裁示）。
                const maxWidth = resultCardMaxWidth(rect.width, window.innerWidth, window.innerHeight);
                if (maxWidth) div.style.maxWidth = `${maxWidth}px`;
                div.style.whiteSpace = 'normal';
                div.style.boxSizing = 'border-box';
                div.style.display = 'block';
                // 桌面/平板默认 pointer-events:none（结果卡跟随命中点后可能盖住车体，场景点击
                // 必须继续判定）；但被 max-block-size 裁剪的明细必须仍可滚动——内容溢出时恢复
                // 指针事件（滚轮/触控/滚动条），内容回落再交还穿透（评审 P2，2026-11-15）。
                div.style.pointerEvents = div.scrollHeight > div.clientHeight + 1 ? 'auto' : '';
                // 只有脚本接管的跟随态写逻辑宽度；停靠回退由 CSS 的窄横屏上限拥有。
                if (maxWidth) div.style.maxInlineSize = `${maxWidth}px`;
            } else if (div.style.display === 'none') {
                // 从相机后方转回可见：恢复显示，沿用现有尺寸。
                div.style.display = 'block';
            }
            // 卡片是 absolute，left/top 相对 offsetParent；投影锚点在 #canvas-container 坐标系
            // （与 offsetParent 同尺寸同原点）。参考系不一致时显式换算，避免偏移误差。
            const anchor = (div.offsetParent as HTMLElement | null) ?? div.parentElement;
            if (!anchor) return;
            const anchorRect = anchor.getBoundingClientRect();
            // 固定 HUD 面板（与 browser armor 门禁同口径）：#corner-tl = 左上信息胶囊 + 参数入口，
            // .armor-back = 返回键，#corner-tr = 右下射击卡，#turret-controls = 左下姿态卡，
            // .armor-shot-view-switch = 单发分析页右下视角切换（不与结果卡相交）。
            const panels: ResultCardRect[] = [];
            for (const selector of ['#corner-tl', '#corner-tr', '#turret-controls', '.armor-back', '.armor-shot-view-switch']) {
                const el = document.querySelector(selector) as HTMLElement | null;
                if (!el) continue;
                const style = getComputedStyle(el);
                if (style.display === 'none' || style.visibility === 'hidden') continue;
                const r = el.getBoundingClientRect();
                if (r.width <= 0 || r.height <= 0) continue;
                panels.push({ left: r.left - anchorRect.left, top: r.top - anchorRect.top, right: r.right - anchorRect.left, bottom: r.bottom - anchorRect.top });
            }
            // 旧 left 会约束 absolute + width:auto 卡片的 shrink-to-fit 宽度：卡片隐藏期间画布
            // 变窄后恢复时，先按旧位置量宽会把卡片量小，落位后实际更宽/更高，而静止帧不再
            // 重排 → HUD 避让永久失效。dirty/恢复显示时先把位置归零再测量，解除旧位置约束；
            // 落位后再用实际尺寸做有界重排（普通跟随帧也只多一次测量）。
            if (trajLayoutDirty || wasHidden) {
                div.style.left = '0px';
                div.style.top = '0px';
                div.style.insetInlineStart = '0px';
                div.style.insetBlockStart = '0px';
                div.style.transform = 'none';
            }
            const place = (width: number, height: number) => chooseResultCardPosition({
                clickX: projected.x + (rect.left - anchorRect.left),
                clickY: projected.y + (rect.top - anchorRect.top),
                width,
                height,
                viewportWidth: anchorRect.width,
                viewportHeight: anchorRect.height,
                panels,
                // 结果卡与命中点错开：水平 24px、垂直 40px。命中点/层点及周围装甲是用户
                // 正在读的画面，卡片不能贴着命中点压上去，且通常向下多让一些
                //（2026-11-24 用户裁示）。
                anchorGap: 24,
                anchorGapY: 40,
                gap: 14,
                pad: 8,
            });
            const writePosition = (pos: { left: number; top: number }): void => {
                // CSS 的停靠规则用 logical inset + translateX(-50%)：物理与逻辑两个方向都写同一
                // 像素值并覆盖 transform。**不能写 inset-*: auto**：同一内联声明块里逻辑属性若
                // 排在物理 left/top 之后，会按声明顺序覆盖它们（used left/top 变回 auto → 卡片
                // 落到静态位置、跑到场景下方；browser-armor-aiming 实际抓到过）。
                div.style.insetInlineStart = `${pos.left}px`;
                div.style.insetBlockStart = `${pos.top}px`;
                div.style.left = `${pos.left}px`;
                div.style.top = `${pos.top}px`;
                div.style.transform = 'none';
            };
            let cardW = div.offsetWidth;
            let cardH = div.offsetHeight;
            let chosen = place(cardW, cardH);
            writePosition(chosen);
            for (let i = 0; i < 2; i++) {
                const actualW = div.offsetWidth;
                const actualH = div.offsetHeight;
                if (actualW === cardW && actualH === cardH) break;
                cardW = actualW;
                cardH = actualH;
                chosen = place(cardW, cardH);
                writePosition(chosen);
            }
            trajLayoutDirty = false;
        }
    return {
        showTrajectory, updateTrajInfoPos, armorDebugPanel, tidyTrajectory,
        clearTrajInfoPos() { trajInfoPos = null; trajAnchorWorld = null; lastAnchor = null; },
        setTrajInfoPos(v) {
            trajInfoPos = v;
            // 世界模式“当前 tick 不相交”提示把锚点设到观察目标：卡片同样跟随该世界点。
            trajAnchorWorld = v ? v.clone() : null;
            lastAnchor = null;
            trajLayoutDirty = true;
        },
        markTrajInfoDirty() { trajLayoutDirty = true; },
        clearTrajGroup() {
            if (trajGroup) { getFxScene().remove(trajGroup); disposeOverlayObject(trajGroup); trajGroup = null; }
            trajInfoPos = null;
            trajAnchorWorld = null;
            lastAnchor = null;
        },
        getTrajInfoPos: () => trajInfoPos,
    };
}
