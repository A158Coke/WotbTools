package com.wotb.core.parse;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * 解析 .wotbreplay (= zip 包含 meta.json + battle_results.dat)。
 */
public final class ReplayParser {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    // PlayerResultsInfo (#301 -> #2) 简单 uint 字段: protobuf 字段号
    static final int F_ACCOUNT = 101, F_TEAM = 102, F_TANK = 103;
    static final int F_SHOTS = 4, F_HITS = 5, F_PENS = 7, F_DAMAGE = 8;
    static final int F_RECEIVED = 11, F_HITS_RECV = 12, F_PENS_RECV = 15;
    static final int F_ENEMIES_DMG = 17, F_KILLS = 18, F_BLOCKED = 117;
    static final int[] F_ASSIST = {9, 10};
    static final int F_SURVIVED = 105;          // == -1 表示存活
    static final int F_DEATH_TIME = 104;        // 死亡时刻(ms; 存活时=0)
    // 名册 PlayerInfo (#201 -> #2)
    static final int R_NICK = 1, R_PLATOON = 2, R_CLAN = 5;

    private ReplayParser() {
    }

    public static Battle parse(final byte[] replayBytes) throws IOException {
        return parse(unzip(replayBytes));
    }

    private static Battle parse(final Map<String, byte[]> entries) throws IOException {
        final JsonNode meta;
        if (entries.containsKey("meta.json")) {
            meta = MAPPER.readTree(entries.get("meta.json"));
        } else {
            meta = MAPPER.createObjectNode();
        }
        final byte[] dat = entries.get("battle_results.dat");
        if (dat == null) {
            throw new IOException("回放中没有 battle_results.dat (可能是不完整或加密的回放)");
        }

        final Object[] tuple = (Object[]) PickleReader.loads(dat);
        final Object arenaId = tuple[0];
        final byte[] pb = (byte[]) tuple[1];
        final Map<Integer, List<Object>> root = Protobuf.decode(pb);

        // ---- 名册 #201 ----
        final Map<Long, String[]> roster = new HashMap<>();   // acc -> [nickname, clan]
        final Map<Long, Long> platoonByAcc = new HashMap<>();
        for (final Object praw : root.getOrDefault(201, List.of())) {
            final Map<Integer, List<Object>> p = Protobuf.decode((byte[]) praw);
            final long acc = Protobuf.firstLong(p, 1, 0);
            final Map<Integer, List<Object>> info = Protobuf.message(p, 2);
            roster.put(acc, new String[]{Protobuf.string(info, R_NICK), Protobuf.string(info, R_CLAN)});
            final Object pl = Protobuf.first(info, R_PLATOON);
            if (pl instanceof Number) {
                platoonByAcc.put(acc, ((Number) pl).longValue());
            }
        }

        // ---- 战绩 #301 ----
        final List<PlayerResult> players = new ArrayList<>();
        for (final Object rraw : root.getOrDefault(301, List.of())) {
            final Map<Integer, List<Object>> r = Protobuf.decode((byte[]) rraw);
            final Map<Integer, List<Object>> info = Protobuf.message(r, 2);
            final PlayerResult pr = new PlayerResult();
            pr.accountId = Protobuf.firstLong(info, F_ACCOUNT, 0);
            pr.team = (int) Protobuf.firstLong(info, F_TEAM, 0);
            pr.tankId = Protobuf.firstLong(info, F_TANK, 0);
            pr.nShots = (int) Protobuf.firstLong(info, F_SHOTS, 0);
            pr.nHitsDealt = (int) Protobuf.firstLong(info, F_HITS, 0);
            pr.nPenetrationsDealt = (int) Protobuf.firstLong(info, F_PENS, 0);
            pr.damageDealt = (int) Protobuf.firstLong(info, F_DAMAGE, 0);
            int assist = 0;
            for (final int f : F_ASSIST) {
                assist += (int) Protobuf.firstLong(info, f, 0);
            }
            pr.damageAssisted = assist;
            pr.damageReceived = (int) Protobuf.firstLong(info, F_RECEIVED, 0);
            pr.nHitsReceived = (int) Protobuf.firstLong(info, F_HITS_RECV, 0);
            pr.nPenetrationsReceived = (int) Protobuf.firstLong(info, F_PENS_RECV, 0);
            pr.nEnemiesDamaged = (int) Protobuf.firstLong(info, F_ENEMIES_DMG, 0);
            pr.kills = (int) Protobuf.firstLong(info, F_KILLS, 0);
            pr.damageBlocked = (int) Protobuf.firstLong(info, F_BLOCKED, 0);
            final Object killer = Protobuf.first(info, F_SURVIVED);
            pr.survived = (killer instanceof Number) && ((Number) killer).longValue() == -1L;
            pr.deathTimeMillis = Protobuf.firstLong(info, F_DEATH_TIME, 0);
            pr.raw = info;
            players.add(pr);
        }

        // 合并名册
        for (final PlayerResult pr : players) {
            final String[] info = roster.get(pr.accountId);
            pr.nickname = (info != null && info[0] != null && !info[0].isEmpty())
                    ? info[0] : String.valueOf(pr.accountId);
            pr.clan = (info != null && info[1] != null) ? info[1] : "";
            pr.platoonId = platoonByAcc.get(pr.accountId);
        }

        final Battle battle = new Battle();
        battle.arenaId = String.valueOf(arenaId);
        final Object win = Protobuf.first(root, 3);
        battle.winnerTeam = (win instanceof Number) ? ((Number) win).intValue() : null;
        battle.version = text(meta, "version");
        battle.mapName = text(meta, "mapName");
        battle.durationS = meta.hasNonNull("battleDuration") ? Math.min(meta.get("battleDuration").asDouble(), 420) : null;
        battle.startTime = parseLong(text(meta, "battleStartTime"));
        battle.recorder = text(meta, "playerName");
        battle.recorderVehicle = text(meta, "playerVehicleName");
        battle.players = players;

        // ---- data.wotreplay 事件流 ----
        final byte[] eventData = entries.get("data.wotreplay");
        List<EventStreamReader.ParsedPacket> esPackets = List.of();
        if (eventData != null) {
            try {
                final EventStreamReader.EventStream es = EventStreamReader.read(eventData);
                battle.clientVersion = es.clientVersion;
                esPackets = es.packets;
            } catch (Exception ignored) {
            }
        }

        // 存活时间: 存活=战斗时长, 阵亡=3 层 fallback
        final double bd = battle.durationS != null ? battle.durationS : 0;
        Map<Long, Double> deathTimesByEntityLeave = Map.of();
        Map<Long, Double> deathTimesByPosition = Map.of();
        if (!esPackets.isEmpty()) {
            deathTimesByEntityLeave = EventStreamReader.estimateDeathTimesByEntityLeaves(esPackets, bd);
            deathTimesByPosition = EventStreamReader.estimateDeathTimesByPositions(esPackets, bd);
        }
        for (final PlayerResult pr : players) {
            if (pr.survived) {
                pr.survivalTimeSec = bd;
            } else {
                double st = pr.deathTimeMillis / 1000.0;
                if (st <= 0) {
                    final double el = deathTimesByEntityLeave.getOrDefault(pr.accountId, 0.0);
                    final double pos = deathTimesByPosition.getOrDefault(pr.accountId, 0.0);
                    // EntityLeave 常出现假阳性(临时离场而非阵亡), 若 Position 数据显著晚于
                    // EntityLeave 且 >0, 取 Position 作为更可靠的死亡时间
                    if (el > 0 && pos > 0 && pos > el + 5.0) {
                        st = pos;
                    } else if (el > 0) {
                        st = el;
                    } else {
                        st = pos;
                    }
                }
                pr.survivalTimeSec = st > 0 ? Math.min(st, bd) : 0;
            }
        }

        return battle;
    }

    private static String text(final JsonNode n, final String key) {
        return n.hasNonNull(key) ? n.get(key).asText() : "";
    }

    private static Long parseLong(final String s) {
        try {
            return s == null || s.isEmpty() ? null : Long.parseLong(s.trim());
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static Map<String, byte[]> unzip(final byte[] data) throws IOException {
        final Map<String, byte[]> out = new HashMap<>();
        try (ZipInputStream zis = new ZipInputStream(new java.io.ByteArrayInputStream(data))) {
            ZipEntry e;
            final byte[] tmp = new byte[8192];
            while ((e = zis.getNextEntry()) != null) {
                final ByteArrayOutputStream bos = new ByteArrayOutputStream();
                int read;
                while ((read = zis.read(tmp)) != -1) {
                    bos.write(tmp, 0, read);
                }
                out.put(e.getName(), bos.toByteArray());
            }
        }
        return out;
    }
}
