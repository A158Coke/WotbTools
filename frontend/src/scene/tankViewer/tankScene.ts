import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { createTurretRig } from '../viewer/turretRig.js'
import { createModelLifecycle } from '../viewer/modelLifecycle.js'
import { createHeatmapPipeline } from '../viewer/heatmap.js'
import { createTrajectoryCard } from '../viewer/trajectoryCard.js'
import { createDebugUi } from '../viewer/debugUi.js'
import { createEquipmentState } from '../viewer/equipmentState.js'
import { createCollisionView } from '../viewer/collisionView.js'
import { createJudgment } from '../viewer/judgment.js'
import { createDiagnosticProbe } from '../viewer/diagnosticProbe.js'
import { createAimInput } from '../viewer/aimInput.js'
import { createDataLoader } from '../viewer/dataLoader.js'
import type { Host } from '../tankViewer.js'
import { bind } from '../hostBind.ts'
import { byId } from './domById.ts'

function initScene(S: Host) {
            S.scene = new THREE.Scene();
            S.scene.background = null;
            S.fxScene = new THREE.Scene();

            const view = byId('canvas-container');
            S.camera = new THREE.PerspectiveCamera(S.ARMOR_BASE_FOV, view.clientWidth / view.clientHeight, 0.1, 1000);
            S.camera.position.set(0, 0, -S.ARMOR_REF_DIST);

            S.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
            S.renderer.setClearColor(0x000000, 0);
            S.renderer.setSize(view.clientWidth, view.clientHeight);
            S.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
            S.renderer.localClippingEnabled = true;
            view.appendChild(S.renderer.domElement);
            try {
                const gl = S.renderer.getContext();
                const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
                S.gpuLabel = String((debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) || '');
            } catch (_) { S.gpuLabel = ''; }
            const canvas = S.renderer.domElement;
            canvas.addEventListener('webglcontextlost', S.reportContextLost);
            canvas.addEventListener('webglcontextrestored', S.reportContextRestored);
            S.cleanups.push(() => {
                canvas.removeEventListener('webglcontextlost', S.reportContextLost);
                canvas.removeEventListener('webglcontextrestored', S.reportContextRestored);
            });
            try { if (S.renderer.getContext().isContextLost()) S.reportContextLost(); } catch (_) {}
            S.renderer.toneMapping = THREE.ACESFilmicToneMapping;
            S.renderer.toneMappingExposure = 1.15;

            S.controls = new OrbitControls(S.camera, S.renderer.domElement);
            S.controls.enableDamping = true;
            S.controls.dampingFactor = 0.05;
            S.controls.rotateSpeed = 0.35;
            S.controls.minDistance = 3;
            S.controls.maxDistance = 500;
            S.controls.mouseButtons = {
                LEFT: THREE.MOUSE.ROTATE,
                MIDDLE: THREE.MOUSE.DOLLY,
                RIGHT: null,
            };


            const readThemeColor = (name: string, fallback: string) => {
                const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
                if (!raw) return new THREE.Color(fallback);
                try { return new THREE.Color(raw); } catch { return new THREE.Color(fallback); }
            };
            const hemi = new THREE.HemisphereLight(0xffffff, readThemeColor('--color-surface-2', '#2f2311'), 2.2);
            S.scene.add(hemi);
            const themeObserver = new MutationObserver(() => {
                hemi.groundColor.copy(readThemeColor('--color-surface-2', '#2f2311'));
            });
            themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
            S.cleanups.push(() => themeObserver.disconnect());
            S.scene.add(new THREE.AmbientLight(0xffffff, 0.9));
            const spot1 = new THREE.SpotLight(0xfff5e1, 500, 60, 0.55, 0.6);
            spot1.position.set(10, 15, 8);
            S.scene.add(spot1);
            const spot2 = new THREE.SpotLight(0x88aaff, 260, 50, 0.45, 0.5);
            spot2.position.set(-10, 12, -6);
            S.scene.add(spot2);

            S.raycaster = new THREE.Raycaster();
            S.mouse = new THREE.Vector2();
        }

export function bindTankScene(S: Host) {
  Object.assign(S, {
    initScene: bind(S, initScene),
  })
}

export function initTankScene(S: Host) {
S.SESS = Math.random().toString(36).slice(2);
        S.heatFrames = 0;
  S.heatReadySent = false;

        S.scene = undefined;
  S.camera = undefined;
  S.renderer = undefined;
  S.controls = undefined;
        S.fxScene = null;
        S.raycaster = undefined;
  S.mouse = undefined;
        S.tankData = undefined;
        
        S.selectedShell = null;
        S.penetrationMode = false;
        S.worldOverviewMode = false;
        S.collisionMode = false;
        S.rig = createTurretRig({
            getTankModel: () => S.ml.models.tankModel,
            getArmorModel: () => S.ml.models.armorModel,
            getTankData: () => S.tankData,
            getConfig: () => S.currentConfig(),
            updateCollisionWorldMatrices: () => S.hm.updateCollisionWorldMatrices(),
            getCollisionMode: () => S.collisionMode,
            computeGunClipPlane: () => S.hm.computeGunClipPlane(),
            syncModuleClipPlanes: () => S.cvs.syncModuleClipPlanes(),
            invalidateRicochetPose: () => S.hm.invalidateRicochetPose(),
        });
        S.clearTrajectory = () => S.tc.clearTrajGroup();
        S.ml = createModelLifecycle({
            rig: S.rig,
            isDestroyed: () => S.destroyed,
            isContextLost: () => S.contextLost,
            loadGen: { get: () => S.loadGen, bump: () => ++S.loadGen },
            modelProgress: S.modelProgress,
            reportLoad: S.reportLoad,
            errorMessage: S.errorMessage,
            L_loading: S.L.loading,
            loadFailed: S.loadFailed,
            getTankData: () => S.tankData,
            getCurrentConfigIdx: () => S.dl.getCurrentConfigIdx(),
            getScene: () => S.scene,
            getControls: () => S.controls,
            getFxScene: () => S.fxScene,
            getQP: () => S.QP,
            getPlateThickness: S.getPlateThickness,
            getCurrentConfig: () => S.currentConfig(),
            applyConfig: (...a) => S.dl.applyConfig(...a),
            applyArmorStateToModel: () => S.cvs.applyArmorStateToModel(),
            applyUrlOptionsOnce: S.applyUrlOptionsOnce,
            clearTrajectory: S.clearTrajectory,
            clearHeBlast: () => S.hm.clearHeBlast(),
            disposePenetrationResources: () => S.hm.disposePenetrationResources(),
            clearHighlight: () => { S.cvs.setHighlightedArmorNode(null); },
            releaseModuleMaterialCaches: () => S.cvs.releaseModuleMaterialCaches(),
        });
        S.ml.setArmorModelResolver(() => S.models.armorModel);
        S.models = S.ml.models;
        S.hm = createHeatmapPipeline({
            models: S.models,
            rig: S.rig,
            getWorldMetersPerUnit: () => S.ml.getWorldMetersPerUnit(),
            getModuleMeshes: () => S.ml.getModuleMeshes(),
            getRenderer: () => S.renderer,
            getCamera: () => S.camera,
            getTankData: () => S.tankData,
            getCurrentConfig: () => S.currentConfig(),
            getActiveGunNumber: (...a) => S.activeGunNumber(...a),
            getSelectedShell: () => S.selectedShell,
            getShooterShells: () => S.dl.getShooterShells(),
            getPenetrationMode: () => S.penetrationMode,
            getCollisionMode: () => S.collisionMode,
            equipmentCoeffs: (...a) => S.eqs.equipmentCoeffs(...a),
            resolveCaliberFor: (...a) => S.jc.resolveCaliberFor(...a),
            applyArmorViewStyle: (...a) => S.cvs.applyArmorViewStyle(...a),
            getFxScene: () => S.fxScene,
            getScene: () => S.scene,
            applyCategoryFilters: (...a) => S.cvs.applyCategoryFilters(...a),
        });
        S.eqs = createEquipmentState({
            hmRef: () => S.hm,
            getCurrentTargetId: () => S.dl.getCurrentTargetId(),
            getSelectedShell: () => S.selectedShell,
            getShooterShells: () => S.dl.getShooterShells(),
            pitchDeviceBonus: S.pitchDeviceBonus,
            pitchDeviceAvailable: S.initialPitchDeviceAvailable,
            L: S.L,
        });
        S.cvs = createCollisionView({
            models: S.models,
            ml: S.ml,
            getModuleMeshes: () => S.ml.getModuleMeshes(),
            hmRef: () => S.hm,
            rig: S.rig,
            getTankData: () => S.tankData,
            getCurrentConfig: () => S.currentConfig(),
            getActiveGunNumber: (...a) => S.activeGunNumber(...a),
            getPenetrationMode: () => S.penetrationMode,
            getCollisionMode: () => S.collisionMode,
            getPlateThickness: S.getPlateThickness,
            thicknessToColor: S.thicknessToColor,
            isEffectivelyVisible: (...a) => S.jc.isEffectivelyVisible(...a),
        });
        S.dl = createDataLoader({
            ml: S.ml, rig: S.rig, hmRef: () => S.hm, tcRef: () => S.tc, jcRef: () => S.jc, cvsRef: () => S.cvs,
            targetLoadGen: { get: () => S.targetLoadGen, bump: () => ++S.targetLoadGen },
            loadGen: { get: () => S.loadGen, bump: () => ++S.loadGen },
            isDestroyed: () => S.destroyed,
            isContextLost: () => S.contextLost,
            getTankData: () => S.tankData,
            setTankData: (d) => { S.tankData = d; },
            getSelectedShell: () => S.selectedShell,
            setSelectedShell: (sh) => { S.selectedShell = sh; },
            reportLoad: S.reportLoad,
            loadFailed: S.loadFailed,
            errorMessage: S.errorMessage,
            rerunAuthoritativeShotCheck: () => S.rerunAuthoritativeShotCheck(),
            requestedShellIndex: S.requestedShellIndex,
            L: S.L,
            QP: S.QP,
            onTankList: S.onTankList,
            onTankSelection: S.onTankSelection,
            getFxScene: () => S.fxScene,
            eqsRef: () => S.eqs,
            getPenetrationMode: () => S.penetrationMode,
            getCollisionMode: () => S.collisionMode,
            getCurrentConfig: () => S.currentConfig(),
            getUpgradeOptions: S.upgradeOptions,
            getUrlApplied: () => S.urlApplied,
            setUrlApplied: (v) => { S.urlApplied = v; },
            getTurretDeg: () => S.currentTurretDeg,
            getGunDeg: () => S.currentGunDeg,
        });
        S.du = createDebugUi({
            L: S.L,
            escapeText: S.escapeText,
            isDestroyed: () => S.destroyed,
            getCurrentTargetId: () => S.dl.getCurrentTargetId(),
        });
        S.tc = createTrajectoryCard({
            isDestroyed: () => S.destroyed,
            clearShotError: S.du.clearShotError,
            clearHeBlast: () => S.hm.clearHeBlast(),
            getFxScene: () => S.fxScene,
            getCamera: () => S.camera,
            L: S.L,
            armorDebug: () => S.ARMOR_DEBUG,
        });
        S.jc = createJudgment({
            models: S.models,
            hm: S.hm,
            tc: S.tc,
            cvs: S.cvs,
            getRenderer: () => S.renderer,
            getCamera: () => S.camera,
            getControls: () => S.controls,
            getFxScene: () => S.fxScene,
            getRaycaster: () => S.raycaster,
            getMouse: () => S.mouse,
            getTankData: () => S.tankData,
            getCurrentConfig: () => S.currentConfig(),
            getActiveGunNumber: (...a) => S.activeGunNumber(...a),
            getSelectedShell: () => S.selectedShell,
            getShooterShells: () => S.dl.getShooterShells(),
            getShooterCaliber: () => S.dl.getShooterCaliber(),
            getShooterData: () => S.dl.getShooterData(),
            isDestroyed: () => S.destroyed,
            isShooterLoading: () => S.dl.isShooterLoading(),
            isShotReplay: () => !!S.QP.get('shot'),
            getCurrentConfigIdx: () => S.dl.getCurrentConfigIdx(),
            getCollisionMode: () => S.collisionMode,
            getPenetrationMode: () => S.penetrationMode,
            getWorldOverviewMode: () => S.worldOverviewMode,
            armorDebug: () => S.ARMOR_DEBUG,
            getModuleMeshes: () => S.ml.getModuleMeshes(),
            getWorldMetersPerUnit: () => S.ml.getWorldMetersPerUnit(),
            getPlateThickness: S.getPlateThickness,
            equipmentCoeffs: (...a) => S.eqs.equipmentCoeffs(...a),
            effectiveCalibrated: S.eqs.effectiveCalibrated,
            effectiveEnhanced: S.eqs.effectiveEnhanced,
            shellPenMul: S.eqs.shellPenMul,
            L: S.L,
            showShotError: S.du.showShotError,
            onJudgmentDistance: (...a) => S.onJudgmentDistance?.(...a),
        });
        createDiagnosticProbe({
            hm: S.hm,
            models: S.models,
            rig: S.rig,
            jc: S.jc,
            getRenderer: () => S.renderer,
            getCamera: () => S.camera,
            getControls: () => S.controls,
            getTankData: () => S.tankData,
            getCurrentConfig: () => S.currentConfig(),
            getActiveGunNumber: (...a) => S.activeGunNumber(...a),
            getSelectedShell: () => S.selectedShell,
            getShooterShells: () => S.dl.getShooterShells(),
            getModuleMeshes: () => S.ml.getModuleMeshes(),
            getWorldMetersPerUnit: () => S.ml.getWorldMetersPerUnit(),
            equipmentCoeffs: (...a) => S.eqs.equipmentCoeffs(...a),
            getWorldOverviewMode: () => S.worldOverviewMode,
            getPenetrationMode: () => S.penetrationMode,
            shellPenMul: S.eqs.shellPenMul,
            getTurretDeg: () => S.currentTurretDeg,
            getGunDeg: () => S.currentGunDeg,
            getAimSession: () => S.aim.getAimSession(),
            aimPartAt: (x, y) => S.aim.aimPartAt(x, y),
            getCameraMotion: () => ({ cameraMovedAt: S.cameraMovedAt, frameIntervalMs: S.frameIntervalMs }),
            getRcLastClick: () => S.rcLastClick,
            setRcLastClick: (v) => { S.rcLastClick = v; },
            getLastPresetTarget: () => S.lastPresetTarget,
        });
        S.aim = createAimInput({
            models: S.models,
            rig: S.rig,
            eqs: S.eqs,
            jc: S.jc,
            getRenderer: () => S.renderer,
            getCamera: () => S.camera,
            getControls: () => S.controls,
            getRaycaster: () => S.raycaster,
            getMouse: () => S.mouse,
            getTankData: () => S.tankData,
            getCurrentConfig: () => S.currentConfig(),
            getTurretDeg: () => S.currentTurretDeg,
            getGunDeg: () => S.currentGunDeg,
            setTurretDeg: (deg) => { S.currentTurretDeg = deg; },
            setGunDeg: (deg) => { S.currentGunDeg = deg; },
        });
}
