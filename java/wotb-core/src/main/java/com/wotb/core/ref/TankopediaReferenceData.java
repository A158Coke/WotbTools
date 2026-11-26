package com.wotb.core.ref;

public final class TankopediaReferenceData {

    private static final Tankopedia TANKOPEDIA = Tankopedia.loadFromResources();

    private TankopediaReferenceData() {
    }

    public static Tankopedia tankopedia() {
        return TANKOPEDIA;
    }
}
