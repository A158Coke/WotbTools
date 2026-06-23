package com.wotb.web.service;

import org.springframework.boot.SpringApplication;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Service;

/** 桌面模式生命周期: 判定是否桌面运行、优雅关机 (仅桌面 exe 用)。 */
@Service
public class DesktopLifecycle {

    private final ConfigurableApplicationContext context;
    private final Environment env;

    public DesktopLifecycle(final ConfigurableApplicationContext context, final Environment env) {
        this.context = context;
        this.env = env;
    }

    /** 是否以桌面 (jpackage exe) 模式运行。 */
    public boolean isDesktop() {
        return env.getProperty("app.desktop", Boolean.class, false);
    }

    /** 异步退出: 让当前 HTTP 响应先返回, 再关闭 Spring 上下文并退出进程。 */
    public void requestShutdown() {
        new Thread(() -> {
            try {
                Thread.sleep(300);
            } catch (InterruptedException ignored) {
                Thread.currentThread().interrupt();
            }
            int code = SpringApplication.exit(context, () -> 0);
            System.exit(code);
        }, "desktop-shutdown").start();
    }
}
