package com.aiswatchdog.detectors;

import com.aiswatchdog.AISWatchdogJob;
import com.aiswatchdog.models.AISPosition;
import com.aiswatchdog.models.Alert;
import com.aiswatchdog.models.Geofence;
import com.aiswatchdog.utils.GeoUtils;
import org.apache.flink.api.common.state.BroadcastState;
import org.apache.flink.api.common.state.MapState;
import org.apache.flink.api.common.state.MapStateDescriptor;
import org.apache.flink.api.common.state.ReadOnlyBroadcastState;
import org.apache.flink.api.common.typeinfo.BasicTypeInfo;
import org.apache.flink.configuration.Configuration;
import org.apache.flink.streaming.api.functions.co.BroadcastProcessFunction;
import org.apache.flink.util.Collector;
import org.locationtech.jts.geom.Geometry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.HashMap;
import java.util.Map;

/**
 * Detects when vessels enter geofenced zones (MPAs, sanctioned waters, etc.).
 *
 * Uses Flink's Broadcast State pattern:
 * - Geofences are broadcast to all parallel instances
 * - Each AIS position is checked against all geofences
 * - Alerts are emitted when violations are detected
 *
 * To avoid alert spam, tracks which vessels are currently in which zones
 * and only alerts on zone entry (not every position while inside).
 */
public class GeofenceViolationDetector
        extends BroadcastProcessFunction<AISPosition, Geofence, Alert> {

    private static final Logger LOG = LoggerFactory.getLogger(GeofenceViolationDetector.class);

    // State descriptor for tracking vessel-zone membership
    // Key: "mmsi:zoneId", Value: entry timestamp
    private static final MapStateDescriptor<String, String> VESSEL_ZONE_STATE =
            new MapStateDescriptor<>(
                    "vessel-zone-state",
                    BasicTypeInfo.STRING_TYPE_INFO,
                    BasicTypeInfo.STRING_TYPE_INFO
            );

    // Cache parsed geometries to avoid re-parsing for each position
    private transient Map<String, Geometry> geometryCache;

    @Override
    public void open(Configuration parameters) {
        geometryCache = new HashMap<>();
    }

    /**
     * Process each AIS position against all broadcast geofences.
     */
    @Override
    public void processElement(
            AISPosition position,
            ReadOnlyContext ctx,
            Collector<Alert> out) throws Exception {

        // Get broadcast geofences
        ReadOnlyBroadcastState<String, Geofence> geofenceState =
                ctx.getBroadcastState(AISWatchdogJob.GEOFENCE_STATE_DESCRIPTOR);

        // Check position against each geofence
        for (Map.Entry<String, Geofence> entry : geofenceState.immutableEntries()) {
            Geofence geofence = entry.getValue();

            try {
                // Get or parse geometry
                Geometry geometry = getGeometry(geofence);
                if (geometry == null) {
                    continue;
                }

                // Check if position is inside geofence
                boolean isInside = GeoUtils.isPointInPolygon(
                        position.getLatitude(),
                        position.getLongitude(),
                        geometry
                );

                if (isInside) {
                    // Check if we should generate an alert
                    if (shouldAlert(position, geofence)) {
                        Alert alert = Alert.geofenceViolation(
                                position,
                                geofence.getZoneName(),
                                geofence.getZoneType()
                        );

                        LOG.info("Geofence violation detected: {} in {}",
                                position.getMmsi(), geofence.getZoneName());

                        out.collect(alert);
                    }
                }
            } catch (Exception e) {
                LOG.warn("Error checking geofence {}: {}", geofence.getZoneId(), e.getMessage());
            }
        }
    }

    /**
     * Process geofence updates (broadcast side).
     */
    @Override
    public void processBroadcastElement(
            Geofence geofence,
            Context ctx,
            Collector<Alert> out) throws Exception {

        // Update broadcast state with new/updated geofence
        BroadcastState<String, Geofence> state =
                ctx.getBroadcastState(AISWatchdogJob.GEOFENCE_STATE_DESCRIPTOR);

        state.put(geofence.getZoneId(), geofence);

        // Pre-parse and cache the geometry
        try {
            Geometry geometry = GeoUtils.parseGeoJson(geofence.getGeometry());
            geometryCache.put(geofence.getZoneId(), geometry);
            LOG.info("Loaded geofence: {} ({})", geofence.getZoneName(), geofence.getZoneType());
        } catch (Exception e) {
            LOG.warn("Failed to parse geometry for geofence {}: {}",
                    geofence.getZoneId(), e.getMessage());
        }
    }

    /**
     * Get cached geometry or parse it.
     */
    private Geometry getGeometry(Geofence geofence) {
        Geometry cached = geometryCache.get(geofence.getZoneId());
        if (cached != null) {
            return cached;
        }

        try {
            Geometry geometry = GeoUtils.parseGeoJson(geofence.getGeometry());
            geometryCache.put(geofence.getZoneId(), geometry);
            return geometry;
        } catch (Exception e) {
            LOG.warn("Failed to parse geometry for {}", geofence.getZoneId());
            return null;
        }
    }

    /**
     * Determine if we should generate an alert for this position/zone combination.
     *
     * Rules:
     * - Sanctioned waters: Alert for all vessels
     * - MPAs: Alert for fishing vessels, or vessels exhibiting fishing behavior
     * - EEZ: Alert based on flag state mismatch (not yet implemented)
     */
    private boolean shouldAlert(AISPosition position, Geofence geofence) {
        String zoneType = geofence.getZoneType();

        // Sanctioned waters - alert everyone
        if ("sanctioned_waters".equals(zoneType)) {
            return true;
        }

        // Marine Protected Area
        if ("MPA".equals(zoneType)) {
            // Alert if it's a fishing vessel
            if (position.isFishingVessel()) {
                return true;
            }

            // Alert if zone is configured to alert all vessels
            if (geofence.alertsAllVessels()) {
                return true;
            }

            // Could add fishing behavior detection here
            return false;
        }

        // EEZ - could check flag state vs jurisdiction
        if ("EEZ".equals(zoneType)) {
            // For now, only alert fishing vessels in foreign EEZ
            // In production, would check vessel flag vs zone jurisdiction
            if (position.isFishingVessel()) {
                return true;
            }
            return false;
        }

        // Restricted zones - alert everyone
        if ("restricted".equals(zoneType)) {
            return true;
        }

        // Unknown zone type - use zone's rules
        return geofence.alertsAllVessels();
    }
}
