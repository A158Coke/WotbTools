package com.wotb.core.league;

import org.springframework.util.StringUtils;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 战队自动名称：本队至少 {@value #MAJORITY_THRESHOLD}/7 玩家具有相同非空军团标签时，
 * 使用该多数军团标签；否则待命名（由上传者填写，仅当前前端页面内存状态）。
 *
 * <p>规则：不自动选择「人数最多但未过半」的标签；名称只存在于当前会话内存，
 * 不写数据库 / localStorage / 服务端文件。</p>
 */
public final class LeagueTeamNamer {

    /** 多数军团标签门槛：至少 4/7。 */
    public static final int MAJORITY_THRESHOLD = 4;

    /** 名称来源稳定英文码。 */
    public static final String NAME_SOURCE_CLAN_MAJORITY = "CLAN_MAJORITY";
    public static final String NAME_SOURCE_UNNAMED = "UNNAMED";

    private LeagueTeamNamer() {
    }

    /** 自动名称；未达到多数标签 → null（待命名）。 */
    public static String autoName(final List<PlayerLeagueRating> players) {
        final Map<String, Integer> counts = new HashMap<>();
        for (final PlayerLeagueRating p : players) {
            if (StringUtils.hasText(p.clan())) {
                counts.merge(p.clan(), 1, Integer::sum);
            }
        }
        String majority = null;
        for (final Map.Entry<String, Integer> e : counts.entrySet()) {
            if (e.getValue() >= MAJORITY_THRESHOLD) {
                if (majority != null && !majority.equals(e.getKey())) {
                    return null; // 两个标签都达到 4 人（7 人内不可能，防御）
                }
                majority = e.getKey();
            }
        }
        return majority;
    }

    /** 名称来源。 */
    public static String nameSource(final List<PlayerLeagueRating> players) {
        return autoName(players) != null ? NAME_SOURCE_CLAN_MAJORITY : NAME_SOURCE_UNNAMED;
    }
}
