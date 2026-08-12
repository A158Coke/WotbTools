package com.wotb.web.replay.ai;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * AI 提示词加载器（单一事实源：classpath:/prompts/*.zh.md）。
 * <p>提示词正文以 Markdown 文件维护（可读、可 review、可 diff），运行期按 key 惰性加载并缓存。
 * 编辑约定：UTF-8、LF 换行；CRLF 会被归一化。规则片段（EN/RU 本地化替换锚点）仍留在
 * {@link PlayerPromptRules} / {@link TeamPromptLocalizer} 常量中，与 md 内 ZH 文本保持一致。</p>
 */
public final class AiPromptLibrary {

    private static final Map<String, String> CACHE = new ConcurrentHashMap<>();

    private AiPromptLibrary() {
    }

    /** 读取 prompts/{key}.zh.md 的原文（缓存）。 */
    public static String zh(final String key) {
        return CACHE.computeIfAbsent(key, AiPromptLibrary::read);
    }

    private static String read(final String key) {
        final String resource = "/prompts/" + key + ".zh.md";
        try (InputStream in = AiPromptLibrary.class.getResourceAsStream(resource)) {
            if (in == null) {
                throw new IllegalStateException("Missing AI prompt resource: " + resource);
            }
            final String text = new String(in.readAllBytes(), StandardCharsets.UTF_8);
            // Windows 编辑器可能引入 CRLF；归一化保证与历史 \n 内容一致（末尾换行保留）。
            return text.replace("\r\n", "\n").replace('\r', '\n');
        } catch (final IOException e) {
            throw new IllegalStateException("Failed to read AI prompt resource: " + resource, e);
        }
    }
}
