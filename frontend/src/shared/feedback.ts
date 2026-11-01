import type { InjectionKey } from 'vue'

/** 应用外壳持有站点反馈对话框；入口只请求打开，门禁与登录由外壳决定。 */
export const FEEDBACK_KEY: InjectionKey<() => void> = Symbol('wotbtools.feedback')
