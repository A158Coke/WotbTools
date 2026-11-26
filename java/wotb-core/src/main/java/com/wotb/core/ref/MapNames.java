package com.wotb.core.ref;

import org.springframework.util.StringUtils;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.io.InputStream;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;

public final class MapNames {

    private static final String LOCALE_ZH = "zh";
    private static final String LOCALE_EN = "en";
    private static final String LOCALE_RU = "ru";
    private static final Map<String, String> CN = loadChineseNames();
    private static final Map<String, Localized> LOCALIZED = loadLocalized();

    private MapNames() {
    }

    private static Map<String, String> loadChineseNames() {
        final Map<String, String> map = new HashMap<>();
        try (InputStream in = MapNames.class.getResourceAsStream("/map_names.json")) {
            if (in != null) {
                final JsonNode root = JsonMapper.builder().build().readTree(in);
                root.properties().forEach(entry ->
                    map.put(normalizeKey(entry.getKey()), resolveChineseLabel(entry.getKey(), entry.getValue()))
                );
            }
        } catch (Exception ignored) {
        }
        return map;
    }

    private static String resolveChineseLabel(final String fallback, final JsonNode node) {
        if (node == null || node.isNull()) {
            return fallback;
        }
        final String directLabel = textOrNull(node);
        if (directLabel != null) {
            return directLabel;
        }
        final String zhLabel = textOrNull(node.get(LOCALE_ZH));
        if (zhLabel != null) {
            return zhLabel;
        }
        final String enLabel = textOrNull(node.get(LOCALE_EN));
        if (enLabel != null) {
            return enLabel;
        }
        return fallback;
    }

    private static String textOrNull(final JsonNode node) {
        if (node == null || !node.isString()) {
            return null;
        }
        final String text = node.asString();
        return StringUtils.hasText(text) ? text : null;
    }

    private static String normalizeKey(final String mapName) {
        return mapName == null ? "" : mapName.toLowerCase(Locale.ROOT).trim();
    }

    public record Localized(String zh, String en, String ru) {
    }

    private static Map<String, Localized> loadLocalized() {
        final Map<String, Localized> map = new HashMap<>();
        try (InputStream in = MapNames.class.getResourceAsStream("/map_names.json")) {
            if (in != null) {
                final JsonNode root = JsonMapper.builder().build().readTree(in);
                root.properties().forEach(entry -> {
                    final String code = normalizeKey(entry.getKey());
                    final JsonNode node = entry.getValue();
                    map.put(code, new Localized(
                            textOrNull(node == null ? null : node.get(LOCALE_ZH)),
                            textOrNull(node == null ? null : node.get(LOCALE_EN)),
                            textOrNull(node == null ? null : node.get(LOCALE_RU))));
                });
            }
        } catch (Exception ignored) {
        }
        return map;
    }

    public static Localized localized(final String mapName) {
        if (!StringUtils.hasText(mapName)) {
            return new Localized(mapName, mapName, mapName);
        }
        final Localized hit = LOCALIZED.get(normalizeKey(mapName));
        return hit != null ? hit : new Localized(mapName, mapName, mapName);
    }

    public static String cn(final String mapName) {
        if (!StringUtils.hasText(mapName)) {
            return mapName;
        }
        return CN.getOrDefault(normalizeKey(mapName), mapName);
    }

    public static Optional<String> tryResolve(final String mapName) {
        if (!StringUtils.hasText(mapName)) {
            return Optional.empty();
        }
        final String resolved = CN.get(normalizeKey(mapName));
        return resolved != null ? Optional.of(resolved) : Optional.empty();
    }
}
