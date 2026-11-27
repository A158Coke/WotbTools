import { defaultStateId } from '../../data/armorStates.js'
import { dollyZoomFov } from '../viewer/viewerMath.js'
import { disposeHitMarker, updateOverlayResolution } from '../viewer/overlayStroke.js'
import { resetViewerGlobals } from './viewerGlobals.js'
import type { Host } from '../tankViewer.js'
import { bind } from '../hostBind.ts'
import { byId } from './domById.ts'

function rerunAuthoritativeShotCheck(S: Host) {
            const wc = window.__worldTickCtx;
            if (!(window.__worldPenMode && wc?.launch && wc.lvDir)) return false;
            S.jc.setShotRay(wc.launch.clone(), wc.launch.clone().addScaledVector(wc.lvDir, wc.rayFar));
            S.jc.doPenetrationCheck(0, 0);
            S.jc.clearShotRay();
            return true;
        }

function refreshEquipmentEffects(S: Host) {
            const sel = document.getElementById('shell-select') as HTMLSelectElement | null;
            if (sel) {
                for (let i = 0; i < sel.options.length; i++) {
                    if (S.dl.getShooterShells() && i < S.dl.getShooterShells().length) {
                        sel.options[i].textContent = S.eqs.shellOptionText(S.dl.getShooterShells()[i]);
                    }
                }
            }
            S.hm.updateHeatmapThickness();
            if (!S.QP.get('shot') && (S.jc.getLastClickNdc() || S.hm.getHeHeatmapCenter())) {
                S.tc.tidyTrajectory();
                disposeHitMarker(S.fxScene);
                S.jc.clearLastClickNdc();
            }
            if (S.penetrationMode || S.hm.getPrimaryArmorScene()) {
                const sh = S.selectedShell || (S.dl.getShooterShells()[0]) || null;
                if (sh) { S.hm.updatePenetrationUniforms(sh); S.hm.updateSpacedUniforms(sh); }
            }
            if (S.QP.get('shot')) {
                if (!S.rerunAuthoritativeShotCheck()) S.jc.doPenetrationCheck(0, 0);
            }
            S.hm.syncHeatOverlay();
        }

function setupEventHandlers(S: Host) {
            const initialCal = document.getElementById('eq-calibrated') as HTMLInputElement | null;
            if (initialCal && S.eqs.equipmentOverride.calibrated != null) initialCal.checked = S.eqs.equipmentOverride.calibrated;
            const initialEnh = document.getElementById('eq-enhanced') as HTMLInputElement | null;
            if (initialEnh && S.eqs.equipmentOverride.enhanced != null) initialEnh.checked = S.eqs.equipmentOverride.enhanced;
            const initialPitch = document.getElementById('eq-pitch-device') as HTMLInputElement | null;
            if (initialPitch && S.eqs.equipmentOverride.pitch != null) initialPitch.checked = S.eqs.equipmentOverride.pitch;
            byId<HTMLSelectElement>('shell-select').addEventListener('change', function(this: HTMLSelectElement) {
                if (S.destroyed || S.dl.isShooterLoading()) return;
                const idx = parseInt(this.value);
                if (S.dl.getShooterShells() && idx < S.dl.getShooterShells().length) {
                    S.QP.set('shell', String(idx));
                    S.selectedShell = S.dl.getShooterShells()[idx];
                    if (S.penetrationMode || S.hm.getPrimaryArmorScene()) { S.hm.updatePenetrationUniforms(S.selectedShell); S.hm.updateSpacedUniforms(S.selectedShell); }
                    if (S.QP.get('shot')) {
                        if (!S.rerunAuthoritativeShotCheck()) S.jc.doPenetrationCheck(0, 0);
                    } else if (S.jc.getLastClickNdc() || S.hm.getHeHeatmapCenter()) {
                        S.tc.tidyTrajectory();
                        disposeHitMarker(S.fxScene);
                        S.jc.clearLastClickNdc();
                    }
                    S.hm.syncHeatOverlay();
                    S.onShellSelection?.(idx);
                }
            });

            byId<HTMLInputElement>('eq-calibrated').addEventListener('change', function(this: HTMLInputElement) {
                S.eqs.equipmentOverride.calibrated = null;
                S.refreshEquipmentEffects();
                S.onEquipmentSelection?.('calibrated', this.checked);
            });
            byId<HTMLInputElement>('eq-enhanced').addEventListener('change', function(this: HTMLInputElement) {
                S.eqs.equipmentOverride.enhanced = null;
                S.refreshEquipmentEffects();
                S.onEquipmentSelection?.('enhanced', this.checked);
            });
            const pitchToggle = document.getElementById('eq-pitch-device') as HTMLInputElement | null;
            if (pitchToggle) pitchToggle.addEventListener('change', function(this: HTMLInputElement) {
                S.eqs.equipmentOverride.pitch = null;
                S.onEquipmentSelection?.('pitch', this.checked);
            });
            byId<HTMLInputElement>('armor-state-toggle').addEventListener('change', function(this: HTMLInputElement) {
                if (!S.cvs.getArmorStateDecl()) return;
                S.cvs.setArmorState(this.checked ? S.cvs.nonDefaultStateId(S.cvs.getArmorStateDecl()) : defaultStateId(S.cvs.getArmorStateDecl()));
            });

            byId<HTMLSelectElement>('config-select').addEventListener('change', function(this: HTMLSelectElement) {
                const idx = parseInt(this.value);
                S.dl.applyConfig(idx);
                S.onConfigSelection?.(idx);
            });

            byId<HTMLButtonElement>('collision-btn').addEventListener('click', function(this: HTMLButtonElement) {
                S.collisionMode = !S.collisionMode;
                if (S.collisionMode && S.penetrationMode) {
                    S.penetrationMode = false;
                    const pb = byId('penetration-btn');
                    pb.classList.remove('active');
                    pb.setAttribute('aria-pressed', 'false');
                    S.hm.applyPenetrationMode(false);
                    S.hm.refreshPenetrationResolution();
                }
                this.classList.toggle('active', S.collisionMode);
                this.setAttribute('aria-pressed', String(S.collisionMode));
                if (!S.collisionMode) S.cvs.resetArmorFilters();
                S.setArmorFilterRowVisible(S.collisionMode);
                S.setResultLegendVisible(!S.collisionMode);
                if (!S.collisionMode) { S.cvs.resetArmorHighlight(); byId('click-info').style.display = 'none'; }
                if (!S.ml.models.armorModel) { S.hm.syncHeatOverlay(); return; }
                S.cvs.applyArmorViewStyle(S.collisionMode);
                S.hm.syncHeatOverlay();
            });

            ['primary', 'spaced', 'external'].forEach(function(name) {
                const btn = document.getElementById('filter-' + name);
                if (!btn) return;
                btn.addEventListener('click', function() {
                    S.cvs.toggleCategory(name);
                });
            });

            S.renderer.domElement.addEventListener('pointerdown', S.aim.aimPointerHandlers.down);
            S.renderer.domElement.addEventListener('pointermove', S.aim.aimPointerHandlers.move);
            S.renderer.domElement.addEventListener('pointerup', S.aim.aimPointerHandlers.up);
            S.renderer.domElement.addEventListener('pointercancel', S.aim.aimPointerHandlers.cancel);
            S.renderer.domElement.addEventListener('lostpointercapture', S.aim.aimPointerHandlers.lostCapture);

            byId('turret-controls').style.display = 'block';

            const resizeView = () => {
                if (S.destroyed) return;
                const view = document.getElementById('canvas-container');
                if (!view?.clientWidth || !view.clientHeight) return;
                S.camera.aspect = view.clientWidth / view.clientHeight;
                S.camera.updateProjectionMatrix();
                S.renderer.setSize(view.clientWidth, view.clientHeight);
                S.hm.refreshPenetrationResolution();
                const clickInfo = document.getElementById('click-info');
                if (clickInfo) clickInfo.style.display = 'none';
                S.tc.markTrajInfoDirty();
            };
            S.onWin('resize', resizeView);
            if (typeof ResizeObserver === 'function') {
                const observer = new ResizeObserver(resizeView);
                observer.observe(byId('canvas-container'));
                S.cleanups.push(() => observer.disconnect());
            }
            if (typeof ResizeObserver === 'function') {
                const hudObserver = new ResizeObserver(() => S.tc.markTrajInfoDirty());
                for (const selector of ['#corner-tl', '#corner-tr', '#turret-controls', '.armor-back', '.armor-shot-view-switch']) {
                    const el = document.querySelector(selector);
                    if (el) hudObserver.observe(el);
                }
                S.cleanups.push(() => hudObserver.disconnect());
            }
        }

async function init(S: Host) {
            S.reportLoad({ state: 'loading', progress: null });
            S.initScene();
            S.setupEventHandlers();
            const initTargetId = S.initialTankId ?? 28689;
            const initShooterId = S.initialShooterId ?? initTargetId;
            await S.dl.populateTankLists(initTargetId, initShooterId);
            if (S.destroyed || S.contextLost) return;
            S.initPhase = 'shell data';
            await S.dl.loadShooter(initShooterId);
            if (S.destroyed || S.contextLost) return;
            S.dl.markInitDone();
            S.dl.updateTankLabels();
            S.initPhase = 'tank data';
            await S.dl.loadTarget(initTargetId);
            if (S.destroyed || S.contextLost) return;
            if (!S.destroyed && !S.contextLost) S.animate();
        }

function retry(S: Host) {
            if (S.destroyed || S.contextLost || !S.dl.isInitDone() || S.dl.getCurrentTargetId() == null) return false;
            let phase = 'shell data';
            const ready = S.selectedShell && !S.dl.isShooterLoading()
                ? Promise.resolve() : S.dl.loadShooter(S.dl.getCurrentShooterId());
            ready.then(() => { phase = 'tank data'; if (!S.destroyed) return S.dl.loadTarget(S.dl.getCurrentTargetId()); })
                .then(() => { if (!S.destroyed && !S.rafId) S.animate(); })
                .catch((e: unknown) => S.reportLoad({ state: 'error', message: S.loadFailed(phase, S.errorMessage(e)) }));
            return true;
        }

function trackCameraMotion(S: Host) {
            const now = performance.now();
            if (S.lastFrameAt) S.frameIntervalMs = S.frameIntervalMs * 0.8 + (now - S.lastFrameAt) * 0.2;
            S.lastFrameAt = now;
            if (!S.lastCameraPos) {
                S.lastCameraPos = S.camera.position.clone();
                S.cameraMovedAt = now;
                return;
            }
            if (S.camera.position.distanceToSquared(S.lastCameraPos) > 1e-10) {
                S.lastCameraPos.copy(S.camera.position);
                S.cameraMovedAt = now;
            }
        }

function applyLongRangeCompensation(S: Host, enabled: boolean) {
            const d = S.camera.position.distanceTo(S.controls.target);
            let fov, near, far;
            if (!enabled) {
                fov = S.OVERVIEW_BASE_FOV;
                near = 0.1;
                far = Math.max(1000, d * 3);
            } else {
                fov = dollyZoomFov(d, true, S.ARMOR_BASE_FOV, S.ARMOR_REF_DIST, S.ARMOR_MIN_FOV, S.ARMOR_MAX_FOV, S.ARMOR_FAR_PRODUCT_GAIN, S.ARMOR_FAR_PRODUCT_MAX, S.ARMOR_PRODUCT_SCALE);
                near = 0.05 * d;
                far = d + 30;
            }
            let dirty = false;
            if (Math.abs(S.camera.fov - fov) > 0.005) { S.camera.fov = fov; dirty = true; }
            if (Math.abs(S.camera.near - near) > 1e-4 || Math.abs(S.camera.far - far) > 1) {
                S.camera.near = near; S.camera.far = far; dirty = true;
            }
            if (dirty) S.camera.updateProjectionMatrix();
        }

function renderFxPass(S: Host) {
            if (!S.fxScene || S.fxScene.children.length === 0) return;
            const prevAutoClear = S.renderer.autoClear;
            S.renderer.autoClear = false;
            S.renderer.render(S.fxScene, S.camera);
            S.renderer.autoClear = prevAutoClear;
        }

function syncOverlayResolution(S: Host) {
            if (!S.renderer) return;
            const width = S.renderer.domElement.clientWidth;
            const height = S.renderer.domElement.clientHeight;
            if (S.fxScene) updateOverlayResolution(S.fxScene, width, height);
            if (window.__worldAnno) updateOverlayResolution(window.__worldAnno, width, height);
        }

function animate(S: Host) {
            if (S.destroyed || S.contextLost) return;
            S.hookRcClickRecorder();
            syncOverlayResolution(S);
            S.rafId = requestAnimationFrame(S.animate);
            S.controls.update();
            S.applyLongRangeCompensation(!S.worldOverviewMode);
            S.trackCameraMotion();
            S.reportDistance();
            if ((S.penetrationMode || (!!S.hm.getPrimaryArmorScene() && S.hm.heGradientWanted())) && S.ml.models.armorModel) {
                if (S.SESS && S.heatFrames < 5) {
                    S.heatFrames++;
                }
                S.hm.prepareRicochetFrame();
                S.hm.updatePenetrationDistanceUniforms();
                S.hm.renderSpacedArmorPass();
                S.renderer.render(S.scene, S.camera);
                S.renderer.clearDepth();
                if (S.hm.getPrimaryArmorScene()) { S.hm.syncCloneMatrices(S.hm.getPrimaryArmorScene()); S.renderer.render(S.hm.getPrimaryArmorScene(), S.camera); }
                S.renderFxPass();
            } else {
                S.renderer.autoClear = true;
                S.renderer.render(S.scene, S.camera);
                S.renderFxPass();
            }
            if (S.tc.getTrajInfoPos()) S.tc.updateTrajInfoPos();
        }

function destroy(S: Host) {
            S.destroyed = true;
            S.dl.bumpShooterLoadGen();
            S.jc.bumpPenSeq();
            S.targetLoadGen++;
            S.loadGen++;
            resetViewerGlobals();
            cancelAnimationFrame(S.rafId);
            while (S.cleanups.length) { try { S.cleanups.pop()(); } catch (_) {} }
            try { if (S.controls) S.controls.dispose(); } catch (_) {}
            if (S.renderer) {
                try { S.renderer.dispose(); } catch (_) {}
                try { S.renderer.forceContextLoss(); } catch (_) {}
                if (S.renderer.domElement && S.renderer.domElement.parentNode) {
                    S.renderer.domElement.parentNode.removeChild(S.renderer.domElement);
                }
            }
            try { S.hm.armorShaders.dispose(); } catch (_) {}
        }

function isContextLost(S: Host) { return S.contextLost; }

export function bindTankShotCheck(S: Host) {
  Object.assign(S, {
    rerunAuthoritativeShotCheck: bind(S, rerunAuthoritativeShotCheck),
    refreshEquipmentEffects: bind(S, refreshEquipmentEffects),
    setupEventHandlers: bind(S, setupEventHandlers),
    init: bind(S, init),
    retry: bind(S, retry),
    trackCameraMotion: bind(S, trackCameraMotion),
    applyLongRangeCompensation: bind(S, applyLongRangeCompensation),
    renderFxPass: bind(S, renderFxPass),
    animate: bind(S, animate),
    destroy: bind(S, destroy),
    isContextLost: bind(S, isContextLost),
  })
}

export function initTankShotCheck(S: Host) {


S.currentTurretDeg = 0;
  S.currentGunDeg = 0;

        
        
        
                
        
        
        
        

                
        
        S.cameraMovedAt = 0;
        S.lastCameraPos = null;
        S.lastFrameAt = 0;
        S.frameIntervalMs = 16;
        

        



S.init().catch((e: unknown) => {
            console.error('tank viewer init failed:', e);
            S.reportLoad({ state: 'error', message: S.loadFailed(S.initPhase, S.errorMessage(e)) });
        });
}
