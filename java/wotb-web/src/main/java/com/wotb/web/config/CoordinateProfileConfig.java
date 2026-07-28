package com.wotb.web.config;

import com.wotb.core.replay.feature.MapCoordinateProfile;
import com.wotb.core.replay.feature.MapRegionResolver;
import jakarta.annotation.PostConstruct;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;

/**
 * Reads coordinate calibration from application properties / environment variables
 * and configures {@link MapRegionResolver} at startup.
 * <p>
 * Properties:
 * <pre>
 * wotb.replay.coordinate.half-extent=${REPLAY_COORDINATE_HALF_EXTENT:250}
 * wotb.replay.coordinate.clamp-tolerance=${REPLAY_COORDINATE_CLAMP_TOLERANCE:12.5}
 * </pre>
 */
@Configuration
@ConfigurationProperties(prefix = "wotb.replay.coordinate")
@EnableConfigurationProperties(AiModelProperties.class)
public class CoordinateProfileConfig {

    private float halfExtent = 250f;
    private float clampTolerance = 12.5f;

    public float getHalfExtent() {
        return halfExtent;
    }

    public void setHalfExtent(final float halfExtent) {
        this.halfExtent = halfExtent;
    }

    public float getClampTolerance() {
        return clampTolerance;
    }

    public void setClampTolerance(final float clampTolerance) {
        this.clampTolerance = clampTolerance;
    }

    @PostConstruct
    void configureResolver() {
        final MapCoordinateProfile profile = new MapCoordinateProfile(halfExtent, clampTolerance);
        MapRegionResolver.configure(profile);
    }
}
