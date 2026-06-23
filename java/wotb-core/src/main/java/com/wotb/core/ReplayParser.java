package com.wotb.core;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
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
    static final int F_XP = 23, F_CREDITS = 106;
    static final int[] F_ASSIST = {9, 10};
    static final int F_SURVIVED = 105;          // == -1 表示存活
    // 名册 PlayerInfo (#201 -> #2)
    static final int R_NICK = 1, R_PLATOON = 2, R_TEAM = 3, R_CLAN = 5;

    private ReplayParser() {
    }

    public static Battle parse(Path path) throws IOException {
        Map<String, byte[]> entries = unzip(Files.readAllBytes(path));
        return parse(entries);
    }

    public static Battle parse(byte[] replayBytes) throws IOException {
        return parse(unzip(replayBytes));
    }

    private static Battle parse(Map<String, byte[]> entries) throws IOException {
        JsonNode meta = MAPPER.createObjectNode();
        if (entries.containsKey("meta.json")) {
            meta = MAPPER.readTree(entries.get("meta.json"));
        }
        byte[] dat = entries.get("battle_results.dat");
        if (dat == null) {
            throw new IOException("回放中没有 battle_results.dat (可能是不完整或加密的回放)");
        }

        Object[] tuple = (Object[]) PickleReader.loads(dat);
        Object arenaId = tuple[0];
        byte[] pb = (byte[]) tuple[1];
        Map<Integer, List<Object>> root = Protobuf.decode(pb);

        // ---- 名册 #201 ----
        Map<Long, String[]> roster = new HashMap<>();   // acc -> [nickname, clan]
        Map<Long, Long> platoonByAcc = new HashMap<>();
        for (Object praw : root.getOrDefault(201, List.of())) {
            Map<Integer, List<Object>> p = Protobuf.decode((byte[]) praw);
            long acc = Protobuf.firstLong(p, 1, 0);
            Map<Integer, List<Object>> info = Protobuf.message(p, 2);
            roster.put(acc, new String[]{Protobuf.string(info, R_NICK), Protobuf.string(info, R_CLAN)});
            Object pl = Protobuf.first(info, R_PLATOON);
            if (pl instanceof Number) {
                platoonByAcc.put(acc, ((Number) pl).longValue());
            }
        }

        // ---- 战绩 #301 ----
        List<PlayerResult> players = new ArrayList<>();
        for (Object rraw : root.getOrDefault(301, List.of())) {
            Map<Integer, List<Object>> r = Protobuf.decode((byte[]) rraw);
            Map<Integer, List<Object>> info = Protobuf.message(r, 2);
            PlayerResult pr = new PlayerResult();
            pr.accountId = Protobuf.firstLong(info, F_ACCOUNT, 0);
            pr.team = (int) Protobuf.firstLong(info, F_TEAM, 0);
            pr.tankId = Protobuf.firstLong(info, F_TANK, 0);
            pr.nShots = (int) Protobuf.firstLong(info, F_SHOTS, 0);
            pr.nHitsDealt = (int) Protobuf.firstLong(info, F_HITS, 0);
            pr.nPenetrationsDealt = (int) Protobuf.firstLong(info, F_PENS, 0);
            pr.damageDealt = (int) Protobuf.firstLong(info, F_DAMAGE, 0);
            int assist = 0;
            for (int f : F_ASSIST) {
                assist += (int) Protobuf.firstLong(info, f, 0);
            }
            pr.damageAssisted = assist;
            pr.damageReceived = (int) Protobuf.firstLong(info, F_RECEIVED, 0);
            pr.nHitsReceived = (int) Protobuf.firstLong(info, F_HITS_RECV, 0);
            pr.nPenetrationsReceived = (int) Protobuf.firstLong(info, F_PENS_RECV, 0);
            pr.nEnemiesDamaged = (int) Protobuf.firstLong(info, F_ENEMIES_DMG, 0);
            pr.kills = (int) Protobuf.firstLong(info, F_KILLS, 0);
            pr.damageBlocked = (int) Protobuf.firstLong(info, F_BLOCKED, 0);
            pr.xp = (int) Protobuf.firstLong(info, F_XP, 0);
            pr.credits = (int) Protobuf.firstLong(info, F_CREDITS, 0);
            Object killer = Protobuf.first(info, F_SURVIVED);
            pr.survived = (killer instanceof Number) && ((Number) killer).longValue() == -1L;
            pr.raw = info;
            players.add(pr);
        }

        // 合并名册
        for (PlayerResult pr : players) {
            String[] info = roster.get(pr.accountId);
            pr.nickname = (info != null && info[0] != null && !info[0].isEmpty())
                    ? info[0] : String.valueOf(pr.accountId);
            pr.clan = (info != null && info[1] != null) ? info[1] : "";
            pr.platoonId = platoonByAcc.get(pr.accountId);
        }

        Battle battle = new Battle();
        battle.arenaId = String.valueOf(arenaId);
        Object win = Protobuf.first(root, 3);
        battle.winnerTeam = (win instanceof Number) ? ((Number) win).intValue() : null;
        battle.modeMapId = (Long) Protobuf.first(root, 1) instanceof Long
                ? (Long) Protobuf.first(root, 1) : null;
        battle.version = text(meta, "version");
        battle.mapName = text(meta, "mapName");
        battle.mapId = meta.hasNonNull("mapId") ? meta.get("mapId").asInt() : "";
        battle.durationS = meta.hasNonNull("battleDuration") ? meta.get("battleDuration").asDouble() : null;
        battle.startTime = parseLong(text(meta, "battleStartTime"));
        battle.recorder = text(meta, "playerName");
        battle.recorderVehicle = text(meta, "playerVehicleName");
        battle.players = players;
        return battle;
    }

    private static String text(JsonNode n, String key) {
        return n.hasNonNull(key) ? n.get(key).asText() : "";
    }

    private static Long parseLong(String s) {
        try {
            return s == null || s.isEmpty() ? null : Long.parseLong(s.trim());
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static Map<String, byte[]> unzip(byte[] data) throws IOException {
        Map<String, byte[]> out = new HashMap<>();
        try (ZipInputStream zis = new ZipInputStream(new java.io.ByteArrayInputStream(data))) {
            ZipEntry e;
            byte[] tmp = new byte[8192];
            while ((e = zis.getNextEntry()) != null) {
                ByteArrayOutputStream bos = new ByteArrayOutputStream();
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
