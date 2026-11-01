package com.wotb.ai.prompt;

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
 * 三语 AI 提示词加载器：classpath:/prompts/{key}.{zh,en,ru}.md。
 * <p>UTF-8 正文按语言和 key 惰性缓存；{{key}} 递归包含同语言资源。
 * 缺失资源与循环包含显式失败；归一化 CRLF/CR，保留尾换行。</p>
 */
public final class AiPromptLibrary {

    private static final Map<String, String> CACHE = new ConcurrentHashMap<>();

    /** 占位符语法：{{key}}，key 为 prompts/ 下相对 key（字母/数字/_/-//）。 */
    private static final Pattern INCLUDE =
            Pattern.compile("\\{\\{([a-zA-Z0-9_/-]+)\\}\\}");

    private AiPromptLibrary() {
    }

    /** 读取 prompts/{key}.zh.md 的展开文本（缓存）。 */
    public static String zh(final String key) {
        return text(key, "zh");
    }

    /** 读取指定语言的展开文本；languageCode 必须为 zh/en/ru，不做语言回退。 */
    public static String text(final String key, final String languageCode) {
        if (!Set.of("zh", "en", "ru").contains(languageCode == null ? "" : languageCode)) {
            throw new IllegalArgumentException("Unsupported AI prompt language: " + languageCode);
        }
        final String resourceKey = key + "." + languageCode;
        return CACHE.computeIfAbsent(resourceKey, ignored -> load(key, languageCode, new LinkedHashSet<>()));
    }

    private static String load(final String key, final String languageCode, final Set<String> chain) {
        final String resourceKey = key + "." + languageCode;
        if (!chain.add(resourceKey)) {
            throw new IllegalStateException("AI prompt include cycle: "
                    + String.join(" -> ", chain) + " -> " + resourceKey);
        }
        try {
            return expand(read(key, languageCode), languageCode, chain);
        } finally {
            chain.remove(resourceKey);
        }
    }

    private static String expand(final String text, final String languageCode, final Set<String> chain) {
        final Matcher matcher = INCLUDE.matcher(text);
        if (!matcher.find()) {
            return text;
        }
        final StringBuilder sb = new StringBuilder(text.length() + 256);
        int last = 0;
        do {
            sb.append(text, last, matcher.start());
            sb.append(load(matcher.group(1), languageCode, chain));
            last = matcher.end();
        } while (matcher.find());
        sb.append(text, last, text.length());
        return sb.toString();
    }

    private static String read(final String key, final String languageCode) {
        final String resource = "/prompts/" + key + "." + languageCode + ".md";
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
