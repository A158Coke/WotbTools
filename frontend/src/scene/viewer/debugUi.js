// 调试/诊断 UI（#820 Agent A 出仓）：射击复现错误条、技术证据调试窗口、
// segment/模块解码与单发质量提示。原 tankViewer.js 闭包内对应函数整体平移。
import { recordedTargetMatchesShot } from '../../replay-local/compute/tankSetup'

/**
 * @param {object} deps composition root 注入的显式接口
 * @param {object} deps.L 界面文案
 * @param {(value: unknown) => string} deps.escapeText HTML 转义
 * @param {() => boolean} deps.isDestroyed
 * @param {() => number|null} deps.getCurrentTargetId 当前目标车 id（data loader owner）
 */
export function createDebugUi(deps) {
    const { L, escapeText, isDestroyed, getCurrentTargetId } = deps
    // showShotError 的持久错误行：World View HUD 重建 #turret-controls 时
    // 会覆盖它，所以错误消息保存在模块状态并在每次重建时重新插入。
    let shotReplayError = '';

function shotErrorHtml() {
            if (!shotReplayError) return '';
            return '<div class="ctrl-row" style="color:var(--red);"><b>射击复现错误</b></div>'
                + '<div class="ctrl-row" style="color:var(--red);font-size:11px;">' + escapeText(shotReplayError) + '</div>';
        }

function clearShotError() {
            shotReplayError = '';
            const el = document.getElementById('shot-replay-error');
            if (el) { el.textContent = ''; el.style.display = 'none'; }
        }

function showShotError(msg) {
            if (isDestroyed()) return;
            shotReplayError = msg;
            console.error('[shot-replay] ' + msg);
            // 用户可见的常显错误条；不进入 #turret-controls 的 debug details/隐藏逻辑。
            const alert = document.getElementById('shot-replay-error');
            if (alert) { alert.textContent = msg; alert.style.display = 'block'; }
            const st = document.getElementById('turret-controls');
            if (st) {
                // 世界模式调试关闭时该面板被收纳——错误必须强制可见
                st.style.display = 'block';
                st.innerHTML = shotErrorHtml();
            }
        }

function fmt3(x, y, z) { return '(' + x.toFixed(1) + ', ' + y.toFixed(1) + ', ' + z.toFixed(1) + ')'; }
function dbgReset() {
            let w = document.getElementById('debug-info');
            if (!w) {
                w = document.createElement('div');
                w.id = 'debug-info';
                (document.getElementById('corner-tr') || document.body).appendChild(w);
            }
            w.replaceChildren();
            const heading = document.createElement('h4');
            heading.textContent = L.technicalEvidence;
            w.appendChild(heading);
        }

function dbgInfo(id, color, name, text) {
            const w = document.getElementById('debug-info');
            if (!w) return;
            let r = document.getElementById(id);
            if (!r) {
                r = document.createElement('div');
                r.id = id; r.className = 'dbg-row';
                r.innerHTML = '<span class="dbg-dot" style="background:' + color + '"></span>'
                    + '<span class="dbg-name">' + name + '</span><span class="dbg-val"></span>';
                w.appendChild(r);
            }
            r.querySelector('.dbg-val').textContent = text;
        }

function setupShotDebug(extraRefresh) {
            // Group raw protocol and geometry evidence for the explicit developer URL mode.
            const panel = document.getElementById('turret-controls');
            if (panel) {
                const evidence = document.createElement('details');
                evidence.className = 'armor-evidence';
                const summary = document.createElement('summary');
                summary.textContent = L.technicalEvidence;
                evidence.appendChild(summary);
                for (const row of [...panel.children]) {
                    if (!row.querySelector('#time-scrub')) evidence.appendChild(row);
                }
                const coordinates = document.getElementById('debug-info');
                if (coordinates) evidence.appendChild(coordinates);
                panel.appendChild(evidence);
            }
            window.__debugOn = false;
            window.__debugSetVisible = function(on) {
                window.__debugOn = on;
                if (window.__worldAnno) window.__worldAnno.visible = on;
                if (window.__moveAnno) window.__moveAnno.visible = on;
                if (window.__shooterMuzzleMk) window.__shooterMuzzleMk.visible = on;
                if (window.__shooterMuzzleLine) window.__shooterMuzzleLine.visible = on;
                if (extraRefresh) extraRefresh(on);
                // 面板与移动标注复选框仅在调试模式可交互
                const st = document.getElementById('turret-controls');
                if (st) st.style.display = on ? 'block' : 'none';
                // 开发诊断窗口随模式显隐（内容行由各标记更新函数写入）
                const di = document.getElementById('debug-info');
                if (di) di.style.display = on ? 'block' : 'none';
            };
        }

function shellIdParts(gid) {
            if (!gid) return null;
            return { local: gid >> 8, nation: gid & 0xff };
        }

function decodeModules(mask) {
            const NAMES = ['引擎','弹药架','油箱','右履带','左履带','火炮','?37','观察装置','?39','?40','?41','?42','?43'];
            const out = [];
            if (!mask) return out;
            for (let b = 0; b < 13; b++) if (mask & (1 << b)) out.push(NAMES[b] || ('bit' + b));
            return out;
        }

function srQualityIssues(s) {
            const q = s.quality;
            const issues = [];
            if (!q) return issues;
            if (q.target_dead) issues.push('受击方开火前已死亡（残骸命中，按未命中处理）');
            if (q.shooter_pos_from_muzzle) issues.push('射手位置为炮口坐标兜底');
            if (q.target_anchor_src === 'nearest') issues.push('命中通知缺失，目标锚点回退命中时刻最近包');
            else if (q.target_anchor_src === 'extrapolated') issues.push('命中通知缺失，目标锚点按末段速度外推');
            else if (q.target_anchor_src === 'filtered') issues.push('命中通知缺失，目标锚点回退命中时刻插值');
            if ((q.turret_degraded || []).includes('target')) issues.push('目标炮塔角降级为车体朝向');
            if ((q.turret_degraded || []).includes('shooter')) issues.push('射手炮塔角降级为车体朝向');
            if (q.shell_from_broadcast) issues.push('弹种来自开火广播兜底');
            if (q.shell_from_terrain) issues.push('弹种来自地形命中广播兜底（0x1b）');
            if (q.shooter_pitch_from_velocity) issues.push('射手炮管俯仰由弹道推算');
            if (q.dmg_unattributed) issues.push('伤害未记账');
            if (s.target_name && !s.shell_id) issues.push('弹种未知');
            if (s.target_name && s.game_hit_result === 255) issues.push('服务器未通知命中结果');
            return issues;
        }
    return {
        shotErrorHtml, clearShotError, showShotError,
        dbgReset, dbgInfo, fmt3, setupShotDebug,
        shellIdParts, decodeModules, srQualityIssues,
        getShotReplayError: () => shotReplayError,
    };
}
