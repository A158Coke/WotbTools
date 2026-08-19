package com.wotb.web.replay.ai;

import com.wotb.core.replay.map.MapTacticalSemantics;
import com.wotb.core.replay.map.MapTacticalSemanticsRegistry;
import org.springframework.util.StringUtils;

import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Call #1（Pre-Battle Strategic Prior）的用户可见渲染器。
 * <p>与 Prompt 内的 priorSection 共享同一数据源（{@link PreBattleStrategicPrior}），
 * 但输出的是面向最终用户的 Markdown：去除机器段头（PRE-BATTLE STRATEGIC PRIOR）、
 * 内部标签（GRID_REGION_N 转可读区域名，TEAM_A/TEAM_B 替换为可读标签），只保留
 * 队伍画像 / 关键对阵 / 战略胜机 / 战略假设四个可读小节。</p>
 * <p>输出语言跟随请求 {@link AllowedLanguage}（ZH/EN/RU），文案为后端确定性渲染，
 * 不重新请求 LLM 生成展示文本。两种调用形态：随机战 harness 按录像者视角映射为
 * 「友军/敌军」（内部 Call #1 仍保持 TEAM_A/TEAM_B 的客观标签不变）；团队复盘按
 * 视角队伍交换为「我方/对方」。prior 不可用（Call #1 失败 / 降级 / 无内容）返回
 * {@code null}，由调用方置空 preBattleSection。</p>
 * <p>用户可见文本的卫生规则：hypothesis id 直接输出 parser 得到的 id（如 H1，
 * 绝不 prepend 额外前缀）；所有用户可见 LLM 自由文本（advantage/reason/condition/
 * claim/strengths/weaknesses/preferredPlans/composition）统一做 TEAM_A/TEAM_B
 * 与 GRID_REGION_N 的显示 token 替换。</p>
 */
public final class PreBattleSectionRenderer {

    private static final Pattern GRID_REGION = Pattern.compile("GRID_REGION_(\\d)");
    private static final MapTacticalSemanticsRegistry MAP_SEMANTICS = MapTacticalSemanticsRegistry.load();

    /**
     * composition 属性键的中文显示名（用户可见，不直出 mobility 等英文键）。
     */
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

    /**
     * 中性渲染（perspective 未知时的防御路径）：队伍1/队伍2，简体中文。
     */
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

    /**
     * 团队复盘（语言跟随请求）：按视角队伍交换，视角队伍渲染为「我方」。
     */
    public static String render(final PreBattleStrategicPrior prior,
                                final int perspectiveTeam,
                                final String teamLabel,
                                final AllowedLanguage language) {
        return render(prior, perspectiveTeam, teamLabel, language, null);
    }

    /**
     * 团队复盘（语言跟随请求 + 地图语义）：按视角队伍交换，视角队伍渲染为「我方」；
     * {@code mapCode} 用于把 AREA ID 映射为中文名 + 九宫格编号。
     */
    public static String render(final PreBattleStrategicPrior prior,
                                final int perspectiveTeam,
                                final String teamLabel,
                                final AllowedLanguage language,
                                final String mapCode) {
        return renderInternal(prior, perspectiveTeam, teamLabel,
                texts(language, false), language, mapCode);
    }

    /**
     * 随机战：按录像者 perspective 队伍映射为「友军/敌军」。recorderTeam 必须是
     * 1 或 2（录像者所属 team → 友军，另一方 → 敌军）；其他值走中性标签防御路径。
     * 内部 Call #1 的 TEAM_A/TEAM_B 客观语义不受此映射影响。
     * <p>随机战 <b>不</b>附加录像者 nickname 作为 team label——只显示「友军画像/
     * 敌军画像」，不显示「友军（Player123）画像」。团队复盘才保留真实 clan/team
     * label（走 {@link #render(PreBattleStrategicPrior, int, String, AllowedLanguage)}）。</p>
     */
    public static String renderRandomBattle(final PreBattleStrategicPrior prior,
                                            final int recorderTeam,
                                            final AllowedLanguage language) {
        return renderRandomBattle(prior, recorderTeam, language, null);
    }

    /**
     * 随机战（语言跟随 + 地图语义，AREA ID → 中文名 + 九宫格编号）。
     */
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
        // TEAM_A/TEAM_B 是 LLM 输出的原始队伍 token：不 swap 时 TEAM_A=渲染首位；
        // swap 后 TEAM_A 指向 prior.teamA（渲染末位），映射随之对调。
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
                // id 直接输出 parser 得到的值（如 H1），绝不 prepend 前缀（避免 HH1）。
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

    /**
     * 用户可见展示转换：TEAM_A/TEAM_B 内部 token 替换为对应显示名，GRID_REGION_N
     * 机器 token 转为可读区域名（如 GRID_REGION_5 → 5区）。{@code teamALabel} 是
     * TEAM_A token 对应的显示名、{@code teamBLabel} 是 TEAM_B token 对应的显示名
     * （调用侧已按视角 swap 映射）。
     */
    private static String display(final String value,
                                  final String teamALabel,
                                  final String teamBLabel,
                                  final Texts texts,
                                  final String mapCode,
                                  final AllowedLanguage language) {
        if (!StringUtils.hasText(value)) {
            return value;
        }
        // TEAM_A/TEAM_B 是 Call #1 契约 token；LLM 自由文本还可能出现
        // TEAM A / A队 / A 队 / 队伍1 等变体，全部映射到同一视角标签。
        String result = value
                .replace("TEAM_A", teamALabel).replace("TEAM_B", teamBLabel)
                .replace("TEAM A", teamALabel).replace("TEAM B", teamBLabel)
                .replace("A队", teamALabel).replace("B队", teamBLabel)
                .replace("A 队", teamALabel).replace("B 队", teamBLabel)
                .replace("队伍1", teamALabel).replace("队伍2", teamBLabel);
        // 「簇」字兜底不在 renderer 层做：此处无 authoritative Battle context（nickname/
        // tankName/clan 可能合法含「簇」，如昵称「星簇」），提前裸替换会破坏 proper noun。
        // 由最终输出边界 AiReplayReviewService.sanitizeClusterTerms（带 protected literals）统一处理。
        final Matcher matcher = GRID_REGION.matcher(result);
        if (matcher.find()) {
            // regionName 模板形如 "$1区" / "Region $1"：replaceAll 会把 $1 展开为区域号。
            result = matcher.replaceAll(texts.regionName());
        }
        return mapAreaNames(result, mapCode, language);
    }

    /**
     * AREA ID → 用户可见区域名 + 九宫格编号，语言跟随请求。
     * <p>ZH 使用现有 semantic 中文 label（如 ELEVATED_TERRAIN_01 → 东侧高地区域（3/5/6/9区））；
     * EN/RU 不泄漏中文、不翻译/猜测区域名，只保留可靠的九宫格编号（Regions 3/5/6/9 /
     * Области 3/5/6/9），无编号时用通用词 Area / Область。</p>
     */
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

    /**
     * composition 属性键翻译（三语），用户可见不直出 mobility 等英文键。
     */
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

    /**
     * composition 属性值翻译（HIGH/MEDIUM/LOW → 三语）。
     */
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

    /**
     * 文案集合：按语言与展示形态（随机战 友军/敌军 vs 团队 我方/对方）选择。
     */
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

    /**
     * 随机战形态的友军/敌军文案（EN/RU 随机战当前无 prior，防御性保留）。
     */
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
