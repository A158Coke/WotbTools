package com.wotb.web.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;
import org.springframework.core.io.support.ResourcePatternResolver;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.util.Arrays;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Component
class StartupReleaseDiagnostics {

    private static final Logger log = LoggerFactory.getLogger(StartupReleaseDiagnostics.class);
    private static final String MIGRATION_PATTERN = "classpath*:db/migration/V*__*.sql";
    private static final Pattern MIGRATION_FILENAME = Pattern.compile("V(\\d+)__.*\\.sql");
    private static final Pattern FULL_COMMIT_SHA = Pattern.compile("[0-9a-f]{40}");
    private static final int IMMUTABLE_TAG_SHA_LENGTH = 12;

    private final String buildCommit;
    private final ResourcePatternResolver resourcePatternResolver = new PathMatchingResourcePatternResolver();

    StartupReleaseDiagnostics(@Value("${build.commit:unknown}") final String buildCommit) {
        this.buildCommit = buildCommit;
    }

    @EventListener(ApplicationReadyEvent.class)
    void logReleaseIdentity() {
        log.info("WotBTools backend build={} imageTag={} Flyway migration ceiling={}",
                buildCommit, immutableImageTag(), migrationCeiling());
    }

    private String immutableImageTag() {
        if (!FULL_COMMIT_SHA.matcher(buildCommit).matches()) {
            return "unavailable";
        }
        return "sha-" + buildCommit.substring(0, IMMUTABLE_TAG_SHA_LENGTH);
    }

    private String migrationCeiling() {
        try {
            return Arrays.stream(resourcePatternResolver.getResources(MIGRATION_PATTERN))
                    .map(Resource::getFilename)
                    .filter(filename -> filename != null)
                    .map(MIGRATION_FILENAME::matcher)
                    .filter(Matcher::matches)
                    .map(matcher -> matcher.group(1))
                    .mapToInt(Integer::parseInt)
                    .max()
                    .stream()
                    .mapToObj(String::valueOf)
                    .findFirst()
                    .orElse("none");
        } catch (final IOException exception) {
            log.warn("Unable to determine Flyway migration ceiling", exception);
            return "unavailable";
        }
    }
}
