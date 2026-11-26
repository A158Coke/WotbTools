package com.wotb.core.replay.evidence;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.feature.MapRegionResolver;
import com.wotb.core.replay.processing.PlayerSideResolver;
import com.wotb.core.util.PlayerResultFormat;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;

public final class PointsSituationSkill {

    private PointsSituationSkill() {
    }


    public static final float PRESENCE_BIN_SEC = 15f;

    public static final float MIN_MOVE_METERS_PER_SAMPLE = 4f;

    public static final float MAX_ENTRY_LOOKBACK_SEC = 20f;

    public static final float ENTRY_MERGE_GAP_SEC = 8f;

    public static final float POSITION_STREAM_GAP_SEC = 5f;

    public record PositionSample(float timeSec, float x, float z) {
        public PositionSample {
            if (!Float.isFinite(timeSec) || timeSec < 0
                    || !Float.isFinite(x) || !Float.isFinite(z)) {
                throw new IllegalArgumentException(
                        "position sample must be finite with non-negative time: "
                                + timeSec + "," + x + "," + z);
            }
        }
    }

    public record VehicleTrack(long accountId, int team, List<PositionSample> samples) {
        public VehicleTrack {
            samples = samples == null ? List.of() : List.copyOf(samples);
        }
    }

    public record KillPointsEvent(float timeSec, int victimTeam, int beneficiaryTeam) {
        public KillPointsEvent {
            if (!Float.isFinite(timeSec) || timeSec < 0) {
                throw new IllegalArgumentException("timeSec must be finite and >= 0: " + timeSec);
            }
        }
    }

    public record CapturePresence(float startSec, float endSec, int team1Vehicles, int team2Vehicles) {
    }

    public record ControlRegionEntryWindow(
            float startSec,
            float endSec,
            int team,
            List<Long> accountIds,
            int targetRegion
    ) {
        public ControlRegionEntryWindow {
            accountIds = accountIds == null ? List.of() : List.copyOf(accountIds);
        }
    }

    public static List<KillPointsEvent> killPointsTimeline(final Battle battle) {
        if (battle == null || battle.players == null) {
            return List.of();
        }
        final List<KillPointsEvent> events = new ArrayList<>();
        for (final PlayerResult player : battle.players) {
            if (player == null || player.survived) {
                continue;
            }
            if (!PlayerSideResolver.isValidRawTeam(player.team)) {
                continue;
            }
            final double deathSec = PlayerResultFormat.deathSec(player);
            if (!Double.isFinite(deathSec) || deathSec <= 0) {
                continue;
            }
            events.add(new KillPointsEvent(
                    (float) deathSec, player.team, player.team == 1 ? 2 : 1));
        }
        events.sort(Comparator.comparingDouble(KillPointsEvent::timeSec));
        return List.copyOf(events);
    }

    public static List<CapturePresence> capturePresence(
            final List<VehicleTrack> tracks,
            final Set<String> controlRegions,
            final String mapCode,
            final float binSec
    ) {
        if (tracks == null || tracks.isEmpty()
                || controlRegions == null || controlRegions.isEmpty()
                || !Float.isFinite(binSec) || binSec <= 0) {
            return List.of();
        }
        final Map<Integer, Set<Long>> team1ByBin = new TreeMap<>();
        final Map<Integer, Set<Long>> team2ByBin = new TreeMap<>();
        for (final VehicleTrack track : tracks) {
            final boolean team1 = track.team() == 1;
            if (!team1 && track.team() != 2) {
                continue;
            }
            final Map<Integer, Set<Long>> byBin = team1 ? team1ByBin : team2ByBin;
            for (final PositionSample sample : track.samples()) {
                final int region = regionOf(sample.x(), sample.z(), mapCode);
                if (region <= 0 || !controlRegions.contains(String.valueOf(region))) {
                    continue;
                }
                final int bin = (int) Math.floor(sample.timeSec() / binSec);
                byBin.computeIfAbsent(bin, k -> new LinkedHashSet<>())
                        .add(track.accountId());
            }
        }
        final Set<Integer> bins = new TreeSet<>();
        bins.addAll(team1ByBin.keySet());
        bins.addAll(team2ByBin.keySet());
        final List<CapturePresence> result = new ArrayList<>();
        for (final int bin : bins) {
            result.add(new CapturePresence(
                    bin * binSec,
                    (bin + 1) * binSec,
                    team1ByBin.getOrDefault(bin, Set.of()).size(),
                    team2ByBin.getOrDefault(bin, Set.of()).size()));
        }
        return List.copyOf(result);
    }

    public static List<ControlRegionEntryWindow> controlRegionEntryWindows(
            final List<VehicleTrack> tracks,
            final Set<String> controlRegions,
            final String mapCode
    ) {
        if (tracks == null || tracks.isEmpty()
                || controlRegions == null || controlRegions.isEmpty()) {
            return List.of();
        }
        final List<ControlRegionEntryWindow> perVehicle = new ArrayList<>();
        for (final VehicleTrack track : tracks) {
            if (track.samples().size() < 2) {
                continue;
            }
            perVehicle.addAll(entryWindowsOf(track, controlRegions, mapCode));
        }
        return mergeByTeamAndRegion(perVehicle);
    }

    private static List<ControlRegionEntryWindow> entryWindowsOf(
            final VehicleTrack track,
            final Set<String> controlRegions,
            final String mapCode
    ) {
        final List<PositionSample> samples = track.samples();
        final List<ControlRegionEntryWindow> windows = new ArrayList<>();
        for (int i = 1; i < samples.size(); i++) {
            final PositionSample entry = samples.get(i);
            final int entryRegion = regionOf(entry.x(), entry.z(), mapCode);
            if (entryRegion <= 0 || !controlRegions.contains(String.valueOf(entryRegion))) {
                continue;
            }
            final PositionSample previous = samples.get(i - 1);
            if (inside(previous, controlRegions, mapCode)
                    || entry.timeSec() - previous.timeSec() > POSITION_STREAM_GAP_SEC) {
                continue;
            }
            final float entryDisplacement = MapRegionResolver.canonicalDistanceMeters(
                    previous.x(), previous.z(), entry.x(), entry.z(), mapCode);
            if (entryDisplacement < MIN_MOVE_METERS_PER_SAMPLE) {
                continue;
            }
            final float start = approachStart(samples, i, controlRegions, mapCode);
            final float end = presenceEnd(samples, i, controlRegions, mapCode);
            windows.add(new ControlRegionEntryWindow(start, end, track.team(),
                    List.of(track.accountId()), entryRegion));
        }
        return windows;
    }

    private static float approachStart(
            final List<PositionSample> samples,
            final int entryIndex,
            final Set<String> controlRegions,
            final String mapCode
    ) {
        final float entryTime = samples.get(entryIndex).timeSec();
        float start = entryTime;
        for (int j = entryIndex - 1; j >= 1; j--) {
            final PositionSample current = samples.get(j);
            final PositionSample before = samples.get(j - 1);
            if (entryTime - before.timeSec() > MAX_ENTRY_LOOKBACK_SEC) {
                break;
            }
            if (inside(current, controlRegions, mapCode)) {
                break;
            }
            if (current.timeSec() - before.timeSec() > POSITION_STREAM_GAP_SEC) {
                break;
            }
            final float distance = MapRegionResolver.canonicalDistanceMeters(
                    before.x(), before.z(), current.x(), current.z(), mapCode);
            if (distance < MIN_MOVE_METERS_PER_SAMPLE) {
                break;
            }
            start = before.timeSec();
        }
        return start;
    }

    private static float presenceEnd(
            final List<PositionSample> samples,
            final int entryIndex,
            final Set<String> controlRegions,
            final String mapCode
    ) {
        float end = samples.get(entryIndex).timeSec();
        for (int k = entryIndex + 1; k < samples.size(); k++) {
            final PositionSample sample = samples.get(k);
            final PositionSample before = samples.get(k - 1);
            if (sample.timeSec() - before.timeSec() > POSITION_STREAM_GAP_SEC) {
                break;
            }
            if (!inside(sample, controlRegions, mapCode)) {
                break;
            }
            end = sample.timeSec();
        }
        return end;
    }

    private static boolean inside(
            final PositionSample sample,
            final Set<String> controlRegions,
            final String mapCode
    ) {
        final int region = regionOf(sample.x(), sample.z(), mapCode);
        return region > 0 && controlRegions.contains(String.valueOf(region));
    }

    private static int regionOf(final float x, final float z, final String mapCode) {
        return MapRegionResolver.resolveRegionFromRaw(x, z, mapCode);
    }

    private static List<ControlRegionEntryWindow> mergeByTeamAndRegion(
            final List<ControlRegionEntryWindow> windows) {
        final List<ControlRegionEntryWindow> sorted = new ArrayList<>(windows);
        sorted.sort(Comparator
                .comparingInt(ControlRegionEntryWindow::team)
                .thenComparingInt(ControlRegionEntryWindow::targetRegion)
                .thenComparingDouble(ControlRegionEntryWindow::startSec)
                .thenComparingDouble(ControlRegionEntryWindow::endSec));
        final List<ControlRegionEntryWindow> merged = new ArrayList<>();
        ControlRegionEntryWindow current = null;
        for (final ControlRegionEntryWindow window : sorted) {
            if (current == null) {
                current = window;
                continue;
            }
            if (current.team() == window.team()
                    && current.targetRegion() == window.targetRegion()
                    && window.startSec() <= current.endSec() + ENTRY_MERGE_GAP_SEC) {
                final Set<Long> accounts = new LinkedHashSet<>(current.accountIds());
                accounts.addAll(window.accountIds());
                current = new ControlRegionEntryWindow(
                        Math.min(current.startSec(), window.startSec()),
                        Math.max(current.endSec(), window.endSec()),
                        current.team(),
                        List.copyOf(accounts),
                        current.targetRegion());
            } else {
                merged.add(current);
                current = window;
            }
        }
        if (current != null) {
            merged.add(current);
        }
        return List.copyOf(merged);
    }
}
