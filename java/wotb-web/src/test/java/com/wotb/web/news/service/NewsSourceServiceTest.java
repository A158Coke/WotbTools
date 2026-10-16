package com.wotb.web.news.service;

import com.wotb.web.news.dto.NewsDtos.Article;
import com.wotb.web.news.dto.NewsDtos.Selection;
import com.wotb.web.util.apierror.ApiErrorCode;
import com.wotb.web.util.apierror.ApiException;
import java.io.IOException;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.net.URI;
import java.net.UnknownHostException;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.jsoup.Jsoup;
import org.junit.jupiter.api.Test;
import org.apache.http.client.methods.CloseableHttpResponse;
import org.apache.http.client.methods.HttpGet;
import org.apache.http.entity.BasicHttpEntity;
import org.apache.http.impl.client.CloseableHttpClient;
import org.apache.http.message.BasicHeader;
import org.apache.http.message.BasicStatusLine;
import org.apache.http.HttpVersion;
import org.springframework.test.util.ReflectionTestUtils;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.times;

class NewsSourceServiceTest {
    private static final JsonMapper JSON = JsonMapper.builder().build();
    private static final String KEY = "update-14-10";
    private static final String PAGE = NewsSourceService.ORIGIN + "/en/news/updates/" + KEY + "/";

    @Test void realCmsShapeExpandsBothGalleriesAndPreservesListsAndRawTime() throws Exception {
        try (final NewsSourceService service = offline(new MutableClock())) {
            final Article article = service.article(KEY);
            assertEquals("Update: Halloween Madness", article.title());
            assertEquals("en", article.language());
            assertEquals("2026-10-13T14:15:00", article.publishedAtRaw());
            final var document = Jsoup.parseBodyFragment(join(article));
            assertEquals(12, document.select("img").size());
            assertEquals(6, document.select("ul").size());
            assertTrue(document.text().contains("Each time you enter the Garage"));
            assertTrue(document.text().contains("General bugs and client crash issues"));
            assertTrue(document.select("gallery").isEmpty());
            assertEquals(13, service.imageSources(article).size());
            document.select("img").forEach(img -> assertTrue(img.attr("src").matches("/api/news/source-images/[0-9a-f]{64}")));
            assertFalse(article.sync().stale());
        }
    }

    @Test void selectionRejectsDuplicateUnknownAndStaleIdsAndKeepsOriginalOrder() throws Exception {
        try (final NewsSourceService service = offline(new MutableClock())) {
            final Article article = service.article(KEY);
            final String first = article.blocks().getFirst().id();
            final String last = article.blocks().getLast().id();
            final Article selected = service.selected(new Selection(KEY, article.revision(), List.of(last, first)));
            assertEquals(List.of(first, last), selected.blocks().stream().map(b -> b.id()).toList());
            assertEquals(1, service.imageSources(selected).size(), "unselected gallery images must not be archived");
            assertCode(ApiErrorCode.INVALID_ARGUMENT, () -> service.selected(new Selection(KEY, article.revision(), List.of(first, first))));
            assertCode(ApiErrorCode.INVALID_ARGUMENT, () -> service.selected(new Selection(KEY, article.revision(), List.of("missing"))));
            assertCode(ApiErrorCode.NEWS_REVISION_CONFLICT, () -> service.selected(new Selection(KEY, "old", List.of(first))));
            assertCode(ApiErrorCode.NEWS_REVISION_CONFLICT, () -> service.selected(new Selection("uncached", "old", List.of(first))));
        }
    }

    @Test void sanitizerPreservesNestedAtomicBlocksAndBareTextWhileRemovingExecutableContent() {
        try (final NewsSourceService service = new NewsSourceService(new MutableClock())) {
            final var blocks = service.blocks("bare <span>alpha</span> <em>beta</em><section><div><ul><li>outer<ul><li>inner</li></ul></li></ul>"
                    + "<table><tr><td>A <strong>B</strong></td></tr></table></div></section>tail"
                    + "<script>alert(1)</script><p onclick='evil()'><a href='javascript:evil()'>safe text</a></p>",
                    PAGE, new LinkedHashMap<>(), id -> { throw new AssertionError(); });
            assertEquals(5, blocks.size());
            assertTrue(blocks.getFirst().html().contains("</span> <em>"), "inline whitespace is content");
            assertEquals("outer inner", Jsoup.parse(blocks.get(1).html()).text());
            assertEquals(2, Jsoup.parse(blocks.get(1).html()).select("ul").size());
            final String html = blocks.stream().map(b -> b.html()).reduce("", String::concat);
            assertTrue(html.contains("<table>"));
            assertTrue(html.contains("tail"));
            assertFalse(html.contains("onclick"));
            assertFalse(html.contains("javascript:"));
            assertFalse(html.contains("alert"));
        }
    }

    @Test void lazySrcsetAndPictureChooseOneControlledImageAndRemoveAllAlternatives() {
        try (final NewsSourceService service = new NewsSourceService(new MutableClock())) {
            final Map<String, String> images = new LinkedHashMap<>();
            final var blocks = service.blocks("<picture><source srcset='//media-wbp.wgcdn.co/media/a.jpg 1x, //media-wbp.wgcdn.co/media/b.jpg 2x'>"
                    + "<img src='data:image/gif;base64,x' data-src='/media/lazy.jpg' onerror='bad()'></picture>", PAGE, images, id -> null);
            assertEquals(List.of("https://media-wbp.wgcdn.co/media/b.jpg"), List.copyOf(images.values()));
            final String html = blocks.getFirst().html();
            assertFalse(html.contains("<source"));
            assertFalse(html.contains("srcset"));
            assertFalse(html.contains("data-src"));
            assertFalse(html.contains("onerror"));
        }
    }

    @Test void unknownNecessaryImageSyntaxAndTooManyImagesFailExplicitly() {
        try (final NewsSourceService service = new NewsSourceService(new MutableClock())) {
            for (final String html : List.of("<div style='background:url(https://example.com/a.png)'>text</div>",
                    "<img>", "<gallery uuid='invalid'>image</gallery>", "<div data-bg='/media/a.jpg'>text</div>")) {
                assertThrows(ApiException.class, () -> service.blocks(html, PAGE, new LinkedHashMap<>(), id -> null));
            }
            final StringBuilder html = new StringBuilder();
            for (int index = 0; index < 121; index++) html.append("<img src='/media/").append(index).append(".jpg'>");
            assertCode(ApiErrorCode.NEWS_CONTENT_UNSUPPORTED, () -> service.blocks(html.toString(), PAGE, new LinkedHashMap<>(), id -> null));
            assertCode(ApiErrorCode.NEWS_CONTENT_UNSUPPORTED, () -> service.blocks("<div>".repeat(70) + "deep" + "</div>".repeat(70),
                    PAGE, new LinkedHashMap<>(), id -> null));
            assertEquals(1000, service.blocks("<p>x</p>".repeat(1000), PAGE, new LinkedHashMap<>(), id -> null).size());
            assertCode(ApiErrorCode.NEWS_CONTENT_UNSUPPORTED, () -> service.blocks("<p>x</p>".repeat(1001),
                    PAGE, new LinkedHashMap<>(), id -> null));
        }
    }

    @Test void mediaEmbedsBecomeOriginalSourceLinksWithoutRemoteExecution() {
        try (final NewsSourceService service = new NewsSourceService(new MutableClock())) {
            final var blocks = service.blocks("<iframe src='https://youtube.com/embed/x'></iframe><video autoplay src='https://evil/video'></video>",
                    PAGE, new LinkedHashMap<>(), id -> null);
            final var document = Jsoup.parse(blocks.getFirst().html());
            assertEquals(2, document.select("a").size());
            assertTrue(document.select("iframe,video").isEmpty());
            assertEquals(PAGE, document.selectFirst("a").attr("href"));
        }
    }

    @Test void onlyHttpsOfficialCdnAndPublicAddressesAreAccepted() {
        assertEquals("https://media-wbp.wgcdn.co/media/a.jpg", NewsSourceService.imageUri("/media/a.jpg").toString());
        for (final String url : List.of("http://media-wbp.wgcdn.co/a", "https://media-wbp.wgcdn.co.evil/a", "https://127.0.0.1/a",
                "https://user@media-wbp.wgcdn.co/a", "https://media-wbp.wgcdn.co:8443/a", "file:///tmp/a", "data:image/png,x")) {
            assertThrows(ApiException.class, () -> NewsSourceService.imageUri(url));
        }
        for (final String address : List.of("127.0.0.1", "10.0.0.1", "169.254.169.254", "100.64.0.1", "::1", "fc00::1")) {
            assertThrows(UnknownHostException.class, () -> NewsSourceService.publicAddresses(address));
        }
        assertThrows(ApiException.class, () -> NewsSourceService.validateUri(URI.create("https://media-wbp.wgcdn.co/a"), false));
    }

    @Test void detailsUseSingleFlightAcrossConcurrentReaders() throws Exception {
        final CountDownLatch entered = new CountDownLatch(1);
        final CountDownLatch release = new CountDownLatch(1);
        final AtomicInteger reads = new AtomicInteger();
        try (final NewsSourceService service = offline(new MutableClock()); final var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            doAnswer(invocation -> {
                reads.incrementAndGet(); entered.countDown(); assertTrue(release.await(5, TimeUnit.SECONDS));
                return minimal(KEY, "<p>one</p>");
            }).when(service).fetchJson(any(), any());
            final List<java.util.concurrent.Future<Article>> futures = new ArrayList<>();
            for (int index = 0; index < 12; index++) futures.add(executor.submit(() -> service.article(KEY)));
            assertTrue(entered.await(5, TimeUnit.SECONDS));
            release.countDown();
            for (final var future : futures) assertEquals(KEY, future.get(5, TimeUnit.SECONDS).sourceKey());
            assertEquals(1, reads.get());
        } finally { release.countDown(); }
    }

    @Test void failedRefreshPreservesArticleAndItsImagesAndPublishesStaleStatus() throws Exception {
        final MutableClock clock = new MutableClock();
        final CountDownLatch refreshed = new CountDownLatch(1);
        final CountDownLatch release = new CountDownLatch(1);
        try (final NewsSourceService service = offline(clock)) {
            final Article original = service.article(KEY);
            doAnswer(invocation -> {
                if (invocation.getArgument(0).toString().contains("/categories/")) {
                    refreshed.countDown();
                    assertTrue(release.await(5, TimeUnit.SECONDS));
                }
                throw new ApiException(ApiErrorCode.NEWS_SOURCE_UNAVAILABLE);
            })
                    .when(service).fetchJson(any(), any());
            clock.advance(Duration.ofHours(13));
            service.scheduleRefresh();
            assertTrue(refreshed.await(5, TimeUnit.SECONDS));
            final var flights = (Map<?, ?>) ReflectionTestUtils.getField(service, "articleFlights");
            final var pending = (java.util.concurrent.CompletableFuture<?>) java.util.Objects.requireNonNull(flights).get(KEY);
            release.countDown();
            assertThrows(java.util.concurrent.CompletionException.class, java.util.Objects.requireNonNull(pending)::join);
            final Article stale = service.article(KEY);
            assertEquals(original.revision(), stale.revision());
            assertTrue(stale.sync().stale());
            assertEquals(13, service.imageSources(stale).size());
            assertEquals(original.sync().lastSuccessfulFetchAt(), stale.sync().lastSuccessfulFetchAt());
            assertEquals(clock.instant().plus(Duration.ofHours(12)), stale.sync().nextRefreshAt());
        } finally { release.countDown(); }
    }

    @Test void paginationIsCompleteAndListRefreshNeverPublishesAPartialSnapshot() throws Exception {
        final MutableClock clock = new MutableClock();
        try (final NewsSourceService service = offline(clock)) {
            doAnswer(invocation -> {
                final URI uri = invocation.getArgument(0);
                return JSON.readTree("{\"count\":2,\"has_next\":" + uri.getQuery().contains("page=1&")
                        + ",\"results\":[" + minimal(uri.getQuery().contains("page=1&") ? "one" : "two", "<p>x</p>") + "]}");
            }).when(service).fetchJson(any(), any());
            assertEquals(2, service.list(1, 1).totalItems());
            assertEquals("two", service.list(2, 1).items().getFirst().sourceKey());
            assertTrue(service.list(Integer.MAX_VALUE, 50).items().isEmpty());
            final CountDownLatch attempted = new CountDownLatch(1);
            doAnswer(invocation -> { attempted.countDown(); return JSON.readTree("{\"count\":3,\"has_next\":false,\"results\":[]}"); })
                    .when(service).fetchJson(any(), any());
            clock.advance(Duration.ofHours(13));
            service.scheduleRefresh();
            assertTrue(attempted.await(5, TimeUnit.SECONDS));
            assertEquals(2, service.list(1, 50).totalItems());
            assertTrue(service.list(1, 50).sync().stale());
        }
    }

    @Test void coldFailuresDoNotCausePerVisitorUpstreamRetries() {
        final AtomicInteger requests = new AtomicInteger();
        try (final NewsSourceService service = spy(new NewsSourceService(new MutableClock()))) {
            doAnswer(invocation -> { requests.incrementAndGet(); throw new ApiException(ApiErrorCode.NEWS_SOURCE_UNAVAILABLE); })
                    .when(service).fetchJson(any(), any());
            for (int index = 0; index < 3; index++) assertCode(ApiErrorCode.NEWS_SOURCE_UNAVAILABLE, () -> service.list(1, 50));
            for (int index = 0; index < 3; index++) assertCode(ApiErrorCode.NEWS_SOURCE_UNAVAILABLE, () -> service.article(KEY));
            assertEquals(2, requests.get());
        }
    }

    @Test void listUsesPublicationTimeInsteadOfEditorialPinOrder() throws Exception {
        try (final NewsSourceService service = offline(new MutableClock())) {
            final String older = minimal("pinned-old", "<p>x</p>").toString().replace("2026-10-13", "2025-01-01");
            final String newer = minimal("new", "<p>x</p>").toString();
            doReturn(JSON.readTree("{\"count\":2,\"has_next\":false,\"results\":[" + older + "," + newer + "]}"))
                    .when(service).fetchJson(any(), any());
            assertEquals(List.of("new", "pinned-old"), service.list(1, 50).items().stream().map(Article::sourceKey).toList());
        }
    }

    @Test void realHistoricalUnderscoreSlugIsSupportedButPathTraversalIsRejected() throws Exception {
        try (final NewsSourceService service = offline(new MutableClock())) {
            doReturn(minimal("chinese_lt", "<p>Chinese Light Tanks</p>")).when(service).fetchJson(any(), any());
            assertEquals("chinese_lt", service.article("chinese_lt").sourceKey());
            assertCode(ApiErrorCode.INVALID_ARGUMENT, () -> service.article("../private"));
            assertCode(ApiErrorCode.INVALID_ARGUMENT, () -> service.article("news?category=other"));
        }
    }

    @Test void actualLanguageAndSourceMetadataParticipateInRevision() throws Exception {
        try (final NewsSourceService english = offline(new MutableClock()); final NewsSourceService chinese = offline(new MutableClock())) {
            doReturn(minimal(KEY, "<p>x</p>")).when(english).fetchJson(any(), any());
            doReturn(JSON.readTree(minimal(KEY, "<p>x</p>").toString().replace("\"lang\":\"en\"", "\"lang\":\"zh-tw\"")))
                    .when(chinese).fetchJson(any(), any());
            assertEquals("zh-tw", chinese.article(KEY).language());
            assertNotEquals(english.article(KEY).revision(), chinese.article(KEY).revision());
        }
    }

    @Test void sourceProxyCachesBoundedBytesAndNeverReturnsItsMutableArray() throws Exception {
        final MutableClock clock = new MutableClock();
        final AtomicInteger downloads = new AtomicInteger();
        try (final NewsSourceService service = offline(clock)) {
            final String id = service.article(KEY).coverImageId();
            doAnswer(invocation -> { downloads.incrementAndGet(); return new byte[] {1, 2, 3}; }).when(service).downloadImage(anyString());
            final byte[] first = service.sourceImage(id);
            first[0] = 9;
            assertArrayEquals(new byte[] {1, 2, 3}, service.sourceImage(id));
            assertEquals(1, downloads.get());
            clock.advance(Duration.ofHours(2));
            service.sourceImage(id);
            assertEquals(2, downloads.get());
            assertCode(ApiErrorCode.RESOURCE_NOT_FOUND, () -> service.sourceImage("https://example.com/a"));
        }
    }

    @Test void redirectTargetIsValidatedBeforeOpeningTheNextConnection() throws Exception {
        try (final NewsSourceService service = new NewsSourceService(new MutableClock())) {
            final CloseableHttpClient http = replaceHttp(service);
            final CloseableHttpResponse response = mock(CloseableHttpResponse.class);
            when(response.getStatusLine()).thenReturn(new BasicStatusLine(HttpVersion.HTTP_1_1, 302, "Redirect"));
            when(response.getFirstHeader("Location")).thenReturn(new BasicHeader("Location", "https://127.0.0.1/private"));
            when(http.execute(any(HttpGet.class))).thenReturn(response);
            assertCode(ApiErrorCode.NEWS_IMAGE_INVALID, () -> service.downloadImage(NewsSourceService.CDN + "/media/a.jpg"));
            verify(http, times(1)).execute(any(HttpGet.class));
        }
    }

    @Test void oversizedChunkedBodyIsStoppedWithoutTrustingContentLength() throws Exception {
        try (final NewsSourceService service = new NewsSourceService(new MutableClock())) {
            final CloseableHttpClient http = replaceHttp(service);
            final BasicHttpEntity entity = new BasicHttpEntity();
            entity.setContentLength(-1);
            entity.setContent(new ByteArrayInputStream(new byte[10 * 1024 * 1024 + 1]));
            final CloseableHttpResponse oversized = response(entity);
            when(http.execute(any(HttpGet.class))).thenReturn(oversized);
            assertCode(ApiErrorCode.FILE_TOO_LARGE, () -> service.downloadImage(NewsSourceService.CDN + "/media/a.jpg"));
        }
    }

    @Test void overallDeadlineAbortsActualRequestEvenWhenBodyReadStalls() throws Exception {
        try (final NewsSourceService service = new NewsSourceService(new MutableClock())) {
            final CloseableHttpClient http = replaceHttp(service);
            final CountDownLatch aborted = new CountDownLatch(1);
            doAnswer(invocation -> {
                final HttpGet request = invocation.getArgument(0);
                request.setCancellable(() -> { aborted.countDown(); return true; });
                final BasicHttpEntity entity = new BasicHttpEntity();
                entity.setContent(new InputStream() {
                    @Override public int read() throws IOException {
                        try { assertTrue(aborted.await(5, TimeUnit.SECONDS)); }
                        catch (final InterruptedException interrupted) { Thread.currentThread().interrupt(); }
                        throw new IOException("Request aborted");
                    }
                });
                return response(entity);
            }).when(http).execute(any(HttpGet.class));
            assertCode(ApiErrorCode.NEWS_SOURCE_UNAVAILABLE, () -> ReflectionTestUtils.invokeMethod(service, "download",
                    URI.create(NewsSourceService.CDN + "/media/a.jpg"), 1024, Duration.ofMillis(50)));
            assertEquals(0, aborted.getCount());
        }
    }

    private static CloseableHttpClient replaceHttp(final NewsSourceService service) throws IOException {
        ((CloseableHttpClient) java.util.Objects.requireNonNull(ReflectionTestUtils.getField(service, "http"))).close();
        final CloseableHttpClient client = mock(CloseableHttpClient.class);
        ReflectionTestUtils.setField(service, "http", client);
        return client;
    }

    private static CloseableHttpResponse response(final BasicHttpEntity entity) {
        final CloseableHttpResponse response = mock(CloseableHttpResponse.class);
        when(response.getStatusLine()).thenReturn(new BasicStatusLine(HttpVersion.HTTP_1_1, 200, "OK"));
        when(response.getEntity()).thenReturn(entity);
        return response;
    }

    private static NewsSourceService offline(final MutableClock clock) throws IOException {
        final NewsSourceService service = spy(new NewsSourceService(clock));
        final JsonNode article = fixture("update-14-10.json");
        final JsonNode halloween = fixture("halloween-gallery.json");
        final JsonNode goldville = fixture("black-goldville-gallery.json");
        doAnswer(invocation -> {
            final String uri = invocation.getArgument(0).toString();
            if (uri.contains("fa9846f9")) return halloween;
            if (uri.contains("0014fbbe")) return goldville;
            return article;
        }).when(service).fetchJson(any(), any());
        return service;
    }

    private static JsonNode fixture(final String name) throws IOException {
        try (final var input = NewsSourceServiceTest.class.getResourceAsStream("/news/" + name)) {
            if (input == null) throw new IOException("Missing fixture");
            return JSON.readTree(new String(input.readAllBytes(), StandardCharsets.UTF_8));
        }
    }

    private static JsonNode minimal(final String key, final String html) {
        return JSON.valueToTree(Map.of("slug", key, "lang", "en", "name", "Update", "publication_start_at", "2026-10-13T14:15:00",
                "category", Map.of("slug", "updates"), "content", html));
    }

    private static String join(final Article article) { return article.blocks().stream().map(b -> b.html()).reduce("", String::concat); }
    private static void assertCode(final ApiErrorCode code, final Runnable action) {
        assertEquals(code, assertThrows(ApiException.class, action::run).errorCode());
    }

    private static class MutableClock extends Clock {
        private volatile Instant now = Instant.parse("2026-10-17T00:00:00Z");
        void advance(final Duration amount) { now = now.plus(amount); }
        @Override public ZoneId getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(final ZoneId zone) { return this; }
        @Override public Instant instant() { return now; }
    }
}
