package com.wotb.web.config;

import java.util.List;

import org.junit.jupiter.api.Test;
import org.springframework.boot.env.YamlPropertySourceLoader;
import org.springframework.core.env.PropertySource;
import org.springframework.core.io.ClassPathResource;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * wotb-web {@code application.yml} 的日志级别契约。
 *
 * <p>本测试从 AI 模块测试中迁出：{@code org.apache.poi} 是 Business Backend 关注点，
 * 而 AI prompt 泄露防护（{@code OpenAiChatModel} 压到 ERROR）属于独立 ai-service，
 * 由 {@code wotb-ai} 自己的配置测试守护。</p>
 */
class WebApplicationLoggingContractTest {

    @Test
    void applicationYmlKeepsThirdPartyLogLevelsQuiet() throws Exception {
        assertEquals("WARN", application().getProperty("logging.level.org.apache.poi"),
                "POI 解析日志默认只保留 WARN");
    }

    private static PropertySource<?> application() throws Exception {
        final List<PropertySource<?>> sources = new YamlPropertySourceLoader()
                .load("application", new ClassPathResource("application.yml"));
        return sources.getFirst();
    }
}
