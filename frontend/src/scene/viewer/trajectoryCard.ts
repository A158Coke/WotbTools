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

export interface TrajectoryCardLayer extends ShotResultCardLayer {
    point: THREE.Vector3
}

export interface TrajectoryCardOptions {
    blockedNoPrimary?: boolean
    probabilityMode?: boolean
    heInfo?: ShotResultCardHeInfo | null
    heDirectHit?: { name: string; thickness: number } | null
}

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
    markTrajInfoDirty(): void
    armorDebugPanel(snapshot: NonNullable<Window['__armorDebugLast']>): void
    tidyTrajectory(): void
    clearTrajInfoPos(): void
    setTrajInfoPos(v: THREE.Vector3 | null): void
    clearTrajGroup(): void
    getTrajInfoPos(): THREE.Vector3 | null
}

export interface TrajectoryCardDeps {
    isDestroyed: () => boolean
    clearShotError: () => void
    clearHeBlast: () => void
    getFxScene: () => THREE.Scene
    getCamera: () => THREE.Camera
    L: ShotResultCardLabels
    armorDebug: () => boolean
}

export function createTrajectoryCard(deps: TrajectoryCardDeps): TrajectoryCardHandle {
    const { isDestroyed, clearShotError, clearHeBlast, getFxScene, getCamera, L, armorDebug } = deps
    let trajGroup: THREE.Group | null = null;
    let trajInfoPos: THREE.Vector3 | null = null;
    let trajAnchorWorld: THREE.Vector3 | null = null;
    let lastAnchor: { x: number; y: number } | null = null;
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
            allowChance = allowChance && !blockedNoPrimary;
            const heInfo = options.heInfo || null;
            const rawHeChance = heInfo ? heInfo.chance : 0;
            const heChance = typeof rawHeChance === 'number' && Number.isFinite(rawHeChance) ? rawHeChance : 0;
            const heDirectHit = options.heDirectHit || null;
            if (armorDebug()) {
                window.__heCardDebug = {
                    heDirectHit,
                    l0: layers[0] ? { name: layers[0].name, thickness: layers[0].thickness, eff: layers[0].eff, angle: layers[0].angle } : null,
                    heBest: heInfo && heInfo.best ? { armor: heInfo.best.armor, layers: heInfo.best.layers } : null,
                };
            }
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
            let rawChance = 0;
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
            const { chance: cardChance } = resolveCardChance({
                heInfo, heChance, probabilityMode, overallChance, rawChance, allowChance,
            });
            const partialChainLayers = !probabilityMode && chancePartial
                ? evaluateProbabilityChain(chancePen, probLayers).layers
                : null;
            const nextPartialChance = createPartialChanceResolver(partialChainLayers);
            const layerRoles = (displayLayers as ReadonlyArray<ShotResultCardLayer>).map((l) => layerResultRole({
                layer: l,
                probabilityMode,
                blockedNoPrimary,
                partialChance: probabilityMode ? null : nextPartialChance(l),
            }));

            if (trajGroup) { getFxScene().remove(trajGroup); disposeOverlayObject(trajGroup); trajGroup = null; }

            const resultRole: ShotResultRole = resultRoleForCardDisplay({
                result,
                heInfo,
                heChance,
                probabilityMode,
                overallChance,
                chancePartial,
            });
            const hitPointRole = resultRoleForHitPoint({
                layerRoles,
                resultRole,
                hasPerLayerDisplay: !heInfo,
            });
            if (window.__hitMarker) setOverlayDotColor(window.__hitMarker, sceneResultColor(hitPointRole));
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
            const cardHost = document.getElementById('canvas-container');
            const cardHostRect = cardHost ? cardHost.getBoundingClientRect() : null;
            const compactCard = isCompactShotResultCard(window.innerWidth, window.innerHeight);
            const cardMetrics = shotResultCardMetrics(compactCard, shotResultCardScale(window.innerWidth, window.innerHeight));
            const cardMaxWidth = resultCardMaxWidth(cardHostRect ? cardHostRect.width : 0, window.innerWidth, window.innerHeight);
            trajAnchorWorld = firstPoint.clone();
            lastAnchor = null;
            trajLayoutDirty = true;
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
            updateTrajInfoPos();
            getFxScene().add(trajGroup);
        }

function updateTrajInfoPos(): void {
            if (!trajInfoPos) return;
            const div = document.getElementById('traj-info');
            if (!div) return;
            const host = document.getElementById('canvas-container');
            const rect = host ? host.getBoundingClientRect() : null;
            if (!rect || !(rect.width > 0) || !(rect.height > 0)) { div.style.display = 'none'; return; }
            if (!trajAnchorWorld) {
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
                const maxWidth = resultCardMaxWidth(rect.width, window.innerWidth, window.innerHeight);
                if (maxWidth) div.style.maxWidth = `${maxWidth}px`;
                div.style.whiteSpace = 'normal';
                div.style.boxSizing = 'border-box';
                div.style.display = 'block';
                div.style.pointerEvents = div.scrollHeight > div.clientHeight + 1 ? 'auto' : '';
                if (maxWidth) div.style.maxInlineSize = `${maxWidth}px`;
            } else if (div.style.display === 'none') {
                div.style.display = 'block';
            }
            const anchor = (div.offsetParent as HTMLElement | null) ?? div.parentElement;
            if (!anchor) return;
            const anchorRect = anchor.getBoundingClientRect();
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
                anchorGap: 24,
                anchorGapY: 40,
                gap: 14,
                pad: 8,
            });
            const writePosition = (pos: { left: number; top: number }): void => {
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
