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

    // Minimum distance from shore/anchorage to trigger stopped/slow alerts (NM)
    // Increased to 2.5 NM to cover larger anchorage areas
    private static final double MIN_SHORE_DISTANCE_NM = 2.5;

    // Major Baltic ports and anchorages (lat, lon) - vessels near these are likely in legitimate anchorage
    private static final double[][] BALTIC_PORTS_ANCHORAGES = {
            // Finland - Gulf of Finland
            {60.1587, 24.9500},  // Helsinki
            {60.1400, 24.9800},  // Helsinki Anchorage East
            {60.1300, 24.8500},  // Helsinki Anchorage West
            {60.0800, 25.0500},  // Helsinki Outer Anchorage
            {60.2833, 25.0333},  // Vuosaari (Helsinki container port)
            {60.2550, 25.2000},  // Sipoo Bay anchorage
            {60.4539, 22.2667},  // Turku
            {61.4833, 21.8000},  // Rauma
            {63.0833, 21.6167},  // Vaasa
            {60.0969, 19.9347},  // Mariehamn (Åland)
            {60.1000, 24.6000},  // Porkkala area
            {60.0167, 24.3667},  // Inkoo
            {60.4333, 27.1833},  // Kotka
            {60.4667, 26.9500},  // Hamina
            {60.2000, 25.5000},  // Porvoo offshore
            // Estonia - Tallinn Bay and Gulf of Finland (EXPANDED)
            {59.4500, 24.7500},  // Tallinn Old City Harbor
            {59.4600, 24.7800},  // Tallinn Passenger Terminal
            {59.4900, 24.9500},  // Muuga Harbor (major container port east of Tallinn)
            {59.5000, 24.9800},  // Muuga Anchorage
            {59.5100, 25.0200},  // Muuga Outer Anchorage
            {59.4800, 24.8800},  // Tallinn Bay Eastern Anchorage
            {59.4700, 24.8500},  // Tallinn Bay Central Anchorage
            {59.4400, 24.8200},  // Tallinn Bay Southern Anchorage
            {59.5200, 24.8000},  // Tallinn Bay Northern Anchorage
            // Muuga Cargo Terminal (expanded coverage)
            {59.4950, 24.9300},  // Muuga Container Terminal West
            {59.4980, 24.9600},  // Muuga Container Terminal Central
            {59.5020, 24.9900},  // Muuga Container Terminal East
            {59.5050, 25.0100},  // Muuga Bulk Terminal
            {59.4920, 24.9100},  // Muuga Oil Terminal
            {59.4880, 24.9400},  // Muuga South Quay
            {59.5080, 24.9700},  // Muuga North Anchorage
            {59.3500, 24.0500},  // Paldiski North
            {59.3300, 24.0800},  // Paldiski South
            {59.4200, 24.6500},  // Kakumäe area
            {59.5667, 25.4167},  // Kunda
            {59.4833, 25.6000},  // Loksa
            {59.3800, 27.7500},  // Sillamäe
            {59.4500, 28.0500},  // Narva-Jõesuu
            // Western Estonia - Rohuküla and Haapsalu
            {58.9050, 23.4200},  // Rohuküla Ferry Terminal
            {58.9100, 23.4400},  // Rohuküla Harbor
            {58.9000, 23.4000},  // Rohuküla Anchorage
            {58.9433, 23.5417},  // Haapsalu
            {58.9500, 23.5000},  // Haapsalu Bay
            {58.8000, 23.4500},  // Vormsi Island Ferry
            // Pärnu Bay
            {58.3833, 24.5000},  // Pärnu Harbor
            {58.4000, 24.4500},  // Pärnu Anchorage
            // Saaremaa & Hiiumaa
            {58.2500, 22.5000},  // Kuressaare
            {58.8667, 22.9333},  // Kärdla (Hiiumaa)
            {58.5833, 23.3833},  // Virtsu Ferry Terminal
            {58.3833, 26.7167},  // Tartu area
            // Sweden
            {59.3293, 18.0686},  // Stockholm
            {57.7089, 11.9746},  // Gothenburg
            {55.6000, 13.0000},  // Malmö
            {56.1612, 15.5869},  // Karlskrona
            {56.6667, 16.3667},  // Kalmar
            {57.2667, 16.4667},  // Oskarshamn
            {60.6749, 17.1413},  // Gävle
            {58.7500, 17.8333},  // Nynäshamn
            // Latvia
            {56.9496, 24.1052},  // Riga
            {56.5000, 21.0000},  // Liepāja
            {57.4000, 21.5500},  // Ventspils
            // Lithuania
            {55.7172, 21.1175},  // Klaipėda
            // Poland
            {54.3520, 18.6466},  // Gdańsk
            {54.5189, 18.5305},  // Gdynia
            {53.4285, 14.5528},  // Szczecin
            // Germany
            {54.3233, 10.1394},  // Kiel
            {53.8667, 10.6833},  // Lübeck
            {54.0833, 12.1333},  // Rostock
            {54.1833, 12.0833},  // Warnemünde
            {54.3150, 13.0900},  // Stralsund Hafeninsel
            {54.3100, 13.1000},  // Stralsund Harbor
            {54.3200, 13.0800},  // Stralsund Anchorage
            {54.5100, 13.6400},  // Sassnitz (Rügen)
            {54.4333, 13.1833},  // Greifswald
            // Denmark
            {55.6761, 12.5683},  // Copenhagen
            {55.4667, 8.4500},   // Esbjerg
            {57.0500, 9.9167},   // Frederikshavn
            {56.1500, 10.2167},  // Aarhus
            // Russia (Baltic)
            {59.9343, 30.3351},  // St. Petersburg
            {54.7104, 20.4522},  // Kaliningrad
            {59.9833, 29.7667},  // Kronstadt
            {59.8667, 29.1333},  // Ust-Luga
            {60.7000, 28.7500},  // Vyborg
            // Norway (near Baltic entrance)
            {59.9139, 10.7522},  // Oslo
    };

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
     * Check if position is near any known port or anchorage.
     * Returns true if within MIN_SHORE_DISTANCE_NM of any port.
     */
    private boolean isNearPortOrAnchorage(double lat, double lon) {
        for (double[] port : BALTIC_PORTS_ANCHORAGES) {
            double distNM = distanceNM(lat, lon, port[0], port[1]);
            if (distNM < MIN_SHORE_DISTANCE_NM) {
                return true;
            }
        }
        return false;
    }

    /**
     * Calculate distance between two points in nautical miles using Haversine formula.
     */
    private double distanceNM(double lat1, double lon1, double lat2, double lon2) {
        double R = 3440.065; // Earth radius in nautical miles
        double dLat = Math.toRadians(lat2 - lat1);
        double dLon = Math.toRadians(lon2 - lon1);
        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2)) *
                Math.sin(dLon / 2) * Math.sin(dLon / 2);
        double c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    /**
     * Assess the threat level of a vessel in a cable zone.
     */
    private Alert assessThreat(AISPosition position, Geofence zone) {
        double speed = position.getSpeedOverGround() != null ? position.getSpeedOverGround() : 0;
        Integer shipType = position.getShipType();
        String flagState = extractFlagState(position.getMmsi());

        // Skip stopped/slow alerts if vessel is near a port or anchorage
        boolean nearPort = isNearPortOrAnchorage(position.getLatitude(), position.getLongitude());
        if (nearPort && speed < SLOW_SPEED_THRESHOLD) {
            // Vessel is near port/anchorage and moving slowly - this is normal behavior
            LOG.debug("Skipping alert for {} - near port/anchorage at ({}, {})",
                    position.getMmsi(), position.getLatitude(), position.getLongitude());
            return null;
        }

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
