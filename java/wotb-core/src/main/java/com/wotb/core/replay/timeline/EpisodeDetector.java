package com.wotb.core.replay.timeline;

import java.util.ArrayList;
import java.util.List;

public final class EpisodeDetector {

    public static final double MIN_EPISODE_SEC = 8.0;
    public static final double PREFERRED_MAX_SEC = 45.0;
    public static final double HARD_MAX_SEC = 60.0;
    public static final double QUIET_GAP_SEC = 10.0;

    private EpisodeDetector() {
    }

    public static List<TacticalEpisode> detect(final BattleTimeline timeline) {
        if (timeline == null || timeline.frames() == null || timeline.frames().isEmpty()) {
            return List.of();
        }
        final int maxSecond = timeline.frames().size() - 1;
        final double endSec = Math.max(0, timeline.durationSec() < maxSecond
                ? maxSecond : timeline.durationSec());
        if (endSec <= 0) {
            return List.of();
        }

        final List<List<BattleDelta>> deltasBySecond = new ArrayList<>(maxSecond + 1);
        for (int i = 0; i <= maxSecond; i++) {
            deltasBySecond.add(new ArrayList<>());
        }
        int lastDeltaSecond = -1;
        for (final BattleFrame frame : timeline.frames()) {
            if (frame.deltas() == null || frame.deltas().isEmpty()) {
                continue;
            }
            deltasBySecond.get(frame.second()).addAll(frame.deltas());
            lastDeltaSecond = Math.max(lastDeltaSecond, frame.second());
        }

        final double[] scores = new double[maxSecond + 1];
        for (int s = 0; s <= maxSecond; s++) {
            double score = 0;
            int destroyed = 0;
            int firstKnown = 0;
            int reacquired = 0;
            for (final BattleDelta d : deltasBySecond.get(s)) {
                switch (d.kind()) {
                    case FIRST_CONTACT -> score += 3;
                    case DESTROYED -> destroyed++;
                    case ALIVE_COUNT_CHANGE -> score += 2;
                    case HP_GAP_DELTA -> score += 2;
                    case FIRST_KNOWN -> firstKnown++;
                    case ENEMY_REACQUIRED -> reacquired++;
                    case POINTS_CHANGE -> score += 1;
                    case ENGAGEMENT_ACTIVITY -> {
                        score += 1;
                        if (d.number("damageInWindow", 0) >= 200) {
                            score += 1;
                        }
                    }
                    default -> {
                    }
                }
            }
            score += Math.min(2, destroyed);
            score += Math.min(2, firstKnown);
            score += Math.min(2, reacquired);
            scores[s] = score;
        }

        final List<int[]> raw = new ArrayList<>();
        int start = 0;
        int lastDeltaSeen = 0;
        for (int s = 0; s <= maxSecond; s++) {
            final double length = s - start;
            final double elapsedSinceDelta = s - lastDeltaSeen;
            final boolean strongSignal = scores[s] >= 3.0 && length >= MIN_EPISODE_SEC;
            final boolean quietGap = elapsedSinceDelta >= QUIET_GAP_SEC
                    && length >= MIN_EPISODE_SEC && deltasBySecond.get(s).isEmpty();
            final boolean tooLong = length >= HARD_MAX_SEC;
            final boolean preferredReached = length >= PREFERRED_MAX_SEC
                    && (scores[s] >= 1.0 || s == maxSecond);
            if (s > start && (strongSignal || quietGap || tooLong || preferredReached)) {
                raw.add(new int[]{start, s});
                start = s;
                lastDeltaSeen = s;
            }
            if (!deltasBySecond.get(s).isEmpty()) {
                lastDeltaSeen = s;
            }
        }
        if (start < maxSecond || raw.isEmpty()) {
            raw.add(new int[]{start, Math.max(start + 1, maxSecond + 1)});
        }

        final List<int[]> merged = new ArrayList<>();
        for (final int[] seg : raw) {
            if (merged.isEmpty()) {
                merged.add(seg);
                continue;
            }
            final int[] prev = merged.get(merged.size() - 1);
            final double prevLen = prev[1] - prev[0];
            final double curLen = seg[1] - seg[0];
            if (curLen < MIN_EPISODE_SEC && (prevLen + curLen) <= HARD_MAX_SEC) {
                prev[1] = seg[1];
            } else {
                merged.add(seg);
            }
        }
        if (merged.size() > 1 && (merged.get(0)[1] - merged.get(0)[0]) < MIN_EPISODE_SEC) {
            final int[] first = merged.get(0);
            final int[] second = merged.get(1);
            if ((second[1] - first[0]) <= HARD_MAX_SEC) {
                first[1] = second[1];
                merged.remove(1);
            }
        }

        final List<TacticalEpisode> episodes = new ArrayList<>();
        int idx = 0;
        for (final int[] seg : merged) {
            final double s = seg[0];
            final int lastInclusiveSecond = Math.min(seg[1] - 1, maxSecond);
            final double e = Math.max(s + MIN_EPISODE_SEC, lastInclusiveSecond + 1.0);
            final WorldSummary before = frameWorld(timeline, Math.max(0, seg[0] - 1));
            final WorldSummary after = frameWorld(timeline, lastInclusiveSecond);
            final List<BattleDelta> deltas = collectDeltas(deltasBySecond, seg[0], seg[1]);
            episodes.add(new TacticalEpisode(
                    idx++, s, Math.min(e, endSec), before, after,
                    List.copyOf(deltas),
                    List.copyOf(changes(deltas)),
                    List.of()));
        }
        return List.copyOf(episodes);
    }

    private static WorldSummary frameWorld(final BattleTimeline timeline, final int second) {
        final BattleFrame frame = timeline.frameAt(second);
        return frame == null ? WorldSummary.EMPTY : frame.world();
    }

    private static List<BattleDelta> collectDeltas(
            final List<List<BattleDelta>> deltasBySecond,
            final int startSecond,
            final int endExclusiveSecond) {
        final List<BattleDelta> out = new ArrayList<>();
        for (int s = Math.max(0, startSecond); s < endExclusiveSecond && s < deltasBySecond.size(); s++) {
            out.addAll(deltasBySecond.get(s));
        }
        return out;
    }

    static List<String> changes(final List<BattleDelta> deltas) {
        final List<String> out = new ArrayList<>();
        for (final BattleDelta d : deltas) {
            switch (d.kind()) {
                case FIRST_CONTACT -> out.add("FIRST_CONTACT");
                case DESTROYED -> out.add("DESTROYED");
                case ALIVE_COUNT_CHANGE -> {
                    final double f = d.number("friendlyAlive", -1);
                    final double e = d.number("enemyAlive", -1);
                    if (f >= 0 && e >= 0) {
                        out.add("ALIVE " + (int) f + "v" + (int) e);
                    }
                }
                case FIRST_KNOWN -> out.add("NEW_ENEMY_INFO");
                case ENEMY_REACQUIRED -> out.add("ENEMY_REACQUIRED");
                case ENEMY_LOST -> out.add("ENEMY_LOST");
                case HP_GAP_DELTA -> out.add("HP_GAP_DELTA");
                case POINTS_CHANGE -> out.add("POINTS_CHANGE");
                case ENGAGEMENT_ACTIVITY -> out.add("ENGAGEMENT dmg="
                        + Math.round(d.number("damageInWindow", 0)));
                case REGION_CHANGE -> out.add("ROTATION");
                default -> {
                }
            }
        }
        return out;
    }
}
