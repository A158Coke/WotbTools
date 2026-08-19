package com.wotb.web.replay.ai.eval;

import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;

/** 写 target/ai-eval-report/report.md + report.json（每例 PASS/FAIL + 期望判断）。 */
public final class AiEvalReportWriter {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private AiEvalReportWriter() {
    }

    public record CaseResult(
            AiEvalCase caze,
            boolean passed,
            List<AiEvalAssertions.CheckResult> checks
    ) {
    }

    public static void write(final List<CaseResult> results) throws IOException {
        final Path dir = Path.of("target", "ai-eval-report");
        Files.createDirectories(dir);

        final StringBuilder md = new StringBuilder("# AI 复盘评估报告（CI 模式）\n\n");
        md.append("| case | 期望判断 | 结果 | 失败检查 |\n|---|---|---|---|\n");
        for (final CaseResult result : results) {
            final List<String> failed = result.checks().stream()
                    .filter(check -> !check.passed())
                    .map(check -> check.check().kind() + ":" + check.check().text())
                    .toList();
            md.append("| ").append(result.caze().id())
                    .append(" | ").append(result.caze().expectedJudgment())
                    .append(" | ").append(result.passed() ? "PASS" : "FAIL")
                    .append(" | ").append(String.join("; ", failed))
                    .append(" |\n");
        }
        final long passed = results.stream().filter(CaseResult::passed).count();
        md.append("\n汇总: ").append(passed).append("/").append(results.size()).append(" 通过\n");
        Files.writeString(dir.resolve("report.md"), md, StandardCharsets.UTF_8);

        final List<Map<String, Object>> json = results.stream()
                .map(result -> Map.<String, Object>of(
                        "id", result.caze().id(),
                        "expectedJudgment", result.caze().expectedJudgment(),
                        "passed", result.passed(),
                        "note", result.caze().note()))
                .toList();
        Files.writeString(dir.resolve("report.json"),
                MAPPER.writerWithDefaultPrettyPrinter().writeValueAsString(json),
                StandardCharsets.UTF_8);
    }
}
