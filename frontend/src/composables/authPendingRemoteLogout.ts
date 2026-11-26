const PENDING_REMOTE_LOGOUT_KEY = 'wotb-auth-pending-remote-logout'

export function markPendingRemoteLogout() {
  try { localStorage.setItem(PENDING_REMOTE_LOGOUT_KEY, '1') } catch { /* 隐私模式：降级为会话内语义 */ }
}

export function clearPendingRemoteLogout() {
  try { localStorage.removeItem(PENDING_REMOTE_LOGOUT_KEY) } catch { /* 同上 */ }
}

export function hasPendingRemoteLogout() {
  try { return localStorage.getItem(PENDING_REMOTE_LOGOUT_KEY) === '1' } catch { return false }
}
