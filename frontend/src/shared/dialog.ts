import type { InjectionKey } from 'vue'

/**
 * AppDialog 默认 Teleport 到 body。提供 true 时原地渲染（不移到 body）——
 * 组件测试用它在 wrapper 内直接查找对话框内容；生产代码不提供。
 */
export const DIALOG_INLINE_KEY: InjectionKey<boolean> = Symbol('dialog-inline')
