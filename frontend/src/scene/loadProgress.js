/**
 * 3D 资产加载进度聚合（审计 3D-23：加载只有一行文字，没有进度）。
 * 每个资产是一项：GLTFLoader / XHR 的 onProgress 给字节进度（total 可能为 0 = 长度未知），
 * fetch 步骤只在完成时记一项。整体进度 = 各项进度的平均值，单调不减。
 * 纯逻辑，不依赖 three.js / DOM，方便测试；onChange 收到 snapshot。
 */

/** 单项进度：完成 = 1；字节总量已知 = loaded/total；未知 = 0（只在完成时跳到 1） */
function itemFraction(item) {
  if (item.done) return 1
  if (item.total > 0) return Math.min(1, Math.max(0, item.loaded / item.total))
  return 0
}

/**
 * @param {(snapshot: { fraction: number | null, done: number, total: number }) => void} [onChange]
 */
export function createLoadProgress(onChange) {
  const items = new Map()
  let last = 0

  function snapshot() {
    if (!items.size) return { fraction: null, done: 0, total: 0 }
    let sum = 0
    let done = 0
    for (const item of items.values()) {
      sum += itemFraction(item)
      if (item.done) done += 1
    }
    // 新登记的项会拉低平均值：对外保持单调不减，避免进度条倒退
    last = Math.max(last, sum / items.size)
    return { fraction: last, done, total: items.size }
  }

  const emit = () => {
    const snap = snapshot()   // 先算快照：单调下限在每次变更时推进，与是否有回调无关
    onChange?.(snap)
  }

  return {
    /** 登记一项（重复登记无副作用） */
    expect(key) {
      if (!items.has(key)) items.set(key, { loaded: 0, total: 0, done: false })
      emit()
    },
    /** 字节进度（XHR ProgressEvent：loaded / total；lengthComputable=false 时 total=0） */
    update(key, loaded, total) {
      const item = items.get(key) || { loaded: 0, total: 0, done: false }
      item.loaded = Number(loaded) || 0
      item.total = Number(total) || 0
      items.set(key, item)
      emit()
    },
    /** 完成（成功或失败都算结束；失败由调用方另行上报） */
    complete(key) {
      const item = items.get(key) || { loaded: 0, total: 0, done: false }
      item.done = true
      items.set(key, item)
      emit()
    },
    reset() {
      items.clear()
      last = 0
      emit()
    },
    snapshot,
  }
}

/** 0–1 → 0–100 的整数百分比；null（未知）保持 null，进度条显示为不确定态 */
export function progressPercent(fraction) {
  if (fraction == null || !Number.isFinite(fraction)) return null
  return Math.round(Math.min(1, Math.max(0, fraction)) * 100)
}
