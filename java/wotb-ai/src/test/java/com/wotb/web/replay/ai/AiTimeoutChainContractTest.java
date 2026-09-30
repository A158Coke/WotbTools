package com.wotb.web.replay.ai;

import org.junit.jupiter.api.Test;

import java.lang.reflect.Field;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * AI Review 超时链与模型默认值契约：ai-service 常量 / application.yml、前端安全超时、TX 线上边缘反代、
 * Yecao ai-service Compose 必须保持一致，防止任一层漂移重新引入「前端 400s / nginx 420s / 后端 400s」式的旧链路。
 *
 * <p>AI Review 已随服务拆分迁出 wotb-web（独立 stateless {@code ai-service}，模块 {@code java/wotb-ai}）：
 * SSE {@code SseEmitter} 超时与 {@code wotb.ai.*} 配置由 {@code com.wotb.ai.AiReviewController} 与
 * {@code java/wotb-ai/.../application.yml} 承担，因此本契约的 Java 锚点指向那里。wotb-ai 是 wotb-web 的
 * test-scope 依赖，测试类仍留在 wotb-web 测试树内。</p>
 *
 * <p><b>归属</b>：AI provider 配置与 secret 只属于 Yecao {@code ai-service}
 * （{@code deploy/docker-compose.prod.yml} + {@code .github/workflows/ai-service.yml}）。TX 业务编排
 * （{@code deploy/tx/business-api.compose.yml}、{@code deploy/tx/deploy.sh}、
 * {@code .github/workflows/business-api.yml}）<b>不再携带任何 {@code AI_*}</b>，只保留 {@code /api/ai/**}
 * → {@code 10.20.0.2:8089} 的 ingress 路由（{@code TX_AI_UPSTREAM}）。因此本契约对 TX 侧断言的是
 * 「零 AI 配置」这一不变量，而不是某个具体默认值。</p>
 *
 * <p>TX 线上边缘是 {@code deploy/tx/nginx/frontend.conf.template}（由 frontend 镜像的 nginx template
 * entrypoint 渲染并覆盖镜像内烘焙的 {@code deploy/nginx/nginx.conf}），因此 SSE 1120s 断言锚定模板。</p>
 */
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
        // AI Review SSE 分析流已随单页 Workspace 改造抽到 AiReviewPanel（PR #128）
        assertFileContains("AiReviewPanel.vue",
                repoPath("frontend", "src", "components", "AiReviewPanel.vue"),
                "const AI_ANALYZE_TIMEOUT_MS = 1_100_000");
        // TX 线上边缘（渲染后覆盖镜像内烘焙副本）。
        assertFileContains("frontend.conf.template read",
                repoPath("deploy", "tx", "nginx", "frontend.conf.template"),
                "proxy_read_timeout 1120s;");
        assertFileContains("frontend.conf.template send",
                repoPath("deploy", "tx", "nginx", "frontend.conf.template"),
                "proxy_send_timeout 1120s;");
        // Yecao 宿主按服务拆分预部署 ai-service：AI 超时链的部署输入必须出现在该 compose 中。
        assertFileContains("docker-compose.prod.yml (ai-service)",
                repoPath("deploy", "docker-compose.prod.yml"),
                "AI_REVIEW_WORKER_OVERALL_DEADLINE_SEC: ${AI_REVIEW_WORKER_OVERALL_DEADLINE_SEC:-1100}");
        // 业务应用的部署脚本不得再担负 AI 运行时配置。
        assertFileDoesNotContain("deploy.sh",
                repoPath("deploy", "deploy.sh"),
                "AI_REVIEW_WORKER_OVERALL_DEADLINE_SEC");
        // TX 业务编排不携带任何 AI 配置（服务拆分收口后的不变量）。
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

    /** AI 模型默认值契约：ai-service 的 application default 与 Yecao 部署默认必须同为 deepseek-v4-flash。 */
    @Test
    void aiModelFallbacksStayOnFlash() throws Exception {
        assertFileContains("application.yml (ai-service)",
                repoPath("java", "wotb-ai", "src", "main", "resources", "application.yml"),
                "model: ${AI_MODEL:deepseek-v4-flash}");
        assertFileContains("docker-compose.prod.yml (ai-service)",
                repoPath("deploy", "docker-compose.prod.yml"),
                "AI_MODEL: ${AI_MODEL:-deepseek-v4-flash}");
        // TX 侧不得再出现模型默认值；.env.example 只列变量名、不落值。
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

    /** ai-service 的 SSE 超时常量（{@code private static final long}）——跨模块契约锚点。 */
    private static long aiServiceSseTimeoutMs() throws Exception {
        final Class<?> controller = Class.forName("com.wotb.ai.AiReviewController");
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
