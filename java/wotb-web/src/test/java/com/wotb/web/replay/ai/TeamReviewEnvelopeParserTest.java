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
            + "\"claims\": [{\"text\": \"本队在这一波3换1\", \"evidenceIds\": [\"E101\"]}]"
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
    void toleratesMissingMachineFields() {
        // 纯战术观点 claim 可无机器字段（Review B1-2：容忍缺失）
        final String json = "{"
                + "\"primaryDiagnosis\":{\"title\":\"主判断\",\"reasoning\":\"理由\"},"
                + "\"reviewMarkdown\":\"## 团队复盘\\n\\n内容\","
                + "\"claims\":[{\"text\":\"I think the first engagement was the main issue.\"}]}";
        final TeamReviewEnvelope envelope = TeamReviewEnvelopeParser.parse(json);
        assertNotNull(envelope);
        final TeamReviewEnvelope.Claim claim = envelope.claims().get(0);
        assertNull(claim.claimType());
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
}