package com.wotb.ai.review;

import com.wotb.core.replay.map.MapTacticalSemantics;
import com.wotb.core.replay.map.MapTacticalSemanticsRegistry;
import org.springframework.util.StringUtils;

import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class PreBattleSectionRenderer {

    private static final Pattern GRID_REGION = Pattern.compile("GRID_REGION_(\\d)");
    private static final MapTacticalSemanticsRegistry MAP_SEMANTICS = MapTacticalSemanticsRegistry.load();

    private static final Map<String, String> COMPOSITION_KEYS_ZH = Map.of(
            "mobility", "机动性",
            "closeRangeTrading", "近距离换血",
            "hullDownCapability", "卖头能力",
            "burstPotential", "爆发能力");

    private static final Map<String, String> COMPOSITION_KEYS_EN = Map.of(
            "mobility", "Mobility",
            "closeRangeTrading", "Close-range trading",
            "hullDownCapability", "Hull-down capability",
            "burstPotential", "Burst potential");

    private static final Map<String, String> COMPOSITION_KEYS_RU = Map.of(
            "mobility", "Мобильность",
            "closeRangeTrading", "Ближний размен",
            "hullDownCapability", "Игра от башни",
            "burstPotential", "Залповый урон");

    private PreBattleSectionRenderer() {
    }

    public static String render(final PreBattleStrategicPrior prior) {
        return render(prior, 0, null, AllowedLanguage.ZH);
    }

    /**
     * 团队复盘：按视角队伍交换，视角队伍渲染为「我方」，对手渲染为「对方」。
     *
     * @param perspectiveTeam 视角队伍（1 或 2；其他值按中性标签处理）
     * @param teamLabel       视角队伍的军团/队伍名（可空，仅用于增强可读性）
     */
    public static String render(final PreBattleStrategicPrior prior,
                                final int perspectiveTeam,
                                final String teamLabel) {
        return render(prior, perspectiveTeam, teamLabel, AllowedLanguage.ZH);
    }

    public static String render(final PreBattleStrategicPrior prior,
                                final int perspectiveTeam,
                                final String teamLabel,
                                final AllowedLanguage language) {
        return render(prior, perspectiveTeam, teamLabel, language, null);
    }

    public static String render(final PreBattleStrategicPrior prior,
                                final int perspectiveTeam,
                                final String teamLabel,
                                final AllowedLanguage language,
                                final String mapCode) {
        return renderInternal(prior, perspectiveTeam, teamLabel,
                texts(language, false), language, mapCode);
    }

    public static String renderRandomBattle(final PreBattleStrategicPrior prior,
                                            final int recorderTeam,
                                            final AllowedLanguage language) {
        return renderRandomBattle(prior, recorderTeam, language, null);
    }

    public static String renderRandomBattle(final PreBattleStrategicPrior prior,
                                            final int recorderTeam,
                                            final AllowedLanguage language,
                                            final String mapCode) {
        return renderInternal(prior, recorderTeam, null,
                texts(language, true), language, mapCode);
    }

    private static String renderInternal(final PreBattleStrategicPrior prior,
                                         final int perspectiveTeam,
                                         final String teamLabel,
                                         final Texts texts,
                                         final AllowedLanguage language,
                                         final String mapCode) {
        if (prior == null || !prior.hasContent()) {
            return null;
        }
        final boolean teamView = perspectiveTeam == 1 || perspectiveTeam == 2;
        final boolean swapped = teamView && perspectiveTeam == 2;
        final String teamALabel = teamView
                ? texts.ours() + (StringUtils.hasText(teamLabel)
                        ? texts.labelParens().formatted(teamLabel) : "")
                : texts.neutralOne();
        final String teamBLabel = teamView ? texts.theirs() : texts.neutralTwo();
        final String tokenALabel = swapped ? teamBLabel : teamALabel;
        final String tokenBLabel = swapped ? teamALabel : teamBLabel;
        final PreBattleStrategicPrior.TeamProfile profileA = swapped ? prior.teamB() : prior.teamA();
        final PreBattleStrategicPrior.TeamProfile profileB = swapped ? prior.teamA() : prior.teamB();

        final StringBuilder sb = new StringBuilder(2048);
        sb.append("## ").append(texts.title()).append("\n\n");
        sb.append(texts.intro()).append('\n');
        appendTeamProfile(sb, teamALabel, profileA, tokenALabel, tokenBLabel, texts, language, mapCode);
        appendTeamProfile(sb, teamBLabel, profileB, tokenALabel, tokenBLabel, texts, language, mapCode);
        if (!prior.keyMatchups().isEmpty()) {
            sb.append("\n**").append(texts.matchups()).append("**\n");
            for (final PreBattleStrategicPrior.KeyMatchup m : prior.keyMatchups()) {
                sb.append("- ").append(texts.region()).append(' ')
                        .append(display(text(m.area(), texts.unknown()),
                                tokenALabel, tokenBLabel, texts, mapCode, language));
                if (StringUtils.hasText(m.advantage())) {
                    sb.append("：").append(display(m.advantage(),
                            tokenALabel, tokenBLabel, texts, mapCode, language));
                }
                if (StringUtils.hasText(m.reason())) {
                    sb.append("（").append(display(m.reason(),
                            tokenALabel, tokenBLabel, texts, mapCode, language)).append("）");
                }
                sb.append('\n');
            }
        }
        if (!prior.strategicWinConditions().isEmpty()) {
            sb.append("\n**").append(texts.winConditions()).append("**\n");
            for (final PreBattleStrategicPrior.StrategicWinCondition w
                    : prior.strategicWinConditions()) {
                sb.append("- ").append(display(text(w.team(), texts.unknown()),
                        tokenALabel, tokenBLabel, texts, mapCode, language))
                        .append("：").append(display(text(w.condition(), ""),
                                tokenALabel, tokenBLabel, texts, mapCode, language))
                        .append('\n');
            }
        }
        if (!prior.hypotheses().isEmpty()) {
            sb.append("\n**").append(texts.hypotheses()).append("**\n");
            for (final PreBattleStrategicPrior.StrategicHypothesis h : prior.hypotheses()) {
                sb.append("- ").append(text(h.id(), "?"))
                        .append("：").append(display(text(h.claim(), ""),
                                tokenALabel, tokenBLabel, texts, mapCode, language));
                if (StringUtils.hasText(h.reason())) {
                    sb.append("（").append(texts.reasonPrefix())
                            .append(display(h.reason(),
                                    tokenALabel, tokenBLabel, texts, mapCode, language)).append("）");
                }
                sb.append('\n');
            }
        }
        return sb.toString();
    }

    private static void appendTeamProfile(final StringBuilder sb,
                                          final String label,
                                          final PreBattleStrategicPrior.TeamProfile profile,
                                          final String tokenALabel,
                                          final String tokenBLabel,
                                          final Texts texts,
                                          final AllowedLanguage language,
                                          final String mapCode) {
        if (profile == null) {
            return;
        }
        sb.append("\n**").append(label).append(texts.profileSuffix()).append("**\n");
        if (!profile.composition().isEmpty()) {
            sb.append("- ").append(texts.composition()).append('：');
            sb.append(String.join("；", profile.composition().entrySet().stream()
                    .map(e -> compositionKey(e.getKey(), language) + "="
                            + compositionValue(display(e.getValue(),
                                    tokenALabel, tokenBLabel, texts, mapCode, language), language))
                    .toList()));
            sb.append('\n');
        }
        if (!profile.strengths().isEmpty()) {
            sb.append("- ").append(texts.strengths()).append('：')
                    .append(String.join("；", profile.strengths().stream()
                            .map(s -> display(s, tokenALabel, tokenBLabel, texts, mapCode, language))
                            .toList()))
                    .append('\n');
        }
        if (!profile.weaknesses().isEmpty()) {
            sb.append("- ").append(texts.weaknesses()).append('：')
                    .append(String.join("；", profile.weaknesses().stream()
                            .map(s -> display(s, tokenALabel, tokenBLabel, texts, mapCode, language))
                            .toList()))
                    .append('\n');
        }
        if (!profile.preferredPlans().isEmpty()) {
            sb.append("- ").append(texts.plans()).append('：')
                    .append(String.join("；", profile.preferredPlans().stream()
                            .map(s -> display(s, tokenALabel, tokenBLabel, texts, mapCode, language))
                            .toList()))
                    .append('\n');
        }
    }

    private static String text(final String value, final String fallback) {
        return StringUtils.hasText(value) ? value.trim() : fallback;
    }

    private static String display(final String value,
                                  final String teamALabel,
                                  final String teamBLabel,
                                  final Texts texts,
                                  final String mapCode,
                                  final AllowedLanguage language) {
        if (!StringUtils.hasText(value)) {
            return value;
        }
        String result = value
                .replace("TEAM_A", teamALabel).replace("TEAM_B", teamBLabel)
                .replace("TEAM A", teamALabel).replace("TEAM B", teamBLabel)
                .replace("A队", teamALabel).replace("B队", teamBLabel)
                .replace("A 队", teamALabel).replace("B 队", teamBLabel)
                .replace("队伍1", teamALabel).replace("队伍2", teamBLabel);
        final Matcher matcher = GRID_REGION.matcher(result);
        if (matcher.find()) {
            result = matcher.replaceAll(texts.regionName());
        }
        return mapAreaNames(result, mapCode, language);
    }

    private static String mapAreaNames(final String value,
                                       final String mapCode,
                                       final AllowedLanguage language) {
        if (!StringUtils.hasText(value) || !StringUtils.hasText(mapCode)) {
            return value;
        }
        final MapTacticalSemantics semantics = MAP_SEMANTICS.semanticsFor(mapCode);
        final AllowedLanguage lang = language == null ? AllowedLanguage.ZH : language;
        String result = value;
        for (final Map.Entry<String, MapTacticalSemantics.TacticalArea> entry
                : semantics.areas().entrySet()) {
            final MapTacticalSemantics.TacticalArea area = entry.getValue();
            if (lang == AllowedLanguage.ZH
                    && area.label().isBlank() && area.gridRegions().isEmpty()) {
                continue;
            }
            final List<String> regions = area.gridRegions().stream()
                    .map(region -> region.replace("GRID_REGION_", ""))
                    .toList();
            final String readable = switch (lang) {
                case EN -> regions.isEmpty() ? "Area" : "Regions " + String.join("/", regions);
                case RU -> regions.isEmpty() ? "Область" : "Области " + String.join("/", regions);
                case ZH -> (area.label().isBlank() ? entry.getKey() : area.label())
                        + (regions.isEmpty() ? "" : "（" + String.join("/", regions) + "区）");
            };
            result = result.replace(entry.getKey(), readable);
        }
        return result;
    }

    private static String compositionKey(final String key, final AllowedLanguage language) {
        if (key == null) {
            return "";
        }
        final Map<String, String> map = switch (language == null ? AllowedLanguage.ZH : language) {
            case EN -> COMPOSITION_KEYS_EN;
            case RU -> COMPOSITION_KEYS_RU;
            case ZH -> COMPOSITION_KEYS_ZH;
        };
        return map.getOrDefault(key, key);
    }

    private static String compositionValue(final String value, final AllowedLanguage language) {
        if (value == null) {
            return "";
        }
        final String upper = value.trim().toUpperCase();
        return switch (language == null ? AllowedLanguage.ZH : language) {
            case EN -> switch (upper) {
                case "HIGH" -> "High";
                case "MEDIUM" -> "Medium";
                case "LOW" -> "Low";
                default -> value;
            };
            case RU -> switch (upper) {
                case "HIGH" -> "Высокий";
                case "MEDIUM" -> "Средний";
                case "LOW" -> "Низкий";
                default -> value;
            };
            case ZH -> switch (upper) {
                case "HIGH" -> "高";
                case "MEDIUM" -> "中";
                case "LOW" -> "低";
                default -> value;
            };
        };
    }

    private record Texts(
            String title,
            String intro,
            String ours,
            String theirs,
            String neutralOne,
            String neutralTwo,
            String labelParens,
            String profileSuffix,
            String composition,
            String strengths,
            String weaknesses,
            String plans,
            String matchups,
            String region,
            String regionName,
            String winConditions,
            String hypotheses,
            String reasonPrefix,
            String unknown
    ) {
        private Texts withFriendlyEnemy() {
            return new Texts(title, intro, "友军", "敌军", neutralOne, neutralTwo,
                    labelParens, profileSuffix, composition, strengths, weaknesses, plans,
                    matchups, region, regionName, winConditions, hypotheses,
                    reasonPrefix, unknown);
        }
    }

    private static final Texts ZH = new Texts(
            "赛前预测",
            "基于地图与双方阵容的 AI 赛前判断（未读取任何战斗结果）。",
            "我方", "对方", "队伍1", "队伍2", "（%s）",
            "画像", "阵容属性", "优势", "劣势", "预期打法",
            "关键对阵", "区域", "$1区", "战略胜机", "战略假设",
            "理由：", "未知");

    private static final Texts EN = new Texts(
            "Pre-Battle Prediction",
            "An AI pre-battle judgment based on the map and both lineups (no battle results were read).",
            "Our Team", "Opposing Team", "Team 1", "Team 2", "(%s)",
            " Profile", "Composition", "Strengths", "Weaknesses", "Preferred Plans",
            "Key Matchups", "Region", "Region $1", "Win Conditions", "Strategic Hypotheses",
            "Reason: ", "Unknown");

    private static final Texts RU = new Texts(
            "Предбоевой прогноз",
            "Предбоевое суждение ИИ по карте и составам обеих команд (результаты боя не читались).",
            "Наша команда", "Команда противника", "Команда 1", "Команда 2", "(%s)",
            " профиль", "Состав", "Сильные стороны", "Слабые стороны", "Ожидаемый план",
            "Ключевые противостояния", "Регион", "Область $1", "Условия победы", "Стратегические гипотезы",
            "Причина: ", "Неизвестно");

    private static final Texts ZH_RANDOM = ZH.withFriendlyEnemy();
    private static final Texts EN_RANDOM = new Texts(
            "Pre-Battle Prediction",
            "An AI pre-battle judgment based on the map and both lineups (no battle results were read).",
            "Friendly", "Enemy", "Team 1", "Team 2", "(%s)",
            " Profile", "Composition", "Strengths", "Weaknesses", "Preferred Plans",
            "Key Matchups", "Region", "Region $1", "Win Conditions", "Strategic Hypotheses",
            "Reason: ", "Unknown");
    private static final Texts RU_RANDOM = new Texts(
            "Предбоевой прогноз",
            "Предбоевое суждение ИИ по карте и составам обеих команд (результаты боя не читались).",
            "Союзники", "Противник", "Команда 1", "Команда 2", "(%s)",
            " профиль", "Состав", "Сильные стороны", "Слабые стороны", "Ожидаемый план",
            "Ключевые противостояния", "Регион", "Область $1", "Условия победы", "Стратегические гипотезы",
            "Причина: ", "Неизвестно");

    private static Texts texts(final AllowedLanguage language, final boolean friendlyEnemy) {
        return switch (language == null ? AllowedLanguage.ZH : language) {
            case EN -> friendlyEnemy ? EN_RANDOM : EN;
            case RU -> friendlyEnemy ? RU_RANDOM : RU;
            case ZH -> friendlyEnemy ? ZH_RANDOM : ZH;
        };
    }
}
