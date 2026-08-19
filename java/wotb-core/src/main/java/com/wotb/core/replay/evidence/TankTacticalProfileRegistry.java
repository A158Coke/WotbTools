package com.wotb.core.replay.evidence;

import com.wotb.core.ref.ReplayDisplayNames;
import org.springframework.util.StringUtils;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.io.InputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * 坦克战术语义库：优先匹配人工精选条目，未收录车辆回退到车型级保守默认值。
 * <p>数据源 {@code common/tank_tactical_profiles.json}（构建时复制到 classpath）。
 * 语义字段只允许 HIGH / MEDIUM / LOW / UNKNOWN。</p>
 */
public final class TankTacticalProfileRegistry {

    public static final String UNKNOWN_CLASS = "UNKNOWN";

    private final Map<String, TankTacticalProfile> curatedByKey;

    private TankTacticalProfileRegistry(final Map<String, TankTacticalProfile> curatedByKey) {
        this.curatedByKey = curatedByKey;
    }

    public static TankTacticalProfileRegistry load() {
        final Map<String, TankTacticalProfile> map = new HashMap<>();
        try (InputStream in = TankTacticalProfileRegistry.class
                .getResourceAsStream("/tank_tactical_profiles.json")) {
            if (in != null) {
                final JsonNode root = JsonMapper.builder().build().readTree(in);
                root.properties().forEach(e -> map.put(
                        normalizeKey(e.getKey()),
                        parseProfile(e.getValue())));
            }
        } catch (final Exception ignored) {
            // 缺库时仅保留车型级 fallback（与 Tankopedia 缺库策略一致）
        }
        return new TankTacticalProfileRegistry(Collections.unmodifiableMap(map));
    }

    private static TankTacticalProfile parseProfile(final JsonNode node) {
        return new TankTacticalProfile(
                text(node, "vehicleClass", UNKNOWN_CLASS),
                stringList(node, "roles"),
                stringList(node, "strengths"),
                stringList(node, "weaknesses"),
                text(node, "mobility", "UNKNOWN"),
                text(node, "burstPotential", "UNKNOWN"),
                text(node, "sustainedDpm", "UNKNOWN"),
                text(node, "hullDownAbility", "UNKNOWN"),
                text(node, "armorReliability", "UNKNOWN"),
                true);
    }

    private static String text(final JsonNode node, final String key, final String fallback) {
        return node.hasNonNull(key) ? node.get(key).asText() : fallback;
    }

    private static List<String> stringList(final JsonNode node, final String key) {
        final List<String> result = new ArrayList<>();
        if (node.hasNonNull(key) && node.get(key).isArray()) {
            node.get(key).forEach(item -> result.add(item.asText()));
        }
        return result;
    }

    /**
     * 按权威名（优先 tankId → tankopedia）查询；未收录时回退车型默认。
     */
    public TankTacticalProfile profileFor(final long tankId, final String name,
                                          final String type, final Object tier) {
        final String authoritativeName = ReplayDisplayNames.tankName(tankId, name);
        return profileFor(authoritativeName, normalizeClass(type), tierInt(tier));
    }

    private TankTacticalProfile profileFor(final String name, final String vehicleClass, final int tier) {
        final TankTacticalProfile curated = curatedByKey.get(normalizeKey(name));
        if (curated != null) {
            return curated;
        }
        return genericProfile(vehicleClass, tier);
    }

    private static int tierInt(final Object tier) {
        if (tier instanceof Number number) {
            return number.intValue();
        }
        if (tier instanceof String text && !text.isBlank()) {
            try {
                return Integer.parseInt(text.trim());
            } catch (final NumberFormatException ignored) {
                return 0;
            }
        }
        return 0;
    }

    private static TankTacticalProfile genericProfile(final String vehicleClass, final int tier) {
        final boolean elite = tier >= 9;
        return switch (vehicleClass) {
            case "HEAVY" -> new TankTacticalProfile(vehicleClass,
                    List.of("armored_frontline", "close_range_trader"),
                    List.of("armor_reliability"),
                    List.of("slow_rotation", "rotation_dependent"),
                    elite ? "MEDIUM" : "LOW", "MEDIUM", "MEDIUM", "MEDIUM", "HIGH", false);
            case "MEDIUM" -> new TankTacticalProfile(vehicleClass,
                    List.of("mobile_flanker", "flexible_support"),
                    List.of("mobility", "flexibility"),
                    List.of("armor_reliability"),
                    "HIGH", "MEDIUM", "HIGH", "MEDIUM", "MEDIUM", false);
            case "LIGHT" -> new TankTacticalProfile(vehicleClass,
                    List.of("scout", "flanker"),
                    List.of("mobility", "view_range"),
                    List.of("armor_reliability", "sustained_trading"),
                    "HIGH", "MEDIUM", "MEDIUM", "LOW", "LOW", false);
            case "TANK_DESTROYER" -> new TankTacticalProfile(vehicleClass,
                    List.of("long_range_support", "ambush"),
                    List.of("burst_potential", "alpha"),
                    List.of("flexibility", "close_range"),
                    "MEDIUM", "HIGH", "HIGH", "MEDIUM", "MEDIUM", false);
            default -> new TankTacticalProfile(UNKNOWN_CLASS,
                    List.of(), List.of(), List.of(),
                    "UNKNOWN", "UNKNOWN", "UNKNOWN", "UNKNOWN", "UNKNOWN", false);
        };
    }

    /**
     * 归一化车种：中文 / 英文（含 blitzkit 新格式 "Heavy tank" 等）→ 语义枚举。
     */
    static String normalizeClass(final String type) {
        if (!StringUtils.hasText(type)) {
            return UNKNOWN_CLASS;
        }
        return switch (type.trim().toLowerCase(Locale.ROOT)) {
            case "重坦", "heavy", "heavy tank", "ht" -> "HEAVY";
            case "中坦", "medium", "medium tank", "mt" -> "MEDIUM";
            case "轻坦", "light", "light tank", "lt" -> "LIGHT";
            case "td", "坦克歼击车", "tank destroyer", "tank_destroyer" -> "TANK_DESTROYER";
            default -> UNKNOWN_CLASS;
        };
    }

    private static String normalizeKey(final String name) {
        return name == null ? "" : name.trim().toLowerCase(Locale.ROOT);
    }
}
