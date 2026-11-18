package com.wotb.core.ai;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Scans prose for tank and nickname anchors and resolves local pairings. */
final class TankNameAnchorParser {
    private TankNameAnchorParser() {
    }

    /** A located tank or nickname occurrence. */
    static final class Span {
        final int start;
        final int end;
        final String text;
        final String canonical;
        final boolean nickname;

        Span(int start, int end, String text, String canonical, boolean nickname) {
            this.start = start;
            this.end = end;
            this.text = text;
            this.canonical = canonical;
            this.nickname = nickname;
        }
    }

    /** 扫描正文，合并坦克名与昵称命中，重叠时保留更长者（如 Emil II 优先于其前缀 Emil I）。 */
    static List<Span> scan(final String text,
                           final Map<String, String> canonicalByLower,
                           final Pattern tankPattern,
                           final Pattern nickPattern,
                           final Map<String, String> byLowerNick) {
        final List<Span> spans = new ArrayList<>();
        final Matcher tankMatcher = tankPattern.matcher(text);
        while (tankMatcher.find()) {
            final String matched = tankMatcher.group();
            if (isAscii(matched) && hasAsciiBoundaryViolation(text, tankMatcher.start(), tankMatcher.end())) {
                continue;
            }
            spans.add(new Span(tankMatcher.start(), tankMatcher.end(), matched,
                    canonicalByLower.get(matched.toLowerCase(Locale.ROOT)), false));
        }
        final Matcher nickMatcher = nickPattern.matcher(text);
        while (nickMatcher.find()) {
            final String matched = nickMatcher.group();
            if (isAscii(matched) && hasAsciiBoundaryViolation(text, nickMatcher.start(), nickMatcher.end())) {
                continue;
            }
            final String tankName = byLowerNick.get(matched.toLowerCase(Locale.ROOT));
            if (tankName != null) {
                spans.add(new Span(nickMatcher.start(), nickMatcher.end(), matched, tankName, true));
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
    static Map<Integer, String> buildPairedTankByStart(final String text, final List<Span> spans) {
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
