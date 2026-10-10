import type { InjectionKey } from 'vue'

/**
 * AppDialog 默认 Teleport 到 body。提供 true 时原地渲染（不移到 body）——
 * 组件测试用它在 wrapper 内查找内容；教学宿主提供 true，让共用弹窗随当前 fullscreen
 * Teleport 宿主呈现，避免把弹窗移出全屏可见子树。
 */
export const DIALOG_INLINE_KEY: InjectionKey<boolean> = Symbol('dialog-inline')
