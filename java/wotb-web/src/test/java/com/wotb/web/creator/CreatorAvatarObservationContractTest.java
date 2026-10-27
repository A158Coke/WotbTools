package com.wotb.web.creator;

import com.qcloud.cos.COSClient;
import com.wotb.web.creator.config.CreatorAvatarObservationConfiguration;
import com.wotb.web.creator.entity.CreatorAvatar;
import com.wotb.web.creator.repository.CreatorAvatarRepository;
import com.wotb.web.creator.repository.CreatorRepository;
import com.wotb.web.creator.service.CreatorAvatarService;
import com.wotb.web.util.CosImageStorage;
import com.wotb.web.util.apierror.ApiErrorCode;
import com.wotb.web.util.apierror.ApiException;
import io.micrometer.core.instrument.Meter;
import io.micrometer.core.instrument.Timer;
import io.micrometer.core.instrument.config.MeterFilter;
import io.micrometer.core.instrument.distribution.DistributionStatisticConfig;
import io.micrometer.core.instrument.observation.DefaultMeterObservationHandler;
import io.micrometer.observation.Observation;
import io.micrometer.observation.ObservationRegistry;
import io.micrometer.observation.aop.ObservedAspect;
import io.micrometer.prometheusmetrics.PrometheusConfig;
import io.micrometer.prometheusmetrics.PrometheusMeterRegistry;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.aop.support.AopUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.EnableAspectJAutoProxy;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.junit.jupiter.SpringJUnitConfig;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.SimpleTransactionStatus;
import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.when;

/** Fast Micrometer contract test: no database or Docker required. */
@SpringJUnitConfig(CreatorAvatarObservationContractTest.Config.class)
class CreatorAvatarObservationContractTest {
    private static final String PREFIX = "creator-avatars/";
    private static final String OPERATION = CreatorAvatarService.OBSERVATION_NAME;

    @Autowired CreatorAvatarService avatars;
    @Autowired PrometheusMeterRegistry meters;
    @Autowired ObservationRegistry observations;
    @Autowired COSClient client;

    @BeforeEach
    void setup() {
        reset(client);
        doAnswer(call -> null).when(client).putObject(anyString(), anyString(), any(InputStream.class), any());
    }

    @Test
    void springProxyInterceptsUploadAndRecordsOneObservation() throws Exception {
        assertTrue(AopUtils.isAopProxy(avatars));
        final double before = operationCount();
        final String id = avatars.upload(png(32, 32));
        assertNotNull(id);
        assertEquals(before + 1, operationCount(), 0.0);
        final Timer timer = operationTimer("none", "none");
        assertNotNull(timer);
        assertTrue(timer.count() >= 1);
        assertTrue(timer.totalTime(TimeUnit.NANOSECONDS) > 0);
        assertNotNull(timer.getId().getTag("class"));
        assertEquals("upload", timer.getId().getTag("method"));
    }

    @Test
    void knownApiExceptionKeepsBusinessErrorCode() {
        final double before = operationCount();
        final ApiException error = assertThrows(ApiException.class,
                () -> avatars.upload(new MockMultipartFile("image", new byte[] {1, 2, 3})));
        assertEquals(ApiErrorCode.CREATOR_INVALID_REQUEST, error.errorCode());
        assertEquals(before + 1, operationCount(), 0.0);
        assertNotNull(operationTimer("ApiException", "CREATOR_INVALID_REQUEST"));
    }

    @Test
    void unexpectedRuntimeFailureIsUnclassifiedAndPropagates() throws Exception {
        final IllegalStateException failure = new IllegalStateException("unexpected");
        doThrow(failure).when(client).putObject(anyString(), anyString(), any(InputStream.class), any());
        final double before = operationCount();
        final IllegalStateException thrown = assertThrows(IllegalStateException.class,
                () -> avatars.upload(png(32, 32)));
        assertSame(failure, thrown);
        assertEquals(before + 1, operationCount(), 0.0);
        assertNotNull(operationTimer("IllegalStateException", "unclassified"));
    }

    @Test
    void prometheusExpositionHasHistogramAndStableErrorTag() throws Exception {
        avatars.upload(png(32, 32));
        final String scrape = meters.scrape();
        assertTrue(scrape.contains("# TYPE wotb_creator_avatar_upload_seconds histogram"));
        assertTrue(scrape.contains("wotb_creator_avatar_upload_seconds_bucket{"));
        assertTrue(scrape.contains("le=\"+Inf\""));
        assertTrue(scrape.contains("wotb_creator_avatar_upload_seconds_count"));
        assertTrue(scrape.contains("wotb_creator_avatar_upload_seconds_sum"));
        assertTrue(scrape.contains("error_code=\"none\""));
    }

    @Test
    void filterOnlyAffectsTheCanonicalObservation() {
        Observation.createNotStarted("http.server.requests", observations).observe(() -> { });
        final Timer http = meters.get("http.server.requests").timer();
        assertNotNull(http);
        assertNull(http.getId().getTag("error.code"));
        assertNull(http.getId().getTag("error_code"));
    }

    @Test
    void apiExceptionIdsNeverEnterMeterTagsOrExposition() {
        final ApiException first = assertThrows(ApiException.class,
                () -> avatars.upload(new MockMultipartFile("image", new byte[] {1, 2, 3})));
        final ApiException second = assertThrows(ApiException.class,
                () -> avatars.upload(new MockMultipartFile("image", new byte[] {1, 2, 3})));
        assertNotEquals(first.id(), second.id());
        final Timer timer = operationTimer("ApiException", "CREATOR_INVALID_REQUEST");
        assertNotNull(timer);
        final Set<String> allowedTags = Set.of("error", "error.code", "class", "method");
        timer.getId().getTags().forEach(tag -> {
            assertTrue(allowedTags.contains(tag.getKey()), tag.getKey());
            assertNotEquals("id", tag.getKey());
            assertFalse(tag.getValue().contains(first.id()));
            assertFalse(tag.getValue().contains(second.id()));
            assertFalse(tag.getValue().contains("untrusted.exe"));
        });
        final String scrape = meters.scrape();
        assertFalse(scrape.contains(first.id()));
        assertFalse(scrape.contains(second.id()));
        assertFalse(scrape.contains("untrusted.exe"));
    }

    private double operationCount() {
        return meters.find(OPERATION).timers().stream().mapToDouble(Timer::count).sum();
    }

    private Timer operationTimer(final String error, final String code) {
        return meters.find(OPERATION).timers().stream()
                .filter(timer -> error.equals(timer.getId().getTag("error")))
                .filter(timer -> code.equals(timer.getId().getTag("error.code"))
                        || code.equals(timer.getId().getTag("error_code")))
                .findFirst().orElse(null);
    }

    private static MockMultipartFile png(final int width, final int height) throws Exception {
        final ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        ImageIO.write(new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB), "png", bytes);
        return new MockMultipartFile("image", "untrusted.exe", "application/octet-stream", bytes.toByteArray());
    }

    @Configuration
    @EnableAspectJAutoProxy(proxyTargetClass = true)
    static class Config {
        @Bean
        PrometheusMeterRegistry meterRegistry() {
            final PrometheusMeterRegistry registry = new PrometheusMeterRegistry(PrometheusConfig.DEFAULT);
            registry.config().meterFilter(new MeterFilter() {
                @Override
                public DistributionStatisticConfig configure(final Meter.Id id,
                                                             final DistributionStatisticConfig config) {
                    if (OPERATION.equals(id.getName())) {
                        return DistributionStatisticConfig.builder().percentilesHistogram(true).build().merge(config);
                    }
                    return config;
                }
            });
            return registry;
        }

        @Bean
        ObservationRegistry observationRegistry(final PrometheusMeterRegistry registry) {
            final ObservationRegistry observationRegistry = ObservationRegistry.create();
            observationRegistry.observationConfig().observationHandler(new DefaultMeterObservationHandler(registry));
            observationRegistry.observationConfig().observationFilter(
                    new CreatorAvatarObservationConfiguration().creatorAvatarErrorCodeFilter());
            return observationRegistry;
        }

        @Bean
        ObservedAspect observedAspect(final ObservationRegistry registry) {
            return new ObservedAspect(registry);
        }

        @Bean
        COSClient client() {
            return mock(COSClient.class);
        }

        @Bean
        CosImageStorage storage(final COSClient client) {
            return new CosImageStorage(client, "images-1251234567", "league-broadcasts/covers/", PREFIX);
        }

        @Bean
        CreatorAvatarRepository creatorAvatarRepository() {
            final CreatorAvatarRepository repository = mock(CreatorAvatarRepository.class);
            final AtomicReference<CreatorAvatar> saved = new AtomicReference<>();
            when(repository.saveAndFlush(any(CreatorAvatar.class))).thenAnswer(call -> {
                saved.set(call.getArgument(0));
                return call.getArgument(0);
            });
            when(repository.findLocked(anyString())).thenAnswer(call -> {
                final CreatorAvatar avatar = saved.get();
                return avatar != null && avatar.id.equals(call.getArgument(0)) ? Optional.of(avatar) : Optional.empty();
            });
            return repository;
        }

        @Bean
        CreatorRepository creatorRepository() {
            return mock(CreatorRepository.class);
        }

        @Bean
        PlatformTransactionManager transactionManager() {
            final PlatformTransactionManager transactions = mock(PlatformTransactionManager.class);
            when(transactions.getTransaction(any())).thenReturn(new SimpleTransactionStatus());
            return transactions;
        }

        @Bean
        CreatorAvatarService creatorAvatarService(final CreatorAvatarRepository avatars,
                                                  final CreatorRepository creators,
                                                  final CosImageStorage storage,
                                                  final PlatformTransactionManager transactions) {
            return new CreatorAvatarService(avatars, creators, storage, transactions, PREFIX);
        }
    }
}
