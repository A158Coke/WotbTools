package com.wotb.core.ref;

import org.springframework.util.StringUtils;

/**
 * Shared display-name resolver for AI Review prompts.
 * Both TEAM_PERSPECTIVE and PLAYER_FOCUSED paths use the same contract:
 * <ul>
 *   <li>map internal code → {@link MapNames} → user-visible map name</li>
 *   <li>tankId → {@link Tankopedia} → user-visible tank name</li>
 *   <li>tankId → {@link Tankopedia} → structured vehicle class</li>
 * </ul>
 *
 * <p>坦克名称是权威专有名词：解析只走 {@code tankId → tankopedia}，
 * 绝不解析名称文本本身。车辆类型同样只来自 tankopedia 的结构化
 * {@code class} 字段，任何情况下都不得由名称推断
 * （例如不得因为名称含 {@code SPHT} 就判定为 SPG / 自行火炮）。</p>
 */
public final class ReplayDisplayNames {

    private static final Tankopedia TANKOPEDIA = Tankopedia.load();

    /**
     * tankopedia 未提供车辆类型时的稳定占位值。
     */
    public static final String UNKNOWN_TANK_CLASS = "未知";

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

    /**
     * 结构化车辆类型，仅取自 tankopedia 的 {@code class} 字段（英文，如 Heavy tank）。
     * <p>Blitz 不存在自行火炮车种；tankopedia 未提供时返回 {@link #UNKNOWN_TANK_CLASS}，
     * 调用方必须原样输出「未知」，不得由坦克名称推断。AI 复盘正文语言由前端 {@code lang}
     * 参数控制，后端不在此处做中文本地化。</p>
     */
    public static String tankClass(final long tankId) {
        if (tankId <= 0) {
            return UNKNOWN_TANK_CLASS;
        }
        final String type = TANKOPEDIA.info(tankId).type();
        if (!StringUtils.hasText(type)) {
            return UNKNOWN_TANK_CLASS;
        }
        return type;
    }

    /**
     * 结构化车辆等级，仅取自 tankopedia 的 {@code tier}；缺失返回空串，不得由名称推断。
     */
    public static String tankTier(final long tankId) {
        if (tankId <= 0) {
            return "";
        }
        final Object tier = TANKOPEDIA.info(tankId).tier();
        final String text = tier == null ? "" : String.valueOf(tier);
        return text.isBlank() ? "" : text;
    }

    /**
     * 结构化车辆国家，仅取自 tankopedia 的 {@code nation}（英文，如 USA）；缺失返回空串。
     */
    public static String tankNation(final long tankId) {
        if (tankId <= 0) {
            return "";
        }
        final String nation = TANKOPEDIA.info(tankId).nation();
        return StringUtils.hasText(nation) ? nation : "";
    }

    /**
     * 结构化车辆炮伤，仅取自 tankopedia 的 {@code alphaDamage}；缺失或 ≤0 返回空串。
     */
    public static String tankAlphaDamage(final long tankId) {
        if (tankId <= 0) {
            return "";
        }
        final Integer alpha = TANKOPEDIA.info(tankId).alphaDamage();
        return alpha != null && alpha > 0 ? String.valueOf(alpha) : "";
    }

    /**
     * 结构化车辆血量，仅取自 tankopedia 的 {@code hp/maxHp}；缺失或 ≤0 返回空串。
     */
    public static String tankMaxHp(final long tankId) {
        if (tankId <= 0) {
            return "";
        }
        final Integer hp = TANKOPEDIA.info(tankId).maxHp();
        return hp != null && hp > 0 ? String.valueOf(hp) : "";
    }

    /**
     * 结构化车辆满血量数值（tankopedia maxHp）；缺失或 ≤0 返回 null（供掉血百分比计算）。
     */
    public static Integer tankMaxHpValue(final long tankId) {
        if (tankId <= 0) {
            return null;
        }
        final Integer hp = TANKOPEDIA.info(tankId).maxHp();
        return hp != null && hp > 0 ? hp : null;
    }

    /**
     * 手工维护的每辆车知识点，取自 tankopedia 的 {@code extraInfo}；空串时不输出。
     */
    public static String tankExtraInfo(final long tankId) {
        if (tankId <= 0) {
            return "";
        }
        final String knowledge = TANKOPEDIA.info(tankId).extraInfo();
        return StringUtils.hasText(knowledge) ? knowledge.trim() : "";
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
