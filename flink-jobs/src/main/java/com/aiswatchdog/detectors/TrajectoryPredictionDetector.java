package com.aiswatchdog.detectors;

import com.aiswatchdog.AISWatchdogJob;
import com.aiswatchdog.models.AISPosition;
import com.aiswatchdog.models.Alert;
import com.aiswatchdog.models.Geofence;
import com.aiswatchdog.utils.GeoUtils;
import org.apache.flink.api.common.state.MapState;
import org.apache.flink.api.common.state.MapStateDescriptor;
import org.apache.flink.api.common.state.ValueState;
import org.apache.flink.api.common.state.ValueStateDescriptor;
import org.apache.flink.api.common.state.ReadOnlyBroadcastState;
import org.apache.flink.configuration.Configuration;
import org.apache.flink.streaming.api.functions.co.KeyedBroadcastProcessFunction;
import org.apache.flink.util.Collector;
import org.locationtech.jts.geom.Coordinate;
import org.locationtech.jts.geom.Geometry;
import org.locationtech.jts.geom.GeometryFactory;
import org.locationtech.jts.geom.LineString;
import org.locationtech.jts.geom.Point;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.*;

/**
 * Predicts vessel trajectories and alerts when vessels are on course to enter
 * cable protection zones within a specified time window.
 *
 * This detector provides early warning by:
 * 1. Tracking vessel position history to calculate trajectory
 * 2. Projecting future position based on speed and course
 * 3. Checking if projected path intersects cable zones
 * 4. Alerting when intersection is predicted within N minutes
 *
 * Competition differentiator: Predictive alerting vs reactive alerting
 */
public class TrajectoryPredictionDetector
        extends KeyedBroadcastProcessFunction<String, AISPosition, Geofence, Alert> {

    private static final Logger LOG = LoggerFactory.getLogger(TrajectoryPredictionDetector.class);

    // Prediction parameters
    private static final int PREDICTION_MINUTES = 45;  // Look ahead time
    private static final double MIN_SPEED_KNOTS = 3.0;  // Minimum speed for prediction
    private static final long ALERT_COOLDOWN_MS = 30 * 60 * 1000;  // 30 min cooldown per vessel+zone

    // Geometry factory for creating prediction lines
    private static final GeometryFactory GEOMETRY_FACTORY = new GeometryFactory();

    // State: last alert time per zone (to avoid repeated alerts)
    private transient ValueState<Map<String, Long>> lastAlertTimeState;

    // State: last position for trajectory calculation
    private transient ValueState<AISPosition> lastPositionState;

    // Cache for parsed geometries
    private transient Map<String, Geometry> geometryCache;

    @Override
    public void open(Configuration parameters) throws Exception {
        lastAlertTimeState = getRuntimeContext().getState(
                new ValueStateDescriptor<>("lastAlertTime",
                        (Class<Map<String, Long>>) (Class<?>) Map.class));

        lastPositionState = getRuntimeContext().getState(
                new ValueStateDescriptor<>("lastPosition", AISPosition.class));

        geometryCache = new HashMap<>();
    }

    @Override
    public void processElement(
            AISPosition position,
            ReadOnlyContext ctx,
            Collector<Alert> out) throws Exception {

        // Skip if vessel is moving too slowly for meaningful prediction
        Double speed = position.getSpeedOverGround();
        if (speed == null || speed < MIN_SPEED_KNOTS) {
            lastPositionState.update(position);
            return;
        }

        // Get heading (course over ground)
        Double heading = position.getCourseOverGround();
        if (heading == null) {
            heading = position.getHeading() != null ? position.getHeading().doubleValue() : null;
        }
        if (heading == null) {
            lastPositionState.update(position);
            return;
        }

        // Get broadcast cable zones
        ReadOnlyBroadcastState<String, Geofence> geofenceState =
                ctx.getBroadcastState(AISWatchdogJob.GEOFENCE_STATE_DESCRIPTOR);

        // Initialize alert time tracking
        Map<String, Long> alertTimes = lastAlertTimeState.value();
        if (alertTimes == null) {
            alertTimes = new HashMap<>();
        }

        long now = System.currentTimeMillis();

        // Calculate predicted positions along trajectory
        List<double[]> predictedPath = calculatePredictedPath(
                position.getLatitude(),
                position.getLongitude(),
                heading,
                speed,
                PREDICTION_MINUTES
        );

        // Check each cable zone for intersection
        for (Map.Entry<String, Geofence> entry : geofenceState.immutableEntries()) {
            Geofence zone = entry.getValue();

            // Only process cable protection zones
            if (!"cable_protection".equals(zone.getZoneType())) {
                continue;
            }

            // Rate limiting
            String alertKey = zone.getZoneId();
            Long lastAlert = alertTimes.get(alertKey);
            if (lastAlert != null && (now - lastAlert) < ALERT_COOLDOWN_MS) {
                continue;
            }

            try {
                Geometry zoneGeometry = getGeometry(zone);
                if (zoneGeometry == null) {
                    continue;
                }

                // Check if vessel is ALREADY in zone (skip - CableProximityDetector handles this)
                if (GeoUtils.isPointInPolygon(position.getLatitude(), position.getLongitude(), zoneGeometry)) {
                    continue;
                }

                // Check if predicted path intersects the zone
                IntersectionResult intersection = checkPathIntersection(predictedPath, zoneGeometry);

                if (intersection != null) {
                    // Calculate time to zone entry
                    double distanceNM = distanceNM(
                            position.getLatitude(), position.getLongitude(),
                            intersection.latitude, intersection.longitude
                    );
                    double timeToEntryMinutes = (distanceNM / speed) * 60;

                    // Only alert if entry is within prediction window
                    if (timeToEntryMinutes <= PREDICTION_MINUTES && timeToEntryMinutes > 1) {
                        Alert alert = createPredictiveAlert(
                                position, zone, timeToEntryMinutes, intersection, speed, heading
                        );
                        out.collect(alert);

                        alertTimes.put(alertKey, now);
                        lastAlertTimeState.update(alertTimes);

                        LOG.info("Predictive alert: {} heading toward {} - ETA {:.0f} min",
                                position.getShipName() != null ? position.getShipName() : position.getMmsi(),
                                zone.getZoneName(),
                                timeToEntryMinutes);
                    }
                }
            } catch (Exception e) {
                LOG.warn("Error checking zone {} for trajectory: {}", zone.getZoneId(), e.getMessage());
            }
        }

        lastPositionState.update(position);
    }

    /**
     * Calculate predicted positions along vessel trajectory.
     * Returns list of [lat, lon] points at 5-minute intervals.
     */
    private List<double[]> calculatePredictedPath(
            double lat, double lon, double heading, double speedKnots, int minutes) {

        List<double[]> path = new ArrayList<>();
        path.add(new double[]{lat, lon});

        // Calculate positions at 5-minute intervals
        for (int t = 5; t <= minutes; t += 5) {
            double distanceNM = speedKnots * (t / 60.0);
            double[] predicted = calculateDestination(lat, lon, heading, distanceNM);
            path.add(predicted);
        }

        return path;
    }

    /**
     * Calculate destination point given start, bearing, and distance.
     * Uses spherical earth formula.
     */
    private double[] calculateDestination(double lat, double lon, double bearing, double distanceNM) {
        double R = 3440.065;  // Earth radius in nautical miles
        double d = distanceNM / R;  // Angular distance
        double bearingRad = Math.toRadians(bearing);
        double lat1 = Math.toRadians(lat);
        double lon1 = Math.toRadians(lon);

        double lat2 = Math.asin(
                Math.sin(lat1) * Math.cos(d) +
                Math.cos(lat1) * Math.sin(d) * Math.cos(bearingRad)
        );

        double lon2 = lon1 + Math.atan2(
                Math.sin(bearingRad) * Math.sin(d) * Math.cos(lat1),
                Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
        );

        return new double[]{Math.toDegrees(lat2), Math.toDegrees(lon2)};
    }

    /**
     * Check if predicted path intersects a zone.
     * Returns intersection point and segment index if found.
     */
    private IntersectionResult checkPathIntersection(List<double[]> path, Geometry zone) {
        if (path.size() < 2) {
            return null;
        }

        // Create line segments and check for intersection
        for (int i = 0; i < path.size() - 1; i++) {
            double[] p1 = path.get(i);
            double[] p2 = path.get(i + 1);

            // Create line segment
            Coordinate[] coords = new Coordinate[]{
                    new Coordinate(p1[1], p1[0]),  // lon, lat
                    new Coordinate(p2[1], p2[0])
            };
            LineString segment = GEOMETRY_FACTORY.createLineString(coords);

            // Check intersection
            if (segment.intersects(zone)) {
                // Find the intersection point
                Geometry intersection = segment.intersection(zone);
                if (!intersection.isEmpty()) {
                    Coordinate intersectCoord = intersection.getCoordinate();
                    return new IntersectionResult(
                            intersectCoord.y,  // latitude
                            intersectCoord.x,  // longitude
                            i
                    );
                }
            }
        }

        return null;
    }

    /**
     * Calculate distance between two points in nautical miles.
     */
    private double distanceNM(double lat1, double lon1, double lat2, double lon2) {
        double R = 3440.065;
        double dLat = Math.toRadians(lat2 - lat1);
        double dLon = Math.toRadians(lon2 - lon1);
        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2)) *
                Math.sin(dLon / 2) * Math.sin(dLon / 2);
        double c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    /**
     * Create a predictive alert for approaching cable zone.
     */
    private Alert createPredictiveAlert(
            AISPosition position,
            Geofence zone,
            double timeToEntryMinutes,
            IntersectionResult intersection,
            double speed,
            double heading) {

        String severity = timeToEntryMinutes < 15 ? "HIGH" :
                         timeToEntryMinutes < 30 ? "MEDIUM" : "LOW";

        String title = String.format(
                "PREDICTIVE: Vessel approaching %s in ~%.0f min",
                zone.getZoneName(),
                timeToEntryMinutes
        );

        String description = String.format(
                "Vessel %s (MMSI: %s) is on course to enter %s cable zone. " +
                "Current speed: %.1f kts, heading: %.0f°. " +
                "Predicted zone entry at (%.4f, %.4f) in approximately %.0f minutes.",
                position.getShipName() != null ? position.getShipName() : "Unknown",
                position.getMmsi(),
                zone.getZoneName(),
                speed,
                heading,
                intersection.latitude,
                intersection.longitude,
                timeToEntryMinutes
        );

        Map<String, Object> details = new HashMap<>();
        details.put("cable_name", zone.getZoneName());
        details.put("zone_id", zone.getZoneId());
        details.put("vessel_speed", speed);
        details.put("vessel_heading", heading);
        details.put("predicted_entry_lat", intersection.latitude);
        details.put("predicted_entry_lon", intersection.longitude);
        details.put("time_to_entry_minutes", Math.round(timeToEntryMinutes));
        details.put("prediction_type", "TRAJECTORY_INTERSECTION");

        Alert alert = new Alert(Alert.AlertType.TRAJECTORY_PREDICTION, Alert.Severity.valueOf(severity), position.getMmsi());
        alert.setVesselName(position.getShipName());
        alert.setLatitude(position.getLatitude());
        alert.setLongitude(position.getLongitude());
        alert.setTitle(title);
        alert.setDescription(description);
        for (Map.Entry<String, Object> entry : details.entrySet()) {
            alert.addDetail(entry.getKey(), entry.getValue());
        }

        return alert;
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
            LOG.info("TrajectoryPrediction: Updated cable zone: {} - {}",
                    geofence.getZoneId(), geofence.getZoneName());
        }
    }

    /**
     * Result of path-zone intersection check.
     */
    private static class IntersectionResult {
        final double latitude;
        final double longitude;
        final int segmentIndex;

        IntersectionResult(double latitude, double longitude, int segmentIndex) {
            this.latitude = latitude;
            this.longitude = longitude;
            this.segmentIndex = segmentIndex;
        }
    }
}
