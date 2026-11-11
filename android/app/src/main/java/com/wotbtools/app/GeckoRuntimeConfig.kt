package com.wotbtools.app

/**
 * GeckoView 启动配置（`GeckoRuntimeSettings.Builder.configFilePath` 读取的 YAML，release 构建同样生效）。
 *
 * `full-screen-api.allow-trusted-requests-only = false`：Gecko 默认只允许用户输入事件里的
 * `requestFullscreen()`；回放解析完成后的自动横屏全屏发生在异步回调里，没有用户输入，默认配置下必被拒绝。
 * 关闭该限制后全屏**仍然只由 Gecko 持有**（`document.fullscreenElement` → `onFullScreen` → 宿主系统 UI / 方向），
 * 不引入第二个全屏权威。安全面：主文档导航只放行本机 origin（`NavigationPolicy`，外部 https 交系统浏览器），
 * 放宽后最多是本 App 自己的页面无手势全屏；全屏可随时被 Back / 系统手势退出。
 *
 * 验证状态：`configFilePath` 在 GeckoView 文档（含 release 构建强制读取）中存在，YAML `prefs` 为布尔 / 字符串 / 整数映射；
 * 本机无法对 pinned geckoview 版本做运行时验证，**自动全屏是否真实生效仍是真机门槛**。
 */
object GeckoRuntimeConfig {
    const val FILE_NAME = "geckoview-config.yaml"

    fun yaml(): String = "prefs:\n  full-screen-api.allow-trusted-requests-only: false\n"
}
