package com.aiswatchdog.detectors;

import com.aiswatchdog.AISWatchdogJob;
import com.aiswatchdog.models.AISPosition;
import com.aiswatchdog.models.Alert;
import com.aiswatchdog.models.Geofence;
import com.aiswatchdog.utils.GeoUtils;
import org.apache.flink.api.common.state.ReadOnlyBroadcastState;
import org.apache.flink.api.common.state.ValueState;
import org.apache.flink.api.common.state.ValueStateDescriptor;
import org.apache.flink.configuration.Configuration;
import org.apache.flink.streaming.api.functions.co.KeyedBroadcastProcessFunction;
import org.apache.flink.util.Collector;
import org.locationtech.jts.geom.Geometry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.*;

/**
 * Detects anchor dragging - when a vessel reports anchored status but is actually moving.
 *
 * Anchor dragging can:
 * 1. Damage undersea cables and pipelines (C-Lion1, Balticconnector incidents)
 * 2. Indicate a vessel in distress
 * 3. Be intentional sabotage disguised as an accident
 *
 * Detection criteria:
 * - Vessel reports nav_status = 1 (At anchor)
 * - But speed > threshold OR position moving significantly
 * - Especially critical near cable protection zones
 *
 * AIS Navigation Status codes:
 * 0 = Under way using engine
 * 1 = At anchor
 * 2 = Not under command
 * 3 = Restricted maneuverability
 * 4 = Constrained by draught
 * 5 = Moored
 * 6 = Aground
 * 7 = Engaged in fishing
 * 8 = Under way sailing
 */
public class AnchorDraggingDetector
        extends KeyedBroadcastProcessFunction<String, AISPosition, Geofence, Alert> {

    private static final Logger LOG = LoggerFactory.getLogger(AnchorDraggingDetector.class);

    // Navigation status for "at anchor"
    private static final int NAV_STATUS_ANCHORED = 1;
    private static final int NAV_STATUS_MOORED = 5;

    // Speed threshold for considering vessel as moving while anchored (knots)
    private static final double DRAG_SPEED_THRESHOLD = 0.5;
    private static final double HIGH_DRAG_SPEED_THRESHOLD = 1.5;

    // Distance threshold for position drift while anchored (nautical miles)
    private static final double DRIFT_DISTANCE_THRESHOLD_NM = 0.05; // ~100 meters

    // Time thresholds
    private static final long MIN_TIME_BETWEEN_CHECKS_MS = 60 * 1000; // 1 minute

    // Rate limiting for alerts
    private final Map<String, Long> lastAlertTime = new HashMap<>();
    private static final long ALERT_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes

    // State for tracking anchor position
    private ValueState<AnchorState> anchorState;

    // Cache for parsed geometries
    private final Map<String, Geometry> geometryCache = new HashMap<>();

    /**
     * State to track when a vessel drops anchor.
     */
    public static class AnchorState implements java.io.Serializable {
        private static final long serialVersionUID = 1L;

        double anchorLatitude;
        double anchorLongitude;
        long anchorDropTime;
        double maxDriftDistance;
        int alertCount;

        public AnchorState() {}

        public AnchorState(double lat, double lon, long time) {
            this.anchorLatitude = lat;
            this.anchorLongitude = lon;
            this.anchorDropTime = time;
            this.maxDriftDistance = 0;
            this.alertCount = 0;
        }
    }

    @Override
    public void open(Configuration parameters) throws Exception {
        anchorState = getRuntimeContext().getState(
                new ValueStateDescriptor<>("anchorState", AnchorState.class));
    }

    @Override
    public void processElement(AISPosition position, ReadOnlyContext ctx, Collector<Alert> out)
            throws Exception {

        Integer navStatus = position.getNavStatus();
        Double speed = position.getSpeedOverGround();
        String mmsi = position.getMmsi();
        long now = System.currentTimeMillis();

        // Check if vessel claims to be anchored
        boolean claimsAnchored = navStatus != null &&
                (navStatus == NAV_STATUS_ANCHORED || navStatus == NAV_STATUS_MOORED);

        AnchorState state = anchorState.value();

        if (claimsAnchored) {
            if (state == null) {
                // Vessel just dropped anchor - record position
                state = new AnchorState(position.getLatitude(), position.getLongitude(), now);
                anchorState.update(state);
                LOG.debug("Vessel {} dropped anchor at {}, {}", mmsi,
                        position.getLatitude(), position.getLongitude());
                return;
            }

            // Vessel was already anchored - check for dragging
            List<Alert> alerts = checkForAnchorDragging(position, state, ctx, now);
            for (Alert alert : alerts) {
                out.collect(alert);
            }

            // Update state
            anchorState.update(state);

        } else {
            // Vessel is not anchored - clear state
            if (state != null) {
                LOG.debug("Vessel {} weighed anchor", mmsi);
                anchorState.clear();
            }
        }
    }

    /**
     * Check if an anchored vessel is dragging its anchor.
     */
    private List<Alert> checkForAnchorDragging(AISPosition position, AnchorState state,
                                                ReadOnlyContext ctx, long now) throws Exception {

        List<Alert> alerts = new ArrayList<>();
        String mmsi = position.getMmsi();

        // Calculate drift from anchor position
        double driftDistance = GeoUtils.distanceNauticalMiles(
                state.anchorLatitude, state.anchorLongitude,
                position.getLatitude(), position.getLongitude()
        );

        // Track maximum drift
        state.maxDriftDistance = Math.max(state.maxDriftDistance, driftDistance);

        // Get speed
        double speed = position.getSpeedOverGround() != null ? position.getSpeedOverGround() : 0;

        // Check if near cable protection zone
        boolean nearCable = isNearCableZone(position, ctx);
        String nearCableName = nearCable ? getNearestCableName(position, ctx) : null;

        // Determine if anchor is dragging
        boolean isDragging = false;
        Alert.Severity severity = Alert.Severity.LOW;
        String reason = "";

        // Check 1: Moving too fast while anchored
        if (speed > HIGH_DRAG_SPEED_THRESHOLD) {
            isDragging = true;
            severity = Alert.Severity.HIGH;
            reason = String.format("Moving at %.1f kts while reporting anchored", speed);

            if (nearCable) {
                severity = Alert.Severity.CRITICAL;
                reason += String.format(" NEAR %s", nearCableName);
            }
        } else if (speed > DRAG_SPEED_THRESHOLD) {
            isDragging = true;
            severity = nearCable ? Alert.Severity.HIGH : Alert.Severity.MEDIUM;
            reason = String.format("Moving at %.1f kts while anchored", speed);

            if (nearCable) {
                reason += String.format(" near %s", nearCableName);
            }
        }

        // Check 2: Position drift exceeds threshold
        if (driftDistance > DRIFT_DISTANCE_THRESHOLD_NM && !isDragging) {
            isDragging = true;
            severity = nearCable ? Alert.Severity.HIGH : Alert.Severity.MEDIUM;
            reason = String.format("Drifted %.0f meters from anchor position",
                    driftDistance * 1852); // Convert NM to meters

            if (nearCable) {
                severity = Alert.Severity.CRITICAL;
                reason += String.format(" NEAR %s", nearCableName);
            }
        }

        if (isDragging) {
            // Rate limiting
            Long lastAlert = lastAlertTime.get(mmsi);
            if (lastAlert == null || (now - lastAlert) >= ALERT_COOLDOWN_MS) {
                Alert alert = createAnchorDragAlert(position, state, driftDistance, speed,
                        severity, reason, nearCable, nearCableName);
                alerts.add(alert);
                lastAlertTime.put(mmsi, now);
                state.alertCount++;

                LOG.info("Anchor dragging alert for {}: {} (severity: {})",
                        mmsi, reason, severity);
            }
        }

        return alerts;
    }

    /**
     * Create an anchor dragging alert.
     */
    private Alert createAnchorDragAlert(AISPosition position, AnchorState state,
                                        double driftDistance, double speed,
                                        Alert.Severity severity, String reason,
                                        boolean nearCable, String cableName) {

        Map<String, Object> details = new HashMap<>();
        details.put("anchor_position", String.format("%.4f, %.4f",
                state.anchorLatitude, state.anchorLongitude));
        details.put("current_position", String.format("%.4f, %.4f",
                position.getLatitude(), position.getLongitude()));
        details.put("drift_distance_m", Math.round(driftDistance * 1852));
        details.put("drift_distance_nm", Math.round(driftDistance * 100) / 100.0);
        details.put("max_drift_m", Math.round(state.maxDriftDistance * 1852));
        details.put("current_speed", speed);
        details.put("nav_status", position.getNavStatus());
        details.put("anchor_duration_minutes",
                (System.currentTimeMillis() - state.anchorDropTime) / (60 * 1000));
        details.put("near_cable", nearCable);
        if (cableName != null) {
            details.put("cable_name", cableName);
        }
        details.put("alert_count", state.alertCount);

        String title;
        String description;

        if (nearCable) {
            title = severity == Alert.Severity.CRITICAL ?
                    "CRITICAL: Anchor Dragging Near Cable!" :
                    "Anchor Dragging Near Infrastructure";
            description = String.format(
                    "Vessel %s (MMSI: %s) appears to be dragging anchor near %s. " +
                    "%s. Drifted %.0fm from anchor position. IMMEDIATE THREAT TO INFRASTRUCTURE.",
                    position.getShipName() != null ? position.getShipName() : "Unknown",
                    position.getMmsi(),
                    cableName,
                    reason,
                    driftDistance * 1852
            );
        } else {
            title = "Anchor Dragging Detected";
            description = String.format(
                    "Vessel %s (MMSI: %s) appears to be dragging anchor. %s. " +
                    "Drifted %.0fm from anchor position.",
                    position.getShipName() != null ? position.getShipName() : "Unknown",
                    position.getMmsi(),
                    reason,
                    driftDistance * 1852
            );
        }

        return Alert.anchorDragging(position, severity, title, description, details);
    }

    /**
     * Check if vessel is near a cable protection zone.
     */
    private boolean isNearCableZone(AISPosition position, ReadOnlyContext ctx) throws Exception {
        ReadOnlyBroadcastState<String, Geofence> geofenceState =
                ctx.getBroadcastState(AISWatchdogJob.GEOFENCE_STATE_DESCRIPTOR);

        for (Map.Entry<String, Geofence> entry : geofenceState.immutableEntries()) {
            Geofence zone = entry.getValue();
            if (!"cable_protection".equals(zone.getZoneType())) {
                continue;
            }

            try {
                Geometry geometry = getGeometry(zone);
                if (geometry == null) continue;

                boolean isInZone = GeoUtils.isPointInPolygon(
                        position.getLatitude(),
                        position.getLongitude(),
                        geometry
                );

                if (isInZone) {
                    return true;
                }
            } catch (Exception e) {
                // Skip this zone on error
            }
        }
        return false;
    }

    /**
     * Get the name of the nearest cable zone.
     */
    private String getNearestCableName(AISPosition position, ReadOnlyContext ctx) throws Exception {
        ReadOnlyBroadcastState<String, Geofence> geofenceState =
                ctx.getBroadcastState(AISWatchdogJob.GEOFENCE_STATE_DESCRIPTOR);

        for (Map.Entry<String, Geofence> entry : geofenceState.immutableEntries()) {
            Geofence zone = entry.getValue();
            if (!"cable_protection".equals(zone.getZoneType())) {
                continue;
            }

            try {
                Geometry geometry = getGeometry(zone);
                if (geometry == null) continue;

                boolean isInZone = GeoUtils.isPointInPolygon(
                        position.getLatitude(),
                        position.getLongitude(),
                        geometry
                );

                if (isInZone) {
                    return zone.getZoneName();
                }
            } catch (Exception e) {
                // Skip
            }
        }
        return null;
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
            Map<String, Object> geoJson = zone.getGeometry();
            if (geoJson != null) {
                Geometry geometry = GeoUtils.parseGeoJson(geoJson);
                if (geometry != null) {
                    geometryCache.put(zoneId, geometry);
                }
                return geometry;
            }
        } catch (Exception e) {
            LOG.warn("Failed to parse geometry for zone {}: {}", zoneId, e.getMessage());
        }
        return null;
    }

    @Override
    public void processBroadcastElement(Geofence geofence, Context ctx, Collector<Alert> out)
            throws Exception {
        // Update broadcast state with new geofence
        ctx.getBroadcastState(AISWatchdogJob.GEOFENCE_STATE_DESCRIPTOR)
                .put(geofence.getZoneId(), geofence);
    }
}
