package com.wotb.core.ref;

/**
 * Application-level immutable Tankopedia reference data.
 *
 * <p>The classpath Tankopedia resources are loaded exactly once per JVM and then shared by
 * replay/playback, AI, vehicle-detail and submission flows. Consumers must use this reference
 * instead of creating their own {@link Tankopedia} instance.</p>
 */
public final class TankopediaReferenceData {

    private static final Tankopedia TANKOPEDIA = Tankopedia.load();

    private TankopediaReferenceData() {
    }

    /** Shared immutable Tankopedia for the lifetime of the application/JVM. */
    public static Tankopedia tankopedia() {
        return TANKOPEDIA;
    }
}
