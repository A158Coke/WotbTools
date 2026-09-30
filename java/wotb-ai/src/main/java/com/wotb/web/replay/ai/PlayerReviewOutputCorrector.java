package com.wotb.web.replay.ai;

import com.wotb.core.ai.ClusterTermSanitizer;
import com.wotb.core.ai.TankNameCorrector;
import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.ref.ReplayDisplayNames;
import com.wotb.core.replay.processing.PlayerSideResolver;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.ArrayList;
import java.util.List;
import java.util.stream.Collectors;

/**
 * 随机战（PLAYER_FOCUSED）复盘文本的确定性输出纠正链，逐字保留迁移前
 * {@code AiReplayReviewService} 的语义与顺序：
 * <ol>
 *   <li>把 analysis + preBattleSection 组装成一个 correction package（跨文本共享昵称锚点）；</li>
 *   <li>{@link TankNameCorrector} 纠正 AI 生成的坦克名（权威 roster 锚点，跨文本传播）；</li>
 *   <li>{@link ClusterTermSanitizer} 消除 AI 生成的内部术语「簇」，同时保护可能合法含「簇」的
 *       权威专有名词（昵称 / clan / 权威坦克名）；</li>
 *   <li>在 analysis 末尾追加三语固定免责句。</li>
 * </ol>
 *
 * <p>只做文本级纠正，不改任何解析/结算数据；null 段原样保留。
 * 团队路径（TEAM_PERSPECTIVE）迁移前后都不经过本条链。</p>
 */
public final class PlayerReviewOutputCorrector {

    private static final Logger LOGGER = LoggerFactory.getLogger(PlayerReviewOutputCorrector.class);

    private PlayerReviewOutputCorrector() {
    }

    /** 纠正后的两段文本（与输入一一对应，null 段保持 null）。 */
    public record Corrected(String analysis, String preBattleSection) {
    }

    public static Corrected apply(final String analysis, final String preBattleSection,
                                  final Battle battle, final AllowedLanguage language) {
        final List<String> corrected = sanitizeClusterTerms(
                correctTankNames(packageSections(analysis, preBattleSection), battle), battle);
        return new Corrected(withDisclaimerFooter(corrected.get(0), language), corrected.get(1));
    }

    /** 组装 correction package 的各段（允许 null 元素，null 段原样保留）。 */
    private static List<String> packageSections(final String analysis, final String preBattleSection) {
        final List<String> sections = new ArrayList<>(2);
        sections.add(analysis);
        sections.add(preBattleSection);
        return sections;
    }

    /**
     * 坦克名称确定性校验/纠正：把同一 AI Review 的多个文本（analysis + preBattleSection）
     * 视为一个 correction package，跨文本共享昵称锚点已证明的传播映射后再逐文本纠正。
     * 只做文本级纠正，不改任何解析/结算数据；有处理明细时记日志。
     */
    private static List<String> correctTankNames(final List<String> texts, final Battle battle) {
        if (texts == null || texts.isEmpty()
                || battle == null || battle.players == null || battle.players.isEmpty()) {
            return texts;
        }
        final List<TankNameCorrector.RosterEntry> roster = battle.players.stream()
                .filter(p -> PlayerSideResolver.isValidRawTeam(p.team))
                .filter(p -> p.tankId > 0)
                .map(p -> new TankNameCorrector.RosterEntry(
                        p.nickname == null ? "" : p.nickname,
                        ReplayDisplayNames.tankName(p.tankId, p.tankName)))
                .toList();
        if (roster.isEmpty()) {
            return texts;
        }
        final List<TankNameCorrector.Result> results = TankNameCorrector.correctAll(texts, roster);
        final List<String> corrected = new ArrayList<>(texts.size());
        for (int i = 0; i < texts.size(); i++) {
            corrected.add(texts.get(i) == null ? null : results.get(i).text());
        }
        final String detail = results.stream()
                .flatMap(r -> r.replacements().stream())
                .map(r -> r.original() + " -> " + r.replacement() + "[" + r.reason() + "]")
                .collect(Collectors.joining("; "));
        if (!detail.isEmpty()) {
            LOGGER.info("AI tank-name correction applied: {}", detail);
        }
        return corrected;
    }

    /** 「簇」字确定性兜底：对 correction package 各段统一应用，null 段原样保留。 */
    private static List<String> sanitizeClusterTerms(final List<String> texts, final Battle battle) {
        final List<String> protectedLiterals = new ArrayList<>();
        if (battle != null && battle.players != null) {
            for (final PlayerResult p : battle.players) {
                if (p == null) {
                    continue;
                }
                if (p.nickname != null && !p.nickname.isBlank()) {
                    protectedLiterals.add(p.nickname);
                }
                if (p.clan != null && !p.clan.isBlank()) {
                    // teamLabel（TeamPerspectiveLabelResolver 从 clan 聚合）可能含「簇」
                    protectedLiterals.add(p.clan);
                }
                final String tankName = ReplayDisplayNames.tankName(p.tankId, p.tankName);
                if (tankName != null && !tankName.isBlank()) {
                    protectedLiterals.add(tankName);
                }
            }
        }
        final List<String> out = new ArrayList<>(texts.size());
        for (final String t : texts) {
            out.add(t == null ? null : ClusterTermSanitizer.sanitize(t, protectedLiterals));
        }
        return out;
    }

    /** 复盘固定结尾免责句（三语），追加在 analysis 末尾。 */
    private static String withDisclaimerFooter(final String analysis, final AllowedLanguage language) {
        if (analysis == null || analysis.isBlank()) {
            return analysis;
        }
        final String footer = switch (language == null ? AllowedLanguage.ZH : language) {
            case ZH -> "\n\nAI复盘仅供参考";
            case EN -> "\n\nThis AI review is for reference only";
            case RU -> "\n\nРазбор ИИ приведён только для справки";
        };
        return analysis + footer;
    }
}
