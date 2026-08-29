package com.wotb.core.replay.event;

/**
 * Avatar method16 recorder-visible vehicle module/crew state presentation (PR147, 11.19).
 */
public record VehicleModuleCrewStateEvent(
        int sequence,
        ReplayTimestamp timestamp,
        int packetType,
        DecodeConfidence confidence,
        int avatarEntityId,
        int vehicleId,
        int stateCodeRaw,
        int componentCodeRaw,
        int relatedEntityId,
        Component component,
        State state
) implements ReplayEvent {

    public enum Component {
        ENGINE,
        AMMO_RACK,
        FUEL_TANK,
        RIGHT_TRACK,
        LEFT_TRACK,
        GUN,
        TURRET_ROTATOR,
        OBSERVATION_DEVICE,
        COMMANDER,
        DRIVER,
        GUNNER,
        LOADER,
        UNKNOWN
    }

    public enum State {
        DAMAGED_DEGRADED,
        CRITICAL_DISABLED,
        AUTO_REPAIRED_TO_DAMAGED,
        FULL_REPAIRED_CLEAR,
        CREW_SHELL_SHOCKED,
        CREW_HEALED,
        UNKNOWN
    }

    public static Component componentOf(final int code) {
        return switch (code) {
            case 31 -> Component.ENGINE;
            case 32 -> Component.AMMO_RACK;
            case 33 -> Component.FUEL_TANK;
            case 34 -> Component.RIGHT_TRACK;
            case 35 -> Component.LEFT_TRACK;
            case 36 -> Component.GUN;
            case 37 -> Component.TURRET_ROTATOR;
            case 38 -> Component.OBSERVATION_DEVICE;
            case 39 -> Component.COMMANDER;
            case 40 -> Component.DRIVER;
            case 41 -> Component.GUNNER;
            case 43 -> Component.LOADER;
            default -> Component.UNKNOWN;
        };
    }

    public static State stateOf(final int stateCode, final Component component) {
        final boolean crew = switch (component) {
            case COMMANDER, DRIVER, GUNNER, LOADER -> true;
            default -> false;
        };
        if (crew) {
            return switch (stateCode) {
                case 10 -> State.CREW_SHELL_SHOCKED;
                case 22 -> State.CREW_HEALED;
                default -> State.UNKNOWN;
            };
        }
        return switch (stateCode) {
            case 4 -> State.DAMAGED_DEGRADED;
            case 5 -> State.CRITICAL_DISABLED;
            case 18 -> State.AUTO_REPAIRED_TO_DAMAGED;
            case 19 -> State.FULL_REPAIRED_CLEAR;
            default -> State.UNKNOWN;
        };
    }
}
