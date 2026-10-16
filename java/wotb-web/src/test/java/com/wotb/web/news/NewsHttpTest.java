package com.wotb.web.news;

import com.wotb.web.config.ApiErrorTestConfig;
import com.wotb.web.config.SecurityConfig;
import com.wotb.web.exceptionhandler.GlobalExceptionHandler;
import com.wotb.web.news.controller.NewsAdminController;
import com.wotb.web.news.controller.NewsController;
import com.wotb.web.news.dto.NewsDtos;
import com.wotb.web.news.service.NewsArchiveService;
import com.wotb.web.news.service.NewsImageService;
import com.wotb.web.news.service.NewsSourceService;
import com.wotb.web.util.apierror.ApiErrorCode;
import com.wotb.web.util.apierror.ApiException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.mock.web.MockServletContext;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.support.AnnotationConfigWebApplicationContext;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;
import java.time.Instant;
import java.util.List;
import static org.hamcrest.Matchers.nullValue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class NewsHttpTest {
    private AnnotationConfigWebApplicationContext context;
    private MockMvc mvc;
    @BeforeEach void setup() {
        context = new AnnotationConfigWebApplicationContext(); context.setServletContext(new MockServletContext());
        context.register(TestConfig.class); context.refresh();
        mvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    }
    @AfterEach void close() { context.close(); }

    @Test void anonymousReadsAndOnlyNewsOrTournamentAdministratorsCanManage() throws Exception {
        when(context.getBean(NewsSourceService.class).sources()).thenReturn(List.of(new NewsDtos.Source("WG", true), new NewsDtos.Source("LESTA", false)));
        mvc.perform(get("/api/news/sources")).andExpect(status().isOk())
                .andExpect(jsonPath("$[1].enabled").value(false)).andExpect(header().string("Cache-Control", "no-store"));
        mvc.perform(get("/api/admin/news/archives/1")).andExpect(status().isUnauthorized());
        for (final String role : List.of("wotbtools-user", "HoF-admin")) {
            mvc.perform(get("/api/admin/news/archives/1").with(jwt().authorities(new SimpleGrantedAuthority("ROLE_" + role))))
                    .andExpect(status().isForbidden());
        }
        when(context.getBean(NewsArchiveService.class).get(1, true)).thenReturn(archive());
        for (final String role : List.of("news-admin", "tournament-admin")) {
            mvc.perform(get("/api/admin/news/archives/1").with(jwt().authorities(new SimpleGrantedAuthority("ROLE_" + role))))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("FAILED"));
        }
        mvc.perform(post("/api/news/archives").with(jwt().authorities(new SimpleGrantedAuthority("ROLE_news-admin"))))
                .andExpect(status().isForbidden());
        mvc.perform(get("/api/admin/tournaments").with(jwt().authorities(new SimpleGrantedAuthority("ROLE_news-admin"))))
                .andExpect(status().isForbidden());
    }

    @Test void realSerializationPreservesNullsAndSourceLanguage() throws Exception {
        final NewsDtos.Article article = new NewsDtos.Article("old", "Source", "https://asia.wotblitz.com/en/news/updates/old/",
                "en", "2026-10-13T14:15:00", null, "revision", List.of(new NewsDtos.Block("b", "<p>Text</p>")),
                new NewsDtos.Sync(null, null, true));
        when(context.getBean(NewsSourceService.class).article("old")).thenReturn(article);
        mvc.perform(get("/api/news/articles/old")).andExpect(status().isOk())
                .andExpect(jsonPath("$.language").value("en")).andExpect(jsonPath("$.coverImageId").value(nullValue()))
                .andExpect(jsonPath("$.publishedAtRaw").value("2026-10-13T14:15:00"))
                .andExpect(jsonPath("$.sync.lastSuccessfulFetchAt").value(nullValue()))
                .andExpect(jsonPath("$.sync.stale").value(true));
    }

    @Test void strictRevisionAndUnknownFieldsCannotBypassFrozenMetadata() throws Exception {
        for (final String body : List.of("{}", "{\"expectedRevision\":null}", "{\"expectedRevision\":1.2}",
                "{\"expectedRevision\":\"1\"}", "{\"expectedRevision\":-1}", "{\"expectedRevision\":1,\"categoryIds\":[]}")) {
            mvc.perform(post("/api/admin/news/archives/1/retry").with(jwt().authorities(new SimpleGrantedAuthority("ROLE_news-admin")))
                    .contentType("application/json").content(body)).andExpect(status().isBadRequest());
        }
        mvc.perform(post("/api/admin/news/archives").with(jwt().authorities(new SimpleGrantedAuthority("ROLE_news-admin")))
                .contentType("application/json").content("{\"idempotencyKey\":\"123\",\"archives\":[{\"title\":\"t\",\"version\":\"1\",\"categoryIds\":[1.5],\"articles\":[]}]}"))
                .andExpect(status().isBadRequest());
        verifyNoInteractions(context.getBean(NewsArchiveService.class));
    }

    @Test void deleteRequiresExplicitRevisionAndConfirmationAndReturns204() throws Exception {
        mvc.perform(delete("/api/admin/news/archives/1?expectedRevision=1")
                .with(jwt().authorities(new SimpleGrantedAuthority("ROLE_news-admin")))).andExpect(status().isBadRequest());
        mvc.perform(delete("/api/admin/news/archives/1?expectedRevision=1&confirm=true")
                .with(jwt().authorities(new SimpleGrantedAuthority("ROLE_news-admin")))).andExpect(status().isNoContent());
        verify(context.getBean(NewsArchiveService.class)).delete(1, 1, true);
    }

    @Test void withdrawnImagesAreReauthorizedBeforeConditionalGet() throws Exception {
        final NewsImageService images = context.getBean(NewsImageService.class);
        when(images.image("image", false)).thenReturn(new NewsImageService.Blob(new byte[]{1, 2}, "image/png", "a".repeat(64)));
        mvc.perform(get("/api/news/images/image")).andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-cache"))
                .andExpect(header().string("X-Content-Type-Options", "nosniff"));
        when(images.image("image", false)).thenThrow(new ApiException(ApiErrorCode.RESOURCE_NOT_FOUND));
        mvc.perform(get("/api/news/images/image").header("If-None-Match", "\"" + "a".repeat(64) + "\""))
                .andExpect(status().isNotFound());
    }

    @Test void frozenPreviewImagesRequireNewsRoleAndNeverCachePrivateBytes() throws Exception {
        final String path = "/api/admin/news/archives/1/source-images/" + "a".repeat(64);
        mvc.perform(get(path)).andExpect(status().isUnauthorized());
        mvc.perform(get(path).with(jwt().authorities(new SimpleGrantedAuthority("ROLE_wotbtools-user"))))
                .andExpect(status().isForbidden());
        when(context.getBean(NewsImageService.class).frozenSourceImage(1, "a".repeat(64)))
                .thenReturn(new NewsImageService.Blob(new byte[]{1, 2}, "image/png", "hash"));
        mvc.perform(get(path).with(jwt().authorities(new SimpleGrantedAuthority("ROLE_news-admin"))))
                .andExpect(status().isOk()).andExpect(header().string("Cache-Control", "no-store"));
    }

    private static NewsDtos.Archive archive() {
        return new NewsDtos.Archive(1, "WG", "11.21", "Archive", "FAILED", 1, List.of(), List.of(),
                Instant.parse("2026-10-17T00:00:00Z"), "reviewer", null, "NEWS_STORAGE_ERROR");
    }
    @Configuration @EnableWebMvc
    @Import({SecurityConfig.class, ApiErrorTestConfig.class, GlobalExceptionHandler.class})
    static class TestConfig {
        @Bean JwtDecoder jwtDecoder() { return mock(JwtDecoder.class); }
        @Bean NewsArchiveService archives() { return mock(NewsArchiveService.class); }
        @Bean NewsSourceService sources() { return mock(NewsSourceService.class); }
        @Bean NewsImageService images() { return mock(NewsImageService.class); }
        @Bean NewsController publicController(final NewsArchiveService archives, final NewsSourceService sources, final NewsImageService images) {
            return new NewsController(archives, sources, images);
        }
        @Bean NewsAdminController adminController(final NewsArchiveService archives, final NewsImageService images) {
            return new NewsAdminController(archives, images);
        }
    }
}
