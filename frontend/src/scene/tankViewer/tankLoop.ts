// 初始化/事件/重试/相机运动补偿/帧循环/销毁 owner（2026-11-22 自 tankViewer.js 闭包出仓，纯搬移）。
// 依赖读取统一经宿主对象 S。
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
            // 旧判定失效必须排在「渲染资源是否存在」的守卫之前：厚度视图里叠加层已释放
            // （penetrationMode / hm.getPrimaryArmorScene() 都为假），但上一发的爆点、结果卡、轨迹
            // 仍是上一发的——换了装备再回默认视图，syncHeatOverlay 会在旧爆点上按新参数
            // 重建渐变且没有新的点击（Codex 复核 P2，2026-10-30）。只有 uniform 刷新
            // 依资源存在与否，replay 的权威重判分支保持原样。
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
            // 回退 checkbox 初始勾选必须反映 URL/场景的有效装备状态，否则 HUD 资产加载
            // 失败时会出现“界面关闭、判定仍开启”的误导。
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
                    // 机械存在（击穿视图或默认视图 HE 渐变）时都要刷新弹种 uniforms，
                    // 否则默认视图换弹后渐变仍用上一发的穿深/伤害/爆炸半径。
                    if (S.penetrationMode || S.hm.getPrimaryArmorScene()) { S.hm.updatePenetrationUniforms(S.selectedShell); S.hm.updateSpacedUniforms(S.selectedShell); }
                    if (S.QP.get('shot')) {
                        // 世界模式：换弹按权威弦射线重跑判定。
                        if (!S.rerunAuthoritativeShotCheck()) S.jc.doPenetrationCheck(0, 0);
                    } else if (S.jc.getLastClickNdc() || S.hm.getHeHeatmapCenter()) {
                        // 普通检视换弹（2026-10-28 用户裁定）：只清掉上一次判定结果，
                        // 不按旧点击位置重跑——新弹种要用户重新点击才产生结果。
                        // 清理与「叠加层资源是否存在」解耦：厚度视图里叠加层已释放，
                        // 上一发的爆点/轨迹仍必须清（Codex 复核 P2，2026-10-30）。
                        S.tc.tidyTrajectory();
                        disposeHitMarker(S.fxScene);
                        S.jc.clearLastClickNdc();
                    }
                    // 清理之后再统一裁决叠加层（HE→非 HE 释放、HE+爆点保留/重建）。
                    S.hm.syncHeatOverlay();
                    S.onShellSelection?.(idx);
                }
            });

            byId<HTMLInputElement>('eq-calibrated').addEventListener('change', function(this: HTMLInputElement) {
                // 原生勾选是回退控件：用户手动改动后必须接管 URL 初始化留下的 override，
                // 否则复选框可见但计算仍走旧覆盖值。
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
                // 只影响炮管俯仰钳制（不碰穿深/厚度），下一次拖动按新上下限生效。
                S.eqs.equipmentOverride.pitch = null;
                S.onEquipmentSelection?.('pitch', this.checked);
            });
            byId<HTMLInputElement>('armor-state-toggle').addEventListener('change', function(this: HTMLInputElement) {
                if (!S.cvs.getArmorStateDecl()) return;   // 静态车无声明：不得读 states（review P2 崩溃点）
                S.cvs.setArmorState(this.checked ? S.cvs.nonDefaultStateId(S.cvs.getArmorStateDecl()) : defaultStateId(S.cvs.getArmorStateDecl()));
            });

            byId<HTMLSelectElement>('config-select').addEventListener('change', function(this: HTMLSelectElement) {
                const idx = parseInt(this.value);
                S.dl.applyConfig(idx);
                S.onConfigSelection?.(idx);
            });

            byId<HTMLButtonElement>('collision-btn').addEventListener('click', function(this: HTMLButtonElement) {
                S.collisionMode = !S.collisionMode;
                // 与击穿视图互斥：切到装甲厚度先关掉热力图
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
                // 组成显隐只在厚度视图可用；退出时复位为全显示
                if (!S.collisionMode) S.cvs.resetArmorFilters();
                S.setArmorFilterRowVisible(S.collisionMode);
                S.setResultLegendVisible(!S.collisionMode);
                if (!S.collisionMode) { S.cvs.resetArmorHighlight(); byId('click-info').style.display = 'none'; }
                if (!S.ml.models.armorModel) { S.hm.syncHeatOverlay(); return; }
                S.cvs.applyArmorViewStyle(S.collisionMode);
                // 叠加层裁决必须排在网格可见性恢复**之后**：退出厚度视图时
                // cvs.resetArmorFilters() 只复位开关，真正恢复可见性的是
                // applyArmorViewStyle → applyCategoryFilters；而 rebuildHeatmapScenes →
                // collectPenetrationMeshes 会跳过 visible=false 的板，先重建会漏掉被分类
                // 过滤隐藏的主装/间隙甲/模块，之后的点击也复用这份残缺场景
                // （Codex 复核 P2，2026-10-30）。进入厚度视图时这里只做释放，顺序无影响。
                S.hm.syncHeatOverlay();
            });

            // 分类过滤（主装甲 / 间隙 / 外部模块）：active = 显示
            ['primary', 'spaced', 'external'].forEach(function(name) {
                const btn = document.getElementById('filter-' + name);
                if (!btn) return;
                btn.addEventListener('click', function() {
                    S.cvs.toggleCategory(name);
                });
            });

            // —— 指针交互注册（单一 Pointer Events，桌面+触屏统一；评审 PR BLOCKER 1/2）——
            // 处理器与全部状态定义在闭包级（__armorRicochet 钩子之前），这里只做注册（renderer 已就绪）。
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
                // 厚度点选卡跟随点击位置（绝对像素坐标）：容器尺寸变化后旧坐标可能落到
                // 场景外并被 .armor-view 的 overflow 裁掉（评审 P2）。旧点击点在新布局
                // 下也不再对应同一块装甲，因此直接隐藏，等用户重新点击——不猜新位置。
                const clickInfo = document.getElementById('click-info');
                if (clickInfo) clickInfo.style.display = 'none';
                // 判定结果卡是主结果窗口，不能因 resize 消失：标记 dirty 后按新容器尺寸
                // 重新定位（点击锚点已换算成容器坐标，钳制交给共享定位函数）。
                S.tc.markTrajInfoDirty();
            };
            S.onWin('resize', resizeView);
            // The recorded-shot header can wrap without a window resize (locale / error message).
            if (typeof ResizeObserver === 'function') {
                const observer = new ResizeObserver(resizeView);
                observer.observe(byId('canvas-container'));
                S.cleanups.push(() => observer.disconnect());
            }
            // 结果卡避让的固定 HUD 面板自身会变尺寸（参数抽屉展开、模块区加载/收起、射击 HUD
            // 换行），而 #canvas-container 尺寸不变，上面的观察器收不到。直接观察面板并在尺寸
            // 变化时标记结果卡重排，避免卡片压到展开后的面板（评审 P2，2026-11-15）。
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
            // 模型回调可立即恢复射击并判定，因此弹药必须先完成，不能靠定时器猜网络耗时。
            S.initPhase = 'shell data';
            await S.dl.loadShooter(initShooterId);
            if (S.destroyed || S.contextLost) return;
            S.dl.markInitDone();
            S.dl.updateTankLabels();
            S.initPhase = 'tank data';
            await S.dl.loadTarget(initTargetId);
            if (S.destroyed || S.contextLost) return;
            if (!S.destroyed && !S.contextLost) S.animate();   // await 期间路由已离开/上下文已丢失则不再启动渲染
        }

function retry(S: Host) {
            if (S.destroyed || S.contextLost || !S.dl.isInitDone() || S.dl.getCurrentTargetId() == null) return false;
            let phase = 'shell data';
            const ready = S.selectedShell && !S.dl.isShooterLoading()
                ? Promise.resolve() : S.dl.loadShooter(S.dl.getCurrentShooterId());
            ready.then(() => { phase = 'tank data'; if (!S.destroyed) return S.dl.loadTarget(S.dl.getCurrentTargetId()); })
                .then(() => { if (!S.destroyed && !S.rafId) S.animate(); })   // 首次加载失败时渲染循环尚未启动
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
            if (S.camera.position.distanceToSquared(S.lastCameraPos) > 1e-10) {   // > 0.01mm
                S.lastCameraPos.copy(S.camera.position);
                S.cameraMovedAt = now;
            }
        }

function applyLongRangeCompensation(S: Host, enabled: boolean) {
            const d = S.camera.position.distanceTo(S.controls.target);
            let fov, near, far;
            if (!enabled) {
                // world overview：原生 50° 取景（far 随距离防裁切）
                fov = S.OVERVIEW_BASE_FOV;
                near = 0.1;
                far = Math.max(1000, d * 3);
            } else {
                // 单车装甲检视 / shot replay：同一套 Armor Inspector 参考 + 更强的距离缩放
                // display profile（+0.028/m、封顶 3.8、整体 ×1.1），远距车体缩小更明显。
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

/** 屏幕空间覆盖物的 resolution 必须在**任何渲染之前**同步：fxScene 与射击复现的
 *  世界标注组（__worldAnno）可能不同时存在，且首帧 (1,1) 会把 2px 线画成整屏粗带。 */
function syncOverlayResolution(S: Host) {
            if (!S.renderer) return;
            const width = S.renderer.domElement.clientWidth;
            const height = S.renderer.domElement.clientHeight;
            if (S.fxScene) updateOverlayResolution(S.fxScene, width, height);
            if (window.__worldAnno) updateOverlayResolution(window.__worldAnno, width, height);
        }

function animate(S: Host) {
            if (S.destroyed || S.contextLost) return;
            S.hookRcClickRecorder();   // 探针监听惰性挂载（首帧 renderer 就绪）
            syncOverlayResolution(S);
            S.rafId = requestAnimationFrame(S.animate);
            S.controls.update();
            // 单车装甲检视：Armor Inspector 实测 15m/18.75° + 40° 上限；
            // shot replay：旧 30m/50° dolly-zoom；world 总览传 false → 原生 50°。
            S.applyLongRangeCompensation(!S.worldOverviewMode);
            S.trackCameraMotion();
            S.reportDistance();
            // 击穿视图全管线；默认视图下 HE 渐变叠加层（机械已建且爆点在）复用同一管线。
            if ((S.penetrationMode || (!!S.hm.getPrimaryArmorScene() && S.hm.heGradientWanted())) && S.ml.models.armorModel) {
                if (S.SESS && S.heatFrames < 5) {
                    S.heatFrames++;   // 就绪门控计数保留（上游语义）；上报端点已随 client-only 移除
                }
                S.hm.prepareRicochetFrame(); // 所有通道先共享本帧几何，RT1 不再消费上一帧网格
                S.hm.updatePenetrationDistanceUniforms();   // 交战距离衰减（相机/炮口→命中板，每帧刷 pen uniform）
                S.hm.renderSpacedArmorPass();
                S.renderer.render(S.scene, S.camera);                       // 背景/网格（autoClear 已置 false）
                S.renderer.clearDepth();                                 // 清除深度，让 exclude 深度遮罩生效
                if (S.hm.getPrimaryArmorScene()) { S.hm.syncCloneMatrices(S.hm.getPrimaryArmorScene()); S.renderer.render(S.hm.getPrimaryArmorScene(), S.camera); }
                S.renderFxPass();   // 点击判定特效画在热力图之上（否则被 0.5/0.95 alpha 覆盖）
            } else {
                // 普通分支必须自清屏：热力图/叠加层的最后一帧会把 autoClear 留成 false，
                // 若条件在两次 syncHeatOverlay 之间失效（如 selectedShell 被换掉但尚未
                // 同步），没有显式 clear 的帧会复用上一帧缓冲（评审 2026-10-30 提出的
                // 清理状态风险）。这里不依赖「谁最后动过 autoClear」。
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
            S.targetLoadGen++; // invalidate in-flight target JSON before it can mutate the destroyed/current viewer
            S.loadGen++;   // invalidate any in-flight GLTF callbacks before releasing the live scene
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
            try { S.hm.armorShaders.dispose(); } catch (_) {}   // context 私有占位纹理（材质已随场景释放）
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
/** 校准弹/强化装甲变化后的统一刷新（勾选框与宿主 HUD 的 setEquipmentOverride 共用）。
         *  厚度系数与判定模式无关：装甲检视下点板/热力图读同一份 uniform。 */

/// 宿主页"重试"：恢复缺失弹药并重载当前目标；初始化未完成则由宿主整体重建

S.currentTurretDeg = 0;
  S.currentGunDeg = 0;

        // lastClickNdc owner = judgment 模块（jc.getLastClickNdc()）。
        
        /** 装甲厚度模式（实现在 viewer/judgment.ts 的 showArmorPartInfo）：命中装甲板 → 高亮该板，
         *  部件名与基础装甲值显示在场景顶部正中的固定胶囊里（不跟随命中点；无击穿判定）。 */
        
        // 射击复现错误面板（模块级：doPenetrationCheck 等顶层函数也要调用）
        
                
        /**
         * 间隙甲（spaced）双面求交：显示/采样材质与 BlitzKit 同为 FrontSide，从背面命中的
         * 间隙屏（单面屏幕或闭合板的背面）不会进入 THREE.Raycaster。求交前把间隙甲材质的
         * side 临时切成 DoubleSide，求交是同步的，完成后立即恢复（不经过渲染，画面不变）。
         */
                /**
         * 判定命中收集（点击主链 / 跳弹续飞共用）：
         *  - 间隙甲双面：背面命中的间隙屏参与判定（法线已由 classifyHit 翻向来向）；
         *    主装甲/外部模块仍只认迎面命中（闭合壳体正/背面各算一层会重复消耗厚度）。
         *  - 闭合间隙甲的正/背面是同一块板：该板前面已计过时不再重复计背面。
         */
        
        /**
         * 判定口径必须是实际数据：射手配置 → 射手数据 → 弹体 → 目标坦克。
         * 历史实现缺数据时静默用 120mm，会改变 overmatch / 转正 / 3× 口径结果；
         * 现在返回 0 由调用方 fail-closed（报 shellUnavailable），不再猜。
         */
        
        
        

                
        
        // 相机运动追踪（门禁用）：OrbitControls 的 damping 让相机在拖动/捏合结束后继续滑行
        // 若干帧——慢渲染（CI 无 GPU）时这段滑行会持续数秒。门禁"按像素采样部位 → 按下"
        // 之间相机若仍在滑行，采样时的分类与按下时的分类就会不一致（同一像素从 turret
        // 滑成 hull/背景），断言随机翻车。暴露「上次相机移动距今多久 + 帧间隔」，让门禁
        // 等到视图真正静止再采样（等状态，不等时钟）。
        S.cameraMovedAt = 0;
        S.lastCameraPos = null;   // null = 首帧（NaN 比较恒为 false，会把移动检测永远锁死）
        S.lastFrameAt = 0;
        S.frameIntervalMs = 16;
        

        // ===== 单车装甲检视 / shot replay 的相机标定 =====
        // Armor Inspector 实测（PC T-34）：基准 15m/18.75°，FOV 最大 40°（约 6.5m 处封顶），
        // 实测取景点 6.5–28.35m；near=0.05d，far=d+30；d<15 时 FOV 变宽、车体屏幕尺寸保持 15m 比例。
        // 单车装甲检视与 shot replay 共用这套标定；shot replay 的 0.5–500m 由 minFov=0.5° 兜底。
        // enabled=false（两车 world 总览）以原生 50° 幂等还原——总览按射手/目标取景，
        // 套单车 dolly-zoom 会把远距受击车裁出视锥（review P2）。
        

        /** 点击判定特效 pass：独立 fxScene，永远画在车体/热力图之上。击穿概率模式在
         *  hm.getPrimaryArmorScene() 之后、clearDepth 之上叠加，HE 白色遮罩下命中点/轨迹仍清晰；
         *  默认视图画在场景之后。autoClear 必须临时关闭——fxScene 没有背景，
         *  否则会把整帧清掉。 */

/// 路由离开清理：停 rAF、摘 window 监听、释放控制器与 WebGL 上下文。
        /// canvas 由 ArmorView 的容器 DOM 一并移除，这里只处理 JS 侧句柄。

S.init().catch((e: unknown) => {
            console.error('tank viewer init failed:', e);
            S.reportLoad({ state: 'error', message: S.loadFailed(S.initPhase, S.errorMessage(e)) });
        });
}
