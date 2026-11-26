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

public final class AiPromptLibrary {

    private static final Map<String, String> CACHE = new ConcurrentHashMap<>();

    private static final Pattern INCLUDE =
            Pattern.compile("\\{\\{([a-zA-Z0-9_/-]+)\\}\\}");

    private AiPromptLibrary() {
    }

    public static String zh(final String key) {
        return text(key, "zh");
    }

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
            return text.replace("\r\n", "\n").replace('\r', '\n');
        } catch (final IOException e) {
            throw new IllegalStateException("Failed to read AI prompt resource: " + resource, e);
        }
    }
}
