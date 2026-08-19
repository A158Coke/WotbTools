package com.wotb.web.replay.ai;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.wotb.web.replay.controller.ReconstructionController;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;

/**
 * AI Review 超时链配置契约：后端常量、application.yml、前端安全超时、nginx、
 * workflow / deploy.sh / compose / .env.example 必须保持一致，防止任一层漂移
 * 重新引入「前端 400s / nginx 420s / 后端 400s」式的旧链路。
 */
class AiTimeoutChainContractTest {

    private static final long OVERALL_DEADLINE_SEC = 1100L;
    private static final long PROXY_TIMEOUT_SEC = 1120L;

    private static Path repoPath(final String first, final String... rest) {
        Path p = Path.of(System.getProperty("user.dir"), "..", "..").normalize();
        return p.resolve(Path.of(first, rest));
    }

    @Test
    void backendConstantsStayAligned() {
        assertEquals(OVERALL_DEADLINE_SEC, AiReviewWorkerExecutor.DEFAULT_OVERALL_DEADLINE_SEC,
                "worker overall deadline 默认值必须与前端/nginx 对齐");
        assertEquals(OVERALL_DEADLINE_SEC, TacticalReviewHarness.ENDPOINT_DEADLINE_SEC,
                "harness 端点 deadline 常量必须与整体链路对齐");
        assertEquals(PROXY_TIMEOUT_SEC * 1000L, ReconstructionController.SSE_TIMEOUT_MS,
                "SseEmitter 超时必须与 nginx 代理超时对齐");
    }

    @Test
    void repoConfigChainDoesNotDrift() throws Exception {
        assertFileContains("application.yml",
                repoPath("java", "wotb-web", "src", "main", "resources", "application.yml"),
                "overall-deadline-sec: ${AI_REVIEW_WORKER_OVERALL_DEADLINE_SEC:1100}");
        assertFileContains("ReconstructionPage.vue",
                repoPath("frontend", "src", "components", "ReconstructionPage.vue"),
                "const AI_ANALYZE_TIMEOUT_MS = 1_100_000");
        assertFileContains("nginx.conf read",
                repoPath("deploy", "nginx", "nginx.conf"),
                "proxy_read_timeout 1120s;");
        assertFileContains("nginx.conf send",
                repoPath("deploy", "nginx", "nginx.conf"),
                "proxy_send_timeout 1120s;");
        assertFileContains("deploy.yml",
                repoPath(".github", "workflows", "deploy.yml"),
                "AI_REVIEW_WORKER_OVERALL_DEADLINE_SEC: '1100'");
        assertFileContains("docker-compose.prod.yml",
                repoPath("deploy", "docker-compose.prod.yml"),
                "${AI_REVIEW_WORKER_OVERALL_DEADLINE_SEC:-1100}");
        assertFileContains("docker-compose online",
                repoPath("docker", "online", "docker-compose.yml"),
                "${AI_REVIEW_WORKER_OVERALL_DEADLINE_SEC:-1100}");
        assertFileContains(".env.example",
                repoPath(".env.example"),
                "AI_REVIEW_WORKER_OVERALL_DEADLINE_SEC=1100");
        assertFileContains("deploy.sh fail-fast",
                repoPath("deploy", "deploy.sh"),
                "AI_REVIEW_WORKER_OVERALL_DEADLINE_SEC\" != \"1100\"");
    }

    private static void assertFileContains(final String label, final Path file,
                                           final String expected) throws Exception {
        assertTrue(Files.isRegularFile(file), label + " 文件不存在: " + file);
        final String content = Files.readString(file);
        assertTrue(content.contains(expected),
                label + " 缺少对齐配置片段: " + expected + "\nfile=" + file);
    }
}
