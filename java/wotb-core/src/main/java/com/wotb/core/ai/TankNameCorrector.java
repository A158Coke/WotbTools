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
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * AI 复盘正文坦克名称确定性校验/纠正器。
 * <p>AI 复盘正文是 LLM 自由文本，存在把玩家坦克名写错/写成译名/俗称的幻觉
 * （如把 Kranvagn 写成「埃米尔1951」）。本类在生成后对正文做确定性纠正：
 * <ul>
 *   <li>R1 昵称锚定：以 roster 昵称的括号对/所属式配对定位其坦克名，若与 roster 权威名
 *       不一致则替换为权威名（支持「坦克名（昵称）」与「昵称（坦克名）」两种顺序）；</li>
 *   <li>R1+ 文档级传播：全文先收集昵称锚点已证明的「错名 canonical -> roster 车」唯一映射
 *       （Pass 1），再传播到其它 standalone 提及（Pass 2，同一 canonical 的别名/英文原文
 *       一并修正，与出现顺序无关；映射冲突或 source 本身在 roster 时 fail closed 不传播）；</li>
 *   <li>R2 归一化：别名（KRV/克朗瓦根/埃米尔1951 等，见 common/tank-name-aliases.json）
 *       与大小写差异统一为 tankopedia 权威英文名；</li>
 *   <li>R3 独立错名检测：正文中出现的、不在本场 roster 内的已知车名（无昵称锚点/有歧义时
 *       无法确定归属玩家）只记录不改写，由调用方记日志——fail closed，不猜测。</li>
 * </ul>
 * 纯函数、确定性：同样的输入必然产出同样的输出，不改 AI 调用、不增加成本。</p>
 */
public final class TankNameCorrector {

    /** roster 条目：昵称 -&gt; 权威坦克名（由调用方用 {@code ReplayDisplayNames.tankName} 解析）。 */
    public record RosterEntry(String nickname, String tankName) {
    }

    /** 一条处理记录。{@code reason}：CORRECTED（R1 纠正）/ PROPAGATED（共享映射传播）/ NORMALIZED（R2 归一化）/ DETECTED（R3 检测不改写）。 */
    public record Replacement(String original, String replacement, String reason) {
    }

    /** 纠正结果：纠正后的正文 + 处理明细。 */
    public record Result(String text, List<Replacement> replacements) {
    }

    private static final Tankopedia TANKOPEDIA = Tankopedia.load();
    private static final TankNameAliases ALIASES = TankNameAliases.load();

    /** 已知车名（tier7-10 权威名）+ 别名的 小写文本 -&gt; 权威名。 */
    private static final Map<String, String> CANONICAL_BY_LOWER = buildCanonicalIndex();
    private static final Set<String> ALIAS_KEYS_LOWER = buildAliasKeys();
    private static final Pattern TANK_PATTERN = buildPattern(CANONICAL_BY_LOWER.keySet());

    private TankNameCorrector() {
    }

    private static Map<String, String> buildCanonicalIndex() {
        final Map<String, String> index = new HashMap<>();
        for (final String name : TANKOPEDIA.names()) {
            index.put(lower(name), name);
        }
        for (final String alias : ALIASES.aliases()) {
            index.put(lower(alias), ALIASES.canonical(alias));
        }
        return index;
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
        final Map<String, RosterEntry> byLowerNick = new LinkedHashMap<>();
        final Set<String> rosterTanksLower = new HashSet<>();
        for (final RosterEntry entry : roster) {
            if (entry.nickname() == null || entry.nickname().isBlank()
                    || entry.tankName() == null || entry.tankName().isBlank()
                    || "未知坦克".equals(entry.tankName())) {
                continue;
            }
            byLowerNick.put(lower(entry.nickname()), entry);
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
            sections.add(new Section(text, scan(text, TANK_PATTERN, nickPattern, byLowerNick)));
        }
        // Pass 1：跨全部 section 收集共享传播映射（含跨段冲突封禁）
        final Map<String, String> sharedPropagation = new HashMap<>();
        final Set<String> conflicted = new HashSet<>();
        for (final Section section : sections) {
            collectPropagation(section.text(), section.spans(), rosterTanksLower,
                    sharedPropagation, conflicted);
        }
        // Pass 2：逐段应用同一份共享映射
        final List<Result> results = new ArrayList<>(sections.size());
        for (final Section section : sections) {
            results.add(applySection(section.text(), section.spans(), rosterTanksLower, sharedPropagation));
        }
        return List.copyOf(results);
    }

    /** 文本中的一个命中：坦克名或昵称。 */
    private record Span(int start, int end, String text, String canonical, boolean nickname) {
    }

    /** 一段待处理文本及其扫描结果（blank/null 段 spans 为空，原样返回）。 */
    private record Section(String text, List<Span> spans) {
    }

    /** 扫描正文，合并坦克名与昵称命中，重叠时保留更长者（如 Emil II 优先于其前缀 Emil I）。 */
    private static List<Span> scan(final String text,
                                   final Pattern tankPattern,
                                   final Pattern nickPattern,
                                   final Map<String, RosterEntry> byLowerNick) {
        final List<Span> spans = new ArrayList<>();
        final Matcher tankMatcher = tankPattern.matcher(text);
        while (tankMatcher.find()) {
            final String matched = tankMatcher.group();
            if (isAscii(matched) && hasAsciiBoundaryViolation(text, tankMatcher.start(), tankMatcher.end())) {
                continue;
            }
            spans.add(new Span(tankMatcher.start(), tankMatcher.end(), matched,
                    CANONICAL_BY_LOWER.get(lower(matched)), false));
        }
        final Matcher nickMatcher = nickPattern.matcher(text);
        while (nickMatcher.find()) {
            final String matched = nickMatcher.group();
            if (isAscii(matched) && hasAsciiBoundaryViolation(text, nickMatcher.start(), nickMatcher.end())) {
                continue;
            }
            final RosterEntry entry = byLowerNick.get(lower(matched));
            if (entry != null) {
                spans.add(new Span(nickMatcher.start(), nickMatcher.end(), matched, entry.tankName(), true));
            }
        }
        spans.sort(Comparator.comparingInt((Span s) -> s.start)
                .thenComparing(Comparator.comparingInt((Span s) -> s.end - s.start).reversed()));
        final List<Span> merged = new ArrayList<>(spans.size());
        int lastEnd = -1;
        for (final Span span : spans) {
            if (span.start < lastEnd) {
                continue;
            }
            merged.add(span);
            lastEnd = span.end;
        }
        return merged;
    }

    /** 纯 ASCII 名称要求两侧不是 ASCII 字母/数字（避免把 KRV 匹配进 AKRV、把 Emil I 匹配进 Emil II 之外的字母）。 */
    private static boolean hasAsciiBoundaryViolation(final String text, final int start, final int end) {
        if (start > 0 && isAsciiLetterOrDigit(text.charAt(start - 1))) {
            return true;
        }
        return end < text.length() && isAsciiLetterOrDigit(text.charAt(end));
    }

    private static boolean isAsciiLetterOrDigit(final char c) {
        return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9');
    }

    private static boolean isAscii(final String s) {
        for (int i = 0; i < s.length(); i++) {
            if (s.charAt(i) > 0x7F) {
                return false;
            }
        }
        return true;
    }

    /** R1 配对：返回该段内被昵称锚定的坦克 span.start -&gt; roster 权威坦克名。 */
    private static Map<Integer, String> buildPairedTankByStart(final String text, final List<Span> spans) {
        final Map<Integer, String> pairedTankByStart = new HashMap<>();
        for (final Span span : spans) {
            if (!span.nickname) {
                continue;
            }
            final Span paired = findPairedTank(text, spans, span);
            if (paired != null) {
                pairedTankByStart.putIfAbsent(paired.start, span.canonical);
            }
        }
        return pairedTankByStart;
    }

    /**
     * Pass 1（跨段累积）：把一段内昵称锚点已证明的「错名 canonical -&gt; roster canonical」
     * 映射并入共享 {@code map}。fail closed 规则：
     * <ul>
     *   <li>只收集 source canonical 不在本场 roster 的配对——若 source 本身在 roster，
     *       standalone 提及可能是那辆真车，不得全局改写（仅该锚点处按 R1 局部纠正）；</li>
     *   <li>同一 source 被多个锚点指向不同 roster 车 → 冲突，该 source 从 map 移除并加入
     *       {@code conflicted} 永久封禁（后续任何段的同源锚点不得重新入表），
     *       standalone 保持 R2/R3 行为（NORMALIZED / DETECTED），不猜测。</li>
     * </ul>
     * 与出现顺序无关：全部段先收集完，再统一应用（Pass 2）。
     */
    private static void collectPropagation(final String text,
                                           final List<Span> spans,
                                           final Set<String> rosterTanksLower,
                                           final Map<String, String> map,
                                           final Set<String> conflicted) {
        final Map<Integer, String> pairedTankByStart = buildPairedTankByStart(text, spans);
        for (final Span span : spans) {
            if (span.nickname || !pairedTankByStart.containsKey(span.start)) {
                continue;
            }
            final String sourceLower = lower(span.canonical);
            if (rosterTanksLower.contains(sourceLower) || conflicted.contains(sourceLower)) {
                continue; // source 本身在 roster，或已判冲突：standalone 可能是真车/不猜，均不传播
            }
            final String target = pairedTankByStart.get(span.start);
            final String existing = map.putIfAbsent(sourceLower, target);
            if (existing != null && !existing.equalsIgnoreCase(target)) {
                map.remove(sourceLower);
                conflicted.add(sourceLower); // 冲突永久封禁：后续同源锚点不得重新入表
            }
        }
    }

    /** Pass 2：对一段应用 R1 局部纠正 + 共享传播 + R2/R3（替换从后往前，避免位移）。 */
    private static Result applySection(final String text,
                                       final List<Span> spans,
                                       final Set<String> rosterTanksLower,
                                       final Map<String, String> propagatedByCanonicalLower) {
        if (spans.isEmpty()) {
            return new Result(text, List.of());
        }
        final Map<Integer, String> pairedTankByStart = buildPairedTankByStart(text, spans);
        final StringBuilder out = new StringBuilder(text);
        final List<Replacement> replacements = new ArrayList<>();
        // 应用替换（从后往前，避免位移）
        for (int i = spans.size() - 1; i >= 0; i--) {
            final Span span = spans.get(i);
            if (span.nickname) {
                continue;
            }
            final String rosterTank = pairedTankByStart.get(span.start);
            if (rosterTank != null) {
                if (!span.canonical.equalsIgnoreCase(rosterTank)) {
                    out.replace(span.start, span.end, rosterTank);
                    replacements.add(new Replacement(span.text, rosterTank, "CORRECTED"));
                } else if (!span.text.equals(span.canonical)) {
                    // 配对正确但写法不一致（如 KRV 或小写）→ 归一化
                    out.replace(span.start, span.end, span.canonical);
                    replacements.add(new Replacement(span.text, span.canonical, "NORMALIZED"));
                }
                continue;
            }
            // Pass 2（文档级）：package 内已证明该 canonical -> 唯一 roster 车 → 传播到 standalone 提及
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

    /** R1 配对：返回与该昵称配对的坦克 span；不存在返回 null。 */
    private static Span findPairedTank(final String text, final List<Span> spans, final Span nick) {
        // 昵称在括号内：坦克名（昵称）——坦克在开括号前，或同括号内
        final int[] parens = findParens(text, nick.start, nick.end);
        if (parens != null && nicknameCountInside(spans, parens[0], parens[1]) <= 1) {
            final Span before = tankEndingNear(text, spans, parens[0]);
            if (before != null) {
                return before;
            }
            final Span inside = tankInsideParens(spans, parens[0], parens[1], nick);
            if (inside != null) {
                return inside;
            }
        }
        // 昵称在括号前：昵称（坦克名）
        final int[] forward = findForwardParen(text, nick.end);
        if (forward != null && nicknameCountInside(spans, forward[0], forward[1]) == 0) {
            final Span inside = tankInsideParens(spans, forward[0], forward[1], nick);
            if (inside != null) {
                return inside;
            }
        }
        return tankAdjacentPossessive(text, spans, nick);
    }

    /** 昵称结束后 ≤2 字符内紧跟的括号对 [open, close]；不存在返回 null。 */
    private static int[] findForwardParen(final String text, final int nickEnd) {
        for (int i = nickEnd; i < text.length() && i - nickEnd <= 2; i++) {
            final char c = text.charAt(i);
            if (c == '(' || c == '（') {
                final char closeCh = c == '(' ? ')' : '）';
                final int close = text.indexOf(closeCh, i + 1);
                if (close >= 0 && close - i <= 48) {
                    return new int[]{i, close};
                }
            }
            if (!Character.isWhitespace(c)) {
                break;
            }
        }
        return null;
    }

    /** 返回昵称所在括号对 [open, close]；不在任何括号内返回 null。 */
    private static int[] findParens(final String text, final int nickStart, final int nickEnd) {
        for (int i = nickStart - 1; i >= 0 && nickStart - i <= 64; i--) {
            final char c = text.charAt(i);
            if (c != '(' && c != '（') {
                continue;
            }
            final char closeCh = c == '(' ? ')' : '）';
            final int firstClose = text.indexOf(closeCh, i + 1);
            if (firstClose >= nickEnd && firstClose - i <= 48) {
                return new int[]{i, firstClose};
            }
        }
        return null;
    }

    private static int nicknameCountInside(final List<Span> spans, final int open, final int close) {
        int count = 0;
        for (final Span span : spans) {
            if (span.nickname && span.start >= open && span.end <= close) {
                count++;
            }
        }
        return count;
    }

    /** 开括号前 ≤2 字符内结束的坦克名（允许空白/「的」等间隔）。 */
    private static Span tankEndingNear(final String text, final List<Span> spans, final int openParen) {
        for (final Span span : spans) {
            if (span.nickname || span.end > openParen) {
                continue;
            }
            final int gap = openParen - span.end;
            if (gap >= 0 && gap <= 2 && isFiller(text.substring(span.end, openParen))) {
                return span;
            }
        }
        return null;
    }

    /** 括号内、且不与该昵称重叠的坦克名；多个坦克名时返回 null 不判定。 */
    private static Span tankInsideParens(final List<Span> spans, final int open, final int close, final Span nick) {
        Span found = null;
        for (final Span span : spans) {
            if (span.nickname) {
                continue;
            }
            if (span.start > open && span.end <= close && (span.start >= nick.end || span.end <= nick.start)) {
                if (found != null) {
                    return null;
                }
                found = span;
            }
        }
        return found;
    }

    /** 所属式：昵称与坦克名之间 ≤8 字符且仅空白与单个「的」。 */
    private static Span tankAdjacentPossessive(final String text, final List<Span> spans, final Span nick) {
        for (final Span span : spans) {
            if (span.nickname) {
                continue;
            }
            if (span.end < nick.start && nick.start - span.end <= 8 && isPossessiveGap(text, span.end, nick.start)) {
                return span;
            }
            if (nick.end < span.start && span.start - nick.end <= 8 && isPossessiveGap(text, nick.end, span.start)) {
                return span;
            }
        }
        return null;
    }

    private static boolean isFiller(final String s) {
        for (int i = 0; i < s.length(); i++) {
            final char c = s.charAt(i);
            if (!Character.isWhitespace(c) && c != '的' && c != '、' && c != '，') {
                return false;
            }
        }
        return true;
    }

    /** 间隔仅允许空白与单个「的」（所属式限定，避免把并列列举误配）。 */
    private static boolean isPossessiveGap(final String text, final int from, final int to) {
        boolean seenDe = false;
        for (int i = from; i < to; i++) {
            final char c = text.charAt(i);
            if (c == '的') {
                if (seenDe) {
                    return false;
                }
                seenDe = true;
            } else if (!Character.isWhitespace(c)) {
                return false;
            }
        }
        return seenDe;
    }
}
