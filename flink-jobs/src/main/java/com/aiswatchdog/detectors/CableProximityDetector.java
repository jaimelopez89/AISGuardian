package com.aiswatchdog.detectors;

import com.aiswatchdog.AISWatchdogJob;
import com.aiswatchdog.models.AISPosition;
import com.aiswatchdog.models.Alert;
import com.aiswatchdog.models.Geofence;
import com.aiswatchdog.utils.GeoUtils;
import org.apache.flink.api.common.state.ReadOnlyBroadcastState;
import org.apache.flink.streaming.api.functions.co.BroadcastProcessFunction;
import org.apache.flink.util.Collector;
import org.locationtech.jts.geom.Geometry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.*;

/**
 * Detects vessels in proximity to undersea cables and pipelines.
 *
 * Special attention to:
 * - Vessels moving slowly (< 3 knots) - potential anchoring
 * - Vessels stopped/anchored in cable zones
 * - Large vessels that could cause damage
 * - Suspicious flag states
 *
 * This detector is designed for Baltic Sea cable protection following
 * incidents of suspected sabotage (Balticconnector Oct 2023, C-Lion1 Nov 2024).
 */
public class CableProximityDetector
        extends BroadcastProcessFunction<AISPosition, Geofence, Alert> {

    private static final Logger LOG = LoggerFactory.getLogger(CableProximityDetector.class);

    // Speed thresholds in knots
    private static final double SLOW_SPEED_THRESHOLD = 3.0;  // Potential anchoring
    private static final double STOPPED_THRESHOLD = 0.5;     // Effectively stopped

    // Ship types that are higher risk (cargo ships, tankers with anchors)
    private static final Set<Integer> HIGH_RISK_SHIP_TYPES = new HashSet<>(Arrays.asList(
            70, 71, 72, 73, 74, 75, 76, 77, 78, 79,  // Cargo ships
            80, 81, 82, 83, 84, 85, 86, 87, 88, 89   // Tankers
    ));

    // Suspicious flag states (for heightened monitoring)
    private static final Set<String> FLAGGED_STATES = new HashSet<>(Arrays.asList(
            "RU",  // Russia
            "CN",  // China (Yi Peng 3 incident)
            "HK",  // Hong Kong
            "IR"   // Iran
    ));

    // Cache for parsed geometries
    private final Map<String, Geometry> geometryCache = new HashMap<>();

    // Rate limiting: track last alert time per vessel+zone (MMSI:ZoneId -> timestamp)
    private final Map<String, Long> lastAlertTime = new HashMap<>();
    private static final long ALERT_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes

    @Override
    public void processElement(
            AISPosition position,
            ReadOnlyContext ctx,
            Collector<Alert> out) throws Exception {

        // Get broadcast cable zones (filtered for cable_protection type)
        ReadOnlyBroadcastState<String, Geofence> geofenceState =
                ctx.getBroadcastState(AISWatchdogJob.GEOFENCE_STATE_DESCRIPTOR);

        // Check position against each cable zone
        for (Map.Entry<String, Geofence> entry : geofenceState.immutableEntries()) {
            Geofence zone = entry.getValue();

            // Only process cable protection zones
            if (!"cable_protection".equals(zone.getZoneType())) {
                continue;
            }

            try {
                Geometry geometry = getGeometry(zone);
                if (geometry == null) {
                    continue;
                }

                // Check if vessel is inside the cable protection zone
                boolean isInZone = GeoUtils.isPointInPolygon(
                        position.getLatitude(),
                        position.getLongitude(),
                        geometry
                );

                if (isInZone) {
                    // Rate limiting: check if we've alerted for this vessel+zone recently
                    String alertKey = position.getMmsi() + ":" + zone.getZoneId();
                    long now = System.currentTimeMillis();
                    Long lastAlert = lastAlertTime.get(alertKey);

                    if (lastAlert != null && (now - lastAlert) < ALERT_COOLDOWN_MS) {
                        // Skip - already alerted recently for this vessel in this zone
                        continue;
                    }

                    // Determine threat level based on behavior
                    Alert alert = assessThreat(position, zone);
                    if (alert != null) {
                        out.collect(alert);
                        lastAlertTime.put(alertKey, now);
                        LOG.info("Cable proximity alert: {} near {} - {}",
                                position.getShipName() != null ? position.getShipName() : position.getMmsi(),
                                zone.getZoneName(),
                                alert.getSeverity());
                    }
                }
            } catch (Exception e) {
                LOG.warn("Error checking cable zone {}: {}", zone.getZoneId(), e.getMessage());
            }
        }
    }

    /**
     * Assess the threat level of a vessel in a cable zone.
     */
    private Alert assessThreat(AISPosition position, Geofence zone) {
        double speed = position.getSpeedOverGround() != null ? position.getSpeedOverGround() : 0;
        Integer shipType = position.getShipType();
        String flagState = extractFlagState(position.getMmsi());

        Alert.Severity severity;
        String title;
        String description;
        Map<String, Object> details = new HashMap<>();

        details.put("cable_name", zone.getZoneName());
        details.put("zone_id", zone.getZoneId());
        details.put("vessel_speed", speed);
        details.put("ship_type", shipType);
        details.put("flag_state", flagState);

        // Stopped or very slow in cable zone - highest risk
        if (speed < STOPPED_THRESHOLD) {
            severity = Alert.Severity.CRITICAL;
            title = "CRITICAL: Vessel Stopped in Cable Zone";
            description = String.format(
                    "Vessel %s (MMSI: %s) is STOPPED (%.1f kts) in %s protection zone. " +
                    "Possible anchoring or cable interference risk.",
                    position.getShipName() != null ? position.getShipName() : "Unknown",
                    position.getMmsi(),
                    speed,
                    zone.getZoneName()
            );
            details.put("risk_factor", "STOPPED_IN_ZONE");
        }
        // Slow speed - potential anchoring
        else if (speed < SLOW_SPEED_THRESHOLD) {
            // Check for additional risk factors
            boolean isHighRiskShip = shipType != null && HIGH_RISK_SHIP_TYPES.contains(shipType);
            boolean isFlaggedState = FLAGGED_STATES.contains(flagState);

            if (isFlaggedState || isHighRiskShip) {
                severity = Alert.Severity.CRITICAL;
                title = "CRITICAL: Suspicious Slow Vessel Near Cable";
                description = String.format(
                        "Vessel %s (MMSI: %s, Flag: %s) moving slowly (%.1f kts) in %s. " +
                        "High-risk vessel type or flagged state - potential anchoring threat.",
                        position.getShipName() != null ? position.getShipName() : "Unknown",
                        position.getMmsi(),
                        flagState,
                        speed,
                        zone.getZoneName()
                );
                details.put("risk_factor", isFlaggedState ? "FLAGGED_STATE_SLOW" : "HIGH_RISK_SHIP_SLOW");
            } else {
                severity = Alert.Severity.HIGH;
                title = "HIGH: Slow Vessel in Cable Zone";
                description = String.format(
                        "Vessel %s (MMSI: %s) moving slowly (%.1f kts) in %s protection zone. " +
                        "Monitor for potential anchoring.",
                        position.getShipName() != null ? position.getShipName() : "Unknown",
                        position.getMmsi(),
                        speed,
                        zone.getZoneName()
                );
                details.put("risk_factor", "SLOW_IN_ZONE");
            }
        }
        // Normal transit through cable zone
        else {
            // Only alert for flagged states or if this is a high-risk ship type at moderate speed
            boolean isFlaggedState = FLAGGED_STATES.contains(flagState);
            boolean isHighRiskShip = shipType != null && HIGH_RISK_SHIP_TYPES.contains(shipType);

            if (isFlaggedState) {
                severity = Alert.Severity.MEDIUM;
                title = "Flagged State Vessel in Cable Zone";
                description = String.format(
                        "Vessel %s (MMSI: %s, Flag: %s) transiting %s at %.1f kts. " +
                        "Vessel from monitored flag state - tracking.",
                        position.getShipName() != null ? position.getShipName() : "Unknown",
                        position.getMmsi(),
                        flagState,
                        zone.getZoneName(),
                        speed
                );
                details.put("risk_factor", "FLAGGED_STATE_TRANSIT");
            } else if (isHighRiskShip && speed < 8.0) {
                // Large ships moving slowly-ish warrant monitoring
                severity = Alert.Severity.LOW;
                title = "Large Vessel in Cable Zone";
                description = String.format(
                        "Large vessel %s (MMSI: %s) transiting %s at %.1f kts.",
                        position.getShipName() != null ? position.getShipName() : "Unknown",
                        position.getMmsi(),
                        zone.getZoneName(),
                        speed
                );
                details.put("risk_factor", "LARGE_VESSEL_TRANSIT");
            } else {
                // Normal transit - no alert needed
                return null;
            }
        }

        Alert alert = Alert.cableProximity(position, zone.getZoneName(), severity, title, description, details);
        alert.setFlagState(flagState);
        return alert;
    }

    /**
     * Extract flag state from MMSI (first 3 digits = MID code).
     */
    private String extractFlagState(String mmsi) {
        if (mmsi == null || mmsi.length() < 3) {
            return "UNKNOWN";
        }

        String mid = mmsi.substring(0, 3);

        // Common MID codes (simplified)
        switch (mid) {
            case "273": return "RU";  // Russia
            case "412": case "413": case "414": return "CN";  // China
            case "477": return "HK";  // Hong Kong
            case "422": return "IR";  // Iran
            case "230": case "231": return "FI";  // Finland
            case "276": return "EE";  // Estonia
            case "265": case "266": return "SE";  // Sweden
            case "275": return "LV";  // Latvia
            case "277": return "LT";  // Lithuania
            case "261": return "PL";  // Poland
            case "211": return "DE";  // Germany
            case "219": case "220": return "DK";  // Denmark
            case "257": return "NO";  // Norway
            case "226": case "227": return "FR";  // France
            case "232": case "233": case "234": case "235": return "GB";  // UK
            case "244": case "245": case "246": return "NL";  // Netherlands
            default: return mid;  // Return raw MID if unknown
        }
    }

    /**
     * Get or parse geometry for a zone.
     */
    private Geometry getGeometry(Geofence zone) {
        String zoneId = zone.getZoneId();

        if (geometryCache.containsKey(zoneId)) {
            return geometryCache.get(zoneId);
        }

        try {
            Geometry geometry = null;

            // Parse from GeoJSON geometry map
            Map<String, Object> geoJson = zone.getGeometry();
            if (geoJson != null) {
                geometry = GeoUtils.parseGeoJson(geoJson);
            }

            if (geometry != null) {
                geometryCache.put(zoneId, geometry);
            }
            return geometry;

        } catch (Exception e) {
            LOG.warn("Failed to parse geometry for zone {}: {}", zoneId, e.getMessage());
            return null;
        }
    }

    @Override
    public void processBroadcastElement(
            Geofence geofence,
            Context ctx,
            Collector<Alert> out) throws Exception {
        // Update broadcast state with new geofence
        ctx.getBroadcastState(AISWatchdogJob.GEOFENCE_STATE_DESCRIPTOR)
                .put(geofence.getZoneId(), geofence);

        if ("cable_protection".equals(geofence.getZoneType())) {
            LOG.info("Updated cable protection zone: {} - {}",
                    geofence.getZoneId(), geofence.getZoneName());
        }
    }
}
