package com.wotb.web.replay.ai;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.model.Source;
import com.wotb.core.ref.ReplayDisplayNames;
import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.HealthChangedEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.processing.DefaultReplayProcessingFacade;
import com.wotb.core.replay.processing.ReplayProcessingOptions;
import com.wotb.core.replay.processing.ReplayProcessingResult;
import com.wotb.core.replay.processing.TeamEntityMapper;
import com.wotb.core.replay.processing.TeamEntityMapping;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/**
 * 真实回放 HP probe（可重复运行，无样本自动跳过）：
 * 对每辆可映射车辆输出 propId=3 全部 positive 采样、max/首个采样、首个观测受击时间，
 * 判断「整场最大 currentHp」能否被证明为「实际进场满血量（含装备/物资加成）」。
 *
 * <p><b>证明边界</b>：本 probe 里的 first observed DamageEvent（及其缺席）只能帮助
 * <b>证伪</b>「whole-battle max current HP == entry HP」——真实样本显示绝大多数车辆首个
 * positive 样本与首次观测受击同刻且低于 tankopedia base。它<b>不能独立证明</b>
 * 「sample before first observed DamageEvent == authoritative initial full HP」：
 * 事件流伤害覆盖可能 PARTIAL（OBSERVED_DAMAGE_IS_PARTIAL，缺伤害 ≠ 没发生伤害），
 * entry HP 的 OBSERVED_EXACT 判定必须另行结合受击覆盖完整性（见 ObservedMaxHp）。</p>
 */
class EntryHpProbeTest {

    private static final List<String> SAMPLES = List.of(
            "fixtures/replays/random-battle-example.wotbreplay",
            "data/20260725_1535__CHRD-A158布丁_A178_SPHT_9036183479040937(2).wotbreplay",
            "data/20260725_1600__CHRD-A158布丁_A178_SPHT_9034890693886323.wotbreplay",
            "data/20260725_1555__CHRD-A158布丁_A178_SPHT_12142703259467849.wotbreplay",
            "data/20260725_1604__CHRD-A158布丁_A178_SPHT_12142600180253313.wotbreplay",
            "data/20260808_1608__CHRD-A158布丁_Maus_13102443767740493.wotbreplay",
            "data/test/test.wotbreplay");

    @Test
    void probeEntryHpEvidenceAcrossRealSamples() throws Exception {
        final Path common = Path.of(System.getProperty("user.dir"), "..", "..", "common");
        int analyzed = 0;
        for (final String rel : SAMPLES) {
            final Path file = common.resolve(rel);
            if (!Files.exists(file)) {
                System.out.println("\n===== SKIP（样本缺失）: " + rel);
                continue;
            }
            final byte[] bytes = Files.readAllBytes(file);
            final ReplayProcessingResult result;
            try {
                result = new DefaultReplayProcessingFacade().process(
                        new Source(file.getFileName().toString(), bytes), ReplayProcessingOptions.full());
            } catch (final Exception e) {
                System.out.println("\n===== PARSE_FAIL " + rel + " : " + e.getMessage());
                continue;
            }
            final Battle battle = result.battle();
            final ReplayReconstruction recon = result.reconstruction();
            if (battle == null || battle.players == null || recon == null || recon.events() == null) {
                System.out.println("\n===== NO_DATA " + rel);
                continue;
            }
            analyzed++;
            System.out.println("\n==================================================================");
            System.out.println("===== 样本: " + rel);
            System.out.println("map=" + battle.mapName + " arenaBonusType=" + battle.arenaBonusType
                    + " recorder=" + battle.recorder + " players=" + battle.players.size()
                    + " events=" + recon.events().size() + " battleStart=" + recon.battleStartRawClockSec());
            final TeamEntityMapping mapping = TeamEntityMapper.resolve(battle, recon);
            final List<PlayerResult> players = new ArrayList<>(battle.players);
            players.sort(Comparator.comparingInt((PlayerResult p) -> p.team).thenComparingLong(p -> p.accountId));
            for (final PlayerResult p : players) {
                probePlayer(battle, recon, mapping, p);
            }
        }
        System.out.println("\n===== 汇总: 成功解析样本数=" + analyzed + " / " + SAMPLES.size());
    }

    private static void probePlayer(final Battle battle, final ReplayReconstruction recon,
                                    final TeamEntityMapping mapping, final PlayerResult p) {
        final long accountId = p.accountId;
        final Integer base = ReplayDisplayNames.tankMaxHpValue(p.tankId);
        final Float battleStart = recon.battleStartRawClockSec();
        // 全部 positive HP 采样（EXACT & plausible，battle-relative 秒升序）
        final List<double[]> hpSamples = new ArrayList<>();
        if (recon.events() != null) {
            for (final ReplayEvent event : recon.events()) {
                if (!(event instanceof HealthChangedEvent hp)
                        || hp.confidence() != DecodeConfidence.EXACT
                        || hp.currentHealth() == null
                        || !HealthChangedEvent.isPlausibleHp(hp.currentHealth())) {
                    continue;
                }
                final var identity = mapping.identity(hp.entityId());
                if (identity == null || identity.accountId() != accountId) {
                    continue;
                }
                hpSamples.add(new double[]{relSec(event, battleStart), hp.currentHealth()});
            }
        }
        hpSamples.sort(Comparator.comparingDouble(a -> a[0]));
        // 首个受击时间（battle-relative；解析不到的受害者跳过）
        Double firstDamageSec = null;
        if (recon.events() != null) {
            final var damageMapping = DamageEventIdentityResolver.mapping(battle, recon);
            for (final ReplayEvent event : recon.events()) {
                if (event instanceof DamageEvent d && d.damage() > 0
                        && DamageEventIdentityResolver.victimAccount(d, damageMapping) == accountId) {
                    final double t = relSec(event, battleStart);
                    if (firstDamageSec == null || t < firstDamageSec) {
                        firstDamageSec = t;
                    }
                }
            }
        }
        double maxObserved = 0;
        double[] first = null;
        for (final double[] s : hpSamples) {
            maxObserved = Math.max(maxObserved, s[1]);
            if (first == null) {
                first = s;
            }
        }
        final Double firstDamage = firstDamageSec;
        final double maxHp = maxObserved;
        final boolean maxBeforeFirstDamage = firstDamage == null
                || hpSamples.stream().anyMatch(s -> s[0] <= firstDamage + 1e-6 && s[1] >= maxHp - 1e-6);
        // 「能证明 initial/full」的候选：存在采样在首次受击之前（或从未受击）且该采样 >= base 且后续不再升高
        final boolean initialCandidate = firstDamage == null
                || hpSamples.stream().anyMatch(s -> s[0] <= firstDamage + 1e-6);
        final StringBuilder sb = new StringBuilder(512);
        sb.append("\n  accountId=").append(accountId)
                .append(" tankId=").append(p.tankId)
                .append(" tank=").append(ReplayDisplayNames.tankName(p.tankId, p.tankName))
                .append(" team=").append(p.team)
                .append(" baseHp=").append(base == null ? "null" : base)
                .append(" survived=").append(p.survived)
                .append(" deathSec=").append(p.deathTimeMillis > 0
                        ? p.deathTimeMillis / 1000.0 : "null");
        sb.append("\n    hpSamples(").append(hpSamples.size()).append("):");
        for (final double[] s : hpSamples) {
            sb.append(" [").append(String.format("%.1f", s[0])).append("s,").append((int) s[1]).append("]");
        }
        sb.append("\n    maxObserved=").append((int) maxObserved)
                .append(" firstSample=").append(first == null ? "none"
                        : "[" + String.format("%.1f", first[0]) + "s," + (int) first[1] + "]")
                .append(" firstDamageSec=").append(firstDamageSec == null ? "none" : String.format("%.1f", firstDamageSec))
                .append(" maxSampleBeforeFirstDamage=").append(maxBeforeFirstDamage)
                .append(" anySampleBeforeFirstDamage=").append(initialCandidate)
                .append(" base<=maxObserved=").append(base != null && maxObserved >= base);
        System.out.println(sb);
    }

    private static double relSec(final ReplayEvent e, final Float battleStart) {
        if (e.timestamp() == null) {
            return 0;
        }
        final Float battle = e.timestamp().battleClockSec();
        if (battle != null) {
            return battle;
        }
        if (battleStart != null && Float.isFinite(battleStart)) {
            return e.timestamp().rawClockSec() - battleStart;
        }
        return e.timestamp().rawClockSec();
    }
}
