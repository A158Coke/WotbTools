// 场景工厂装配 owner（2026-11-22 自 tankViewer.js 闭包出仓，纯搬移）：模型/热力图/装备/碰撞/数据加载/
// 轨迹/判定/瞄准工厂的构造，以及 Three 场景核心与 resize/pointer 接线。依赖读取统一经宿主对象 S。
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
            // 3D 场景不再自带棕色调背景/雾与地面网格：画布透明，直接继承网页 UI 的
            // --color-canvas；场景只保留车体与光照，风格与页面外壳一致。
            S.scene.background = null;
            // 点击判定特效（轨迹/命中标记/溅射半径球）单独一个场景：热力图 pass 后渲染，
            // 留在主场景会被半透明着色（HE 白色遮罩 alpha≈0.95）整片盖掉。特效材质全是
            // MeshBasicMaterial（不吃光照），空场景即可正确显色。
            S.fxScene = new THREE.Scene();

            // SPA 壳内渲染：视口尺寸取 canvas 容器（main 区域），而非整窗（顶部导航占 67px）
            const view = byId('canvas-container');
            S.camera = new THREE.PerspectiveCamera(S.ARMOR_BASE_FOV, view.clientWidth / view.clientHeight, 0.1, 1000);
            // 默认正对车头（-Z）且平视：目标高度在模型加载后由装甲包围盒中心决定；距离 15m。
            S.camera.position.set(0, 0, -S.ARMOR_REF_DIST);

            // preserveDrawingBuffer 不再开启：本查看器没有任何像素回读（无 toDataURL/readPixels/
            // 录屏），开启它只会阻止浏览器做缓冲区交换优化（每帧多一次全分辨率拷贝）。
            S.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
            S.renderer.setClearColor(0x000000, 0);
            S.renderer.setSize(view.clientWidth, view.clientHeight);
            // DPR 上限 2：此前直接取 devicePixelRatio（3× 屏上按 3× 全屏渲染，像素数 ×2.25）
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
            // 某些环境（模拟器的 GL 翻译层）在 listener 挂上之前就已经丢了上下文。
            try { if (S.renderer.getContext().isContextLost()) S.reportContextLost(); } catch (_) {}
            S.renderer.toneMapping = THREE.ACESFilmicToneMapping;
            S.renderer.toneMappingExposure = 1.15;

            S.controls = new OrbitControls(S.camera, S.renderer.domElement);
            S.controls.enableDamping = true;
            S.controls.dampingFactor = 0.05;
            S.controls.rotateSpeed = 0.35;   // 降低旋转灵敏度（默认 1.0 过快，精细对位困难）
            S.controls.minDistance = 3;
            S.controls.maxDistance = 500;   // 查看器距离范围；Armor Inspector 的 6.5–30m 仅作 FOV 标定参考
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
            // 网页主题（四季）切换时，半球光底面跟随 UI 表面色；画布背景由透明 CSS 继承。
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
        // 点击判定特效（轨迹/命中标记/溅射半径球）独立场景：见 renderFxPass()。
        S.fxScene = null;
        S.raycaster = undefined;
  S.mouse = undefined;
        S.tankData = undefined;   // tankData = target tank (model/armor/info)；tankModel/armorModel owner = modelLifecycle
        
        // 口径不再预置默认值：判定必须用实际数据（配置/弹体/坦克），缺失即报错。
        // shooterShells/shooterCaliber owner = dataLoader；selectedShell 为判定当前弹。
        S.selectedShell = null;
        S.penetrationMode = false;   // 实时穿透热力图模式开关（animate/切弹/按钮共用）
        // 射击复现 world 总览（命中/脱靶【同置】）——dolly-zoom 补偿的门控。
        // 不能复用 __worldPenMode：它只在命中路径置位（脱靶在弹道标注后提前返回），
        // 且还兼管判定坐标转换（review 2026-10-13：脱靶回放曾误套单车补偿致落点裁出视锥）。
        S.worldOverviewMode = false;
        S.collisionMode = false;     // 碰撞模型显示开关（按钮与热力图退出恢复共用）
                // 炮塔/炮管 rig：枢轴、姿态表与 gun 裁切姿态矩阵的唯一 owner（#820 Agent A 出仓）
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
        // 模型/资源生命周期：tankModel/armorModel 引用与 GLB 装载的唯一 owner（#820 Agent A 出仓）
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
        // 穿透热力图/装甲渲染管线：RT、间隙甲场景、跳弹网格与 HE 可视化的唯一 owner（#820 Agent A 出仓）
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
        // 装备判定状态：校准弹/强化装甲/122 的唯一 owner（#820 Agent A 出仓）
        S.eqs = createEquipmentState({
            hmRef: () => S.hm,
            getCurrentTargetId: () => S.dl.getCurrentTargetId(),
            getSelectedShell: () => S.selectedShell,
            getShooterShells: () => S.dl.getShooterShells(),
            pitchDeviceBonus: S.pitchDeviceBonus,
            pitchDeviceAvailable: S.initialPitchDeviceAvailable,
            L: S.L,
        });
        // 碰撞（厚度）视图 + 动态装甲状态：视图样式与状态机的唯一 owner（#820 Agent A 出仓）
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
        // 数据装载与选车/配置编排（#820 Agent A 出仓）
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
        // 调试/诊断 UI：错误条 + 技术证据窗口（#820 Agent A 出仓）
        S.du = createDebugUi({
            L: S.L,
            escapeText: S.escapeText,
            isDestroyed: () => S.destroyed,
            getCurrentTargetId: () => S.dl.getCurrentTargetId(),
        });
        // 轨迹/结果卡：trajGroup 与卡片摆位的唯一 owner（#820 Agent A 出仓）
        S.tc = createTrajectoryCard({
            isDestroyed: () => S.destroyed,
            clearShotError: S.du.clearShotError,
            clearHeBlast: () => S.hm.clearHeBlast(),
            getFxScene: () => S.fxScene,
            getCamera: () => S.camera,
            L: S.L,
            armorDebug: () => S.ARMOR_DEBUG,
        });
        // 射击判定链：点击判定、命中分类、判定请求组装的唯一 owner（#820 Agent A 出仓）
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
        });
        // 诊断探针：window.__armorRicochet 与 readArmorPixels（#820 Agent A 出仓）
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
        // 瞄准输入：Pointer Events 会话与炮塔/炮管拖拽灵敏度（#820 Agent A 出仓）
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
