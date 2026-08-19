package com.wotb.web.replay.ai;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * AI 提示词加载器（单一事实源：classpath:/prompts/*.zh.md）。
 * <p>提示词正文以 Markdown 文件维护（可读、可 review、可 diff），运行期按 key 惰性加载并缓存。
 * 编辑约定：UTF-8、LF 换行；CRLF 会被归一化。规则片段（EN/RU 本地化替换锚点）仍留在
 * {@link PlayerPromptRules} / {@link TeamPromptLocalizer} 常量中，与 md 内 ZH 文本保持一致。</p>
 * <p>支持占位符包含：md 内的 {@code {{key}}} 会在加载时递归展开为
 * {@code prompts/{key}.zh.md} 的内容（如 {@code {{common/rules-core}}}），
 * 用于在多个 prompt 间复用公共规则块；循环包含会显式抛错（fail loud），
 * 不允许静默截断。占位符替换发生在缓存之前，缓存键仍是顶层 key。</p>
 */
public final class AiPromptLibrary {

    private static final Map<String, String> CACHE = new ConcurrentHashMap<>();

    /**
     * 占位符语法：{{key}}，key 为 prompts/ 下相对 key（字母/数字/_/-//）。
     */
    private static final Pattern INCLUDE =
            Pattern.compile("\\{\\{([a-zA-Z0-9_/-]+)\\}\\}");

    private AiPromptLibrary() {
    }

    /**
     * 读取 prompts/{key}.zh.md 的展开文本（缓存）。
     */
    public static String zh(final String key) {
        return CACHE.computeIfAbsent(key, k -> load(k, new LinkedHashSet<>()));
    }

    private static String load(final String key, final Set<String> chain) {
        if (!chain.add(key)) {
            throw new IllegalStateException("AI prompt include cycle: "
                    + String.join(" -> ", chain) + " -> " + key);
        }
        try {
            return expand(read(key), chain);
        } finally {
            chain.remove(key);
        }
    }

    private static String expand(final String text, final Set<String> chain) {
        final Matcher matcher = INCLUDE.matcher(text);
        if (!matcher.find()) {
            return text;
        }
        final StringBuilder sb = new StringBuilder(text.length() + 256);
        int last = 0;
        do {
            sb.append(text, last, matcher.start());
            sb.append(load(matcher.group(1), chain));
            last = matcher.end();
        } while (matcher.find());
        sb.append(text, last, text.length());
        return sb.toString();
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
