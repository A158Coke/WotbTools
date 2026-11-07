// 轨迹与结果卡（#820 Agent A 出仓）：trajGroup/trajInfoPos 的唯一 owner、
// 结果卡 DOM 摆位与 dev armor-debug 面板。原 tankViewer.js 闭包内对应函数整体平移。
import * as THREE from 'three'
import { createShotTrajectoryGroup, trajectoryChanceColor } from './shotTrajectoryGeometry.js'
import { isCompactShotResultCard, shotResultCardMaxWidth as resultCardMaxWidth, shotResultCardMetrics } from '../../utils/shotResultCardMetrics.js'
import { placeShotResultCard } from '../../utils/shotResultCardPlacement.js'
import { renderShotResultCardHtml } from './shotResultCard.js'
import { penetrationChance, evaluateProbabilityChain, resolveCardChance } from '../armorInspectorChance.js'

/**
 * @param {object} deps composition root 注入的显式接口
 * @param {() => boolean} deps.isDestroyed
 * @param {() => void} deps.clearShotError 射击复现错误条清理（debug UI owner）
 * @param {() => void} deps.clearHeBlast HE 爆点/半径球清理（heatmap owner）
 * @param {() => object|null} deps.getFxScene / getCamera
 * @param {object} deps.L 界面文案
 * @param {() => boolean} deps.armorDebug ?armordebug=1 开关
 */
export function createTrajectoryCard(deps) {
    const { isDestroyed, clearShotError, clearHeBlast, getFxScene, getCamera, L, armorDebug } = deps
    let trajGroup = null;
    let trajInfoPos = null;

function tidyTrajectory() {
            if (trajGroup) { getFxScene().remove(trajGroup); trajGroup = null; }
            trajInfoPos = null;
            document.getElementById('traj-info').style.display = 'none';
            document.getElementById('click-info').style.display = 'none';
            // HE 爆点/半径球属于上一发判定：无命中、切车或清空轨迹时必须一起清掉，
            // 否则空白短按/不相交 tick 会保留上次爆炸的着色与球体（评审 P2）。
            clearHeBlast();
        }

function armorDebugPanel(snapshot) {
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

function showTrajectory(firstPoint, result, totalEff, layers, penVal, dmgVal, modDmgVal, distVal, trajOrigin, dmgDealt, probabilityLayers = null, probabilityPen = null, allowChance = true, options = {}) {
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
            const heChance = heInfo && Number.isFinite(heInfo.chance) ? heInfo.chance : 0;
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
            const probLayers = Array.isArray(probabilityLayers) && probabilityLayers.length > 0
                ? probabilityLayers : layers;
            const chancePen = Number.isFinite(probabilityPen)
                ? probabilityPen
                : (probLayers.length > 0 && Number.isFinite(probLayers[0].remaining_before ?? probLayers[0].remainBefore)
                    ? (probLayers[0].remaining_before ?? probLayers[0].remainBefore)
                    : penVal);
            let probabilityEval = null;
            let overallChance = null;
            let chancePct = 0;
            // 精确概率（未取整）用于卡片显示：0.4% 必须显示 <1%、99.6% 显示 >99%，
            // 不能先取整成 0/100 再交给 formatProbabilityPercent（评审 P2）。
            let rawChance = 0;
            if (probabilityMode) {
                probabilityEval = evaluateProbabilityChain(chancePen, probLayers);
                overallChance = probabilityEval.chance;
                rawChance = overallChance;
                chancePct = Math.round(overallChance * 100);
                layers = probabilityEval.layers;
            } else {
                rawChance = probLayers.length > 0 ? penetrationChance(chancePen, probLayers) : 0;
                chancePct = Math.round(rawChance * 100);
            }
            const hasChance = probabilityMode && overallChance > 0;
            const probabilityPartial = hasChance && overallChance < 1;
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

            if (trajGroup) getFxScene().remove(trajGroup);

            // 概率色按精确累计概率分档：0 红、0–1 黄、1 绿；显示用四舍五入百分比，
            // <1% 时显示 <1%，但伤害仍按“只要 >0”给全额（用户裁定）。
            // 卡片侧的 Css 变体（标题/概率行/层着色）已随结果卡出仓 viewer/shotResultCard.ts。
            const probabilityColorHex = trajectoryChanceColor;
            const finalOutcome = probabilityMode
                ? (overallChance >= 1 ? 'PENETRATION' : (hasChance ? 'MAY_PENETRATE' : 'BLOCKED'))
                : result.split('→').pop().trim();
            const color = probabilityMode
                ? probabilityColorHex(overallChance)
                : (finalOutcome === 'PENETRATION' ? 0x4CAF50
                    : (finalOutcome === 'RICOCHET' ? 0xFF8800
                    : (finalOutcome === 'BLOCKED' || finalOutcome === 'ERROR' ? 0xf44336 : 0xff8800)));
            // 轨迹几何已出仓 viewer/shotTrajectoryGeometry.ts（Wave B3B）：场景仍拥有
            // 判定/概率计算、getFxScene()/trajGroup 生命周期与 DOM 挂载；factory 按已算好的
            // 层链/轨迹色构建等价的 Mesh/材质/renderOrder，不挂载到任何 scene。
            const { group: builtTrajGroup, lastPoint } = createShotTrajectoryGroup({
                firstPoint,
                cameraPosition: getCamera().position,
                trajOrigin,
                layers,
                color,
                probabilityMode,
            });
            trajGroup = builtTrajGroup;
            trajInfoPos = lastPoint;
            const div = document.getElementById('traj-info');
            // 结果面板 presentation 已出仓 viewer/shotResultCard.ts（Wave B3A）：场景仍拥有
            // 判定/概率计算、轨迹几何与 DOM 挂载；卡片 HTML 由纯 renderer 按已算好的输入渲染。
            // 卡片宽度以画布容器为界（不是视口）：窄屏/侧栏画布下整张卡片（含顶行、
            // 标题/伤害行）都能换行，不能只限制最佳样本子行（评审 P1/P2）。
            const cardHost = document.getElementById('canvas-container');
            const cardHostRect = cardHost ? cardHost.getBoundingClientRect() : null;
            const compactCard = isCompactShotResultCard(window.innerWidth, window.innerHeight);
            const cardMetrics = shotResultCardMetrics(compactCard);
            const cardMaxWidth = resultCardMaxWidth(cardHostRect ? cardHostRect.width : 0, window.innerWidth, window.innerHeight);
            // 跳弹续飞的非 probabilityMode 分支也保留逐层概率色（最终段 1–99% 时标题是
            // “可能击穿”）：概率链累计是领域计算，在调用方预算后交给 renderer 着色。
            const partialChainLayers = !probabilityMode && chancePartial
                ? evaluateProbabilityChain(chancePen, probLayers).layers
                : null;
            div.innerHTML = renderShotResultCardHtml({
                result, layers, partialChainLayers, chancePen,
                dmgVal, distVal, dmgDealt, trajectoryColor: color,
                cardChance, heInfo, heChance, heDirectHit,
                probabilityMode, overallChance, hasChance, chancePartial, blockedNoPrimary,
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

function updateTrajInfoPos() {
            if (!trajInfoPos) { document.getElementById('traj-info').style.display = 'none'; return; }
            const div = document.getElementById('traj-info');
            const host = document.getElementById('canvas-container');
            const rect = host ? host.getBoundingClientRect() : null;
            if (!rect || !(rect.width > 0) || !(rect.height > 0)) { div.style.display = 'none'; return; }
            // 卡片宽度跟画布容器走（侧栏/窄画布不能按视口算），窗口缩放后同步刷新；
            // 紧凑档（竖屏手机 / 横屏矮视口）再封顶 360px，避免横屏里铺满整屏。
            const maxWidth = resultCardMaxWidth(rect.width, window.innerWidth, window.innerHeight);
            if (maxWidth) div.style.maxWidth = `${maxWidth}px`;
            div.style.whiteSpace = 'normal';
            div.style.boxSizing = 'border-box';
            const v = trajInfoPos.clone().project(getCamera());
            if (v.z > 1) { div.style.display = 'none'; return; }
            // 卡片是 position:fixed，left/top 是视口坐标；必须按画布实际矩形换算，
            // 否则页面/容器滚动或窗口缩放后画布移动而卡片停在旧视口位置。
            const x = rect.left + (v.x * 0.5 + 0.5) * rect.width;
            const y = rect.top + (-v.y * 0.5 + 0.5) * rect.height;
            const offX = 0, offY = 160;
            div.style.display = 'block';   // 先显示才能量取实际尺寸
            const w = div.offsetWidth || 300, h = div.offsetHeight || 90;
            // 可见画布内钳制（translateX(-50%)：left 是面板中心 x）
            const clipL = Math.max(rect.left, 0), clipT = Math.max(rect.top, 0);
            const clipR = Math.min(rect.right, window.innerWidth), clipB = Math.min(rect.bottom, window.innerHeight);
            if (clipR <= clipL || clipB <= clipT) { div.style.display = 'none'; return; }
            // 固定 UI 避让：不压四角与顶部信息面板（左下信息/右下按钮提示/右上栈/左上排）
            const blockers = [];
            const tc = document.getElementById('turret-controls');
            if (tc && tc.style.display !== 'none') blockers.push(tc.getBoundingClientRect());
            const addRect = (id) => {
                const el = document.getElementById(id);
                if (el) { const r = el.getBoundingClientRect(); if (r.width > 0 && r.height > 0) blockers.push(r); }
            };
            addRect('corner-br'); addRect('corner-tr'); addRect('info-panel'); addRect('tank-selectors');
            const { x: px, y: py } = placeShotResultCard({
                anchorX: x + offX,
                anchorY: y,
                offsetY: offY,
                cardWidth: w,
                cardHeight: h,
                clip: { left: clipL, top: clipT, right: clipR, bottom: clipB },
                blockers,
            });
            div.style.transform = 'translateX(-50%)';
            div.style.left = px + 'px';
            div.style.top = py + 'px';
        }
    return {
        showTrajectory, updateTrajInfoPos, armorDebugPanel, tidyTrajectory,
        clearTrajInfoPos() { trajInfoPos = null; },
        setTrajInfoPos(v) { trajInfoPos = v; },
        clearTrajGroup() { if (trajGroup) { getFxScene().remove(trajGroup); trajGroup = null; } trajInfoPos = null; },
        getTrajInfoPos: () => trajInfoPos,
    };
}
