package com.wotb.ai;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * {@code POST /api/ai/reviews} 的 HTTP 边界契约：JWT 角色门 + 返回 worker 之前的失败必须是契约
 * {@code ApiError} 信封（含稳定 {@code errorCode}），而不是 Spring 默认错误体。
 *
 * <p>覆盖 plan §25 的 HTTP 用例：无 JWT、角色不足、未知 locale、非法
 * correlationId。SSE 事件流与取消端点由 {@link AiReviewControllerTest} 在 controller 层覆盖。</p>
 *
 * <p>MockMvc 按本仓库既有形态手工装配（{@code webAppContextSetup + springSecurity()}），
 * 不依赖 {@code @AutoConfigureMockMvc}（Spring Boot 4.1 该切片不在现有测试依赖内）。</p>
 */
@SpringBootTest(classes = AiServiceApplication.class,
        properties = {
                "spring.security.oauth2.resourceserver.jwt.issuer-uri=",
                "spring.security.oauth2.resourceserver.jwt.jwk-set-uri=http://127.0.0.1:9/jwks",
                "wotb.ai.api-key="
        })
class AiReviewHttpBoundaryTest {

    private static final String ENDPOINT = "/api/ai/reviews";
    private static final String USER = "ROLE_wotbtools-user";

    @Autowired
    private WebApplicationContext context;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    }

    @Test
    void rejectsRequestWithoutJwt() throws Exception {
        mockMvc.perform(post(ENDPOINT).contentType(MediaType.APPLICATION_JSON).content(validBody("zh-CN")))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void rejectsAuthenticatedCallerWithoutAiRole() throws Exception {
        mockMvc.perform(post(ENDPOINT).contentType(MediaType.APPLICATION_JSON).content(validBody("zh-CN"))
                        .with(jwt().authorities(new SimpleGrantedAuthority("ROLE_wotbtools-hof"))))
                .andExpect(status().isForbidden());
    }

    @Test
    void returnsContractEnvelopeForUnknownLocale() throws Exception {
        mockMvc.perform(post(ENDPOINT).contentType(MediaType.APPLICATION_JSON).content(validBody("de-DE"))
                        .with(jwt().authorities(new SimpleGrantedAuthority(USER))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errorCode").value("UNKNOWN_LOCALE"));
    }

    @Test
    void returnsContractEnvelopeForNonCanonicalCorrelationId() throws Exception {
        mockMvc.perform(post(ENDPOINT).contentType(MediaType.APPLICATION_JSON)
                        .content(body("zh-CN", "not-a-uuid"))
                        .with(jwt().authorities(new SimpleGrantedAuthority(USER))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errorCode").value("INVALID_CORRELATION_ID"));
    }

    private static String validBody(final String locale) {
        return body(locale, "6f1e6f1e-0000-4000-8000-000000000001");
    }

    /** V2 信封：投影段留空（信封错误先于投影结构校验返回）。 */
    private static String body(final String locale, final String correlationId) {
        return "{\"locale\":\"" + locale + "\",\"correlationId\":\"" + correlationId + "\","
                + "\"battle\":{\"players\":[]},\"projection\":{}}";
    }

    @Test
    void malformedProjectionIsAnInvalidRequestNotAServerError() throws Exception {
        mockMvc.perform(post(ENDPOINT).contentType(MediaType.APPLICATION_JSON).content(validBody("zh-CN"))
                        .with(jwt().authorities(new SimpleGrantedAuthority(USER))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errorCode").value("INVALID_AI_REQUEST"));
    }

    @Test
    void gzipBodyIsInflatedBeforeValidation() throws Exception {
        mockMvc.perform(post(ENDPOINT).contentType(MediaType.APPLICATION_JSON).header("Content-Encoding", "gzip")
                        .content(gzip(body("de-DE", "6f1e6f1e-0000-4000-8000-000000000001")))
                        .with(jwt().authorities(new SimpleGrantedAuthority(USER))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errorCode").value("UNKNOWN_LOCALE"));
    }

    @Test
    void inflatedSizeIsCappedAt16MiB() throws Exception {
        // 17 MiB 的空白在 gzip 下只有几十 KB：传输体合规，解压后超限 → 413（防 zip bomb）
        final byte[] bomb = gzip("{\"locale\":\"zh-CN\"" + " ".repeat(17 * 1024 * 1024) + "}");
        mockMvc.perform(post(ENDPOINT).contentType(MediaType.APPLICATION_JSON).header("Content-Encoding", "gzip")
                        .content(bomb).with(jwt().authorities(new SimpleGrantedAuthority(USER))))
                .andExpect(status().isPayloadTooLarge());
    }

    @Test
    void unsupportedContentEncodingIsRejected() throws Exception {
        mockMvc.perform(post(ENDPOINT).contentType(MediaType.APPLICATION_JSON).header("Content-Encoding", "br")
                        .content(validBody("zh-CN")).with(jwt().authorities(new SimpleGrantedAuthority(USER))))
                .andExpect(status().isUnsupportedMediaType());
    }

    private static byte[] gzip(final String text) throws java.io.IOException {
        final java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        try (java.util.zip.GZIPOutputStream gz = new java.util.zip.GZIPOutputStream(out)) {
            gz.write(text.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        }
        return out.toByteArray();
    }
}
