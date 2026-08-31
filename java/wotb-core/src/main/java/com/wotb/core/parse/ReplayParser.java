package com.wotb.core.parse;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import org.springframework.util.StringUtils;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * 解析 .wotbreplay (= zip 包含 meta.json + battle_results.dat)。
 */
public final class ReplayParser {

    private static final ObjectMapper MAPPER = JsonMapper.builder().build();
    private static final int MEBIBYTE = 1024 * 1024;

    static final int MAX_ARCHIVE_BYTES = ReplayArchiveReader.MAX_ARCHIVE_BYTES;
    static final int MAX_META_JSON_BYTES = ReplayArchiveReader.MAX_META_JSON_BYTES;
    static final int MAX_BATTLE_RESULTS_BYTES = ReplayArchiveReader.MAX_BATTLE_RESULTS_BYTES;
    static final int MAX_DATA_WOTREPLAY_BYTES = ReplayArchiveReader.MAX_DATA_WOTREPLAY_BYTES;
    static final int MAX_TOTAL_UNCOMPRESSED_BYTES = ReplayArchiveReader.MAX_TOTAL_UNCOMPRESSED_BYTES;
    static final int MAX_PLAYERS_PER_REPLAY = 64;

    // PlayerResultsInfo (#301 -> #2) 简单 uint 字段: protobuf 字段号
    static final int F_ACCOUNT = 101, F_TEAM = 102, F_TANK = 103;
    static final int F_SHOTS = 4, F_HITS = 5, F_PENS = 7, F_DAMAGE = 8;
    static final int F_RECEIVED = 11, F_HITS_RECV = 12, F_PENS_RECV = 15;
    static final int F_ENEMIES_DMG = 17, F_KILLS = 18, F_BLOCKED = 117;
    static final int F_POINTS_EARNED = 32, F_POINTS_SEIZED = 33;
    static final int F_XP = 23, F_CREDITS = 106;
    static final int[] F_ASSIST = {9, 10};
    // PR147 settlement: 11.19 corpus 无 #104 deathTimeMillis。#105 = deathReason(-1=幸存 sentinel)；
    // #24 = lifeTime(秒)；#25 = killerID(result/entity-id namespace，#301 outer field1)。
    static final int F_DEATH_REASON = 105;      // deathReason: -1 = 幸存 sentinel; 其它/缺失 = 阵亡
    static final int F_LIFE_TIME = 24;          // lifeTime(秒): 阵亡=结算死亡秒; 幸存=整场时长
    static final int F_KILLER = 25;             // killer result/entity-id (非 accountId)
    static final int F_RESULT_ENTITY = 1;       // #301 outer field1 = result/entity id
    // 名册 PlayerInfo (#201 -> #2)
    static final int R_NICK = 1, R_PREBATTLE_GROUP = 2, R_CLAN = 5, R_RANK = 9;
    static final int R_TEAM = 3;                // 名册来源队伍（1/2；用于结算阵容完整性校验）

    private ReplayParser() {
    }

    /**
     * 只读 meta.json#arenaBonusType（模式预扫描用；不解析 battle_results.dat）。
     * 缺失/不可解析 → null。
     */
    public static Integer peekArenaBonusType(final byte[] replayBytes) throws IOException {
        final Map<String, byte[]> entries = ReplayArchiveReader.read(replayBytes);
        final byte[] metaBytes = entries.get("meta.json");
        if (metaBytes == null) {
            return null;
        }
        final JsonNode meta = MAPPER.readTree(metaBytes);
        if (meta == null || !meta.isObject() || !meta.hasNonNull("arenaBonusType")) {
            return null;
        }
        return meta.get("arenaBonusType").asInt();
    }

    public static Battle parse(final byte[] replayBytes) throws IOException {
        try {
            return parse(ParsedReplay.read(replayBytes));
        } catch (final IllegalArgumentException | IllegalStateException e) {
            throw new IOException("Invalid replay data: " + e.getMessage(), e);
        }
    }

    /** PR162/P0-2: 消费 canonical parse context（归档解压 + settlement 均只一次）。 */
    public static Battle parse(final ParsedReplay parsed) throws IOException {
        final Map<String, byte[]> entries = parsed.entries();
        // PR162/P1-4：meta.json 已由 ParsedReplay 一次解析，这里直接消费，不再各自 readTree。
        final JsonNode meta = parsed.meta();
        final String clientVersion = parsed.clientVersion();
        final SettlementFacts facts = parsed.settlementFacts();
        if (facts == null) {
            if (parsed.battleResultsDat() == null) {
                throw new IOException("Replay is missing battle_results.dat");
            }
            // 保留既有稳定错误契约：malformed settlement → "Invalid replay data: <cause>"。
            throw new IOException("Invalid replay data: " + parsed.settlementError());
        }
        final Object arenaId = facts.arenaId();
        final Map<Integer, List<Object>> root = facts.root();

        // ---- 名册 #201 ----
        final Map<Long, String[]> roster = new HashMap<>();   // acc -> [nickname, clan]
        final Map<Long, Long> prebattleGroupByAcc = new HashMap<>();
        final Map<Long, Long> rankByAcc = new HashMap<>();
        final Map<Long, Integer> rosterTeamByAcc = new HashMap<>();  // acc -> 名册队伍(#201→#2→#3)
        final List<Object> rosterEntries = root.getOrDefault(201, List.of());
        if (rosterEntries.size() > MAX_PLAYERS_PER_REPLAY) {
            throw new IOException("Replay roster exceeds player limit");
        }
        for (final Object praw : rosterEntries) {
            if (!(praw instanceof byte[] playerBytes)) {
                throw new IOException("Invalid battle protobuf: field 201 must be length-delimited");
            }
            final Map<Integer, List<Object>> p = Protobuf.decode(playerBytes);
            final long acc = Protobuf.firstLong(p, 1, 0);
            final Map<Integer, List<Object>> info = Protobuf.message(p, 2);
            roster.put(acc, new String[]{Protobuf.string(info, R_NICK), Protobuf.string(info, R_CLAN)});
            final Object team = Protobuf.first(info, R_TEAM);
            if (team instanceof Number) {
                rosterTeamByAcc.put(acc, ((Number) team).intValue());
            }
            final Object pl = Protobuf.first(info, R_PREBATTLE_GROUP);
            if (pl instanceof Number) {
                prebattleGroupByAcc.put(acc, ((Number) pl).longValue());
            }
            final Object rank = Protobuf.first(info, R_RANK);
            if (rank instanceof Number) {
                rankByAcc.put(acc, ((Number) rank).longValue());
            }
        }

        // ---- 战绩 #301 ----
        final List<PlayerResult> players = new ArrayList<>();
        final List<Object> resultEntries = root.getOrDefault(301, List.of());
        if (resultEntries.size() > MAX_PLAYERS_PER_REPLAY) {
            throw new IOException("Replay results exceed player limit");
        }
        // PR147: field25 killerID 与 #301 outer field1 用同一个 result/entity-id namespace；先收集
        // result/entity-id -> accountId，再回填 killerAccountId（killerID 绝非 accountId）。
        final Map<Long, Long> resultToAccount = new HashMap<>();
        // PR162/P0-2.1: 每个 #301 result 只 decode 一次为中间结构，随后 resultId 映射与 PlayerResult
        // 都从同一份 decoded structure 构建，避免重复 decode raw bytes。
        final List<DecodedResult> decodedResults = new ArrayList<>();
        for (final Object rraw : resultEntries) {
            if (!(rraw instanceof byte[] resultBytes)) {
                throw new IOException("Invalid battle protobuf: field 301 must be length-delimited");
            }
            final Map<Integer, List<Object>> r = Protobuf.decode(resultBytes);
            final Map<Integer, List<Object>> info = Protobuf.message(r, 2);
            final long resultEntityId = Protobuf.firstLong(r, F_RESULT_ENTITY, 0);
            final long accountId = Protobuf.firstLong(info, F_ACCOUNT, 0);
            if (resultEntityId > 0 && accountId > 0) {
                resultToAccount.put(resultEntityId, accountId);
            }
            decodedResults.add(new DecodedResult(r, info));
        }
        for (final DecodedResult decoded : decodedResults) {
            final Map<Integer, List<Object>> r = decoded.r();
            final Map<Integer, List<Object>> info = decoded.info();
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
            pr.victoryPointsEarned = (int) Protobuf.firstLong(info, F_POINTS_EARNED, 0);
            pr.victoryPointsSeized = (int) Protobuf.firstLong(info, F_POINTS_SEIZED, 0);
            pr.xp = (int) Protobuf.firstLong(info, F_XP, 0);
            pr.credits = (int) Protobuf.firstLong(info, F_CREDITS, 0);
            // PR147 settlement raw evidence (#24 lifeTime / #25 killer / #105 deathReason / outer field1).
            pr.settlementResultEntityId = Protobuf.firstLong(r, F_RESULT_ENTITY, 0);
            pr.settlementLifeTimeSec = Protobuf.firstLong(info, F_LIFE_TIME, 0);
            final Object killerRaw = Protobuf.first(info, F_KILLER);
            pr.settlementKillerResultEntityId =
                    killerRaw instanceof Number ? ((Number) killerRaw).longValue() : null;
            final Object deathReasonRaw = Protobuf.first(info, F_DEATH_REASON);
            pr.settlementDeathReasonRaw = deathReasonRaw instanceof Number
                    ? ((Number) deathReasonRaw).intValue() : null;
            // survived is derived from the proven settlement sentinel (== -1); NOT a survived field.
            // Settlement field semantics are structural facts and are not gated by the replay client
            // version. Missing/ordinary death reasons remain dead, while a missing lifetime remains
            // unknown time rather than a fabricated timestamp.
            pr.survived = pr.settlementDeathReasonRaw != null
                    && pr.settlementDeathReasonRaw == -1;
            final long lifeMs = pr.settlementLifeTimeSec > 0
                    ? Math.round(pr.settlementLifeTimeSec * 1000.0) : 0L;
            pr.deathTimeMillis = pr.survived ? 0L : lifeMs;
            pr.raw = info;
            players.add(pr);
        }
        // Map killer result/entity-id -> killer accountId (PR147 namespace). The mapping is a
        // structural settlement fact; an unknown client version does not disable it.
        for (final PlayerResult pr : players) {
            if (pr.settlementKillerResultEntityId != null) {
                final Long ka = resultToAccount.get(pr.settlementKillerResultEntityId);
                pr.killerAccountId = ka != null && ka > 0 ? ka : null;
            }
        }

        // 合并名册
        for (final PlayerResult pr : players) {
            final String[] info = roster.get(pr.accountId);
            pr.nickname = (info != null && StringUtils.hasText(info[0]))
                    ? info[0] : String.valueOf(pr.accountId);
            pr.clan = (info != null && info[1] != null) ? info[1] : "";
            pr.prebattleGroupId = prebattleGroupByAcc.get(pr.accountId);
            pr.rank = rankByAcc.get(pr.accountId);
        }

        final Battle battle = new Battle();
        battle.arenaId = String.valueOf(arenaId);
        final Object win = Protobuf.first(root, 3);
        battle.winnerTeam = (win instanceof Number) ? ((Number) win).intValue() : null;
        // PR147 settlement root facts (RAW preserved): root2=battle unix ts, root4=finishReason, root5=duration.
        battle.settlementStartTime = facts.battleStartTimestampSec();
        battle.settlementFinishReasonRaw = facts.finishReasonRaw();
        battle.settlementDurationSec = facts.settlementDurationSec();
        battle.version = text(meta, "version");
        battle.mapName = text(meta, "mapName");
        // Settlement duration/timestamp are the primary authority (root5/root2); meta only a fallback/cross-check.
        final Double metaDur = meta.hasNonNull("battleDuration") ? meta.get("battleDuration").asDouble() : null;
        battle.durationS = null;
        if (battle.settlementDurationSec != null && battle.settlementDurationSec > 0) {
            battle.durationS = Math.min(battle.settlementDurationSec, 420);
        } else if (metaDur != null) {
            battle.durationS = Math.min(metaDur, 420);
        }
        final Long metaStart = parseLong(text(meta, "battleStartTime"));
        battle.startTime = (battle.settlementStartTime != null && battle.settlementStartTime > 1388534400L)
                ? battle.settlementStartTime
                : (metaStart != null && metaStart > 1388534400L ? metaStart : null);
        battle.recorder = resolveRecorderNickname(text(meta, "playerName"), players);
        battle.recorderVehicle = text(meta, "playerVehicleName");
        battle.arenaBonusType = meta.hasNonNull("arenaBonusType") ? meta.get("arenaBonusType").asInt() : null;
        battle.players = players;
        // ---- 结算阵容完整性证据（严格全局契约 + League 专属证据分离）----
        // Battle.rosterComplete 保持严格 fail-closed 语义（#201 全集合 == #301 全集合 + 队伍一致），
        // 供 SURVIVOR_SETTLEMENT / annihilationSuffix / pointsEndReason 等「完整逐人结算」推断
        // 使用——#201 存在无法证明为 spectator 的 extra（如 #201=4/#301=3）时不得视为完整。
        // League Rating 对 non-combatant extra 的宽容（标准 7v7 且 #301 完整 14 人时 extra 不属于
        // 14 名 settled combatants，见 protocol.md）由 League 专属证据表达，LeagueRatingValidator
        // 判断，不扩大全局 rosterComplete 语义。
        battle.settlementAccountsCoveredByRoster =
                resolveSettlementCoveredByRoster(roster.keySet(), players);
        battle.settlementRosterTeamConsistent =
                resolveSettlementRosterTeamConsistent(rosterTeamByAcc, players);
        battle.rosterComplete = resolveRosterComplete(roster.keySet(), rosterTeamByAcc, players);

        // ---- data.wotreplay 事件流 ----
        // clientVersion 已在方法开头读取（header 内权威版本），这里仅回填到 Battle。
        // ReplayParser 之前基于 direct-damage 累计达到 settlement damageReceived 阈值来生成
        // PlayerResult.killVictims 的逻辑已移除：damageReceived 不是本局最大 HP，也不能证明 lethal
        // boundary / killer identity。击杀归因必须由 canonical terminal lifecycle + 可靠 damage backing
        // 产生；无法证明则 UNKNOWN。
        battle.clientVersion = clientVersion == null ? "" : clientVersion;

        // Compatibility projection for existing export/diagnostic consumers. Settlement remains authority.
        final double bd = battle.durationS != null ? battle.durationS : 0;
        for (final PlayerResult pr : players) {
            if (pr.survived) {
                pr.survivalTimeSec = bd;
            } else {
                final boolean settlementDeathAffirmed = Double.isFinite(pr.settlementLifeTimeSec)
                        && pr.settlementLifeTimeSec > 0;
                pr.survivalTimeSec = settlementDeathAffirmed
                        ? Math.min(pr.settlementLifeTimeSec, bd) : 0;
            }
        }


        return battle;
    }

    /**
     * 结算阵容完整性（<b>严格 fail-closed 全局契约</b>）：名册 #201 与战绩 #301 的账号集合
     * 完全一致（所有参战成员都有结算记录），且名册提供的队伍字段(#201→#2→#3)与结算队伍一致
     * （字段缺失时不做硬性要求）。#201 存在无法证明为 spectator 的 extra（如 #201=4/#301=3）
     * 时返回 false——League Rating 的 non-combatant extra 宽容不在此处实现，走
     * {@link #resolveSettlementCoveredByRoster} / {@link #resolveSettlementRosterTeamConsistent}
     * + LeagueRatingValidator。
     */
    private static boolean resolveRosterComplete(final Set<Long> rosterAccounts,
                                                 final Map<Long, Integer> rosterTeamByAcc,
                                                 final List<PlayerResult> players) {
        if (rosterAccounts.isEmpty() || players == null || players.isEmpty()) {
            return false;
        }
        final Set<Long> resultAccounts = players.stream()
                .map(p -> p.accountId)
                .collect(Collectors.toSet());
        if (!resultAccounts.equals(rosterAccounts)) {
            return false;
        }
        for (final PlayerResult p : players) {
            final Integer rosterTeam = rosterTeamByAcc.get(p.accountId);
            if (rosterTeam != null && rosterTeam.intValue() != p.team) {
                return false;
            }
        }
        return true;
    }

    /**
     * League 专属结算覆盖证据：战绩 #301 的每个结算账号都出现在名册 #201 中（无幽灵结算）。
     * #201 可含 non-combatant extra（标准 7v7 且 #301 完整 14 人时 extra 不属于 14 名
     * settled combatants），extra 不影响本结果；名册为空或结算为空时 fail-closed。
     */
    private static boolean resolveSettlementCoveredByRoster(final Set<Long> rosterAccounts,
                                                            final List<PlayerResult> players) {
        if (rosterAccounts.isEmpty() || players == null || players.isEmpty()) {
            return false;
        }
        for (final PlayerResult p : players) {
            if (!rosterAccounts.contains(p.accountId)) {
                return false;
            }
        }
        return true;
    }

    /**
     * League 专属队伍一致性证据：名册 #201→#2→#3 提供的队伍字段（存在时）与结算队伍一致。
     * 队伍字段缺失时不做硬性要求。
     */
    private static boolean resolveSettlementRosterTeamConsistent(
            final Map<Long, Integer> rosterTeamByAcc,
            final List<PlayerResult> players) {
        if (players == null || players.isEmpty()) {
            return false;
        }
        for (final PlayerResult p : players) {
            final Integer rosterTeam = rosterTeamByAcc.get(p.accountId);
            if (rosterTeam != null && rosterTeam.intValue() != p.team) {
                return false;
            }
        }
        return true;
    }

    /**
     * meta.json#playerName 在部分版本中是「军团-昵称」拼接（如 {@code "CHRD-A158布丁"}），
     * 而 roster 的 nickname 是纯昵称（如 {@code "A158布丁"}）。录像者身份只按玩家 nickname 解析：
     * 先精确匹配 roster 昵称；否则若唯一匹配「clan + 分隔符 + nickname」的常见形式则归一化为纯昵称；
     * 无法可靠归一化（无匹配或歧义）时保留原值，由调用方回退。
     */
    static String resolveRecorderNickname(final String metaPlayerName,
                                          final List<PlayerResult> players) {
        if (!StringUtils.hasText(metaPlayerName) || players == null || players.isEmpty()) {
            return metaPlayerName;
        }
        for (final PlayerResult player : players) {
            if (metaPlayerName.equals(player.nickname)) {
                return player.nickname;
            }
        }
        final Set<String> candidates = new LinkedHashSet<>();
        for (final PlayerResult player : players) {
            if (!StringUtils.hasText(player.clan) || !StringUtils.hasText(player.nickname)) {
                continue;
            }
            if (isClanPrefixedNickname(metaPlayerName, player)) {
                candidates.add(player.nickname);
            }
        }
        return candidates.size() == 1 ? candidates.iterator().next() : metaPlayerName;
    }

    private static boolean isClanPrefixedNickname(final String metaPlayerName,
                                                  final PlayerResult player) {
        final String clan = player.clan.trim();
        final String nickname = player.nickname;
        return metaPlayerName.equals(clan + "-" + nickname)
                || metaPlayerName.equals(clan + "_" + nickname)
                || metaPlayerName.equals("[" + clan + "]" + nickname)
                || metaPlayerName.equals(clan + " " + nickname);
    }

    private static String text(final JsonNode n, final String key) {
        return n.hasNonNull(key) ? n.get(key).asText() : "";
    }

    private static Long parseLong(final String s) {
        try {
            if (!StringUtils.hasText(s)) {
                return null;
            }
            return Long.parseLong(s.trim());
        } catch (final NumberFormatException e) {
            return null;
        }
    }

    /** PR162/P0-2.1：单条 #301 result 的一次解码结果（r=外层消息，info=#2 单场明细子消息）。 */
    private record DecodedResult(
            Map<Integer, List<Object>> r,
            Map<Integer, List<Object>> info
    ) {
    }
}
