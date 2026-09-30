package com.wotb.web.replay.ai.eval;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Cheap report-only gold preflight. It reports lexical hits/misses for the
 * human benchmark report; it is not a semantic tactical judge.
 */
public final class TeamQualityGoldEvaluator {

    private static final Map<String, Pattern> NOTICE_RULES = rules(
            "separate_flank_local", "(?i)(侧翼|flank|局部)",
            "flank_released_enemy", "(?i)(释放|解放|脱离|release|free)",
            "released_enemy_affected_main_group", "(?i)(主力|主团|main|cross-local|交叉)",
            "apparent_duel_not_closed", "(?i)(未收掉|未结束|没有结束|not closed)",
            "external_fire_affected_local", "(?i)(外部火力|侧射|交叉火力|external fire|crossfire)",
            "tracking_created_kill_condition", "(?i)(履带|定身|锁住|tracking|fix)",
            "role_transition", "(?i)(角色转|角色变化|转为|transition)",
            "push_entered", "(?i)(推进|推入|进入推进|push)",
            "push_stalled", "(?i)(停滞|卡住|推进受阻|stalled)",
            "no_successful_disengage", "(?i)(未能撤|无法撤|没有脱离|disengage)",
            "stable_enemy_farm_followed", "(?i)(持续火力|持续输出|输出窗口|farm)",
            "last_known_unresolved", "(?i)(最后已知|LAST[_ -]?KNOWN|未确认|未知)",
            "movement_without_safety_confirmation", "(?i)(进入|移动).{0,20}(安全|确认)",
            "opening_enemy_allocation", "(?i)(开局|opening).{0,25}(分配|配置|allocation|主力)",
            "unresolved_enemy_capacity_decreased", "(?i)(未确认|剩余|容量|capacity).{0,25}(减少|下降|decreased)",
            "friendly_local_numbers_supported_attack", "(?i)(本方|友方|friendly).{0,25}(人数|兵力|numbers).{0,25}(支持|attack|进攻)",
            "proactive_objective_attack", "(?i)(主动|proactive).{0,25}(目标|占点|objective|攻击|进攻)",
            "points_changed_initiative", "(?i)(点数|积分|points).{0,25}(主动权|必须行动|initiative)",
            "bases_changed_initiative", "(?i)(基地|占点|bases).{0,25}(主动权|必须行动|initiative)",
            "numerical_advantage_requires_context", "(?i)(人数优势|数量优势|numerical advantage).{0,30}(位置|时间|点数|context|条件)");

    private static final Map<String, Pattern> MUST_NOT_RULES = rules(
            "death_cluster_as_root_cause", "(?i)(集中阵亡|连续阵亡|死亡集中|death cluster).{0,20}(根因|主要问题|root cause)",
            "damage_only_high_contributor", "(?i)(最高伤害|伤害最高|high damage).{0,20}(高贡献|贡献最大|high contributor)",
            "opening_1_for_1_primary_failure", "(?i)(1\s*[-:]?\s*1|一换一).{0,25}(主要问题|首要失败|primary failure)",
            "death_alone_as_diagnosis", "(?i)(阵亡|死亡|death).{0,20}(因此|所以|说明).{0,20}(问题|失败|诊断)",
            "empty_lane_certainty", "(?i)(这条路|该路线|lane).{0,15}(没人|空路|敌人已离开|empty|left)",
            "reactive_retake_only", "(?i)(只是|仅仅|only).{0,15}(被动|反应|夺回|retake)",
            "automatic_push_rule", "(?i)5\s*(?:v|比)\s*3.{0,16}(必须|一定要|must).{0,8}(推|进攻|push)");

    private TeamQualityGoldEvaluator() {
    }

    public static Evaluation evaluate(final TeamReplayQualityCase qualityCase, final String review) {
        final String text = review == null ? "" : review.toLowerCase(Locale.ROOT);
        final List<String> hits = new ArrayList<>();
        final List<String> misses = new ArrayList<>();
        for (final String requirement : qualityCase.mustNotice()) {
            final Pattern pattern = NOTICE_RULES.get(requirement);
            if (pattern != null && pattern.matcher(text).find()) {
                hits.add(requirement);
            } else {
                misses.add(requirement);
            }
        }
        final List<String> violations = new ArrayList<>();
        for (final String requirement : qualityCase.mustNot()) {
            final Pattern pattern = MUST_NOT_RULES.get(requirement);
            if (pattern != null && pattern.matcher(text).find()) {
                violations.add(requirement);
            }
        }
        return new Evaluation(hits, misses, violations);
    }

    private static Map<String, Pattern> rules(final String... entries) {
        final Map<String, Pattern> rules = new LinkedHashMap<>();
        for (int i = 0; i < entries.length; i += 2) {
            rules.put(entries[i], Pattern.compile(entries[i + 1]));
        }
        return Map.copyOf(rules);
    }

    public record Evaluation(List<String> mustNoticeHits,
                             List<String> mustNoticeMisses,
                             List<String> mustNotViolations) {
        public Evaluation {
            mustNoticeHits = mustNoticeHits == null ? List.of() : List.copyOf(mustNoticeHits);
            mustNoticeMisses = mustNoticeMisses == null ? List.of() : List.copyOf(mustNoticeMisses);
            mustNotViolations = mustNotViolations == null ? List.of() : List.copyOf(mustNotViolations);
        }
    }
}
