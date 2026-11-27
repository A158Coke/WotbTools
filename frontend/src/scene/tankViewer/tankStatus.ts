import { createLoadProgress } from '../loadProgress.js'
import { resetViewerGlobals } from './viewerGlobals.js'
import type { Host } from '../tankViewer.js'
import { bind } from '../hostBind.ts'

interface LoadState { state: string; progress?: number | null; message?: string; contextLost?: boolean }

const ESCAPES: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}

function reportContextLost(S: Host, event: Event) {
            if (event && typeof event.preventDefault === 'function') event.preventDefault();
            if (S.destroyed) return;
            S.contextLost = true;
            S.loadGen++;
            S.targetLoadGen++;
            S.dl.bumpShooterLoadGen();
            if (S.rafId) { cancelAnimationFrame(S.rafId); S.rafId = 0; }
            S.reportLoad({ state: 'error', message: S.contextLostMessage(), contextLost: true });
        }

function reportContextRestored(S: Host) {
            if (!S.destroyed && S.contextLost) S.reportLoad({ state: 'error', message: S.contextLostMessage(), contextLost: true });
        }

export function bindTankStatus(S: Host) {
  Object.assign(S, {
    reportContextLost: bind(S, reportContextLost),
    reportContextRestored: bind(S, reportContextRestored),
  })
}

export function initTankStatus(S: Host) {
resetViewerGlobals();
        S.QP = new URLSearchParams(location.search);
        S.shotMode = S.QP.has('shot');
        S.upgradeOptions = (side: 'shooter' | 'target') => {
            const rawUpgrade = S.QP.get(side === 'shooter' ? 'supgrade' : 'upgrade');
            const explicit = rawUpgrade === 'top' ? 'top'
                : rawUpgrade === 'stock' ? 'stock'
                    : rawUpgrade === 'custom' ? 'custom' : undefined;
            return {
                upgrade: explicit ?? (S.shotMode ? undefined : 'top'),
                abilities: S.QP.get(side === 'shooter' ? 'sabilities' : 'abilities'),
            };
        };
        S.L = {
            loading: 'Loading tank model...',
            shellUnavailable: 'Shell data is missing or invalid.',
            loadFailed: (phase: string, msg: string) => 'Failed to load ' + phase + ': ' + msg,
            contextLost: '3D rendering context was lost (GPU/driver reset). Please retry.',
            type: (value: string) => value,
            nation: (value: string) => value,
            showCollision: 'Show Collision',
            hideCollision: 'Hide Collision',
            partName: (name: string) => name, resultName: (result: string) => result,
            shotDamage: 'damage',
            shotRicochetSeg: 'ricochet (-25% penetration)',
            shotLoss: 'loss',
            shotNominal: 'nominal',
            shotBlocked: 'blocked',
            shotDistance: 'Engagement distance', distanceUnit: 'm',
            effectivePenetration: 'effective penetration',
            shotMinDamage: 'min damage', shotMaxDamage: 'max damage', shotAvgDamage: 'avg damage', shotAvgShort: 'avg',
            shotPenChance: 'penetration chance', shotPenDamage: 'penetration damage',
            shotSplashDamage: 'splash damage', heRadius: 'splash radius', heBestSample: 'best sample',
            directHit: 'direct hit', expectedDamage: 'expected damage',
            heSamplingUnavailable: 'splash sampling unavailable',
            noPrimaryBlocked: 'No primary armor hit; treated as non-penetration',
            heBestSampleUpper: 'best sample (upper)', heBestSampleLower: 'best sample (lower)',
            sectionName: (section: string) => section,
            mayPenetrate: 'May penetrate',
            heatmap: 'Penetration map', hideHeatmap: 'Hide penetration map',
            technicalEvidence: 'Technical evidence', shotView: 'Shot view', relativeView: 'Impact view', worldView: 'Overview',
            phase: (phase: string) => phase,
            armorStateCheckbox: 'Dynamic armor',
            armorStateAutoTitle: 'Replay-detected (armor state at impact)',
            pitchDevice: 'Improved Vertical Stabilizer',
            replayEquipmentAutoTitle: 'Replay-detected (Type5 equipment)',
            ...S.labels,
        };
        S.loadFailed = (phase: string, msg: string) => S.L.loadFailed(S.L.phase(phase), msg);

        S.ARMOR_REF_DIST = 15;
        S.ARMOR_BASE_FOV = 18.75;
        S.ARMOR_MAX_FOV = 40;
        S.ARMOR_MIN_FOV = 0.5;
        S.ARMOR_FAR_PRODUCT_GAIN = 0.028;
        S.ARMOR_FAR_PRODUCT_MAX = 3.8;
        S.ARMOR_PRODUCT_SCALE = 1.1;
        S.OVERVIEW_BASE_FOV = 50;

        S.escapeText = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, ch => ESCAPES[ch]);
        S.cleanups = [];
        S.lastPresetTarget = null;
        S.rafId = 0;
        S.destroyed = false;
        S.contextLost = false;
        S.gpuLabel = '';
        S.pendingTimers = new Set();
        S.setTimeout = (callback: () => void, delay: number) => {
            const timer = globalThis.setTimeout(() => {
                S.pendingTimers.delete(timer);
                if (!S.destroyed) callback();
            }, delay);
            S.pendingTimers.add(timer);
            return timer;
        };
        S.cleanups.push(() => { S.pendingTimers.forEach(globalThis.clearTimeout); S.pendingTimers.clear(); });
        S.initPhase = 'tank list';
        S.reportLoad = (state: LoadState) => {
            if (S.destroyed || typeof S.onLoadState !== 'function') return;
            if (S.contextLost && !(state && state.contextLost)) return;
            try { S.onLoadState(state); } catch (_) {}
        };
        S.errorMessage = (error: unknown) => {
            if (typeof error === 'string') return error;
            if (error instanceof Error) return error.message || String(error);
            if (error && typeof error === 'object') {
                const e = error as { message?: unknown; statusText?: unknown };
                const text = e.message ?? e.statusText;
                if (text) return String(text);
            }
            return String(error ?? 'unknown');
        };
        S.contextLostMessage = () => S.gpuLabel ? `${S.L.contextLost} (${S.gpuLabel})` : S.L.contextLost;
        
        
        S.loadGen = 0;
        S.targetLoadGen = 0;
        S.modelProgress = createLoadProgress((snap) => S.reportLoad({ state: 'loading', progress: snap.fraction }));
        S.onWin = (type: string, fn: EventListener) => {
            window.addEventListener(type, fn);
            S.cleanups.push(() => window.removeEventListener(type, fn));
        };

        S.onWin('error', function(e: ErrorEvent) {
            var el = document.getElementById('loading');
            if (el) { el.textContent = 'JS Error: ' + (e.message || e.error) + ' @ ' + (e.filename || '') + ':' + (e.lineno || ''); el.style.color = '#f44336'; el.style.whiteSpace = 'pre-wrap'; }
        });
        S.onWin('unhandledrejection', function(e: PromiseRejectionEvent) {
            var el = document.getElementById('loading');
            if (el) { el.textContent = 'Promise Rejection: ' + (e.reason && (e.reason.message || e.reason)); el.style.color = '#f44336'; el.style.whiteSpace = 'pre-wrap'; }
        });
}
