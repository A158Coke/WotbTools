package com.wotb.web.replay.ai;

import com.wotb.core.replay.evidence.TeamReviewEnvelope;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;

import java.util.List;

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
        // Review B1-2：机器可校验字段（timeSec/region/count/subject/value/claimType）三语通用
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
        // Review Blocker B1：TACTICAL（纯战术观点）不需要 factual machine 字段 → PASS
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

    // ===== Review Blocker B1：structured factual contract fail-close =====

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
        final String json = claimJson(
                "\"claimType\":\"LOS\",\"timeSec\":112.0,\"text\":\"full LOS\"");
        assertNull(TeamReviewEnvelopeParser.parse(json), "LOS/未知 claimType 必须 reject");
        final String unknown = claimJson(
                "\"claimType\":\"FOO\",\"text\":\"something\"");
        assertNull(TeamReviewEnvelopeParser.parse(unknown), "未知 claimType 必须 reject");
    }

    @Test
    void failCloseClaimWithoutClaimType() {
        final String json = claimJson("\"text\":\"no type claim\"");
        assertNull(TeamReviewEnvelopeParser.parse(json), "claim 缺 claimType 必须 reject");
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
    }
}