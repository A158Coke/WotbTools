package com.wotbtools.app

/**
 * Native 启动面的可见性状态机（纯逻辑，JVM 单测覆盖）。
 *
 * 启动面只在 GeckoView 报告首个内容绘制后移除；paint reset / content crash / kill 后的恢复重新显示，
 * 直到下一次内容绘制。强制更新或运行时错误门禁接管画面时，启动面隐藏且不因恢复信号重新出现，
 * 只有下一次 [startLoading]（冷启动 / 重新加载）才重新进入等待内容态。
 */
internal class StartupSurfaceState {

    var visible = true
        private set

    private var gateOwnsScreen = false

    /** 冷启动 / 重新加载：启动面重新等待可显示内容；门禁态被显式解除。 */
    fun startLoading() {
        gateOwnsScreen = false
        visible = true
    }

    /** 页面已有可显示的首次内容绘制：移除启动面。 */
    fun contentPainted() {
        visible = false
    }

    /** 已绘制内容不再显示（paint reset / crash / kill 恢复）：重新显示启动面，门禁接管时不显示。 */
    fun contentUnavailable() {
        visible = !gateOwnsScreen
    }

    /** Native 门禁（强制更新 / 运行时错误）接管画面：启动面隐藏，直到下一次 [startLoading]。 */
    fun gateShown() {
        gateOwnsScreen = true
        visible = false
    }
}
