package com.wotb.web.replay.dto;

/** One server-calculated, display-only V2 radar axis for the admin gray page. */
public record RatingV2RadarAxis(String key, double rawValue, double normalized, boolean available) {
}
