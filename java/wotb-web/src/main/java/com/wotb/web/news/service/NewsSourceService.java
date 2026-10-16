package com.wotb.web.news.service;

import com.wotb.web.news.dto.NewsDtos.Article;
import com.wotb.web.news.dto.NewsDtos.ArticlePage;
import com.wotb.web.news.dto.NewsDtos.Block;
import com.wotb.web.news.dto.NewsDtos.Selection;
import com.wotb.web.news.dto.NewsDtos.Source;
import com.wotb.web.news.dto.NewsDtos.Sync;
import com.wotb.web.util.apierror.ApiErrorCode;
import com.wotb.web.util.apierror.ApiException;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.InetAddress;
import java.net.URI;
import java.net.UnknownHostException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.function.Function;
import org.apache.http.client.config.RequestConfig;
import org.apache.http.client.methods.HttpGet;
import org.apache.http.impl.client.CloseableHttpClient;
import org.apache.http.impl.client.HttpClients;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.jsoup.nodes.Node;
import org.jsoup.safety.Cleaner;
import org.jsoup.safety.Safelist;
import org.jsoup.select.NodeTraversor;
import org.jsoup.select.NodeVisitor;
import org.springframework.stereotype.Service;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.util.StringUtils;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Fixed ASIA CMS source. Bounded, replace-on-success caches are never permanent archives. */
@Service
public class NewsSourceService implements AutoCloseable {
    static final String ORIGIN = "https://asia.wotblitz.com";
    static final String CDN = "https://media-wbp.wgcdn.co";
    public static final String IMAGE_PATH = "/api/news/source-images/";
    private static final Duration TTL = Duration.ofHours(12);
    private static final int MAX_JSON_BYTES = 1024 * 1024;
    private static final int MAX_IMAGE_BYTES = 10 * 1024 * 1024;
    private static final int MAX_DETAILS = 128;
    private static final int MAX_DETAIL_BYTES = 32 * 1024 * 1024;
    private static final int MAX_IMAGES = 120;
    private static final Set<String> BLOCKS = Set.of("p", "h1", "h2", "h3", "h4", "h5", "h6",
            "ul", "ol", "table", "figure", "blockquote", "pre", "hr");
    private static final Safelist SAFE_HTML = new Safelist()
            .addTags("p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "table", "thead",
                    "tbody", "tfoot", "tr", "th", "td", "caption", "figure", "figcaption", "blockquote",
                    "pre", "code", "hr", "br", "strong", "b", "em", "i", "u", "s", "del", "sup", "sub",
                    "a", "img", "div", "span")
            .addAttributes("a", "href", "title").addProtocols("a", "href", "https", "http")
            .addEnforcedAttribute("a", "rel", "noopener noreferrer")
            .addAttributes("img", "src", "alt", "title").addProtocols("img", "src", "https")
            .addAttributes("td", "colspan", "rowspan").addAttributes("th", "colspan", "rowspan", "scope")
            .addAttributes("ol", "start").preserveRelativeLinks(true);

    private final Object lock = new Object();
    private final Clock clock;
    private final boolean enabled;
    private final JsonMapper json = JsonMapper.builder().build();
    private final ScheduledThreadPoolExecutor timers = new ScheduledThreadPoolExecutor(1,
            Thread.ofPlatform().daemon().name("news-source-timer-", 0).factory());
    private final ThreadPoolExecutor workers = new ThreadPoolExecutor(2, 2, 0, TimeUnit.SECONDS,
            new ArrayBlockingQueue<>(32), Thread.ofPlatform().daemon().name("news-source-", 0).factory());
    private final CloseableHttpClient http;
    private final LinkedHashMap<String, CachedArticle> details = new LinkedHashMap<>(16, .75f, true);
    private final Map<String, CompletableFuture<CachedArticle>> articleFlights = new LinkedHashMap<>();
    private final LinkedHashMap<String, Instant> failedArticles = new LinkedHashMap<>();
    private final LinkedHashMap<String, CachedImage> sourceImages = new LinkedHashMap<>(16, .75f, true);
    private final Map<String, CompletableFuture<byte[]>> imageFlights = new LinkedHashMap<>();
    private CompletableFuture<Void> listFlight;
    private List<Article> listing = List.of();
    private Map<String, String> listingImages = Map.of();
    private Instant listSuccess;
    private Instant listAttempt;
    private boolean listFailed;

    @Autowired
    public NewsSourceService(@Value("${wotb.news.source.enabled:true}") final boolean enabled) {
        this(Clock.systemUTC(), enabled);
    }

    NewsSourceService(final Clock clock) { this(clock, true); }

    private NewsSourceService(final Clock clock, final boolean enabled) {
        this.clock = clock;
        this.enabled = enabled;
        timers.setRemoveOnCancelPolicy(true);
        http = HttpClients.custom().disableRedirectHandling().disableAutomaticRetries().disableCookieManagement()
                .setMaxConnTotal(4).setMaxConnPerRoute(4)
                .setDnsResolver(NewsSourceService::publicAddresses)
                .setDefaultRequestConfig(RequestConfig.custom().setConnectTimeout(5000)
                        .setSocketTimeout(15000).setConnectionRequestTimeout(5000).build()).build();
    }

    @PostConstruct
    void start() {
        // Timers never run network I/O: the same timer must still be able to abort a slow response.
        if (enabled) timers.scheduleWithFixedDelay(this::scheduleRefresh, 0, 1, TimeUnit.MINUTES);
    }

    public List<Source> sources() { return List.of(new Source("WG", true), new Source("LESTA", false)); }

    public ArticlePage list(final int page, final int size) {
        if (!enabled) throw unavailable();
        if (page < 1 || size < 1 || size > 50) throw new ApiException(ApiErrorCode.INVALID_ARGUMENT);
        final CompletableFuture<Void> loading;
        synchronized (lock) { loading = listSuccess == null ? refreshList() : null; }
        if (loading != null) await(loading, 125);
        synchronized (lock) {
            if (listSuccess == null) throw unavailable();
            final int from = (int) Math.min((long) (page - 1) * size, listing.size());
            final int to = Math.min(from + size, listing.size());
            return new ArticlePage(List.copyOf(listing.subList(from, to)), page, size, listing.size(),
                    sync(listSuccess, listAttempt, listFailed));
        }
    }

    public Article article(final String sourceKey) {
        if (!enabled) throw unavailable();
        slug(sourceKey);
        final CompletableFuture<CachedArticle> loading;
        synchronized (lock) {
            final CachedArticle cached = details.get(sourceKey);
            if (cached != null) return withSync(cached.article(), sync(cached.success(), cached.attempt(), cached.failed()));
            loading = refreshArticle(sourceKey);
        }
        final CachedArticle cached = await(loading, 125);
        return withSync(cached.article(), sync(cached.success(), cached.attempt(), cached.failed()));
    }

    /** Does not fetch: a missing/evicted revision requires another preview, never a silently newer snapshot. */
    public Article selected(final Selection selection) {
        if (selection == null || selection.blockIds() == null || selection.blockIds().isEmpty()
                || selection.blockIds().size() > 1000 || selection.blockIds().stream().anyMatch(java.util.Objects::isNull)) {
            throw new ApiException(ApiErrorCode.INVALID_ARGUMENT);
        }
        synchronized (lock) {
            final CachedArticle cached = details.get(selection.sourceKey());
            if (cached == null || !cached.article().revision().equals(selection.revision())) {
                throw new ApiException(ApiErrorCode.NEWS_REVISION_CONFLICT);
            }
            final Set<String> selected = new HashSet<>(selection.blockIds());
            final List<Block> blocks = cached.article().blocks().stream().filter(b -> selected.contains(b.id())).toList();
            if (selected.size() != selection.blockIds().size() || blocks.size() != selected.size()) {
                throw new ApiException(ApiErrorCode.INVALID_ARGUMENT);
            }
            final Article a = cached.article();
            return new Article(a.sourceKey(), a.title(), a.sourceUrl(), a.language(), a.publishedAtRaw(),
                    a.coverImageId(), a.revision(), blocks, null);
        }
    }

    /** Call immediately after selection and persist this map alongside the frozen blocks. */
    public Map<String, String> imageSources(final Article article) {
        final Set<String> ids = new HashSet<>();
        if (article.coverImageId() != null) ids.add(article.coverImageId());
        article.blocks().forEach(block -> Jsoup.parseBodyFragment(block.html()).select("img").forEach(img -> {
            final String src = img.attr("src");
            if (!src.startsWith(IMAGE_PATH)) throw new ApiException(ApiErrorCode.NEWS_CONTENT_UNSUPPORTED);
            ids.add(src.substring(IMAGE_PATH.length()));
        }));
        synchronized (lock) {
            final Map<String, String> result = new LinkedHashMap<>();
            for (final String id : ids) {
                final String url = findImage(id);
                if (url == null) throw new ApiException(ApiErrorCode.NEWS_REVISION_CONFLICT);
                result.put(id, url);
            }
            return Map.copyOf(result);
        }
    }

    public String imageSource(final String id) {
        if (id == null || !id.matches("[0-9a-f]{64}")) throw new ApiException(ApiErrorCode.RESOURCE_NOT_FOUND);
        synchronized (lock) {
            final String url = findImage(id);
            if (url == null) throw new ApiException(ApiErrorCode.RESOURCE_NOT_FOUND);
            return url;
        }
    }

    private String findImage(final String id) {
        final String listed = listingImages.get(id);
        if (listed != null) return listed;
        return details.values().stream().map(c -> c.images().get(id)).filter(java.util.Objects::nonNull).findFirst().orElse(null);
    }

    public byte[] downloadImage(final String url) { return download(imageUri(url), MAX_IMAGE_BYTES, Duration.ofSeconds(15)); }

    /** Public proxy IDs resolve only through current source snapshots, never arbitrary client URLs. */
    public byte[] sourceImage(final String id) {
        final String url = imageSource(id);
        final CompletableFuture<byte[]> flight;
        synchronized (lock) {
            final CachedImage cached = sourceImages.get(id);
            if (cached != null && clock.instant().isBefore(cached.expires())) return cached.bytes().clone();
            final CompletableFuture<byte[]> existing = imageFlights.get(id);
            if (existing != null) flight = existing;
            else {
                flight = new CompletableFuture<>();
                imageFlights.put(id, flight);
                try {
                    workers.execute(() -> {
                        try {
                            final byte[] bytes = downloadImage(url);
                            synchronized (lock) {
                                sourceImages.put(id, new CachedImage(bytes, clock.instant().plus(Duration.ofHours(1))));
                                while (sourceImages.size() > 64 || sourceImages.values().stream().mapToLong(i -> i.bytes().length).sum() > 16 * 1024 * 1024) {
                                    sourceImages.remove(sourceImages.keySet().iterator().next());
                                }
                            }
                            flight.complete(bytes);
                        } catch (final RuntimeException failure) { flight.completeExceptionally(failure); }
                        finally { synchronized (lock) { imageFlights.remove(id); } }
                    });
                } catch (final java.util.concurrent.RejectedExecutionException full) {
                    imageFlights.remove(id);
                    flight.completeExceptionally(unavailable());
                }
            }
        }
        return await(flight, 125).clone();
    }

    void scheduleRefresh() {
        synchronized (lock) {
            if (listAttempt == null || !clock.instant().isBefore(listAttempt.plus(TTL))) refreshList();
            final List<String> expired = details.entrySet().stream()
                    .filter(e -> !clock.instant().isBefore(e.getValue().attempt().plus(TTL)))
                    .map(Map.Entry::getKey).toList();
            expired.forEach(this::refreshArticle);
        }
    }

    private CompletableFuture<Void> refreshList() {
        if (listFlight != null) return listFlight;
        // A failed cold load must not turn every client retry into another upstream fetch.
        if (listSuccess == null && listAttempt != null && clock.instant().isBefore(listAttempt.plus(TTL))) {
            return CompletableFuture.failedFuture(unavailable());
        }
        listAttempt = clock.instant();
        final CompletableFuture<Void> result = new CompletableFuture<>();
        listFlight = result;
        try {
            workers.execute(() -> {
                try {
                    final List<Article> articles = new ArrayList<>();
                    final Map<String, String> images = new LinkedHashMap<>();
                    final Set<String> keys = new HashSet<>();
                    final Instant deadline = clock.instant().plusSeconds(120);
                    int expected = -1;
                    for (int page = 1; page <= 20; page++) {
                        final JsonNode node = fetchJson(URI.create(ORIGIN + "/en/api/cms/news/?category=updates&page=" + page + "&page_size=50"), deadline);
                        final int count = node.path("count").asInt(-1);
                        if (count < 0 || count > 1000 || (expected >= 0 && count != expected)
                                || !node.path("results").isArray() || !node.path("has_next").isBoolean()) throw unavailable();
                        expected = count;
                        for (final JsonNode item : node.path("results")) {
                            final Article article = parseArticle(item, images, false, deadline);
                            if (!keys.add(article.sourceKey())) throw unavailable();
                            articles.add(article);
                        }
                        if (!node.path("has_next").asBoolean()) {
                            if (articles.size() != expected) throw unavailable();
                            synchronized (lock) {
                                listSuccess = clock.instant();
                                // CMS pins are editorial ordering; this view is ordered by official wall time, without inventing UTC.
                                listing = articles.stream().sorted(Comparator.comparing(Article::publishedAtRaw).reversed()).toList();
                                listingImages = Map.copyOf(images);
                                listFailed = false;
                            }
                            result.complete(null);
                            return;
                        }
                    }
                    throw unavailable();
                } catch (final RuntimeException failure) {
                    synchronized (lock) { listFailed = true; }
                    result.completeExceptionally(failure);
                } finally {
                    synchronized (lock) { listFlight = null; }
                }
            });
        } catch (final java.util.concurrent.RejectedExecutionException full) {
            listFlight = null;
            listFailed = true;
            result.completeExceptionally(unavailable());
        }
        return result;
    }

    private CompletableFuture<CachedArticle> refreshArticle(final String key) {
        final CompletableFuture<CachedArticle> flight = articleFlights.get(key);
        if (flight != null) return flight;
        final Instant failed = failedArticles.get(key);
        if (failed != null && clock.instant().isBefore(failed.plus(TTL))) return CompletableFuture.failedFuture(unavailable());
        final CompletableFuture<CachedArticle> result = new CompletableFuture<>();
        articleFlights.put(key, result);
        try {
            workers.execute(() -> {
                try {
                    final Instant deadline = clock.instant().plusSeconds(120);
                    final JsonNode node = fetchJson(URI.create(ORIGIN + "/en/api/cms/news/categories/updates/" + key
                            + "/?consumer=browser&add_related=false"), deadline);
                    final Map<String, String> images = new LinkedHashMap<>();
                    final Article article = parseArticle(node, images, true, deadline);
                    if (!key.equals(article.sourceKey())) throw unavailable();
                    final int articleBytes = json.writeValueAsBytes(article).length;
                    if (articleBytes > MAX_JSON_BYTES) throw unsupported();
                    final int bytes = articleBytes + images.entrySet().stream().mapToInt(e -> 2 * (e.getKey().length() + e.getValue().length())).sum();
                    final CachedArticle cached = new CachedArticle(article, Map.copyOf(images), clock.instant(), clock.instant(), false, bytes);
                    synchronized (lock) {
                        failedArticles.remove(key);
                        details.put(key, cached);
                        while (details.size() > MAX_DETAILS || details.values().stream().mapToLong(CachedArticle::bytes).sum() > MAX_DETAIL_BYTES) {
                            details.remove(details.keySet().iterator().next());
                        }
                    }
                    result.complete(cached);
                } catch (final RuntimeException failure) {
                    synchronized (lock) {
                        failedArticles.put(key, clock.instant());
                        while (failedArticles.size() > MAX_DETAILS) failedArticles.remove(failedArticles.keySet().iterator().next());
                        final CachedArticle old = details.get(key);
                        if (old != null) details.put(key, new CachedArticle(old.article(), old.images(), old.success(), clock.instant(), true, old.bytes()));
                    }
                    result.completeExceptionally(failure);
                } finally {
                    synchronized (lock) { articleFlights.remove(key); }
                }
            });
        } catch (final java.util.concurrent.RejectedExecutionException full) {
            articleFlights.remove(key);
            result.completeExceptionally(unavailable());
        }
        return result;
    }

    private Article parseArticle(final JsonNode node, final Map<String, String> images, final boolean full, final Instant deadline) {
        final String key = text(node, "slug");
        slug(key);
        if (!"updates".equals(node.path("category").path("slug").asText())) throw unavailable();
        final String language = text(node, "lang");
        // These are the actual CMS languages accepted by this source, never the user's UI locale.
        if (!Set.of("en", "zh", "zh-cn", "zh-tw").contains(language.toLowerCase(Locale.ROOT))) throw unavailable();
        // CMS name is an internal label (for example Update 11.21); translation.title is the published heading.
        final String publicTitle = node.path("translation").path("title").asText("");
        final String title = StringUtils.hasText(publicTitle) ? publicTitle : text(node, "name");
        final String published = text(node, "publication_start_at");
        final String sourceUrl = ORIGIN + "/" + language + "/news/updates/" + key + "/";
        final String coverUrl = node.path("images").path("big").asText("");
        final String cover = StringUtils.hasText(coverUrl) ? registerImage(coverUrl, images) : null;
        final List<Block> blocks = full ? blocks(text(node, "content"), sourceUrl, images, uuid ->
                fetchJson(URI.create(ORIGIN + "/en/api/cms/folder/" + uuid + "/"), deadline)) : List.of();
        final String revision = hash("news-html-v1\n" + key + "\n" + title + "\n" + sourceUrl + "\n" + language + "\n"
                + published + "\n" + cover + "\n" + json.writeValueAsString(blocks));
        return new Article(key, title, sourceUrl, language, published, cover, revision, blocks, null);
    }

    List<Block> blocks(final String html, final String sourceUrl, final Map<String, String> images,
                       final Function<String, JsonNode> galleryLoader) {
        if (html.getBytes(StandardCharsets.UTF_8).length > MAX_JSON_BYTES) throw unsupported();
        final Document raw = Jsoup.parseBodyFragment(html, sourceUrl);
        if (raw.getAllElements().size() > 20000) throw unsupported();
        NodeTraversor.traverse(new NodeVisitor() {
            @Override public void head(final Node node, final int depth) { if (depth > 64) throw unsupported(); }
            @Override public void tail(final Node node, final int depth) { }
        }, raw);
        raw.outputSettings().prettyPrint(false);
        raw.select("script,style,noscript,template,svg,math").remove();
        final List<Element> galleries = List.copyOf(raw.select("gallery"));
        if (galleries.size() > 12) throw unsupported();
        for (final Element gallery : galleries) {
            final String uuid = gallery.attr("uuid");
            try { if (!UUID.fromString(uuid).toString().equals(uuid)) throw unsupported(); }
            catch (final IllegalArgumentException invalid) { throw unsupported(); }
            final JsonNode files = galleryLoader.apply(uuid).path("files");
            if (!files.isArray() || files.isEmpty()) throw unsupported();
            final Element figure = new Element("figure");
            for (final JsonNode file : files) {
                if (!file.isString()) throw unsupported();
                figure.appendElement("img").attr("src", file.asText());
            }
            gallery.replaceWith(figure);
        }
        for (final Element element : List.copyOf(raw.getAllElements())) {
            // Unknown CSS image syntax is an explicit unsupported article, never a silently incomplete archive.
            if (element.attr("style").toLowerCase(Locale.ROOT).contains("url(") || element.hasAttr("background")
                    || element.hasAttr("data-background") || element.hasAttr("data-bg")) throw unsupported();
            if (Set.of("iframe", "video", "audio", "object", "embed").contains(element.normalName())) {
                final Element link = new Element("a").attr("href", sourceUrl).text("View original media");
                element.replaceWith(link);
            }
        }
        for (final Element img : raw.select("img")) {
            String url = "";
            for (final String attr : List.of("data-srcset", "srcset", "data-src", "data-original", "src")) {
                if (!StringUtils.hasText(img.attr(attr))) continue;
                url = attr.contains("srcset") ? srcset(img.attr(attr)) : img.attr(attr);
                break;
            }
            final Element picture = img.parent();
            if (picture != null && "picture".equals(picture.normalName())) {
                final Element source = picture.selectFirst("source[srcset]");
                if (source != null) url = srcset(source.attr("srcset"));
            }
            if (!StringUtils.hasText(url)) throw unsupported();
            final String id = registerImage(url, images);
            img.attr("src", ORIGIN + IMAGE_PATH + id);
        }
        if (images.size() > MAX_IMAGES) throw unsupported();
        raw.select("source").remove();
        final Document clean = new Cleaner(SAFE_HTML).clean(raw);
        clean.outputSettings().prettyPrint(false);
        clean.select("img").forEach(img -> img.attr("src", URI.create(img.attr("src")).getPath()));
        final List<String> fragments = new ArrayList<>();
        collectBlocks(clean.body(), fragments);
        if (fragments.isEmpty() || fragments.size() > 1000) throw unsupported();
        final List<Block> result = new ArrayList<>();
        for (int index = 0; index < fragments.size(); index++) {
            final String fragment = fragments.get(index);
            result.add(new Block("b" + index + "-" + hash(fragment).substring(0, 16), fragment));
        }
        return List.copyOf(result);
    }

    private static void collectBlocks(final Element container, final List<String> result) {
        final Element inline = new Element("p");
        for (final Node child : container.childNodes()) {
            if (child instanceof Element element && BLOCKS.contains(element.normalName())) {
                flush(inline, result);
                if (element.hasText() || !element.select("img,hr,br").isEmpty()) result.add(element.outerHtml());
            } else if (child instanceof Element element && "div".equals(element.normalName())) {
                flush(inline, result);
                collectBlocks(element, result);
            } else {
                inline.appendChild(child.clone());
            }
        }
        flush(inline, result);
    }

    private static void flush(final Element inline, final List<String> result) {
        if (inline.hasText() || !inline.select("img,br").isEmpty()) result.add(inline.outerHtml());
        inline.empty();
    }

    private static String srcset(final String value) {
        final String[] candidates = value.split(",");
        if (candidates.length == 0 || candidates.length > 20) throw unsupported();
        final String candidate = candidates[candidates.length - 1].trim().split("\\s+")[0];
        if (!StringUtils.hasText(candidate)) throw unsupported();
        return candidate;
    }

    private static String registerImage(final String url, final Map<String, String> images) {
        final String normalized = imageUri(url).toASCIIString();
        final String id = hash(normalized);
        images.put(id, normalized);
        // A listing has up to 1000 covers; article bounds are enforced separately below.
        return id;
    }

    static URI imageUri(final String value) {
        try {
            if (!StringUtils.hasText(value) || value.length() > 2048) throw unsupported();
            final URI uri = URI.create(value.startsWith("//") ? "https:" + value : value.startsWith("/media/") ? CDN + value : value);
            validateUri(uri, true);
            return uri;
        } catch (final IllegalArgumentException invalid) { throw new ApiException(ApiErrorCode.NEWS_IMAGE_INVALID); }
    }

    static void validateUri(final URI uri, final boolean image) {
        final String host = uri.getHost();
        if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getRawUserInfo() != null || uri.getFragment() != null
                || (uri.getPort() != -1 && uri.getPort() != 443) || host == null
                || !(image ? "media-wbp.wgcdn.co".equalsIgnoreCase(host) : "asia.wotblitz.com".equalsIgnoreCase(host))) {
            throw new ApiException(ApiErrorCode.NEWS_IMAGE_INVALID);
        }
    }

    static InetAddress[] publicAddresses(final String host) throws UnknownHostException {
        final InetAddress[] addresses = InetAddress.getAllByName(host);
        for (final InetAddress address : addresses) {
            final byte[] bytes = address.getAddress();
            if (address.isAnyLocalAddress() || address.isLoopbackAddress() || address.isLinkLocalAddress()
                    || address.isSiteLocalAddress() || address.isMulticastAddress()
                    || (bytes.length == 16 && (bytes[0] & 0xfe) == 0xfc)
                    || (bytes.length == 4 && ((bytes[0] & 255) == 0 || (bytes[0] & 255) >= 224
                    || ((bytes[0] & 255) == 100 && ((bytes[1] & 255) >= 64 && (bytes[1] & 255) <= 127))))) {
                throw new UnknownHostException("Non-public news source address");
            }
        }
        return addresses;
    }

    JsonNode fetchJson(final URI uri, final Instant deadline) {
        final Duration remaining = Duration.between(clock.instant(), deadline);
        if (remaining.isNegative() || remaining.isZero()) throw unavailable();
        return json.readTree(download(uri, MAX_JSON_BYTES, remaining.compareTo(Duration.ofSeconds(15)) > 0 ? Duration.ofSeconds(15) : remaining));
    }

    private byte[] download(final URI initial, final int maximum, final Duration timeout) {
        final long deadline = System.nanoTime() + timeout.toNanos();
        URI uri = initial;
        final boolean image = "media-wbp.wgcdn.co".equalsIgnoreCase(initial.getHost());
        for (int redirects = 0; redirects <= 3; redirects++) {
            validateUri(uri, image);
            final long left = deadline - System.nanoTime();
            if (left <= 0) throw unavailable();
            final HttpGet request = new HttpGet(uri);
            request.setHeader("Accept", image ? "image/*" : "application/json");
            final var abort = timers.schedule(request::abort, left, TimeUnit.NANOSECONDS);
            try (final var response = http.execute(request)) {
                final int status = response.getStatusLine().getStatusCode();
                if (Set.of(301, 302, 303, 307, 308).contains(status)) {
                    final var location = response.getFirstHeader("Location");
                    if (location == null) throw unavailable();
                    uri = uri.resolve(location.getValue());
                    continue;
                }
                if (status != 200 || response.getEntity() == null) throw unavailable();
                if (response.getEntity().getContentLength() > maximum) throw new ApiException(ApiErrorCode.FILE_TOO_LARGE);
                try (final var input = response.getEntity().getContent(); final var out = new ByteArrayOutputStream()) {
                    final byte[] buffer = new byte[8192];
                    int length;
                    while ((length = input.read(buffer)) != -1) {
                        if (System.nanoTime() > deadline) throw unavailable();
                        if (out.size() + length > maximum) throw new ApiException(ApiErrorCode.FILE_TOO_LARGE);
                        out.write(buffer, 0, length);
                    }
                    return out.toByteArray();
                }
            } catch (final IOException failure) { throw unavailable(); }
            finally { abort.cancel(false); request.abort(); }
        }
        throw unavailable();
    }

    private Sync sync(final Instant success, final Instant attempt, final boolean failed) {
        return new Sync(success, attempt.plus(TTL), failed || !clock.instant().isBefore(success.plus(TTL)));
    }

    private static Article withSync(final Article a, final Sync sync) {
        return new Article(a.sourceKey(), a.title(), a.sourceUrl(), a.language(), a.publishedAtRaw(),
                a.coverImageId(), a.revision(), a.blocks(), sync);
    }

    private static String text(final JsonNode node, final String field) {
        final JsonNode value = node.path(field);
        if (!value.isString() || !StringUtils.hasText(value.asText())) throw unavailable();
        return value.asText();
    }

    private static void slug(final String value) {
        if (value == null || !value.matches("[a-z0-9][a-z0-9_-]{0,159}")) throw new ApiException(ApiErrorCode.INVALID_ARGUMENT);
    }

    private static String hash(final String value) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))); }
        catch (final NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
    }

    private static <T> T await(final CompletableFuture<T> future, final int seconds) {
        try { return future.get(seconds, TimeUnit.SECONDS); }
        catch (final InterruptedException interrupted) { Thread.currentThread().interrupt(); throw unavailable(); }
        catch (final ExecutionException failure) {
            if (failure.getCause() instanceof ApiException error) throw error;
            throw unavailable();
        } catch (final TimeoutException timeout) { throw unavailable(); }
    }

    private static ApiException unavailable() { return new ApiException(ApiErrorCode.NEWS_SOURCE_UNAVAILABLE); }
    private static ApiException unsupported() { return new ApiException(ApiErrorCode.NEWS_CONTENT_UNSUPPORTED); }

    @PreDestroy
    @Override public void close() {
        workers.shutdownNow();
        timers.shutdownNow();
        try { http.close(); } catch (final IOException ignored) { /* Closing an already failed client needs no retry. */ }
    }

    private record CachedArticle(Article article, Map<String, String> images, Instant success,
                                 Instant attempt, boolean failed, int bytes) { }
    private record CachedImage(byte[] bytes, Instant expires) { }
}
