package com.wotb.core.ai;

import com.wotb.core.ref.TankNameAliases;
import com.wotb.core.ref.Tankopedia;

import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

public final class TankNameCorrector {

    public record RosterEntry(String nickname, String tankName) {
    }

    public record Replacement(String original, String replacement, String reason) {
    }

    public record Result(String text, List<Replacement> replacements) {
    }

    private static final Tankopedia TANKOPEDIA = Tankopedia.load();
    private static final TankNameAliases ALIASES = TankNameAliases.load();

    private static final Pattern GRID_COORDINATE = Pattern.compile("[A-K](?:[1-9]|10)", Pattern.CASE_INSENSITIVE);
    private static final Set<String> AMBIGUOUS_PROSE_NAMES = Set.of(
            "is", "agent", "wind", "fury", "explorer", "ranger", "outcast",
            "tetrarch", "locust", "matilda", "covenanter", "alecto", "crusader",
            "scavenger", "leopard", "wolverine", "nightmare", "spike", "medjay",
            "high score", "excelsior", "angry connor", "turbo", "jackson", "spark",
            "ox", "rover", "hellcat", "shadowhunter", "charles", "pirate", "dreadnought",
            "thunder", "rudolph", "triumphant", "icebreaker", "enforcer", "frosty", "cyborg");

    private static final Map<String, String> CANONICAL_BY_LOWER = buildCanonicalIndex();
    private static final Set<String> ALIAS_KEYS_LOWER = buildAliasKeys();
    private static final Pattern TANK_PATTERN = buildPattern(CANONICAL_BY_LOWER.keySet());

    private record Section(String text, List<TankNameAnchorParser.Span> spans) {
    }

    private TankNameCorrector() {
    }

    private static Map<String, String> buildCanonicalIndex() {
        final Map<String, String> index = new HashMap<>();
        for (final String name : TANKOPEDIA.names()) {
            if (!isAmbiguousProseName(name)) {
                index.put(lower(name), name);
            }
        }
        for (final String alias : ALIASES.aliases()) {
            final String canonical = ALIASES.canonical(alias);
            if (!isAmbiguousProseName(alias) && !isAmbiguousProseName(canonical)) {
                index.put(lower(alias), canonical);
            }
        }
        return index;
    }

    private static boolean isAmbiguousProseName(final String name) {
        return GRID_COORDINATE.matcher(name).matches() || AMBIGUOUS_PROSE_NAMES.contains(lower(name));
    }

    private static Set<String> buildAliasKeys() {
        final Set<String> keys = new HashSet<>();
        for (final String alias : ALIASES.aliases()) {
            keys.add(lower(alias));
        }
        return keys;
    }

    private static Pattern buildPattern(final Collection<String> names) {
        final List<String> sorted = names.stream()
                .sorted(Comparator.comparingInt(String::length).reversed())
                .toList();
        final StringBuilder sb = new StringBuilder(4096);
        for (final String name : sorted) {
            if (sb.length() > 0) {
                sb.append('|');
            }
            sb.append(Pattern.quote(name));
        }
        return Pattern.compile(sb.toString(), Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE);
    }

    private static String lower(final String s) {
        return s.toLowerCase(Locale.ROOT);
    }

    /**
     * 纠正单个文本中的坦克名（等价于 {@link #correctAll(List, Collection)} 的单元素版本）。
     *
     * @param text   AI 复盘正文（zh/en/ru 均可；坦克名本身是英文专有名词或别名）
     * @param roster 本场双方玩家 roster（昵称 -&gt; 权威坦克名）；空/无效条目会被忽略
     * @return 纠正后正文与处理明细
     */
    public static Result correct(final String text, final Collection<RosterEntry> roster) {
        if (text == null) {
            return new Result("", List.of());
        }
        return correctAll(List.of(text), roster).getFirst();
    }

    /**
     * 把同一 AI Review 的多个文本（如 analysis 与 preBattleSection）视为一个 correction
     * package 整体纠正：Pass 1 跨全部文本收集昵称锚点已证明的「错名 canonical -&gt; roster 车」
     * 共享传播映射，Pass 2 再逐文本应用同一份映射——任一段内的锚点证明可传播到其它段的
     * standalone 提及，且跨段冲突 / source-in-roster 的 fail-closed 规则与单文本一致。
     *
     * @param texts  同一次 AI Review 的各段文本（可为 null/blank；null 段返回空正文且不参与
     *               扫描，返回列表与输入一一对应，不通过拼接实现）
     * @param roster 本场双方玩家 roster（昵称 -&gt; 权威坦克名）；空/无效条目会被忽略
     * @return 各段纠正后正文与处理明细（顺序与 {@code texts} 一致）
     */
    public static List<Result> correctAll(final List<String> texts, final Collection<RosterEntry> roster) {
        if (texts == null || texts.isEmpty() || roster == null || roster.isEmpty()) {
            return texts == null ? List.of()
                    : texts.stream().map(t -> new Result(t == null ? "" : t, List.of())).toList();
        }
        final Map<String, String> byLowerNick = new LinkedHashMap<>();
        final Set<String> rosterTanksLower = new HashSet<>();
        for (final RosterEntry entry : roster) {
            if (entry.nickname() == null || entry.nickname().isBlank()
                    || entry.tankName() == null || entry.tankName().isBlank()
                    || "未知坦克".equals(entry.tankName())) {
                continue;
            }
            byLowerNick.put(lower(entry.nickname()), entry.tankName());
            rosterTanksLower.add(lower(entry.tankName()));
        }
        if (byLowerNick.isEmpty()) {
            return texts.stream().map(t -> new Result(t == null ? "" : t, List.of())).toList();
        }
        final Pattern nickPattern = buildPattern(byLowerNick.keySet());
        final List<Section> sections = new ArrayList<>(texts.size());
        for (final String text : texts) {
            if (text == null || text.isBlank()) {
                sections.add(new Section(text == null ? "" : text, List.of()));
                continue;
            }
            sections.add(new Section(text, TankNameAnchorParser.scan(text, CANONICAL_BY_LOWER, TANK_PATTERN, nickPattern, byLowerNick)));
        }
        final Map<String, String> sharedPropagation = new HashMap<>();
        final Set<String> conflicted = new HashSet<>();
        for (final Section section : sections) {
            collectPropagation(section.text(), section.spans(), rosterTanksLower,
                    sharedPropagation, conflicted);
        }
        final List<Result> results = new ArrayList<>(sections.size());
        for (final Section section : sections) {
            results.add(applySection(section.text(), section.spans(), rosterTanksLower, sharedPropagation));
        }
        return List.copyOf(results);
    }

    private static void collectPropagation(final String text,
                                           final List<TankNameAnchorParser.Span> spans,
                                           final Set<String> rosterTanksLower,
                                           final Map<String, String> map,
                                           final Set<String> conflicted) {
        final Map<Integer, String> pairedTankByStart = TankNameAnchorParser.buildPairedTankByStart(text, spans);
        for (final TankNameAnchorParser.Span span : spans) {
            if (span.nickname || !pairedTankByStart.containsKey(span.start)) {
                continue;
            }
            final String sourceLower = lower(span.canonical);
            if (rosterTanksLower.contains(sourceLower) || conflicted.contains(sourceLower)) {
                continue;
            }
            final String target = pairedTankByStart.get(span.start);
            final String existing = map.putIfAbsent(sourceLower, target);
            if (existing != null && !existing.equalsIgnoreCase(target)) {
                map.remove(sourceLower);
                conflicted.add(sourceLower);
            }
        }
    }

    private static Result applySection(final String text,
                                       final List<TankNameAnchorParser.Span> spans,
                                       final Set<String> rosterTanksLower,
                                       final Map<String, String> propagatedByCanonicalLower) {
        if (spans.isEmpty()) {
            return new Result(text, List.of());
        }
        final Map<Integer, String> pairedTankByStart = TankNameAnchorParser.buildPairedTankByStart(text, spans);
        final StringBuilder out = new StringBuilder(text);
        final List<Replacement> replacements = new ArrayList<>();
        for (int i = spans.size() - 1; i >= 0; i--) {
            final TankNameAnchorParser.Span span = spans.get(i);
            if (span.nickname) {
                continue;
            }
            final String rosterTank = pairedTankByStart.get(span.start);
            if (rosterTank != null) {
                if (!span.canonical.equalsIgnoreCase(rosterTank)) {
                    out.replace(span.start, span.end, rosterTank);
                    replacements.add(new Replacement(span.text, rosterTank, "CORRECTED"));
                } else if (!span.text.equals(span.canonical)) {
                    out.replace(span.start, span.end, span.canonical);
                    replacements.add(new Replacement(span.text, span.canonical, "NORMALIZED"));
                }
                continue;
            }
            final String propagated = propagatedByCanonicalLower.get(lower(span.canonical));
            if (propagated != null) {
                out.replace(span.start, span.end, propagated);
                replacements.add(new Replacement(span.text, propagated, "PROPAGATED"));
                continue;
            }
            if (ALIAS_KEYS_LOWER.contains(lower(span.text))) {
                out.replace(span.start, span.end, span.canonical);
                replacements.add(new Replacement(span.text, span.canonical, "NORMALIZED"));
                if (!rosterTanksLower.contains(lower(span.canonical))) {
                    replacements.add(new Replacement(span.canonical, span.canonical, "DETECTED"));
                }
            } else if (!span.text.equals(span.canonical)) {
                out.replace(span.start, span.end, span.canonical);
                replacements.add(new Replacement(span.text, span.canonical, "NORMALIZED"));
                if (!rosterTanksLower.contains(lower(span.canonical))) {
                    replacements.add(new Replacement(span.canonical, span.canonical, "DETECTED"));
                }
            } else if (!rosterTanksLower.contains(lower(span.canonical))) {
                replacements.add(new Replacement(span.text, span.text, "DETECTED"));
            }
        }
        return new Result(out.toString(), List.copyOf(replacements));
    }


}
