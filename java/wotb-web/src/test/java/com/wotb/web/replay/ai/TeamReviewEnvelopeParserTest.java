package com.wotb.web.replay.ai;

import com.wotb.core.replay.evidence.TeamReviewEnvelope;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Natural Coach 轮：Team Call #2 structured JSON envelope 解析契约。
 * <p>容忍 markdown 代码围栏与前后说明文字；契约不成立（缺 reviewMarkdown /
 * primaryDiagnosis 缺 title 或 reasoning / claims 非数组）时返回 null → 编排层触发重写。</p>
 */
class TeamReviewEnvelopeParserTest {

    private static final String VALID = "{"
            + "\"primaryDiagnosis\": {\"title\": \"主判断\", \"reasoning\": \"理由\", \"supportingEvidenceIds\": [\"E101\", \"E102\"]},"
            + "\"reviewMarkdown\": \"## 团队复盘\\n\\n这是一段自然复盘。\","
            + "\"claims\": [{\"text\": \"本队在这一波3换1\", \"evidenceIds\": [\"E101\"],"
            + "\"claimType\": \"TACTICAL\"}]"
            + "}";

    @Test
    void parsesValidEnvelope() {
        final TeamReviewEnvelope envelope = TeamReviewEnvelopeParser.parse(VALID);
        assertNotNull(envelope);
        assertEquals("主判断", envelope.primaryDiagnosis().title());
        assertEquals(List.of("E101", "E102"), envelope.primaryDiagnosis().supportingEvidenceIds());
        assertEquals("## 团队复盘\n\n这是一段自然复盘。", envelope.reviewMarkdown());
        assertEquals(1, envelope.claims().size());
        assertEquals("本队在这一波3换1", envelope.claims().get(0).text());
    }

    @Test
    void toleratesMarkdownCodeFence() {
        final String fenced = "\"\"\"json\n" + VALID + "\n\"\"\"";
        assertNotNull(TeamReviewEnvelopeParser.parse(fenced));
    }

    @Test
    void toleratesSurroundingProse() {
        final String wrapped = "好的，以下是复盘：\n" + VALID + "\n（完）";
        assertNotNull(TeamReviewEnvelopeParser.parse(wrapped));
    }

    @Test
    void rejectsMissingReviewMarkdown() {
        final String bad = "{\"primaryDiagnosis\":{\"title\":\"t\",\"reasoning\":\"r\"}}";
        assertNull(TeamReviewEnvelopeParser.parse(bad));
    }

    @Test
    void rejectsMissingDiagnosis() {
        final String bad = "{\"reviewMarkdown\":\"## 团队复盘\n\n内容\"}";
        assertNull(TeamReviewEnvelopeParser.parse(bad));
    }

    @Test
    void rejectsBlankDiagnosisReasoning() {
        final String bad = "{\"primaryDiagnosis\":{\"title\":\"t\",\"reasoning\":\"  \"},"
                + "\"reviewMarkdown\":\"## 团队复盘\n\n内容\"}";
        assertNull(TeamReviewEnvelopeParser.parse(bad));
    }

    @Test
    void rejectsNonArrayClaims() {
        final String bad = "{\"primaryDiagnosis\":{\"title\":\"t\",\"reasoning\":\"r\"},"
                + "\"reviewMarkdown\":\"## 团队复盘\n\n内容\",\"claims\":{}}";
        assertNull(TeamReviewEnvelopeParser.parse(bad));
    }

    @Test
    void rejectsNotJson() {
        assertNull(TeamReviewEnvelopeParser.parse("team review 自由文本"));
    }

    @Test
    void parsesMachineClaimFields() {
        // 机器可校验字段（timeSec/region/count/subject/value/claimType）三语通用
        final String json = "{"
                + "\"primaryDiagnosis\":{\"title\":\"主判断\",\"reasoning\":\"理由\"},"
                + "\"reviewMarkdown\":\"## 团队复盘\\n\\n内容\","
                + "\"claims\":[{"
                + "\"text\":\"WildCat died at 112 seconds\",\"evidenceIds\":[\"E101\"],"
                + "\"claimType\":\"DEATH\",\"timeSec\":112.4,\"subject\":\"WildCat\","
                + "\"region\":6,\"count\":5,\"value\":\"7v7 -> 4v6\"}]}";
        final TeamReviewEnvelope envelope = TeamReviewEnvelopeParser.parse(json);
        assertNotNull(envelope);
        final TeamReviewEnvelope.Claim claim = envelope.claims().get(0);
        assertEquals("DEATH", claim.claimType());
        assertEquals(112.4, claim.timeSec(), 0.001);
        assertEquals(6, claim.region());
        assertEquals(5, claim.count());
        assertEquals("WildCat", claim.subject());
        assertEquals("7v7 -> 4v6", claim.value());
        assertEquals(List.of("E101"), claim.evidenceIds());
    }

    @Test
    void tacticalClaimWithoutMachineFieldsPasses() {
        // TACTICAL（纯战术观点）不需要 factual machine 字段 → PASS
        final String json = "{"
                + "\"primaryDiagnosis\":{\"title\":\"主判断\",\"reasoning\":\"理由\"},"
                + "\"reviewMarkdown\":\"## 团队复盘\\n\\n内容\","
                + "\"claims\":[{\"text\":\"I think the first engagement was the main issue.\",\"claimType\":\"TACTICAL\"}]}";
        final TeamReviewEnvelope envelope = TeamReviewEnvelopeParser.parse(json);
        assertNotNull(envelope);
        final TeamReviewEnvelope.Claim claim = envelope.claims().get(0);
        assertEquals("TACTICAL", claim.claimType());
        assertNull(claim.timeSec());
        assertNull(claim.region());
        assertNull(claim.count());
        assertNull(claim.subject());
        assertNull(claim.value());
    }

    @Test
    void rejectsNullAndBlank() {
        assertNull(TeamReviewEnvelopeParser.parse(null));
        assertNull(TeamReviewEnvelopeParser.parse("   "));
    }

    // ===== ：structured factual contract fail-close =====

    private static String claimJson(final String claimBody) {
        return "{"
                + "\"primaryDiagnosis\":{\"title\":\"主判断\",\"reasoning\":\"理由\"},"
                + "\"reviewMarkdown\":\"## 团队复盘\\n\\n内容\","
                + "\"claims\":[{" + claimBody + "}]}";
    }

    private static final String DEATH_VALID =
            "\"claimType\":\"DEATH\",\"subject\":\"WildCat\",\"timeSec\":112.4,"
                    + "\"evidenceIds\":[\"E101\"],\"text\":\"WildCat died at 112 seconds\"";

    @Test
    void failCloseDeathMissingTimeSec() {
        final String json = claimJson(
                "\"claimType\":\"DEATH\",\"subject\":\"WildCat\",\"evidenceIds\":[\"E101\"],"
                        + "\"text\":\"WildCat died\"");
        assertNull(TeamReviewEnvelopeParser.parse(json), "DEATH 缺 timeSec 必须 reject/rewrite");
    }

    @Test
    void failCloseDeathMissingSubject() {
        final String json = claimJson(
                "\"claimType\":\"DEATH\",\"timeSec\":112.4,\"evidenceIds\":[\"E101\"],"
                        + "\"text\":\"died at 112\"");
        assertNull(TeamReviewEnvelopeParser.parse(json), "DEATH 缺 subject 必须 reject/rewrite");
    }

    @Test
    void failClosePositionRegionMissingRegion() {
        final String json = claimJson(
                "\"claimType\":\"POSITION_REGION\",\"timeSec\":112.0,\"count\":5,"
                        + "\"side\":\"FRIENDLY\",\"countSemantics\":\"EXACT\","
                        + "\"evidenceIds\":[\"E106\"],\"text\":\"5 vehicles there\"");
        assertNull(TeamReviewEnvelopeParser.parse(json), "POSITION_REGION 缺 region 必须 reject/rewrite");
    }

    @Test
    void failClosePositionRegionCountAsString() {
        final String json = claimJson(
                "\"claimType\":\"POSITION_REGION\",\"timeSec\":112.0,\"region\":6,"
                        + "\"count\":\"five\",\"side\":\"FRIENDLY\",\"countSemantics\":\"EXACT\","
                        + "\"evidenceIds\":[\"E106\"],\"text\":\"5 vehicles there\"");
        assertNull(TeamReviewEnvelopeParser.parse(json), "count 为字符串必须 reject（JSON number）");
    }

    @Test
    void failCloseEnemyPositionMissingKnowledge() {
        final String json = claimJson(
                "\"claimType\":\"ENEMY_POSITION\",\"subject\":\"Maus\",\"timeSec\":112.0,"
                        + "\"region\":6,\"evidenceIds\":[\"E107\"],\"text\":\"Maus position\"");
        assertNull(TeamReviewEnvelopeParser.parse(json), "ENEMY_POSITION 缺 knowledge 必须 reject/rewrite");
    }

    @Test
    void failCloseUnknownClaimType() {
        // V6m 边界：显式禁止类型（LOS 等）必须 reject——不推断、不降级。
        final String json = claimJson(
                "\"claimType\":\"LOS\",\"timeSec\":112.0,\"text\":\"full LOS\"");
        assertNull(TeamReviewEnvelopeParser.parse(json), "LOS/禁止 claimType 必须 reject");
        // P0-4：未知类型但无任何 factual 机器字段的纯文本陈述 → deterministic 推断为 TACTICAL
        // （正文事实由 validator 的 deterministic 检查兜底，不浪费 LLM retry）。
        final String unknown = claimJson(
                "\"claimType\":\"FOO\",\"text\":\"something\"");
        final TeamReviewEnvelope inferred = TeamReviewEnvelopeParser.parse(unknown);
        assertNotNull(inferred, "P0-4: 未知 claimType（无机器字段）应推断为 TACTICAL，不 reject");
        assertEquals("TACTICAL", inferred.claims().get(0).claimType());
    }

    @Test
    void failCloseClaimWithoutClaimType() {
        // P0-4：缺 claimType 的纯文本陈述 → 推断 TACTICAL（正文由 validator 文本检查兜底）。
        final String json = claimJson("\"text\":\"no type claim\"");
        final TeamReviewEnvelope envelope = TeamReviewEnvelopeParser.parse(json);
        assertNotNull(envelope, "P0-4: claim 缺 claimType 时按机器字段推断，纯文本 → TACTICAL");
        assertEquals("TACTICAL", envelope.claims().get(0).claimType());
        // 带 machine 字段但缺 claimType → 按字段推断为对应 factual 类型
        final String deathNoType = claimJson(
                "\"subject\":\"WildCat\",\"timeSec\":112.0,\"evidenceIds\":[\"E101\"],"
                        + "\"text\":\"WildCat died at 112\"");
        final TeamReviewEnvelope death = TeamReviewEnvelopeParser.parse(deathNoType);
        assertNotNull(death, "P0-4: 缺 claimType 但有 subject+timeSec 应推断 DEATH");
        assertEquals("DEATH", death.claims().get(0).claimType());
    }

    @Test
    void failCloseTimeSecAsString() {
        final String json = claimJson(
                "\"claimType\":\"DEATH\",\"subject\":\"WildCat\",\"timeSec\":\"112\","
                        + "\"evidenceIds\":[\"E101\"],\"text\":\"WildCat died at 112\"");
        assertNull(TeamReviewEnvelopeParser.parse(json), "timeSec 为字符串必须 reject");
    }

    @Test
    void validDeathWithMachineFieldsParses() {
        final TeamReviewEnvelope envelope = TeamReviewEnvelopeParser.parse(claimJson(DEATH_VALID));
        assertNotNull(envelope);
        final TeamReviewEnvelope.Claim claim = envelope.claims().get(0);
        assertEquals("DEATH", claim.claimType());
        assertEquals("WildCat", claim.subject());
        assertEquals(112.4, claim.timeSec(), 0.001);
    }

    @Test
    void validEnemyPositionWithKnowledgeParses() {
        final String json = claimJson(
                "\"claimType\":\"ENEMY_POSITION\",\"subject\":\"Maus\",\"timeSec\":112.0,"
                        + "\"region\":6,\"knowledge\":\"LAST_KNOWN\",\"evidenceIds\":[\"E107\"],"
                        + "\"text\":\"Maus last seen in region 6\"");
        final TeamReviewEnvelope envelope = TeamReviewEnvelopeParser.parse(json);
        assertNotNull(envelope);
        assertEquals("LAST_KNOWN", envelope.claims().get(0).knowledge());
        assertNull(envelope.claims().get(0).subjectAccountId());
    }

    @Test
    void parsesSubjectAccountIdStableIdentity() {
        // subjectAccountId（可选稳定身份，JSON number）
        final String json = claimJson(
                "\"claimType\":\"ENEMY_POSITION\",\"subject\":\"SPHT\",\"timeSec\":112.0,"
                        + "\"region\":6,\"knowledge\":\"LAST_KNOWN\",\"subjectAccountId\":2001,"
                        + "\"evidenceIds\":[\"E109\"],\"text\":\"SPHT last seen in region 6\"");
        final TeamReviewEnvelope envelope = TeamReviewEnvelopeParser.parse(json);
        assertNotNull(envelope);
        assertEquals(Long.valueOf(2001L), envelope.claims().get(0).subjectAccountId());
    }

    @Test
    void failCloseSubjectAccountIdAsString() {
        // subjectAccountId 为字符串 → reject/rewrite（fail-close）
        final String json = claimJson(
                "\"claimType\":\"ENEMY_POSITION\",\"subject\":\"SPHT\",\"timeSec\":112.0,"
                        + "\"region\":6,\"knowledge\":\"LAST_KNOWN\",\"subjectAccountId\":\"2001\","
                        + "\"evidenceIds\":[\"E109\"],\"text\":\"SPHT last seen in region 6\"");
        assertNull(TeamReviewEnvelopeParser.parse(json),
                "subjectAccountId 为字符串必须 reject（JSON number）");
    }
    // ===== 可诊断 ParseResult + 稳定失败分类 =====

    @Test
    void parseDetailedReturnsOkWithEnvelope() {
        final TeamReviewEnvelopeParser.ParseResult result = TeamReviewEnvelopeParser.parseDetailed(VALID);
        assertFalse(result.failed());
        assertNotNull(result.envelope());
        assertNull(result.failureReason());
    }

    @Test
    void parseDetailedClassifiesEmptyOutput() {
        final TeamReviewEnvelopeParser.ParseResult result = TeamReviewEnvelopeParser.parseDetailed("   ");
        assertTrue(result.failed());
        assertEquals(TeamReviewEnvelopeParser.ParseFailureReason.EMPTY_OUTPUT, result.failureReason());
    }

    @Test
    void parseDetailedClassifiesNotJson() {
        final TeamReviewEnvelopeParser.ParseResult result = TeamReviewEnvelopeParser.parseDetailed("team review 自由文本");
        assertTrue(result.failed());
        assertEquals(TeamReviewEnvelopeParser.ParseFailureReason.INVALID_JSON, result.failureReason());
    }

    @Test
    void parseDetailedClassifiesMissingDiagnosis() {
        final TeamReviewEnvelopeParser.ParseResult result = TeamReviewEnvelopeParser.parseDetailed(
                "{\"reviewMarkdown\":\"## 团队复盘\\n\\n内容\"}");
        assertEquals(TeamReviewEnvelopeParser.ParseFailureReason.MISSING_PRIMARY_DIAGNOSIS, result.failureReason());
    }

    @Test
    void parseDetailedClassifiesMissingReviewMarkdown() {
        final TeamReviewEnvelopeParser.ParseResult result = TeamReviewEnvelopeParser.parseDetailed(
                "{\"primaryDiagnosis\":{\"title\":\"t\",\"reasoning\":\"r\"}}");
        assertEquals(TeamReviewEnvelopeParser.ParseFailureReason.MISSING_REVIEW_MARKDOWN, result.failureReason());
    }

    @Test
    void parseDetailedClassifiesInvalidClaimsShape() {
        final TeamReviewEnvelopeParser.ParseResult result = TeamReviewEnvelopeParser.parseDetailed(
                "{\"primaryDiagnosis\":{\"title\":\"t\",\"reasoning\":\"r\"},"
                        + "\"reviewMarkdown\":\"## 团队复盘\\n\\n内容\",\"claims\":{}}");
        assertEquals(TeamReviewEnvelopeParser.ParseFailureReason.INVALID_CLAIMS, result.failureReason());
    }

    @Test
    void parseDetailedClassifiesUnknownClaimType() {
        final TeamReviewEnvelopeParser.ParseResult result = TeamReviewEnvelopeParser.parseDetailed(
                "{\"primaryDiagnosis\":{\"title\":\"t\",\"reasoning\":\"r\"},"
                        + "\"reviewMarkdown\":\"## 团队复盘\\n\\n内容\","
                        + "\"claims\":[{\"text\":\"x\",\"claimType\":\"LOS\"}]}");
        assertEquals(TeamReviewEnvelopeParser.ParseFailureReason.UNKNOWN_CLAIM_TYPE, result.failureReason());
    }

    @Test
    void parseDetailedClassifiesInvalidMachineFieldType() {
        final TeamReviewEnvelopeParser.ParseResult result = TeamReviewEnvelopeParser.parseDetailed(claimJson(
                "\"claimType\":\"DEATH\",\"subject\":\"WildCat\",\"timeSec\":\"112\","
                        + "\"evidenceIds\":[\"E101\"],\"text\":\"died at 112\""));
        assertEquals(TeamReviewEnvelopeParser.ParseFailureReason.INVALID_MACHINE_FIELD_TYPE, result.failureReason());
    }

    @Test
    void parseDetailedClassifiesMissingRequiredMachineField() {
        final TeamReviewEnvelopeParser.ParseResult result = TeamReviewEnvelopeParser.parseDetailed(claimJson(
                "\"claimType\":\"DEATH\",\"subject\":\"WildCat\",\"evidenceIds\":[\"E101\"],"
                        + "\"text\":\"WildCat died\""));
        assertEquals(TeamReviewEnvelopeParser.ParseFailureReason.MISSING_REQUIRED_MACHINE_FIELD, result.failureReason());
    }

    @Test
    void parseDetailedClassifiesTooManyClaims() {
        final StringBuilder sb = new StringBuilder();
        sb.append("{\"primaryDiagnosis\":{\"title\":\"t\",\"reasoning\":\"r\"},")
                .append("\"reviewMarkdown\":\"## 团队复盘\\n\\n内容\",\"claims\":[");
        for (int i = 0; i < TeamReviewEnvelopeParser.MAX_CLAIMS + 1; i++) {
            if (i > 0) sb.append(',');
            sb.append("{\"text\":\"c").append(i).append("\",\"claimType\":\"TACTICAL\"}");
        }
        sb.append("]}");
        final TeamReviewEnvelopeParser.ParseResult result = TeamReviewEnvelopeParser.parseDetailed(sb.toString());
        assertEquals(TeamReviewEnvelopeParser.ParseFailureReason.TOO_MANY_CLAIMS, result.failureReason());
    }

    @Test
    void parseDetailedClassifiesTooManyEvidenceIds() {
        final StringBuilder ids = new StringBuilder();
        for (int i = 0; i <= TeamReviewEnvelopeParser.MAX_IDS_PER_CLAIM; i++) {
            if (i > 0) ids.append(',');
            ids.append("\"E").append(100 + i).append("\"");
        }
        final TeamReviewEnvelopeParser.ParseResult result = TeamReviewEnvelopeParser.parseDetailed(claimJson(
                "\"claimType\":\"DEATH\",\"subject\":\"WildCat\",\"timeSec\":112.4,"
                        + "\"evidenceIds\":[" + ids + "],\"text\":\"WildCat died at 112 seconds\""));
        assertEquals(TeamReviewEnvelopeParser.ParseFailureReason.TOO_MANY_EVIDENCE_IDS, result.failureReason());
    }

    /** 合法 JSON 但业务 schema 违反 → parser 仍 FAIL（JSON syntax ≠ business schema）。 */
    @Test
    void jsonModeTypicalResponseWithWrongClaimsTypeFails() {
        final String wrong = "{\"primaryDiagnosis\": {\"title\": \"t\", \"reasoning\": \"r\"},"
                + "\"reviewMarkdown\": \"...\",\"claims\": \"wrong\"}";
        final TeamReviewEnvelopeParser.ParseResult result = TeamReviewEnvelopeParser.parseDetailed(wrong);
        assertTrue(result.failed(), "合法 JSON 但 claims 类型错误仍必须 FAIL（fail-close）");
        assertEquals(TeamReviewEnvelopeParser.ParseFailureReason.INVALID_CLAIMS, result.failureReason());
    }

    /** 官方 JSON mode 典型响应正常解析 PASS。 */
    @Test
    void jsonModeTypicalResponseParsesPass() {
        final String typical = "{\"primaryDiagnosis\":{\"title\":\"主判断\",\"reasoning\":\"理由\"},"
                + "\"reviewMarkdown\":\"## 团队复盘\\n\\n这是一段复盘。\",\"claims\":[]}";
        final TeamReviewEnvelopeParser.ParseResult result = TeamReviewEnvelopeParser.parseDetailed(typical);
        assertFalse(result.failed());
        assertNotNull(result.envelope());
    }

    // ===== 字符串数组字段三态（MISSING / INVALID / VALID-empty）=====

    private static String diagnosisJson(final String diagnosisBody) {
        return "{\"primaryDiagnosis\":{" + diagnosisBody + "},"
                + "\"reviewMarkdown\":\"## 团队复盘\\n\\n内容\",\"claims\":[]}";
    }

    @Test
    void evidenceIdsAsWholeStringIsSchemaTypeFailure() {
        // malformed evidenceIds（字符串整体）→ 明确的 schema/type failure，不得误报 MISSING_REQUIRED_MACHINE_FIELD
        final TeamReviewEnvelopeParser.ParseResult result = TeamReviewEnvelopeParser.parseDetailed(claimJson(
                "\"claimType\":\"DEATH\",\"subject\":\"WildCat\",\"timeSec\":112.4,"
                        + "\"evidenceIds\":\"E101\",\"text\":\"WildCat died at 112 seconds\""));
        assertTrue(result.failed());
        assertEquals(TeamReviewEnvelopeParser.ParseFailureReason.INVALID_MACHINE_FIELD_TYPE,
                result.failureReason(), "evidenceIds 非数组必须是 schema/type failure 而非 missing");
    }

    @Test
    void evidenceIdsWithObjectElementIsSchemaTypeFailure() {
        final TeamReviewEnvelopeParser.ParseResult result = TeamReviewEnvelopeParser.parseDetailed(claimJson(
                "\"claimType\":\"DEATH\",\"subject\":\"WildCat\",\"timeSec\":112.4,"
                        + "\"evidenceIds\":[{}],\"text\":\"WildCat died at 112 seconds\""));
        assertEquals(TeamReviewEnvelopeParser.ParseFailureReason.INVALID_MACHINE_FIELD_TYPE,
                result.failureReason(), "array 内 object 元素属于 schema/type failure");
    }

    @Test
    void evidenceIdsWithNullElementIsSchemaTypeFailure() {
        final TeamReviewEnvelopeParser.ParseResult result = TeamReviewEnvelopeParser.parseDetailed(claimJson(
                "\"claimType\":\"DEATH\",\"subject\":\"WildCat\",\"timeSec\":112.4,"
                        + "\"evidenceIds\":[null],\"text\":\"WildCat died at 112 seconds\""));
        assertEquals(TeamReviewEnvelopeParser.ParseFailureReason.INVALID_MACHINE_FIELD_TYPE,
                result.failureReason(), "array 内 null 元素属于 schema/type failure");
    }

    @Test
    void evidenceIdsWithNonStringScalarElementIsSchemaTypeFailure() {
        // 字符串数组契约：number/boolean 元素也属于非允许类型（原实现经 asText 静默接受，已收紧）
        final TeamReviewEnvelopeParser.ParseResult result = TeamReviewEnvelopeParser.parseDetailed(claimJson(
                "\"claimType\":\"DEATH\",\"subject\":\"WildCat\",\"timeSec\":112.4,"
                        + "\"evidenceIds\":[123],\"text\":\"WildCat died at 112 seconds\""));
        assertEquals(TeamReviewEnvelopeParser.ParseFailureReason.INVALID_MACHINE_FIELD_TYPE,
                result.failureReason(), "array 内 number 元素属于 schema/type failure");
    }

    @Test
    void missingEvidenceIdsOnFactualClaimIsMissingRequiredMachineField() {
        // 字段缺失 → MISSING_REQUIRED_MACHINE_FIELD（factual claim 必须引用证据）
        final TeamReviewEnvelopeParser.ParseResult result = TeamReviewEnvelopeParser.parseDetailed(claimJson(
                "\"claimType\":\"DEATH\",\"subject\":\"WildCat\",\"timeSec\":112.4,"
                        + "\"text\":\"WildCat died at 112 seconds\""));
        assertEquals(TeamReviewEnvelopeParser.ParseFailureReason.MISSING_REQUIRED_MACHINE_FIELD,
                result.failureReason());
    }

    @Test
    void emptyEvidenceIdsOnFactualClaimIsMissingRequiredMachineField() {
        // 合法 [] 仍是合法空数组：factual claim 要求非空 evidenceIds 时才进入 MISSING_REQUIRED_MACHINE_FIELD
        final TeamReviewEnvelopeParser.ParseResult result = TeamReviewEnvelopeParser.parseDetailed(claimJson(
                "\"claimType\":\"DEATH\",\"subject\":\"WildCat\",\"timeSec\":112.4,"
                        + "\"evidenceIds\":[],\"text\":\"WildCat died at 112 seconds\""));
        assertEquals(TeamReviewEnvelopeParser.ParseFailureReason.MISSING_REQUIRED_MACHINE_FIELD,
                result.failureReason(), "DEATH 要求非空 evidenceIds：合法空数组也必须 MISSING_REQUIRED_MACHINE_FIELD");
    }

    @Test
    void emptyEvidenceIdsOnTacticalClaimPasses() {
        // 合法 [] 是合法空数组：TACTICAL 不要求 evidenceIds → PASS
        final TeamReviewEnvelopeParser.ParseResult result = TeamReviewEnvelopeParser.parseDetailed(claimJson(
                "\"claimType\":\"TACTICAL\",\"evidenceIds\":[],\"text\":\"战术观点\""));
        assertFalse(result.failed(), "TACTICAL 的合法空 evidenceIds 必须 PASS");
        assertNotNull(result.envelope());
        assertTrue(result.envelope().claims().getFirst().evidenceIds().isEmpty());
    }

    @Test
    void supportingEvidenceIdsAsWholeStringIsSchemaTypeFailure() {
        // primaryDiagnosis.supportingEvidenceIds 存在但不是合法字符串数组 → 不允许静默 PASS
        final TeamReviewEnvelopeParser.ParseResult result = TeamReviewEnvelopeParser.parseDetailed(
                diagnosisJson("\"title\":\"主判断\",\"reasoning\":\"理由\",\"supportingEvidenceIds\":\"E101\""));
        assertEquals(TeamReviewEnvelopeParser.ParseFailureReason.INVALID_MACHINE_FIELD_TYPE,
                result.failureReason(), "supportingEvidenceIds 类型非法必须 fail-close");
    }

    @Test
    void supportingEvidenceIdsWithIllegalElementIsSchemaTypeFailure() {
        final TeamReviewEnvelopeParser.ParseResult result = TeamReviewEnvelopeParser.parseDetailed(
                diagnosisJson("\"title\":\"主判断\",\"reasoning\":\"理由\",\"supportingEvidenceIds\":[{}]"));
        assertEquals(TeamReviewEnvelopeParser.ParseFailureReason.INVALID_MACHINE_FIELD_TYPE,
                result.failureReason(), "supportingEvidenceIds 含非法元素必须 fail-close");
        final TeamReviewEnvelopeParser.ParseResult nullElem = TeamReviewEnvelopeParser.parseDetailed(
                diagnosisJson("\"title\":\"主判断\",\"reasoning\":\"理由\",\"supportingEvidenceIds\":[null]"));
        assertEquals(TeamReviewEnvelopeParser.ParseFailureReason.INVALID_MACHINE_FIELD_TYPE,
                nullElem.failureReason(), "supportingEvidenceIds 含 null 元素必须 fail-close");
    }

    @Test
    void legalSupportingEvidenceIdsParsesWithValues() {
        final TeamReviewEnvelopeParser.ParseResult result = TeamReviewEnvelopeParser.parseDetailed(
                diagnosisJson("\"title\":\"主判断\",\"reasoning\":\"理由\","
                        + "\"supportingEvidenceIds\":[\"E101\",\"E102\"]"));
        assertFalse(result.failed());
        assertEquals(List.of("E101", "E102"), result.envelope().primaryDiagnosis().supportingEvidenceIds());
    }
}