package com.wotb.web.tournament.service;

import com.qcloud.cos.COSClient;
import com.qcloud.cos.ClientConfig;
import com.qcloud.cos.auth.BasicCOSCredentials;
import com.qcloud.cos.endpoint.EndpointBuilder;
import com.qcloud.cos.exception.CosClientException;
import com.qcloud.cos.exception.CosServiceException;
import com.qcloud.cos.http.HttpProtocol;
import com.qcloud.cos.model.COSObject;
import com.wotb.web.util.ImageValidation;
import com.wotb.web.util.apierror.ApiErrorCode;
import com.wotb.web.util.apierror.ApiException;
import org.apache.http.HttpEntityEnclosingRequest;
import org.apache.http.entity.ByteArrayEntity;
import org.apache.http.entity.ContentType;
import org.apache.http.impl.bootstrap.ServerBootstrap;
import org.apache.http.util.EntityUtils;
import org.junit.jupiter.api.Test;
import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.net.InetAddress;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.HexFormat;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.assertTimeoutPreemptively;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class BroadcastCosStorageTest {
    private static final String PREFIX = "league-broadcasts/covers/";

    @Test void missingOrUnsafeConfigurationDisablesOnlyCoverStorage() {
        final BroadcastCosStorage missing = new BroadcastCosStorage("", "", "", "", PREFIX);
        final BroadcastCosStorage unsafe = new BroadcastCosStorage("covers-1251234567", "ap-shanghai",
                "test-only", "test-only", "../assets/");
        try {
            assertFalse(missing.configured());
            assertFalse(unsafe.configured());
            assertEquals(ApiErrorCode.BROADCAST_STORAGE_UNAVAILABLE,
                    assertThrows(ApiException.class, () -> missing.get(PREFIX + UUID.randomUUID())).errorCode());
        } finally { missing.close(); unsafe.close(); }
    }

    @Test void productionClientBoundsEveryStageAndEnablesTheOtherwiseDisabledOverallDeadline() {
        final ClientConfig config = BroadcastCosStorage.clientConfig("ap-shanghai");
        assertEquals(HttpProtocol.https, config.getHttpProtocol());
        assertEquals(5_000, config.getConnectionTimeout());
        assertEquals(5_000, config.getConnectionRequestTimeout());
        assertEquals(15_000, config.getSocketTimeout());
        assertEquals(30_000, config.getRequestTimeout());
        assertTrue(config.getRequestTimeOutEnable());
        assertEquals(1, config.getMaxErrorRetry());
        assertEquals(8, config.getMaxConnectionsCount());
    }

    @Test void realSdkSimplePutGetDeleteWorkOnLoopbackWithTheBootManagedDependencies() throws Exception {
        final var objects = new ConcurrentHashMap<String, byte[]>();
        final AtomicInteger operations = new AtomicInteger();
        // COS's metadata parser expects canonical Content-Length/ETag spelling. The JDK server
        // normalizes these header names, so use the already-present Apache HTTP server instead.
        final var server = ServerBootstrap.bootstrap().setLocalAddress(InetAddress.getByName("127.0.0.1"))
                .setListenerPort(0).registerHandler("*", (request, response, context) -> {
            final String path = request.getRequestLine().getUri();
            operations.incrementAndGet();
            switch (request.getRequestLine().getMethod()) {
                case "PUT" -> {
                    final byte[] bytes = EntityUtils.toByteArray(((HttpEntityEnclosingRequest) request).getEntity());
                    objects.put(path, bytes);
                    response.setHeader("ETag", etag(bytes));
                    response.setStatusCode(200);
                }
                case "GET" -> {
                    final byte[] bytes = objects.get(path);
                    if (bytes == null) { response.setStatusCode(404); }
                    else {
                        response.setHeader("ETag", etag(bytes));
                        response.setEntity(new ByteArrayEntity(bytes, ContentType.IMAGE_PNG));
                    }
                }
                case "DELETE" -> { objects.remove(path); response.setStatusCode(204); }
                default -> response.setStatusCode(405);
            }
        }).create();
        server.start();
        final ClientConfig config = loopbackConfig(server.getLocalPort());
        final BroadcastCosStorage storage = new BroadcastCosStorage(
                new COSClient(new BasicCOSCredentials("test-only", "test-only"), config), "covers-1251234567", PREFIX);
        try {
            final ImageValidation.Image image = image();
            final String key = storage.key(UUID.randomUUID().toString());
            storage.put(key, image);
            assertArrayEquals(image.bytes(), storage.get(key));
            storage.delete(key);
            assertTrue(objects.isEmpty());
            assertEquals(3, operations.get());
        } finally { storage.close(); server.stop(); }
    }

    @Test void realSdkOverallDeadlineStopsAStalledPutAndMapsItsFailure() throws Exception {
        final CountDownLatch arrived = new CountDownLatch(1);
        final CountDownLatch release = new CountDownLatch(1);
        final var server = ServerBootstrap.bootstrap().setLocalAddress(InetAddress.getByName("127.0.0.1"))
                .setListenerPort(0).registerHandler("*", (request, response, context) -> {
                    arrived.countDown();
                    try { release.await(5, TimeUnit.SECONDS); }
                    catch (final InterruptedException e) { Thread.currentThread().interrupt(); }
                    response.setStatusCode(200);
                }).create();
        server.start();
        final ClientConfig config = loopbackConfig(server.getLocalPort());
        config.setRequestTimeout(500);
        config.setMaxErrorRetry(0);
        final BroadcastCosStorage storage = new BroadcastCosStorage(
                new COSClient(new BasicCOSCredentials("test-only", "test-only"), config), "covers-1251234567", PREFIX);
        try {
            final String key = storage.key(UUID.randomUUID().toString());
            assertTimeoutPreemptively(Duration.ofSeconds(3), () -> assertEquals(ApiErrorCode.BROADCAST_STORAGE_ERROR,
                    assertThrows(ApiException.class, () -> storage.put(key, image())).errorCode()));
            assertEquals(0, arrived.getCount());
        } finally { release.countDown(); storage.close(); server.stop(); }
    }

    @Test void failuresAreCanonicalAndKeysCannotEscapeTheNamespace() throws Exception {
        final COSClient client = mock(COSClient.class);
        final BroadcastCosStorage storage = new BroadcastCosStorage(client, "covers-1251234567", PREFIX);
        final String key = storage.key(UUID.randomUUID().toString());
        try {
            assertEquals(ApiErrorCode.BROADCAST_COVER_INVALID,
                    assertThrows(ApiException.class, () -> storage.get("assets/" + UUID.randomUUID())).errorCode());
            assertThrows(ApiException.class, () -> storage.get(PREFIX + "../escape"));
            when(client.putObject(anyString(), anyString(), any(java.io.InputStream.class), any()))
                    .thenThrow(new CosClientException("test network failure"));
            assertEquals(ApiErrorCode.BROADCAST_STORAGE_ERROR,
                    assertThrows(ApiException.class, () -> storage.put(key, image())).errorCode());
            final CosServiceException missing = new CosServiceException("missing"); missing.setStatusCode(404);
            when(client.getObject(anyString(), anyString())).thenThrow(missing);
            assertEquals(ApiErrorCode.RESOURCE_NOT_FOUND,
                    assertThrows(ApiException.class, () -> storage.get(key)).errorCode());
            doThrow(missing).when(client).deleteObject(anyString(), anyString());
            storage.delete(key); // Already absent is a successful cleanup.
            final COSObject oversized = new COSObject();
            oversized.setObjectContent(new ByteArrayInputStream(new byte[ImageValidation.MAX_BYTES + 1]));
            doReturn(oversized).when(client).getObject(anyString(), anyString());
            assertEquals(ApiErrorCode.BROADCAST_STORAGE_ERROR,
                    assertThrows(ApiException.class, () -> storage.get(key)).errorCode());
        } finally { storage.close(); }
    }

    private static ImageValidation.Image image() throws Exception {
        final ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        ImageIO.write(new BufferedImage(32, 32, BufferedImage.TYPE_INT_RGB), "png", bytes);
        return ImageValidation.validate(bytes.toByteArray());
    }

    private static String etag(final byte[] bytes) {
        try { return '"' + HexFormat.of().formatHex(MessageDigest.getInstance("MD5").digest(bytes)) + '"'; }
        catch (final java.security.NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }

    private static ClientConfig loopbackConfig(final int port) {
        final ClientConfig config = BroadcastCosStorage.clientConfig("ap-shanghai");
        config.setHttpProtocol(HttpProtocol.http); // Test-only loopback, never a cloud endpoint.
        config.setEndpointBuilder(new EndpointBuilder() {
            @Override public String buildGeneralApiEndpoint(final String bucket) { return "127.0.0.1:" + port; }
            @Override public String buildGetServiceApiEndpoint() { throw new AssertionError("No bucket listing"); }
        });
        return config;
    }
}
