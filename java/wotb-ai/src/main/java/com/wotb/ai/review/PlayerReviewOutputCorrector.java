package com.wotb.ai.review;

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

public final class PlayerReviewOutputCorrector {

    private static final Logger LOGGER = LoggerFactory.getLogger(PlayerReviewOutputCorrector.class);

    private PlayerReviewOutputCorrector() {
    }

    public record Corrected(String analysis, String preBattleSection) {
    }

    public static Corrected apply(final String analysis, final String preBattleSection,
                                  final Battle battle, final AllowedLanguage language) {
        final List<String> corrected = sanitizeClusterTerms(
                correctTankNames(packageSections(analysis, preBattleSection), battle), battle);
        return new Corrected(withDisclaimerFooter(corrected.get(0), language), corrected.get(1));
    }

    private static List<String> packageSections(final String analysis, final String preBattleSection) {
        final List<String> sections = new ArrayList<>(2);
        sections.add(analysis);
        sections.add(preBattleSection);
        return sections;
    }

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
