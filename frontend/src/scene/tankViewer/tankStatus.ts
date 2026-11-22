// 状态/标签/升级选项/HUD 报告 owner（2026-11-22 自 tankViewer.js 闭包出仓，纯搬移）。
// 所有跨子系统共享的可变状态集中在宿主对象 S 上（S.<name> 读写与搬移前闭包逐字一致）。
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
            // 让所有 in-flight 资产/目标加载 continuation 失效，避免它们在错误态之后
            // 继续写 loading/ready 或启动渲染。
            S.loadGen++;
            S.targetLoadGen++;
            S.dl.bumpShooterLoadGen();
            if (S.rafId) { cancelAnimationFrame(S.rafId); S.rafId = 0; }
            S.reportLoad({ state: 'error', message: S.contextLostMessage(), contextLost: true });
        }

function reportContextRestored(S: Host) {
            // 浏览器允许恢复上下文，但 Three.js 的 GPU 资源已失效；保持错误态，由宿主
            // “重试”销毁并重新创建整个 renderer，不在这里重建半套 GL 资源。
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
        // XI 升级态与模块配置一样按双方独立读取；同车也不从目标推导射手状态。
        // custom（部分研发）必须原样透传：折叠成 top 会把未研发节点的加成也画上去，
        // 折叠成 stock 会丢掉已研发效果。
        S.upgradeOptions = (side: 'shooter' | 'target') => {
            const rawUpgrade = S.QP.get(side === 'shooter' ? 'supgrade' : 'upgrade');
            const explicit = rawUpgrade === 'top' ? 'top'
                : rawUpgrade === 'stock' ? 'stock'
                    : rawUpgrade === 'custom' ? 'custom' : undefined;
            return {
                // 普通装甲检视缺省 XI 顶级；射击复现没有升级态证据时不得补成满级，
                // 只有显式 &upgrade=top / &supgrade=top 才是 what-if。
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
            phase: (phase: string) => phase,   // 加载阶段名（armor model / tank model / tank data / tank list）
            armorStateCheckbox: 'Dynamic armor',
            armorStateAutoTitle: 'Replay-detected (armor state at impact)',
            // 122 装备徽标（射击诊断面板）：不得硬编码文案，宿主经 labels 传三语。
            pitchDevice: 'Improved Vertical Stabilizer',
            // Type5 配件串回放判定来源提示（勾选框禁用时的 tooltip）：同不得硬编码。
            replayEquipmentAutoTitle: 'Replay-detected (Type5 equipment)',
            ...S.labels,
        };
        S.loadFailed = (phase: string, msg: string) => S.L.loadFailed(S.L.phase(phase), msg);

        // Armor Inspector 单车装甲检视实测参考（PC T-34，2026-10-18）：
        // 默认 15m/18.75°，FOV 最大 40°（约 6.5m 处封顶）；实测 product 从 15m 的
        // ≈2.477 按 +0.0128/m 缓慢增大、封顶 2.8。用户 2026-10-19 要求车体随距离
        // 缩放更明显：显示 profile 改用 +0.028/m、封顶 3.8（再乘 1.1 整体缩放），
        // 15m 基准不变；30m 约小 14%，100m/500m 约小 35%（实测参考仍保留在上面的注释）。
        // near=0.05d / far=d+30；相机距离沿用查看器 3–500m。
        // shot replay 与装甲检视共用这套显示 profile；两车 world overview 保持原生 50° 取景。
        S.ARMOR_REF_DIST = 15;
        S.ARMOR_BASE_FOV = 18.75;
        S.ARMOR_MAX_FOV = 40;
        S.ARMOR_MIN_FOV = 0.5;
        S.ARMOR_FAR_PRODUCT_GAIN = 0.028;
        S.ARMOR_FAR_PRODUCT_MAX = 3.8;
        S.ARMOR_PRODUCT_SCALE = 1.1;
        S.OVERVIEW_BASE_FOV = 50;

        // window 级监听统一经 onWin 登记，destroy 时成对摘除
        S.escapeText = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, ch => ESCAPES[ch]);
        S.cleanups = [];
        S.lastPresetTarget = null; // 最近一次相机预设的炮轴基准点（pose.target，门禁量炮线俯角用）
        S.rafId = 0;
        S.destroyed = false;   // destroy 后迟到的 init/ animate 不再启动渲染
        S.contextLost = false; // WebGL 上下文丢失后 retry 必须重建 renderer，而不是只 reload 数据
        S.gpuLabel = '';       // 上下文丢失诊断：UNMASKED_RENDERER_WEBGL / RENDERER
        // Navigation between shots replaces the scene before delayed shell/trajectory work can finish.
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
        // 加载状态上报（宿主页进度条 / 错误态）；宿主回调异常不影响场景
        S.reportLoad = (state: LoadState) => {
            if (S.destroyed || typeof S.onLoadState !== 'function') return;
            // Context loss 后所有 load/ready 上报都必须让位于错误态；只有带 contextLost
            // 标记的错误本身可以写入，否则 in-flight GLTF/modelProgress 回调会把错误卡
            // 覆盖成 loading/ready，retry 入口消失。
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
        
        
        // 两个 GLB（装甲 + 外观）字节进度聚合；loadGen 让切车后旧加载的回调不再上报
        S.loadGen = 0;
        S.targetLoadGen = 0;   // target JSON requests can finish out of order when users switch tanks quickly
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
