package com.wotb.web.replay.ai;

import com.wotb.core.model.Battle;
import com.wotb.core.replay.processing.PlayerSideResolver;
import com.wotb.core.replay.evidence.EnemyLastKnownPositionResolver;
import com.wotb.core.replay.evidence.EnemyLastKnownPositionResolver.EnemyLastKnownPosition;
import com.wotb.core.replay.evidence.EnemyLastKnownPositionResolver.EnemyLastKnownPositionResult;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.util.PlayerResultFormat;

import java.util.Locale;

/**
 * 敌方最后已知位置 prompt 段渲染（观测子集）。
 * <p>团队复盘（single）与随机战（harness / fallback / 完整特征）共用同一个核心
 * {@link EnemyLastKnownPositionResolver}，本类只区分行风格：随机战行以「敌方」开头
 * （第二人称语境，不出现「录像者」），团队行沿用 OPPOSING_TEAM_LINEUP 的 opponent
 * 机器键风格。段头明确标注「观测子集」，禁止把观察子集伪装成全知；时间一律
 * X分XX秒，不出现裸秒数；不输出 raw team 编号。</p>
 */
final class EnemyLastKnownPositionsSection {

    private EnemyLastKnownPositionsSection() {
    }

    /**
     * 随机战路径（敌方 = 非录像者队伍）。
     *
     * @return 无内容（无重建/无 OBSERVED 敌方/视角未解析）时返回空串，调用方自行处理换行
     */
    static String renderPlayerSection(final Battle battle, final ReplayReconstruction recon) {
        final Integer recorderTeam = PlayerSideResolver.resolveRecorderTeam(battle);
        if (recorderTeam == null) {
            return "";
        }
        return render(EnemyLastKnownPositionResolver.resolve(recon, battle, recorderTeam), false);
    }

    /**
     * 团队复盘路径（敌方 = 非 perspectiveTeam）。
     *
     * @return 无内容时返回空串
     */
    static String renderTeamSection(final ReplayReconstruction recon, final Battle battle,
                                    final int perspectiveTeam) {
        return render(EnemyLastKnownPositionResolver.resolve(recon, battle, perspectiveTeam), true);
    }

    private static String render(final EnemyLastKnownPositionResult result, final boolean teamStyle) {
        if (result == null || result.vehicles().isEmpty()) {
            return "";
        }
        final StringBuilder sb = new StringBuilder(512);
        sb.append("=== ENEMY_LAST_KNOWN_POSITIONS_OBSERVED（敌方最后已知位置·观测子集） ===\n");
        sb.append("注意: 以下为回放中实际观测到的敌方最后已知位置（观测子集，非全知视野）；")
                .append("敌方当前真实位置可能已变化，不得当作当前精确位置。\n");
        sb.append("observedCount=").append(result.observedCount())
                .append(" totalCount=").append(result.totalCount())
                .append(" confidence=")
                .append(PlayerAnalysisTerms.confidenceLabel(result.confidence()))
                .append('\n');
        for (final EnemyLastKnownPosition vehicle : result.vehicles()) {
            if (teamStyle) {
                appendTeamRow(sb, vehicle);
            } else {
                appendPlayerRow(sb, vehicle);
            }
        }
        return sb.toString();
    }

    /** 随机战行：以「敌方」标识，无 OBSERVED 记录时显式 UNKNOWN。 */
    private static void appendPlayerRow(final StringBuilder sb, final EnemyLastKnownPosition v) {
        sb.append("敌方 ").append(PlayerResultFormat.quoteForPrompt(v.nickname()))
                .append(" 坦克: ").append(PlayerResultFormat.quoteForPrompt(v.tankName()));
        if (v.unknown()) {
            sb.append(" 最后已知位置: UNKNOWN（未观察到该车位置记录）\n");
            return;
        }
        sb.append(" 最后已知位置: ").append(v.region() > 0 ? v.region() + "区" : "未知区域")
                .append(" 距你方主力质心: ").append(v.distanceMeters() != null
                        ? format(v.distanceMeters()) + "m" : "UNKNOWN")
                .append(" 最后观察时间: ").append(v.lastObservedBattleSec() != null
                        ? PlayerAnalysisTerms.battleClock(v.lastObservedBattleSec()) : "UNKNOWN")
                .append('\n');
    }

    /** 团队行：与 OPPOSING_TEAM_LINEUP 相同的 opponent 机器键风格。 */
    private static void appendTeamRow(final StringBuilder sb, final EnemyLastKnownPosition v) {
        sb.append("opponent accountId=").append(v.accountId())
                .append(" nickname=").append(PlayerResultFormat.quoteForPrompt(v.nickname()))
                .append(" tank=").append(PlayerResultFormat.quoteForPrompt(v.tankName()));
        if (v.unknown()) {
            sb.append(" lastKnownPosition=UNKNOWN\n");
            return;
        }
        sb.append(" region=").append(v.region() > 0 ? String.valueOf(v.region()) : "UNKNOWN")
                .append(" distanceMeters=").append(v.distanceMeters() != null
                        ? format(v.distanceMeters()) : "UNKNOWN")
                .append(" lastObserved=").append(v.lastObservedBattleSec() != null
                        ? PlayerAnalysisTerms.battleClock(v.lastObservedBattleSec()) : "UNKNOWN")
                .append('\n');
    }

    private static String format(final float value) {
        return String.format(Locale.ROOT, "%.1f", value);
    }
}
