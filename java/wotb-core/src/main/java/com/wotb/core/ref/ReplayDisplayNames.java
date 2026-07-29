package com.wotb.core.ref;

import org.springframework.util.StringUtils;

/**
 * Shared display-name resolver for AI Review prompts.
 * Both TEAM_PERSPECTIVE and PLAYER_FOCUSED paths use the same contract:
 * <ul>
 *   <li>map internal code → {@link MapNames} → user-visible map name</li>
 *   <li>tankId → {@link Tankopedia} → user-visible tank name</li>
 * </ul>
 */
public final class ReplayDisplayNames {

    private static final Tankopedia TANKOPEDIA = Tankopedia.load();

    private ReplayDisplayNames() {
    }

    public static String mapName(final String internalMapCode) {
        if (!StringUtils.hasText(internalMapCode)) {
            return "未知地图";
        }
        try {
            return MapNames.tryResolve(internalMapCode).orElse("未知地图");
        } catch (final Exception e) {
            return "未知地图";
        }
    }

    public static String tankName(final long tankId, final String existingTankName) {
        if (tankId > 0) {
            final String name = TANKOPEDIA.info(tankId).name();
            if (isValidDisplayName(name)) {
                return name;
            }
        }
        if (isValidDisplayName(existingTankName)) {
            return existingTankName;
        }
        return "未知坦克";
    }

    private static boolean isValidDisplayName(final String name) {
        if (!StringUtils.hasText(name)) return false;
        if (name.startsWith("#")) return false;
        if (name.startsWith("?")) return false;
        if (name.startsWith("vehicle_")) return false;
        if (name.startsWith("tankId=")) return false;
        if (name.matches("\\d+")) return false;
        return true;
    }
}
