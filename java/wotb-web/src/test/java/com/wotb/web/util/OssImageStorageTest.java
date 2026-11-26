package com.wotb.web.util;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import com.wotb.web.util.apierror.ApiErrorCode;
import com.wotb.web.util.apierror.ApiException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTimeoutPreemptively;
import static org.junit.jupiter.api.Assertions.assertTrue;

class OssImageStorageTest {
    private static final byte[] PNG = java.util.HexFormat.of().parseHex("89504e470d0a1a0a0001");
    private static final ApiErrorCode FAILURE = ApiErrorCode.BROADCAST_STORAGE_ERROR;
    private static final ApiErrorCode MISSING = ApiErrorCode.RESOURCE_NOT_FOUND;
    private HttpServer server;
    private OssImageStorage storage;
    private PrivateImageStorage.Namespace images;
    private String key;
    private final AtomicInteger requests = new AtomicInteger();
    private final java.util.concurrent.ExecutorService handlers = Executors.newVirtualThreadPerTaskExecutor();

    @BeforeEach void start() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.setExecutor(handlers);
        server.start();
    }

    private void connect(final int timeoutMs) {
        storage = new OssImageStorage(OssImageStorage.build("cn-hangzhou", "fixture-id", "fixture-key", "fixture-token",
                "http://127.0.0.1:" + server.getAddress().getPort(), true, 1, timeoutMs), "private-images", "covers/", "avatars/");
        images = namespace(storage);
        key = images.key(UUID.randomUUID().toString());
    }

    private static PrivateImageStorage.Namespace namespace(final PrivateImageStorage store) {
        return store.namespace("covers/", ApiErrorCode.BROADCAST_STORAGE_UNAVAILABLE,
                ApiErrorCode.BROADCAST_COVER_INVALID, FAILURE, MISSING);
    }

    @AfterEach void close() throws Exception {
        if (storage != null) { storage.close(); }
        server.stop(0);
        handlers.shutdownNow();
    }

    @Test void oneProviderSelectedAndIncompleteOssCannotFallBackToCos() {
        final var runner = new ApplicationContextRunner().withUserConfiguration(CosImageStorage.class, OssImageStorage.class)
                .withPropertyValues("wotb.broadcast.cos.bucket=images-1251234567", "wotb.broadcast.cos.region=ap-shanghai",
                        "wotb.broadcast.cos.secret-id=fixture", "wotb.broadcast.cos.secret-key=fixture");
        runner.run(ctx -> assertInstanceOf(CosImageStorage.class, ctx.getBean(PrivateImageStorage.class)));
        runner.withPropertyValues("wotb.images.provider=oss").run(ctx -> {
            final var store = ctx.getBean(PrivateImageStorage.class);
            assertInstanceOf(OssImageStorage.class, store);
            assertTrue(ctx.getBeansOfType(CosImageStorage.class).isEmpty());
            assertFalse(namespace(store).configured());
        });
    }

    @Test void signedPrivateCrudValidatesMimeLimitsAndNamespace() throws Exception {
        connect(3_000);
        final AtomicReference<byte[]> saved = new AtomicReference<>();
        final AtomicReference<String> media = new AtomicReference<>("image/png");
        final AtomicReference<String> acl = new AtomicReference<>();
        final AtomicReference<String> auth = new AtomicReference<>();
        final AtomicReference<String> token = new AtomicReference<>();
        server.createContext("/private-images/" + key, exchange -> {
            requests.incrementAndGet();
            try (exchange) {
                switch (exchange.getRequestMethod()) {
                    case "PUT" -> {
                        auth.set(exchange.getRequestHeaders().getFirst("Authorization"));
                        token.set(exchange.getRequestHeaders().getFirst("x-oss-security-token"));
                        acl.set(exchange.getRequestHeaders().getFirst("x-oss-object-acl"));
                        media.set(exchange.getRequestHeaders().getFirst("Content-Type"));
                        saved.set(exchange.getRequestBody().readAllBytes());
                        exchange.sendResponseHeaders(200, -1);
                    }
                    case "GET" -> reply(exchange, 200, media.get(), saved.get());
                    case "DELETE" -> { saved.set(null); exchange.sendResponseHeaders(204, -1); }
                    default -> exchange.sendResponseHeaders(405, -1);
                }
            }
        });
        assertThrows(ApiException.class, () -> images.delete("avatars/" + UUID.randomUUID()));
        assertEquals(0, requests.get());
        images.put(key, new ImageValidation.Image(PNG, ImageValidation.sha256(PNG), "image/png"));
        assertEquals("private", acl.get());
        assertEquals("fixture-token", token.get());
        assertTrue(auth.get().startsWith("OSS4-HMAC-SHA256 "));
        assertArrayEquals(PNG, images.get(key, PNG.length));
        assertEquals(FAILURE, assertThrows(ApiException.class, () -> images.get(key, PNG.length - 1)).errorCode());
        media.set("image/jpeg");
        assertEquals(FAILURE, assertThrows(ApiException.class, () -> images.get(key)).errorCode());
        images.delete(key);
        assertNull(saved.get());
    }

    @Test void onlyNoSuchKeyMeansMissingOrAlreadyDeleted() {
        connect(3_000);
        final AtomicReference<String> code = new AtomicReference<>("NoSuchKey");
        server.createContext("/", exchange -> {
            try (exchange) {
                final String value = code.get();
                reply(exchange, value.equals("AccessDenied") ? 403 : 404, "application/xml",
                        ("<Error><Code>" + value + "</Code><Message>fixture</Message></Error>").getBytes(StandardCharsets.UTF_8));
            }
        });
        assertEquals(MISSING, assertThrows(ApiException.class, () -> images.get(key)).errorCode());
        images.delete(key);
        for (String serviceError : new String[]{"NoSuchBucket", "AccessDenied"}) {
            code.set(serviceError);
            assertEquals(FAILURE, assertThrows(ApiException.class, () -> images.get(key)).errorCode());
            assertEquals(FAILURE, assertThrows(ApiException.class, () -> images.delete(key)).errorCode());
        }
    }

    @Test void slowBodyExpiresAndFreesTheOnlyConnection() throws Exception {
        connect(800);
        final CountDownLatch started = new CountDownLatch(1);
        final CountDownLatch disconnected = new CountDownLatch(1);
        server.createContext("/", exchange -> {
            try (exchange) {
                if (requests.incrementAndGet() != 1) {
                    reply(exchange, 200, "image/png", PNG);
                    return;
                }
                exchange.sendResponseHeaders(200, 0);
                started.countDown();
                while (true) {
                    exchange.getResponseBody().write(1);
                    exchange.getResponseBody().flush();
                    try { Thread.sleep(40); } catch (InterruptedException e) { return; }
                }
            } catch (IOException closedByClient) { disconnected.countDown(); }
        });
        try (var workers = Executors.newVirtualThreadPerTaskExecutor()) {
            final var first = workers.submit(() -> assertThrows(ApiException.class, () -> images.get(key)).errorCode());
            assertTrue(started.await(2, TimeUnit.SECONDS));
            assertEquals(FAILURE, first.get(2, TimeUnit.SECONDS));
            assertTrue(disconnected.await(2, TimeUnit.SECONDS));
            assertArrayEquals(PNG, images.get(key));
        }
    }

    @Test void saturatedPoolFailsWithinItsWaitBudgetAndRemainsUsable() throws Exception {
        connect(12_000);
        final CountDownLatch occupied = new CountDownLatch(1);
        final CountDownLatch release = new CountDownLatch(1);
        server.createContext("/", exchange -> {
            try (exchange) {
                if (requests.incrementAndGet() == 1) {
                    occupied.countDown();
                    try { release.await(15, TimeUnit.SECONDS); } catch (InterruptedException ignored) { return; }
                }
                reply(exchange, 200, "image/png", PNG);
            }
        });
        try (var workers = Executors.newVirtualThreadPerTaskExecutor()) {
            final var first = workers.submit(() -> images.get(key));
            try {
                assertTrue(occupied.await(3, TimeUnit.SECONDS));
                assertTimeoutPreemptively(Duration.ofSeconds(8), () -> assertEquals(FAILURE,
                        assertThrows(ApiException.class, () -> images.get(key)).errorCode()));
                assertEquals(1, requests.get());
            } finally { release.countDown(); }
            assertArrayEquals(PNG, first.get(3, TimeUnit.SECONDS));
            assertArrayEquals(PNG, images.get(key));
        }
    }

    @Test void stalledPutReceivesOneAttemptAndSubsequentReadCanProceed() {
        connect(700);
        final CountDownLatch release = new CountDownLatch(1);
        server.createContext("/", exchange -> {
            try (exchange) {
                if (exchange.getRequestMethod().equals("PUT")) {
                    requests.incrementAndGet();
                    try { release.await(4, TimeUnit.SECONDS); } catch (InterruptedException ignored) { return; }
                } else { reply(exchange, 200, "image/png", PNG); }
            }
        });
        try {
            assertTimeoutPreemptively(Duration.ofSeconds(2), () -> assertEquals(FAILURE, assertThrows(ApiException.class,
                    () -> images.put(key, new ImageValidation.Image(new byte[ImageValidation.MAX_BYTES], "", "image/png"))).errorCode()));
            assertEquals(1, requests.get());
            assertArrayEquals(PNG, images.get(key));
        } finally { release.countDown(); }
    }

    private static void reply(final HttpExchange exchange, final int status, final String type, final byte[] bytes) throws IOException {
        exchange.getResponseHeaders().set("Content-Type", type);
        exchange.sendResponseHeaders(status, bytes.length);
        exchange.getResponseBody().write(bytes);
    }
}
