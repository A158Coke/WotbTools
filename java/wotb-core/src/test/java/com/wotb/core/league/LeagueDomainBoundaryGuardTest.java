package com.wotb.core.league;

import com.wotb.core.model.Battle;
import com.wotb.core.model.Source;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 领域边界回归守卫（plan §24）：防止未来对 {@code league/**} 的改动再次让
 * LeagueFailure 改变 ReplayParseStatus / ProcessingJob.failed / valid /
 * NO_VALID_REPLAYS（§27 业务不变量）。
 *
 * <p>守卫断言的都是<b>数据不变量</b>而非实现细节：League validation failure 与
 * parser failure 分离、Battle ↔ Rating 按 identity 绑定、混合批次不污染 Parser。</p>
 */
class LeagueDomainBoundaryGuardTest {

    /** 按上传顺序返回指定 battle 的 loader（battle 由调用方构造；bytes 仅作索引）。 */
    private static LeagueReplays.LeagueCollectResult collectBattles(final List<Battle> battles) {
        final List<Source> sources = new ArrayList<>();
        for (int i = 0; i < battles.size(); i++) {
            sources.add(new Source("r" + (i + 1) + ".wotbreplay", new byte[]{(byte) i}));
        }
        return LeagueReplays.collect(sources, source -> battles.get(source.bytes()[0]), null, null);
    }

    private static Battle training(final String arenaId) {
        final Battle b = LeagueTestBattles.battle(1, LeagueTestBattles.defaultSevenVsSeven());
        b.arenaId = arenaId;
        return b;
    }

    /** §27 #3/#4/#7：LeagueFailure 不是 ReplayFailure——校验失败场 Battle 保留、不进 parser failures。 */
    @Test
    void leagueValidationFailureKeepsBattleOutOfParserFailures() {
        final Battle bad = training("222");
        bad.settlementAccountsCoveredByRoster = false; // LEAGUE_ROSTER_INCOMPLETE
        final LeagueReplays.LeagueCollectResult r = collectBattles(List.of(bad));

        assertEquals(1, r.battles().size(), "Rating-ineligible 场必须保留在 battles");
        assertTrue(r.failures().isEmpty(), "League validation failure 不得进入 parser failure 列表");
        assertEquals(1, r.leagueFailures().size());
        assertEquals(LeagueFailure.Code.ROSTER_INCOMPLETE, r.leagueFailures().getFirst().code());
        // 该场未评分（Rating 缺席）但 Battle 正常——battles 与 battleResults 数量可不等
        assertEquals(0, r.leagueBatch().battleResults().size());
    }

    /** §27 #9：Battle ↔ Rating 用稳定 identity，禁止数组位置绑定（ineligible 在前时结果仍指向 eligible）。 */
    @Test
    void battleRatingBindsByArenaIdentityNotPosition() {
        final Battle bad = training("222");
        bad.settlementAccountsCoveredByRoster = false;
        final Battle good = training("111");
        final LeagueReplays.LeagueCollectResult r = collectBattles(List.of(bad, good));

        assertEquals(2, r.battles().size());
        assertEquals("222", r.battles().getFirst().arenaId, "battles[0] 是 ineligible 场");
        assertEquals(1, r.leagueBatch().battleResults().size(), "Rating 只对 eligible 场计算");
        assertEquals("111", r.leagueBatch().battleResults().getFirst().arenaId(),
                "battleResults[0] 必须指向 eligible 场（111），不得按 index 对齐 battles[0]（222）");
        assertNull(r.leagueBatch().resultFor("222"), "ineligible 场 resultFor 必须为 null");
        assertNotNull(r.leagueBatch().resultFor("111"));
    }

    /** §21/Case I：混合批次不污染 Parser——battles 保留、无 parser failures、无 League 聚合。 */
    @Test
    void mixedBatchLeavesParserUnpolluted() {
        final Battle t = training("111");
        final Battle rand = training("999");
        rand.arenaBonusType = 1; // 普通随机战
        final LeagueReplays.LeagueCollectResult r = collectBattles(List.of(t, rand));

        assertEquals(LeagueRatingMode.MIXED_UNSUPPORTED, r.mode());
        assertEquals(2, r.battles().size(), "混合批次所有可解析 Battle 必须保留（禁止整体拒绝）");
        assertTrue(r.failures().isEmpty(), "混合批次无解析失败时不得产生 parser failure");
        assertTrue(r.leagueFailures().isEmpty());
        assertNull(r.leagueBatch(), "混合批次不产生 League Rating");
    }
}
