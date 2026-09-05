package com.wotb.web.replay.ai.eval;

import com.wotb.core.replay.evidence.TeamReviewEnvelope;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Deterministic quality checks for model output. This is deliberately test-scope:
 * it reports shortcut violations for the quality harness and does not create a
 * backend tactical verdict or change the production factual safety gate.
 */
public final class TeamQualityShortcutValidator {

    private static final Set<String> NON_SETTLEMENT_BASES = Set.of(
            "INFORMATION", "OBJECTIVE", "LOCAL_ENGAGEMENT", "POSITION", "TEMPO", "TEAM_EXECUTION");
    private static final Pattern SETTLEMENT_DIAGNOSIS = Pattern.compile(
            "(?i)(低伤害|伤害低|最高伤害|伤害最高|击杀最多|击杀少|0击杀|零击杀|最早阵亡|先阵亡|存活到最后|surviv|damage|kill|rank).{0,18}"
                    + "(问题|失败|失误|高贡献|mvp|关键|因此|说明|因为)");
    private static final Pattern DISTANCE_SHORTCUT = Pattern.compile(
            "(?i)(距离很远|离主力很远|远离主力|相距很远).{0,18}(脱节|掉队|失误|错误)");
    private static final Pattern ROLE_SHORTCUT = Pattern.compile(
            "(?i)(轻坦|中坦|重坦|坦克歼击车|自行反坦克炮|lt|mt|ht|td).{0,8}(必须|应该|只能).{0,8}(侦察|前排|抗线|后排|狙击|跟主团)");
    private static final Pattern VISION_SHORTCUT = Pattern.compile(
            "(?i)(没点亮|未点亮|没有点亮|标记消失|没了标记|消失的标记).{0,16}(没人|空路|敌人走了|敌人已离开)");
    private static final Pattern NUMERIC_PUSH_SHORTCUT = Pattern.compile("(?i)5\\s*(?:v|比)\\s*3.{0,16}(必须|一定要).{0,8}(推|进攻)");
    private static final Pattern DEATH_CLUSTER = Pattern.compile("(?i)(集中阵亡|连续阵亡|死亡集中|death cluster|多辆.{0,5}阵亡)");
    private static final Pattern STRUCTURAL_WORD = Pattern.compile(
            "(?i)(信息|点亮|位置|移动|轮转|节奏|局部|交火|侧翼|交叉火力|占点|目标|合流|支援|火力线|推进窗口|承诺|传播)");

    private TeamQualityShortcutValidator() {
    }

    public static List<Violation> validate(final TeamReviewEnvelope envelope) {
        if (envelope == null || envelope.primaryDiagnosis() == null) {
            return List.of(new Violation("PRIMARY_DIAGNOSIS_MISSING", "primaryDiagnosis is required"));
        }
        final TeamReviewEnvelope.PrimaryDiagnosis diagnosis = envelope.primaryDiagnosis();
        final Set<String> bases = new HashSet<>(diagnosis.evidenceBasis() == null
                ? List.of() : diagnosis.evidenceBasis());
        final List<Violation> violations = new ArrayList<>();
        if (bases.isEmpty()) {
            violations.add(new Violation("PRIMARY_DIAGNOSIS_NO_EVIDENCE_BASIS",
                    "primaryDiagnosis must declare a structural evidenceBasis"));
        }
        if (!bases.isEmpty() && bases.stream().noneMatch(NON_SETTLEMENT_BASES::contains)
                && SETTLEMENT_DIAGNOSIS.matcher(text(diagnosis.title()) + " " + text(diagnosis.reasoning())).find()) {
            violations.add(new Violation("SETTLEMENT_ONLY_DIAGNOSIS",
                    "settlement statistics cannot be the sole diagnosis basis"));
        }
        final String review = text(diagnosis.title()) + " " + text(diagnosis.reasoning()) + " "
                + text(envelope.reviewMarkdown());
        if (DISTANCE_SHORTCUT.matcher(review).find()) {
            violations.add(new Violation("DISTANCE_TO_DETACHED_SHORTCUT",
                    "distance alone cannot prove detachment"));
        }
        if (ROLE_SHORTCUT.matcher(review).find()) {
            violations.add(new Violation("VEHICLE_CLASS_ROLE_SHORTCUT",
                    "vehicle class alone cannot mandate a tactical role"));
        }
        if (VISION_SHORTCUT.matcher(review).find()) {
            violations.add(new Violation("VISION_ABSENCE_SHORTCUT",
                    "unseen or vanished markers cannot prove an empty lane or enemy departure"));
        }
        if (NUMERIC_PUSH_SHORTCUT.matcher(review).find()) {
            violations.add(new Violation("NUMERIC_PUSH_SHORTCUT",
                    "5v3 cannot become an automatic push order"));
        }
        if (DEATH_CLUSTER.matcher(review).find() && !STRUCTURAL_WORD.matcher(review).find()) {
            violations.add(new Violation("DEATH_CLUSTER_WITHOUT_CAUSE",
                    "death clustering needs an observable structural cause"));
        }
        final boolean individualJudgment = review.matches("(?s).*?(重点复查|高贡献者|关键威胁|high contributor|review focus|key threat).*?");
        if (individualJudgment && bases.stream().noneMatch(NON_SETTLEMENT_BASES::contains)
                && !STRUCTURAL_WORD.matcher(review).find()) {
            violations.add(new Violation("INDIVIDUAL_JUDGMENT_WITHOUT_STRUCTURE",
                    "individual tactical judgments need non-settlement evidence"));
        }
        return List.copyOf(violations);
    }

    public static boolean passes(final TeamReviewEnvelope envelope) {
        return validate(envelope).isEmpty();
    }

    private static String text(final String value) {
        return value == null ? "" : value.toLowerCase(Locale.ROOT);
    }

    public record Violation(String code, String message) {
    }
}
