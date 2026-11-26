package com.wotb.ai.review;

import org.junit.jupiter.api.Test;

import java.lang.reflect.Field;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AiTimeoutChainContractTest {

    private static final long OVERALL_DEADLINE_SEC = 1100L;
    private static final long PROXY_TIMEOUT_SEC = 1120L;

    private static Path repoPath(final String first, final String... rest) {
        Path p = Path.of(System.getProperty("user.dir"), "..", "..").normalize();
        return p.resolve(Path.of(first, rest));
    }

    @Test
    void backendConstantsStayAligned() throws Exception {
        assertEquals(OVERALL_DEADLINE_SEC, AiReviewWorkerExecutor.DEFAULT_OVERALL_DEADLINE_SEC,
                "worker overall deadline 默认值必须与前端/nginx 对齐");
        assertEquals(OVERALL_DEADLINE_SEC, TacticalReviewHarness.ENDPOINT_DEADLINE_SEC,
                "harness 端点 deadline 常量必须与整体链路对齐");
        assertEquals(PROXY_TIMEOUT_SEC * 1000L, aiServiceSseTimeoutMs(),
                "ai-service SseEmitter 超时必须与 nginx 代理超时对齐");
    }

    @Test
    void repoConfigChainDoesNotDrift() throws Exception {
        assertFileContains("application.yml (ai-service)",
                repoPath("java", "wotb-ai", "src", "main", "resources", "application.yml"),
                "overall-deadline-sec: ${AI_REVIEW_WORKER_OVERALL_DEADLINE_SEC:1100}");
        assertFileContains("AiReviewPanel.vue",
                repoPath("frontend", "src", "components", "AiReviewPanel.vue"),
                "const AI_ANALYZE_TIMEOUT_MS = 1_100_000");
        assertFileContains("frontend.conf.template read",
                repoPath("deploy", "tx", "nginx", "frontend.conf.template"),
                "proxy_read_timeout 1120s;");
        assertFileContains("frontend.conf.template send",
                repoPath("deploy", "tx", "nginx", "frontend.conf.template"),
                "proxy_send_timeout 1120s;");
        assertFileContains("docker-compose.prod.yml (ai-service)",
                repoPath("deploy", "docker-compose.prod.yml"),
                "AI_REVIEW_WORKER_OVERALL_DEADLINE_SEC: ${AI_REVIEW_WORKER_OVERALL_DEADLINE_SEC:-1100}");
        assertFileDoesNotContain("deploy.sh",
                repoPath("deploy", "deploy.sh"),
                "AI_REVIEW_WORKER_OVERALL_DEADLINE_SEC");
        assertFileDoesNotContain("business-api.yml",
                repoPath(".github", "workflows", "business-api.yml"),
                "AI_");
        assertFileDoesNotContain("business-api.compose.yml",
                repoPath("deploy", "tx", "business-api.compose.yml"),
                "AI_");
        assertFileDoesNotContain("deploy/tx/deploy.sh (AI provider key)",
                repoPath("deploy", "tx", "deploy.sh"),
                "AI_API_KEY");
    }

    @Test
    void aiModelFallbacksStayOnFlash() throws Exception {
        assertFileContains("application.yml (ai-service)",
                repoPath("java", "wotb-ai", "src", "main", "resources", "application.yml"),
                "model: ${AI_MODEL:deepseek-v4-flash}");
        assertFileContains("docker-compose.prod.yml (ai-service)",
                repoPath("deploy", "docker-compose.prod.yml"),
                "AI_MODEL: ${AI_MODEL:-deepseek-v4-flash}");
        assertFileDoesNotContain("business-api.yml",
                repoPath(".github", "workflows", "business-api.yml"),
                "AI_MODEL");
        assertFileDoesNotContain("business-api.compose.yml",
                repoPath("deploy", "tx", "business-api.compose.yml"),
                "AI_MODEL");
        assertFileContains(".env.example (name only)",
                repoPath(".env.example"),
                "# AI_MODEL=");
        assertFileDoesNotContain(".env.example (no value)",
                repoPath(".env.example"),
                "AI_MODEL=deepseek-v4-flash");
    }

    private static long aiServiceSseTimeoutMs() throws Exception {
        final Class<?> controller = Class.forName("com.wotb.ai.review.service.AiReviewSubmissionService");
        final Field field = controller.getDeclaredField("SSE_TIMEOUT_MS");
        field.setAccessible(true);
        return field.getLong(null);
    }

    private static void assertFileContains(final String label, final Path file,
                                           final String expected) throws Exception {
        assertTrue(Files.isRegularFile(file), label + " 文件不存在: " + file);
        final String content = Files.readString(file);
        assertTrue(content.contains(expected),
                label + " 缺少对齐配置片段: " + expected + "\nfile=" + file);
    }

    private static void assertFileDoesNotContain(final String label, final Path file,
                                                 final String unexpected) throws Exception {
        assertTrue(Files.isRegularFile(file), label + " 文件不存在: " + file);
        final String content = Files.readString(file);
        assertFalse(content.contains(unexpected),
                label + " 不得再携带 AI 运行时配置: " + unexpected + "\nfile=" + file);
    }
}
