// 数据装载与选车/配置编排（#820 Agent A 出仓）：target/shooter 数据装载代数、名册、
// 弹表装配与配置切换的唯一 owner。原 tankViewer.js 闭包内对应函数整体平移；
// generation guard 与竞态丢弃语义保持原样。
import * as THREE from 'three'
import { fetchTankData, fetchShells, fetchTankEncyclopedia } from '../agentData.js'
import { normalizeTankCache } from '../../utils/tankopediaQuery.js'
import { romanLevel } from '../../utils/tierFormat.js'
import { shellTypeOf } from './armorPlateModel.js'
import { applyArmorConfigVisible as applyArmorPrefixVisibility } from './armorPlateModel.js'
import type { TankArmorConfig } from './armorPlateModel.js'
import type { ModelLifecycleHandle } from './modelLifecycle.js'
import type { TurretRigHandle } from './turretRig.js'
import type { CollisionViewHandle } from './collisionView.js'
import type { ShellSpec, TankConfig, TankData } from './viewerContracts.js'

/** 追踪装载状态（宿主页进度条 / 错误态）。 */
export interface LoadReportState {
    state: 'loading' | 'ready' | 'error'
    progress?: number | null
    message?: string
    contextLost?: boolean
}

/** 射手数据（tank/{id}.json；configs 内弹表/口径）。 */
export interface ShooterTankData extends TankData {
    configs?: ShooterTankConfig[]
    shells?: ShellSpec[]
    caliber?: number
}
export interface ShooterTankConfig extends TankConfig {
    shells?: ShellSpec[]
    caliber?: number
}

/** 队列中的射手配置切换（编辑器先于场景数据就绪）。 */
export interface PendingShooterConfig {
    tankId: number | null
    index: number
}

/** 坦克名册项（normalizeTankCache 视图模型）。 */
export interface TankListEntry {
    id: number | string
    name?: string
    [key: string]: unknown
}

/** 热力图 owner 中被数据装载消费的句柄子集。 */
export interface DataLoaderHeatmapHandle {
    rebuildHeatmapScenes(): void
    getPrimaryArmorScene(): THREE.Scene | null
    disposePenetrationResources(): void
    syncHeatOverlay(): void
    updatePenetrationUniforms(shell: ShellSpec): void
    updateSpacedUniforms(shell: ShellSpec): void
}

/** 判定 owner 中被数据装载消费的句柄子集。 */
export interface DataLoaderJudgmentHandle {
    bumpPenSeq(): void
    clearLastClickNdc(): void
    doPenetrationCheck(ndcX: number, ndcY: number): void
    setShotRay(origin: THREE.Vector3, target: THREE.Vector3): void
    clearShotRay(): void
    resolveShotCaliber(): number
}

/** 轨迹/结果卡 owner 中被数据装载消费的句柄子集。 */
export interface DataLoaderTrajectoryHandle {
    tidyTrajectory(): void
}

export interface DataLoaderDeps {
    ml: ModelLifecycleHandle
    rig: TurretRigHandle
    hmRef: () => DataLoaderHeatmapHandle
    tcRef: () => DataLoaderTrajectoryHandle
    jcRef: () => DataLoaderJudgmentHandle
    cvsRef: () => CollisionViewHandle
    /** 目标 JSON 装载代数（kernel owner） */
    targetLoadGen: { get: () => number; bump: () => number }
    /** 模型装载代数（kernel owner） */
    loadGen: { get: () => number; bump: () => number }
    isDestroyed: () => boolean
    isContextLost: () => boolean
    getTankData: () => TankData
    setTankData: (data: TankData) => void
    getSelectedShell: () => ShellSpec | null
    setSelectedShell: (shell: ShellSpec | null) => void
    reportLoad: (state: LoadReportState) => void
    loadFailed: (phase: string, message: string) => string
    errorMessage: (error: unknown) => string
    rerunAuthoritativeShotCheck: () => unknown
    requestedShellIndex: () => number
    QP: URLSearchParams
    getUrlApplied: () => boolean
    setUrlApplied: (v: boolean) => void
    getTurretDeg: () => number
    getGunDeg: () => number
    eqsRef: () => { shellOptionText(shell: ShellSpec | null): string }
    getPenetrationMode: () => boolean
    getCurrentConfig: () => TankArmorConfig | null
    getUpgradeOptions: (side: 'target' | 'shooter') => { upgrade?: unknown; abilities?: unknown }
    L: {
        type: (value: string) => string
        nation: (value: string) => string
        shellUnavailable: string
        [key: string]: unknown
    }
    getFxScene: () => THREE.Scene
    onTankList?: (list: TankListEntry[]) => void
    onTankSelection?: (selection: { shooter: number | null; target: number | null }) => void
    getCollisionMode: () => boolean
}

export interface DataLoaderHandle {
    updateInfoPanel(): void
    loadTarget(tid: number | string): Promise<boolean>
    loadShooter(tid: number | string): Promise<void>
    selectTank(mode: 'shooter' | 'target' | string, id: number | string): boolean
    canPick(): boolean
    populateTankLists(initTargetId: number | null, initShooterId: number | null): Promise<void>
    updateTankLabels(): void
    applyConfig(idx: number): void
    setupConfigSelect(): void
    populateShellSelector(shells: ShellSpec[], requestedIndex?: number): void
    setShellUiVisible(visible: boolean): void
    setConfigUiVisible(visible: boolean): void
    bumpShooterLoadGen(): number
    markInitDone(): void
    setPendingShooterConfig(v: PendingShooterConfig | null): void
    isInitDone(): boolean
    getCurrentTargetId(): number | null
    getCurrentShooterId(): number | null
    getCurrentConfigIdx(): number
    isShooterLoading(): boolean
    getTanksList(): TankListEntry[]
    getPendingShooterConfig(): PendingShooterConfig | null
    getShooterShells(): ShellSpec[]
    setShooterData(d: ShooterTankData | null): void
    getShooterData(): ShooterTankData | null
    getShooterCaliber(): number | null
    isConfigUiHidden(): boolean
    isShellUiHidden(): boolean
}

export function createDataLoader(deps: DataLoaderDeps): DataLoaderHandle {
    const {
        ml, rig, hmRef, tcRef, jcRef, cvsRef,
        targetLoadGen, loadGen,
        isDestroyed, isContextLost,
        getTankData, setTankData, getSelectedShell, setSelectedShell,
        reportLoad, loadFailed, errorMessage,
        rerunAuthoritativeShotCheck: rerunAuthoritativeShotCheckFn,
        requestedShellIndex, L, QP, getFxScene,
        onTankList, onTankSelection,
        getUrlApplied, setUrlApplied, getTurretDeg, getGunDeg, eqsRef, getPenetrationMode,
        getUpgradeOptions,
    } = deps

        let initDone = false;    // 名册与弹药就绪后 retry 才能只重载目标坦克
        let shooterLoadGen = 0;
        let shooterLoading = false;
        let pendingShooterConfig: PendingShooterConfig | null = null; // { tankId, index }：编辑器先于场景射手数据就绪
        let tanksList: TankListEntry[] = [];
        let currentShooterId: number | null = null;
        let currentTargetId: number | null = null;
        let currentConfigIdx = 0;
        let shooterShells: ShellSpec[] = [], shooterCaliber: number | null = null;
        let shooterData: ShooterTankData | null = null;
        let configUiHidden = false;
        let shellUiHidden = false;

function updateInfoPanel(): void {
            document.getElementById('tank-name')!.textContent = getTankData().name || '?';
            // 卡片该行已有「等级」行标题：值只写数字
            document.getElementById('tank-tier')!.textContent = romanLevel(getTankData().tier) || '?';
            document.getElementById('tank-type')!.textContent = getTankData().type ? L.type(getTankData().type!) : '?';
            document.getElementById('tank-nation')!.textContent = getTankData().nation ? L.nation(getTankData().nation!) : '?';
            document.getElementById('info-panel')!.style.display = 'block';
        }

async function loadTarget(tid: number | string): Promise<boolean> {
            if (isDestroyed() || isContextLost()) return false;
            const gen = targetLoadGen.bump();
            loadGen.bump(); // 立即使旧模型/射击 continuation 失效，不等新 JSON 返回
            jcRef().bumpPenSeq();
            setUrlApplied(false);
            tcRef().tidyTrajectory();
            // 换目标车后旧点击坐标已无意义：不清会在切弹时对新车的同一屏幕坐标
            // 误跑判定（评审 P2）。
            jcRef().clearLastClickNdc();
            reportLoad({ state: 'loading', progress: null });   // 车辆数据（JSON）阶段：不确定进度
            const nextTankData = await fetchTankData(tid, getUpgradeOptions('target'));
            if (isDestroyed() || gen !== targetLoadGen.get()) return false;
            setTankData(nextTankData);
            cvsRef().resolveArmorStateDecl(tid);   // 动态装甲声明（非动态车 → null，全链 no-op）
            const q = new URLSearchParams(location.search);
            const wantCfg = parseInt(q.get('config') ?? '', 10);
            const configs = getTankData().configs || [];
            const defaultCfg = Math.max(0, configs.length - 1);
            currentConfigIdx = ((Number.isInteger(wantCfg) && wantCfg >= 0 && wantCfg < configs.length) ? wantCfg : defaultCfg);
            setupConfigSelect();
            updateInfoPanel();
            ml.loadModels();
            return true;
        }

function setShellUiVisible(visible: boolean): void {
            shellUiHidden = !visible;
            const el = document.getElementById('shell-selector');
            if (el) el.style.display = (!shellUiHidden && shooterShells && shooterShells.length) ? 'block' : 'none';
        }

function setConfigUiVisible(visible: boolean): void {
            configUiHidden = !visible;
            const row = document.getElementById('config-row');
            if (row) row.style.display = configUiHidden ? 'none' : '';
        }

function setupConfigSelect(): void {
            const sel = document.getElementById('config-select') as HTMLSelectElement | null;
            const row = document.getElementById('config-row');
            const cfgs = getTankData() && getTankData().configs ? getTankData().configs! : [];
            if (!sel || !row) return;
            if (cfgs.length <= 1) { row.style.display = 'none'; return; }
            row.style.display = configUiHidden ? 'none' : 'flex';
            sel.innerHTML = '';
            cfgs.forEach((c: TankConfig, i: number) => {
                const o = document.createElement('option');
                o.value = String(i);
                o.textContent = c.label! + (c.turret_name && c.turret_name !== c.label ? ' (' + c.turret_name + ')' : '');
                sel.appendChild(o);
            });
            sel.value = String(currentConfigIdx);
        }

function applyConfig(idx: number): void {
            currentConfigIdx = idx;
            const cfg = deps.getCurrentConfig();
            if (!cfg) return;
            (document.getElementById('config-select') as HTMLSelectElement).value = String(idx);

            rig.collectConfigNodes(ml.models.tankModel);
            rig.applyConfigVisible(ml.models.tankModel, cfg.gun_index!, cfg.turret_index!);
            if (ml.models.armorModel) applyArmorPrefixVisibility(ml.models.armorModel, cfg, rig.collectArmorPrefixes());
            ml.retagSpacedSections();
            ml.refreshConfigArmorThickness();
            rig.alignArmorModules();
            rig.invalidatePoseCaches();
            rig.collectTurretGunNodes();
            rig.collectArmorNodes();
            rig.updateTurretGun(getTurretDeg(), getGunDeg());

            // 目标配置只决定受击方装甲几何/厚度；射击方弹表、口径与选中弹种是射击方的
            // 独立状态（&scfg= 或其自身默认顶级配置），不因目标换炮而改变——同车型
            // 检视也不例外。装甲刷新、穿透失效与热力图重建照常进行。

            // 动态装甲状态过滤必须在热力图重建**之前**：retagSpacedSections/
            // applyArmorConfigVisible 会把可控板还原/重显（覆盖 deco）——visual 回调与
            // 配置切换都经此汇入，漏挂或次序颠倒则初态/切态被覆盖或板集陈旧（review P1-1/P2）
            cvsRef().applyArmorStateToModel();
            cvsRef().applyCategoryFilters();
            // 切配置后旧的命中部件信息不再属于当前视图
            const cfgCard = document.getElementById('click-info');
            if (cfgCard) cfgCard.style.display = 'none';
            cvsRef().setHighlightedArmorNode(null);
            // 目标配置变化后旧的穿透结果/轨迹/HE 爆点都对不上新装甲；普通检视清空并
            // 使在途判定失效，射击复现则沿权威 launch/lvDir 重跑。
            if (!QP.get('shot')) {
                jcRef().bumpPenSeq();
                tcRef().tidyTrajectory();
                if (window.__hitMarker) { getFxScene().remove(window.__hitMarker); window.__hitMarker = null; }
                jcRef().clearLastClickNdc();
            } else {
                rerunAuthoritativeShotCheckFn();
            }
            // 碰撞视图的颜色是厚度快照（applyArmorViewStyle 只在按钮切换时写）；切配置后
            // 必须重刷，否则新炮塔/主炮仍显示上一配置的厚度色。热力图模式由下方重建接管。
            if (deps.getCollisionMode() && !deps.getPenetrationMode() && ml.models.armorModel) cvsRef().applyArmorViewStyle(true);
            if (deps.getPenetrationMode() && ml.models.armorModel) hmRef().rebuildHeatmapScenes();
            else if (hmRef().getPrimaryArmorScene()) { hmRef().disposePenetrationResources(); hmRef().syncHeatOverlay(); }
        }

function populateShellSelector(shells: ShellSpec[], requestedIndex = 0): void {
            const sel = document.getElementById('shell-select') as HTMLSelectElement;
            sel.innerHTML = '';
            shells.forEach((s: ShellSpec, i: number) => {
                const opt = document.createElement('option');
                opt.value = String(i);
                opt.textContent = eqsRef().shellOptionText(s);
                sel.appendChild(opt);
            });
            const index = Number.isInteger(requestedIndex) && requestedIndex >= 0 && requestedIndex < shells.length
                ? requestedIndex : 0;
            sel.value = String(index);
            setSelectedShell(shells[index] || null);
            document.getElementById('shell-selector')!.style.display = (!shellUiHidden && shells.length > 0) ? 'block' : 'none';
        }

async function loadShooter(tid: number | string): Promise<void> {
            if (isDestroyed() || isContextLost()) return;
            const gen = ++shooterLoadGen;
            shooterLoading = true;
            setSelectedShell(null);
            jcRef().bumpPenSeq();
            // 普通检视换射手/换炮后旧命中、轨迹与 HE 爆点属于上一门炮，必须立即失效；
            // 射击复现仍按权威弹道重跑，不在此清空。
            if (!QP.get('shot')) {
                tcRef().tidyTrajectory();
                if (window.__hitMarker) { getFxScene().remove(window.__hitMarker); window.__hitMarker = null; }
                jcRef().clearLastClickNdc();
            }
            try {
                const data = await fetchTankData(tid, getUpgradeOptions('shooter'));
                if (isDestroyed()) return;
                if (gen !== shooterLoadGen) return;
                shooterData = data;
                // 编辑器可能先于场景拿到射手数据：排队中的换炮在数据就绪时生效；
                // tankId 不匹配说明选择已切走，丢弃旧队列。
                if (pendingShooterConfig) {
                    if (pendingShooterConfig.tankId === tid && pendingShooterConfig.tankId === currentShooterId) {
                        QP.set('scfg', String(pendingShooterConfig.index));
                        QP.delete('shell');
                        pendingShooterConfig = null;
                    } else if (pendingShooterConfig.tankId !== currentShooterId) {
                        pendingShooterConfig = null;
                    }
                }
                // 射手实际搭载配置弹表（&scfg= = shooter_config_idx，射击复现表注入）：
                // 多炮坦克 stock 弹表与发射炮的穿深/弹种清单不同（KV-1 发射 85mm F-30 AP
                // 120mm，stock ZiS-5 表只有 86/102/20），选择器必须用发射炮的表。
                // 解析与 ArmorShotHud.cfgIndex 完全同口径：显式且有效的 scfg 选该配置，
                // 缺失/无效用射手自身默认顶级变体（configs 末位）；被选配置弹表为空时
                // 回退车辆顶层 shells（不跳到默认配置），再空走 fetchShells 兜底——
                // 不从目标配置推导。scfg 用 Number 严格解析（parseInt('2x') 会偏离 HUD）。
                const scfgRaw = QP.get('scfg');
                const scfgWanted = (scfgRaw == null || scfgRaw === '') ? NaN : Number(scfgRaw);
                const cfgArr = shooterData!.configs || [];
                const defaultCfg = cfgArr.length ? cfgArr[cfgArr.length - 1] : null;
                const scfgCfg = (Number.isInteger(scfgWanted) && scfgWanted >= 0 && scfgWanted < cfgArr.length)
                    ? cfgArr[scfgWanted] : defaultCfg;
                let shells: ShellSpec[] | null = null, caliber: number | null = null;
                if (scfgCfg && (scfgCfg.shells || []).length) {
                    shells = scfgCfg.shells || [];
                    caliber = (Number.isFinite(scfgCfg.caliber) && scfgCfg.caliber! > 0)
                        ? scfgCfg.caliber! : null;
                }
                if (!shells || shells.length === 0) {
                    shells = shooterData!.shells || [];
                    caliber = (Number.isFinite(shooterData!.caliber) && shooterData!.caliber! > 0)
                        ? shooterData!.caliber! : null;
                }
                if (!shells || shells.length === 0) {
                    const data = await fetchShells(tid, getUpgradeOptions('shooter'));
                    if (isDestroyed()) return;
                    if (gen !== shooterLoadGen) return;
                    if (Array.isArray(data)) {
                        shells = data;
                    } else {
                        shells = data.shells || [];
                        caliber = (Number.isFinite(data.caliber) && data.caliber > 0) ? data.caliber : null;
                    }
                }
                if (!shells) shells = [];
                shooterShells = shells.map(s => (s && s.caliber == null && Number.isFinite(caliber) && caliber! > 0)
                    ? Object.assign({}, s, { caliber: caliber }) : s);
                shooterCaliber = caliber;
                // 射击复现的 &shell= 属于射手配置；普通检视在配置完成后重新恢复该下标。
                populateShellSelector(shooterShells, requestedShellIndex());
                // 这里只校验“能不能构成一次判定”：弹种/穿深/伤害/口径。转正角属于判定输入，
                // 由 doPenetrationCheck 在点击时校验——射手弹表是独立状态，不随目标配置变化。
                const loadedShell = getSelectedShell();
                const loadedShellType = loadedShell ? shellTypeOf(loadedShell) : null;
                if (!loadedShell || !loadedShellType
                    || !Number.isFinite(loadedShell.penetration) || !((loadedShell.damage ?? 0) > 0)
                    || !(jcRef().resolveShotCaliber() > 0)) {
                    setSelectedShell(null);
                    throw new Error(L.shellUnavailable);
                }
                // 切换射击坦克后同步热力图 uniforms（口径/穿深/跳弹角/转正角），否则判定沿用旧数据
                if (getPenetrationMode() || hmRef().getPrimaryArmorScene()) {
                    const sh = getSelectedShell() || null;
                    if (sh) { hmRef().updatePenetrationUniforms(sh); hmRef().updateSpacedUniforms(sh); }
                }
                hmRef().syncHeatOverlay();
                shooterLoading = false;
                const wc = window.__worldTickCtx;
                if (getUrlApplied() && wc?.launch && wc.lvDir && window.__worldPenMode) {
                    jcRef().setShotRay(wc.launch.clone(), wc.launch.clone().addScaledVector(wc.lvDir, wc.rayFar));
                    jcRef().doPenetrationCheck(0, 0);
                    jcRef().clearShotRay();
                }
            } catch (error) {
                if (!isDestroyed() && gen === shooterLoadGen) {
                    setSelectedShell(null);
                    throw error;
                }
            } finally {
                if (gen === shooterLoadGen) shooterLoading = false;
            }
        }

function updateTankLabels(): void {
            const find = (id: number | null) => tanksList.find(t => String(t.id) === String(id));
            const s = find(currentShooterId), t = find(currentTargetId);
            (document.getElementById('shooter-select') as HTMLButtonElement).textContent = s ? s.name! : '—';
            (document.getElementById('target-select') as HTMLButtonElement).textContent = t ? t.name! : '—';
            (document.getElementById('shooter-select') as HTMLButtonElement).disabled = !initDone;
            (document.getElementById('target-select') as HTMLButtonElement).disabled = !initDone;
            document.getElementById('tank-selection-status')!.hidden = initDone;
        }

function selectTank(mode: 'shooter' | 'target' | string, id: number | string): boolean {
            // 首次弹药初始化由 init 独占；防止过期 init continuation 越过新选择。
            if (!initDone) return false;
            id = parseInt(String(id), 10);
            if (!Number.isFinite(id)) return false;
            if (mode === 'shooter') {
                currentShooterId = id;
                updateTankLabels();
                loadShooter(id).catch((e) => {
                    if (currentShooterId === id) reportLoad({ state: 'error', message: loadFailed('shell data', errorMessage(e)) });
                });
            } else if (mode === 'target') {
                currentTargetId = id;
                updateTankLabels();
                loadTarget(id).catch((e) => reportLoad({ state: 'error', message: loadFailed('tank data', errorMessage(e)) }));
            } else {
                return false;
            }
            onTankSelection?.({ shooter: currentShooterId, target: currentTargetId });
            return true;
        }

    function canPick(): boolean {
            return initDone;
        }

async function populateTankLists(initTargetId: number | null, initShooterId: number | null): Promise<void> {
            // 与坦克百科同一名册视图模型：搜索别名 / hp / pen_max 都来自 normalizeTankCache。
            const list = normalizeTankCache(await fetchTankEncyclopedia());
            if (isDestroyed()) return;
            tanksList = list;
            currentShooterId = initShooterId || initTargetId;
            currentTargetId = initTargetId;
            updateTankLabels();
            onTankList?.(list);
            onTankSelection?.({ shooter: currentShooterId, target: currentTargetId });
        }
    return {
        updateInfoPanel, loadTarget, loadShooter, selectTank, canPick, populateTankLists,
        updateTankLabels, applyConfig, setupConfigSelect, populateShellSelector,
        setShellUiVisible, setConfigUiVisible,
        bumpShooterLoadGen: () => { shooterLoadGen++; return shooterLoadGen; },
        markInitDone: () => { initDone = true; },
        setPendingShooterConfig: (v) => { pendingShooterConfig = v; },
        isInitDone: () => initDone,
        getCurrentTargetId: () => currentTargetId,
        getCurrentShooterId: () => currentShooterId,
        getCurrentConfigIdx: () => currentConfigIdx,
        isShooterLoading: () => shooterLoading,
        getTanksList: () => tanksList,
        getPendingShooterConfig: () => pendingShooterConfig,
        getShooterShells: () => shooterShells,
        setShooterData: (d) => { shooterData = d; },
        getShooterData: () => shooterData,
        getShooterCaliber: () => shooterCaliber,
        isConfigUiHidden: () => configUiHidden,
        isShellUiHidden: () => shellUiHidden,
    };
}
