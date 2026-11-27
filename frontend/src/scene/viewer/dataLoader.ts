import * as THREE from 'three'
import { fetchTankData, fetchShells, fetchTankEncyclopedia } from '../agentData.js'
import { normalizeTankCache } from '../../utils/tankopediaQuery.js'
import { romanLevel } from '../../utils/tierFormat.js'
import { shellTypeOf } from './armorPlateModel.js'
import { applyArmorConfigVisible as applyArmorPrefixVisibility } from './armorPlateModel.js'
import { disposeHitMarker } from './overlayStroke.js'
import type { TankArmorConfig } from './armorPlateModel.js'
import type { ModelLifecycleHandle } from './modelLifecycle.js'
import type { TurretRigHandle } from './turretRig.js'
import type { CollisionViewHandle } from './collisionView.js'
import type { ShellSpec, TankConfig, TankData } from './viewerContracts.js'

export interface LoadReportState {
    state: 'loading' | 'ready' | 'error'
    progress?: number | null
    message?: string
    contextLost?: boolean
}

export interface ShooterTankData extends TankData {
    configs?: ShooterTankConfig[]
    shells?: ShellSpec[]
    caliber?: number
}
export interface ShooterTankConfig extends TankConfig {
    shells?: ShellSpec[]
    caliber?: number
}

export interface PendingShooterConfig {
    tankId: number | null
    index: number
}

export interface TankListEntry {
    id: number | string
    name?: string
    [key: string]: unknown
}

export interface DataLoaderHeatmapHandle {
    rebuildHeatmapScenes(): void
    getPrimaryArmorScene(): THREE.Scene | null
    disposePenetrationResources(): void
    syncHeatOverlay(): void
    updatePenetrationUniforms(shell: ShellSpec): void
    updateSpacedUniforms(shell: ShellSpec): void
}

export interface DataLoaderJudgmentHandle {
    bumpPenSeq(): void
    clearLastClickNdc(): void
    doPenetrationCheck(ndcX: number, ndcY: number): void
    setShotRay(origin: THREE.Vector3, target: THREE.Vector3): void
    clearShotRay(): void
    resolveShotCaliber(): number
}

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
    targetLoadGen: { get: () => number; bump: () => number }
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
    clearShotState?: () => void
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
        clearShotState,
    } = deps

        let initDone = false;
        let shooterLoadGen = 0;
        let shooterLoading = false;
        let pendingShooterConfig: PendingShooterConfig | null = null;
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
            document.getElementById('tank-tier')!.textContent = romanLevel(getTankData().tier) || '?';
            document.getElementById('tank-type')!.textContent = getTankData().type ? L.type(getTankData().type!) : '?';
            document.getElementById('tank-nation')!.textContent = getTankData().nation ? L.nation(getTankData().nation!) : '?';
            document.getElementById('info-panel')!.style.display = 'block';
        }

async function loadTarget(tid: number | string): Promise<boolean> {
            if (isDestroyed() || isContextLost()) return false;
            const gen = targetLoadGen.bump();
            loadGen.bump();
            jcRef().bumpPenSeq();
            setUrlApplied(false);
            tcRef().tidyTrajectory();
            jcRef().clearLastClickNdc();
            clearShotState?.();
            reportLoad({ state: 'loading', progress: null });
            const nextTankData = await fetchTankData(tid, getUpgradeOptions('target'));
            if (isDestroyed() || gen !== targetLoadGen.get()) return false;
            setTankData(nextTankData);
            cvsRef().resolveArmorStateDecl(tid);
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


            cvsRef().applyArmorStateToModel();
            cvsRef().applyCategoryFilters();
            const cfgCard = document.getElementById('click-info');
            if (cfgCard) cfgCard.style.display = 'none';
            cvsRef().setHighlightedArmorNode(null);
            if (!QP.get('shot')) {
                jcRef().bumpPenSeq();
                tcRef().tidyTrajectory();
                disposeHitMarker(getFxScene());
                jcRef().clearLastClickNdc();
                clearShotState?.();
            } else {
                rerunAuthoritativeShotCheckFn();
            }
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
            if (!QP.get('shot')) {
                tcRef().tidyTrajectory();
                disposeHitMarker(getFxScene());
                jcRef().clearLastClickNdc();
                clearShotState?.();
            }
            try {
                const data = await fetchTankData(tid, getUpgradeOptions('shooter'));
                if (isDestroyed()) return;
                if (gen !== shooterLoadGen) return;
                shooterData = data;
                if (pendingShooterConfig) {
                    if (pendingShooterConfig.tankId === tid && pendingShooterConfig.tankId === currentShooterId) {
                        QP.set('scfg', String(pendingShooterConfig.index));
                        QP.delete('shell');
                        pendingShooterConfig = null;
                    } else if (pendingShooterConfig.tankId !== currentShooterId) {
                        pendingShooterConfig = null;
                    }
                }
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
                populateShellSelector(shooterShells, requestedShellIndex());
                const loadedShell = getSelectedShell();
                const loadedShellType = loadedShell ? shellTypeOf(loadedShell) : null;
                if (!loadedShell || !loadedShellType
                    || !Number.isFinite(loadedShell.penetration) || !((loadedShell.damage ?? 0) > 0)
                    || !(jcRef().resolveShotCaliber() > 0)) {
                    setSelectedShell(null);
                    throw new Error(L.shellUnavailable);
                }
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
