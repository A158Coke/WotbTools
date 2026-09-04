package com.wotb.core.model;

import org.springframework.util.StringUtils;

import java.util.List;

/** 一场战斗的基本信息 + 全部玩家战绩。 */
public class Battle {
    public String arenaId;
    public Integer winnerTeam;
    /** 模式类型 (meta.json#arenaBonusType): 1=随机战斗; 2=训练房; 其他=娱乐/联赛等; null=未知。 */
    public Integer arenaBonusType;
    public String version = "";
    public String mapName = "";
    public Double durationS;
    public Long startTime;

    // ---- PR147 settlement 顶层事实（battle_results.dat root；RAW，保留原始值）----
    /** root2 = battle Unix timestamp（秒）；缺失=null。 */
    public Long settlementStartTime;
    /** root4 = finishReason 原始值；缺失=null。未证明语义保持 raw。 */
    public Integer settlementFinishReasonRaw;
    /** root5 = settlement battle duration（秒）；缺失=null。 */
    public Double settlementDurationSec;
    public String recorder = "";
    public String recorderVehicle = "";
    public String clientVersion = "";
    public List<PlayerResult> players;

    /**
     * 结算阵容完整性证据（ReplayParser 设置，<b>严格 fail-closed 全局契约</b>）：
     * 名册(#201) 与战绩(#301) 的账号集合完全一致（所有参战成员都有结算记录），且名册提供的
     * 队伍字段(#201→#2→#3)与结算队伍一致（存在时）。null/false 表示未知或不完整
     * （非回放解析路径或数据缺失）。
     *
     * <p>它是 SURVIVOR_SETTLEMENT / annihilationSuffix / pointsEndReason 等「完整逐人结算」
     * 推断的 fail-closed 前提——#201 存在无法证明为 spectator 的 extra（如 #201=4 / #301=3）
     * 时不得视为完整。只有为 true 时，才能用 survivors==0 断言全歼或推导
     * SURVIVOR_SETTLEMENT。</p>
     *
     * <p>League Rating 以 #301 的 14 settled combatants 为 authority；#201 只用于
     * nickname/clan/rank/prebattle metadata enrichment，缺失/extra 不得阻塞 Rating。</p>
     */
    public Boolean rosterComplete;

    public int nPlayers() {
        return players == null ? 0 : players.size();
    }

    /**
     * 录像者本人的战绩。meta 无录像者 accountId, 故按 {@link #recorder} 昵称在 {@link #players} 中匹配。
     * 无录像者名 / 无名册 / 匹配不到时返回 null。
     */
    public PlayerResult recorderResult() {
        if (!StringUtils.hasText(recorder) || players == null) {
            return null;
        }
        for (final PlayerResult p : players) {
            if (recorder.equals(p.nickname)) {
                return p;
            }
        }
        return null;
    }
}
