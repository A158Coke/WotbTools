/** 「远端 end-session 尚未完成」标记（拆分自 useAuth.ts，行为原样）。 */
/**
 * 「远端 end-session 尚未完成」标记（仅浏览器离线登出会置位）。
 * 存 localStorage：登出意图必须跨刷新存活，否则下一次加载就会把用户静默登回去。
 */
const PENDING_REMOTE_LOGOUT_KEY = 'wotb-auth-pending-remote-logout'

export function markPendingRemoteLogout() {
  try { localStorage.setItem(PENDING_REMOTE_LOGOUT_KEY, '1') } catch { /* 隐私模式：降级为会话内语义 */ }
}

export function clearPendingRemoteLogout() {
  try { localStorage.removeItem(PENDING_REMOTE_LOGOUT_KEY) } catch { /* 同上 */ }
}

/** 是否处于「离线登出后、远端会话未收敛」状态：init 不静默复登。 */
export function hasPendingRemoteLogout() {
  try { return localStorage.getItem(PENDING_REMOTE_LOGOUT_KEY) === '1' } catch { return false }
}
