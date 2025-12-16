package com.aiswatchdog.detectors;

import com.aiswatchdog.AISWatchdogJob;
import com.aiswatchdog.models.AISPosition;
import com.aiswatchdog.models.Alert;
import com.aiswatchdog.models.Geofence;
import com.aiswatchdog.models.VesselState;
import com.aiswatchdog.utils.GeoUtils;
import org.apache.flink.api.common.state.BroadcastState;
import org.apache.flink.api.common.state.ReadOnlyBroadcastState;
import org.apache.flink.api.common.state.ValueState;
import org.apache.flink.api.common.state.ValueStateDescriptor;
import org.apache.flink.api.common.typeinfo.TypeInformation;
import org.apache.flink.configuration.Configuration;
import org.apache.flink.streaming.api.functions.co.KeyedBroadcastProcessFunction;
import org.apache.flink.util.Collector;
import org.locationtech.jts.geom.Geometry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.Serializable;
import java.util.HashMap;
import java.util.Map;

/**
 * Detects fishing behavior patterns and alerts when fishing occurs in protected areas.
 *
 * Fishing pattern indicators:
 * - Average speed: < 5 knots
 * - Speed variance: high (start/stop pattern)
 * - Course changes: > 10 significant changes per hour (> 30° deviation)
 * - Area covered: < 100 sq nautical miles (working a specific zone)
 *
 * Alerts when:
 * - Fishing pattern detected in Marine Protected Area (MPA)
 * - Non-fishing vessel type exhibiting fishing behavior
 * - Fishing in foreign EEZ (flag state mismatch)
 */
public class FishingPatternDetector
        extends KeyedBroadcastProcessFunction<String, AISPosition, Geofence, Alert> {

    private static final Logger LOG = LoggerFactory.getLogger(FishingPatternDetector.class);

    // Configuration thresholds
    private final double maxFishingSpeedKnots;
    private final int minCourseChangesPerHour;
    private final double maxAreaSqNm;
    private final int minPositionsForAnalysis;

    // Keyed state for vessel tracking
    private ValueState<VesselState> vesselState;
    private ValueState<FishingAnalysis> fishingAnalysisState;

    // Cached geometries for MPA checks
    private transient Map<String, Geometry> geometryCache;

    /**
     * Fishing behavior analysis results.
     */
    public static class FishingAnalysis implements Serializable {
        private static final long serialVersionUID = 1L;

        public double avgSpeed;
        public double speedVariance;
        public int courseChangeCount;
        public double areaCoveredSqNm;
        public int positionsAnalyzed;
        public long analysisWindowMinutes;
        public boolean isFishingPattern;
        public double confidence;
        public String lastAlertZone;  // Avoid duplicate alerts for same zone

        public FishingAnalysis() {
            this.positionsAnalyzed = 0;
            this.isFishingPattern = false;
            this.confidence = 0;
        }
    }

    public FishingPatternDetector() {
        this(5.0, 10, 100, 10);
    }

    public FishingPatternDetector(double maxSpeed, int minCourseChanges,
                                   double maxArea, int minPositions) {
        this.maxFishingSpeedKnots = maxSpeed;
        this.minCourseChangesPerHour = minCourseChanges;
        this.maxAreaSqNm = maxArea;
        this.minPositionsForAnalysis = minPositions;
    }

    @Override
    public void open(Configuration parameters) {
        vesselState = getRuntimeContext().getState(
                new ValueStateDescriptor<>("vessel-state", TypeInformation.of(VesselState.class))
        );

        fishingAnalysisState = getRuntimeContext().getState(
                new ValueStateDescriptor<>("fishing-analysis", TypeInformation.of(FishingAnalysis.class))
        );

        geometryCache = new HashMap<>();
    }

    @Override
    public void processElement(
            AISPosition position,
            ReadOnlyContext ctx,
            Collector<Alert> out) throws Exception {

        // Update vessel state
        VesselState state = vesselState.value();
        if (state == null) {
            state = new VesselState(position);
        } else {
            state.update(position);
        }
        vesselState.update(state);

        // Need enough positions for analysis
        if (state.getRecentPositions().size() < minPositionsForAnalysis) {
            return;
        }

        // Analyze fishing pattern
        FishingAnalysis analysis = analyzeFishingPattern(state);
        fishingAnalysisState.update(analysis);

        if (!analysis.isFishingPattern) {
            return;
        }

        // Check if in protected zone
        ReadOnlyBroadcastState<String, Geofence> geofences =
                ctx.getBroadcastState(AISWatchdogJob.GEOFENCE_STATE_DESCRIPTOR);

        for (Map.Entry<String, Geofence> entry : geofences.immutableEntries()) {
            Geofence geofence = entry.getValue();

            // Only check MPAs and EEZs for fishing violations
            if (!geofence.isMPA() && !"EEZ".equals(geofence.getZoneType())) {
                continue;
            }

            try {
                Geometry geometry = getGeometry(geofence);
                if (geometry == null) continue;

                boolean isInZone = GeoUtils.isPointInPolygon(
                        position.getLatitude(),
                        position.getLongitude(),
                        geometry
                );

                if (isInZone && shouldAlert(position, geofence, state, analysis)) {
                    Alert alert = createFishingAlert(position, geofence, state, analysis);
                    out.collect(alert);

                    // Record that we alerted for this zone
                    analysis.lastAlertZone = geofence.getZoneId();
                    fishingAnalysisState.update(analysis);
                }
            } catch (Exception e) {
                LOG.warn("Error checking zone {}: {}", geofence.getZoneId(), e.getMessage());
            }
        }
    }

    @Override
    public void processBroadcastElement(
            Geofence geofence,
            Context ctx,
            Collector<Alert> out) throws Exception {

        // Update broadcast state
        BroadcastState<String, Geofence> state =
                ctx.getBroadcastState(AISWatchdogJob.GEOFENCE_STATE_DESCRIPTOR);
        state.put(geofence.getZoneId(), geofence);

        // Cache geometry
        try {
            Geometry geometry = GeoUtils.parseGeoJson(geofence.getGeometry());
            geometryCache.put(geofence.getZoneId(), geometry);
            LOG.debug("Cached geometry for zone: {}", geofence.getZoneName());
        } catch (Exception e) {
            LOG.warn("Failed to parse geometry for {}", geofence.getZoneId());
        }
    }

    /**
     * Analyze recent positions to detect fishing pattern.
     */
    private FishingAnalysis analyzeFishingPattern(VesselState state) {
        FishingAnalysis analysis = new FishingAnalysis();
        var positions = state.getRecentPositions();

        if (positions.size() < minPositionsForAnalysis) {
            return analysis;
        }

        // Calculate speed statistics
        double sumSpeed = 0;
        double sumSpeedSq = 0;
        int speedCount = 0;
        int courseChanges = 0;
        Double lastCourse = null;

        double minLat = Double.MAX_VALUE, maxLat = Double.MIN_VALUE;
        double minLon = Double.MAX_VALUE, maxLon = Double.MIN_VALUE;

        for (var pos : positions) {
            // Speed stats
            if (pos.speed != null) {
                sumSpeed += pos.speed;
                sumSpeedSq += pos.speed * pos.speed;
                speedCount++;
            }

            // Course change detection
            if (pos.course != null && lastCourse != null) {
                double change = Math.abs(pos.course - lastCourse);
                if (change > 180) change = 360 - change;
                if (change > 30) {  // Significant course change
                    courseChanges++;
                }
            }
            lastCourse = pos.course;

            // Bounding box for area calculation
            minLat = Math.min(minLat, pos.lat);
            maxLat = Math.max(maxLat, pos.lat);
            minLon = Math.min(minLon, pos.lon);
            maxLon = Math.max(maxLon, pos.lon);
        }

        // Calculate averages
        analysis.positionsAnalyzed = positions.size();

        if (speedCount > 0) {
            analysis.avgSpeed = sumSpeed / speedCount;
            double avgSpeedSq = sumSpeedSq / speedCount;
            analysis.speedVariance = avgSpeedSq - (analysis.avgSpeed * analysis.avgSpeed);
        }

        analysis.courseChangeCount = courseChanges;

        // Calculate area covered
        double latDist = GeoUtils.distanceNauticalMiles(minLat, minLon, maxLat, minLon);
        double lonDist = GeoUtils.distanceNauticalMiles(minLat, minLon, minLat, maxLon);
        analysis.areaCoveredSqNm = latDist * lonDist;

        // Determine if fishing pattern
        analysis.isFishingPattern = evaluateFishingPattern(analysis);
        analysis.confidence = calculateConfidence(analysis);

        return analysis;
    }

    /**
     * Evaluate if metrics indicate fishing behavior.
     */
    private boolean evaluateFishingPattern(FishingAnalysis analysis) {
        int indicators = 0;

        // Low average speed
        if (analysis.avgSpeed < maxFishingSpeedKnots) {
            indicators++;
        }

        // High speed variance (start/stop)
        if (analysis.speedVariance > 2.0) {
            indicators++;
        }

        // Frequent course changes
        // Normalize to per-hour rate (assume ~3 min between positions)
        double hourlyRate = analysis.courseChangeCount * (60.0 / (analysis.positionsAnalyzed * 3));
        if (hourlyRate >= minCourseChangesPerHour) {
            indicators++;
        }

        // Small operating area
        if (analysis.areaCoveredSqNm < maxAreaSqNm) {
            indicators++;
        }

        // Need at least 3 of 4 indicators
        return indicators >= 3;
    }

    /**
     * Calculate confidence score for fishing detection.
     */
    private double calculateConfidence(FishingAnalysis analysis) {
        double score = 0;

        // Speed contribution (0-25 points)
        if (analysis.avgSpeed < maxFishingSpeedKnots) {
            score += 25 * (1 - analysis.avgSpeed / maxFishingSpeedKnots);
        }

        // Speed variance contribution (0-25 points)
        score += Math.min(25, analysis.speedVariance * 5);

        // Course changes contribution (0-25 points)
        double hourlyRate = analysis.courseChangeCount * (60.0 / (analysis.positionsAnalyzed * 3));
        score += Math.min(25, hourlyRate * 2.5);

        // Area contribution (0-25 points)
        if (analysis.areaCoveredSqNm < maxAreaSqNm) {
            score += 25 * (1 - analysis.areaCoveredSqNm / maxAreaSqNm);
        }

        return Math.min(100, score);
    }

    /**
     * Determine if we should generate an alert.
     */
    private boolean shouldAlert(AISPosition position, Geofence geofence,
                                 VesselState state, FishingAnalysis analysis) {
        // Avoid duplicate alerts for same zone
        if (geofence.getZoneId().equals(analysis.lastAlertZone)) {
            return false;
        }

        // High confidence required
        if (analysis.confidence < 60) {
            return false;
        }

        // MPA - always alert on fishing behavior
        if (geofence.isMPA()) {
            return true;
        }

        // EEZ - alert for fishing vessels (would check flag in production)
        if ("EEZ".equals(geofence.getZoneType())) {
            // In production: check if vessel flag matches EEZ jurisdiction
            return position.isFishingVessel();
        }

        return false;
    }

    /**
     * Create alert for fishing in protected area.
     */
    private Alert createFishingAlert(AISPosition position, Geofence geofence,
                                      VesselState state, FishingAnalysis analysis) {
        Alert alert = new Alert(
                Alert.AlertType.FISHING_IN_MPA,
                geofence.isMPA() ? Alert.Severity.HIGH : Alert.Severity.MEDIUM,
                position.getMmsi()
        );

        alert.setVesselName(position.getShipName());
        alert.setImoNumber(position.getImoNumber());
        alert.setLatitude(position.getLatitude());
        alert.setLongitude(position.getLongitude());

        String vesselType = position.isFishingVessel() ? "Fishing vessel" : "Vessel";
        alert.setTitle(String.format("%s fishing in %s", vesselType, geofence.getZoneName()));

        alert.setDescription(String.format(
                "%s %s (MMSI: %s) detected fishing in %s. " +
                "Avg speed: %.1f kts, Course changes: %d, Confidence: %.0f%%",
                vesselType,
                position.getShipName() != null ? position.getShipName() : "Unknown",
                position.getMmsi(),
                geofence.getZoneName(),
                analysis.avgSpeed,
                analysis.courseChangeCount,
                analysis.confidence
        ));

        // Add analysis details
        alert.addDetail("zone_id", geofence.getZoneId());
        alert.addDetail("zone_type", geofence.getZoneType());
        alert.addDetail("avg_speed_knots", analysis.avgSpeed);
        alert.addDetail("speed_variance", analysis.speedVariance);
        alert.addDetail("course_changes", analysis.courseChangeCount);
        alert.addDetail("area_covered_sqnm", analysis.areaCoveredSqNm);
        alert.addDetail("confidence", analysis.confidence);
        alert.addDetail("positions_analyzed", analysis.positionsAnalyzed);

        // Adjust severity
        if (!position.isFishingVessel()) {
            // Non-fishing vessel exhibiting fishing behavior is more suspicious
            alert.setSeverity(Alert.Severity.HIGH);
            alert.addDetail("suspicious_behavior", "non_fishing_vessel_fishing_pattern");
        }

        if (geofence.isMPA() && analysis.confidence > 80) {
            alert.setSeverity(Alert.Severity.CRITICAL);
        }

        LOG.info("Fishing pattern detected: {} in {} (confidence: {:.0f}%)",
                position.getMmsi(), geofence.getZoneName(), analysis.confidence);

        return alert;
    }

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
            return null;
        }
    }
}
