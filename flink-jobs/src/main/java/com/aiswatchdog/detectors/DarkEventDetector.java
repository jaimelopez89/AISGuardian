package com.aiswatchdog.detectors;

import com.aiswatchdog.models.AISPosition;
import com.aiswatchdog.models.Alert;
import com.aiswatchdog.models.VesselState;
import org.apache.flink.api.common.state.ValueState;
import org.apache.flink.api.common.state.ValueStateDescriptor;
import org.apache.flink.api.common.typeinfo.TypeInformation;
import org.apache.flink.configuration.Configuration;
import org.apache.flink.streaming.api.functions.KeyedProcessFunction;
import org.apache.flink.util.Collector;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Arrays;
import java.util.List;

/**
 * Detects "going dark" events where vessels stop transmitting AIS,
 * AND vessels that suddenly appear in open water (had AIS off previously).
 *
 * Detection methods:
 * 1. GONE DARK: Vessel was transmitting, then stopped
 *    - Was actively transmitting (>1 msg per 5 min)
 *    - Current gap exceeds threshold (default 2 hours)
 *    - Last known position was not in port (speed > 0.5 knots)
 *
 * 2. APPEARED DARK: NEW - Vessel suddenly appears >5nm from shore
 *    - First time we see this vessel
 *    - Position is >5nm from any coastline/port
 *    - Position is NOT at edge of monitoring bounding box
 *    - This indicates vessel was operating with AIS off
 *
 * Uses Flink's Keyed State to track each vessel independently.
 * Uses Processing Time timers to check for gaps.
 */
public class DarkEventDetector
        extends KeyedProcessFunction<String, AISPosition, Alert> {

    private static final Logger LOG = LoggerFactory.getLogger(DarkEventDetector.class);

    // Configuration
    private final long darkThresholdMinutes;
    private final long checkIntervalMs;

    // Baltic Sea bounding box (for detecting vessels appearing at edges)
    private static final double BBOX_MIN_LAT = 54.0;
    private static final double BBOX_MAX_LAT = 66.0;
    private static final double BBOX_MIN_LON = 9.0;
    private static final double BBOX_MAX_LON = 31.0;
    private static final double BBOX_EDGE_MARGIN = 0.5; // degrees (~30nm)

    // Minimum distance from shore for "appeared dark" detection (nautical miles)
    private static final double MIN_SHORE_DISTANCE_NM = 5.0;

    // Major Baltic Sea ports/coastal points for shore distance calculation
    private static final List<double[]> COASTAL_POINTS = Arrays.asList(
            // Finland
            new double[]{60.1699, 24.9384},  // Helsinki
            new double[]{60.4518, 22.2666},  // Turku
            // Estonia
            new double[]{59.4370, 24.7536},  // Tallinn
            // Latvia
            new double[]{56.9496, 24.1052},  // Riga
            // Lithuania
            new double[]{55.7033, 21.1443},  // Klaipeda
            // Poland
            new double[]{54.5189, 18.5305},  // Gdynia
            new double[]{54.3520, 18.6466},  // Gdansk
            // Germany
            new double[]{54.3233, 10.1228},  // Kiel
            new double[]{54.0924, 12.0991},  // Rostock
            // Denmark
            new double[]{55.6761, 12.5683},  // Copenhagen
            // Sweden
            new double[]{59.3293, 18.0686},  // Stockholm
            new double[]{57.7089, 11.9746},  // Gothenburg
            new double[]{55.6050, 13.0038},  // Malmö
            // Russia (Kaliningrad)
            new double[]{54.7104, 20.4522},  // Kaliningrad
            // Russia (St. Petersburg)
            new double[]{59.9343, 30.3351}   // St. Petersburg
    );

    // Keyed state for vessel tracking
    private ValueState<VesselState> vesselState;

    // Track if we've already alerted for this dark event
    private ValueState<Boolean> alertedState;

    /**
     * Create detector with default thresholds.
     */
    public DarkEventDetector() {
        this(120, 60000);  // 2 hour threshold, check every minute
    }

    /**
     * Create detector with custom thresholds.
     *
     * @param darkThresholdMinutes Minutes of silence before alerting
     * @param checkIntervalMs      How often to check for dark vessels (ms)
     */
    public DarkEventDetector(long darkThresholdMinutes, long checkIntervalMs) {
        this.darkThresholdMinutes = darkThresholdMinutes;
        this.checkIntervalMs = checkIntervalMs;
    }

    @Override
    public void open(Configuration parameters) {
        // Initialize state descriptors
        vesselState = getRuntimeContext().getState(
                new ValueStateDescriptor<>("vessel-state", TypeInformation.of(VesselState.class))
        );

        alertedState = getRuntimeContext().getState(
                new ValueStateDescriptor<>("alerted", Boolean.class)
        );
    }

    @Override
    public void processElement(
            AISPosition position,
            Context ctx,
            Collector<Alert> out) throws Exception {

        String mmsi = position.getMmsi();

        // Get or create vessel state
        VesselState state = vesselState.value();
        if (state == null) {
            // NEW VESSEL - Check for "appeared dark" condition
            // Vessel suddenly appears in monitoring area
            checkAppearedDark(position, out);

            state = new VesselState(position);
            LOG.debug("New vessel tracked: {}", mmsi);
        } else {
            state.update(position);
        }

        // Save updated state
        vesselState.update(state);

        // Reset alerted flag since vessel is transmitting again
        Boolean wasAlerted = alertedState.value();
        if (wasAlerted != null && wasAlerted) {
            LOG.info("Vessel {} is transmitting again after dark event", mmsi);
            alertedState.clear();
        }

        // Register timer to check for dark event
        long timerTime = ctx.timerService().currentProcessingTime() + checkIntervalMs;
        ctx.timerService().registerProcessingTimeTimer(timerTime);
    }

    /**
     * Check if a newly appearing vessel should trigger a "Dark AIS - Appeared" alert.
     * Vessels appearing >5nm from shore and NOT at the bounding box edge are suspicious.
     */
    private void checkAppearedDark(AISPosition position, Collector<Alert> out) {
        double lat = position.getLatitude();
        double lon = position.getLongitude();

        // Skip if at the edge of the bounding box (vessel likely just entered monitoring area)
        if (isAtBoundingBoxEdge(lat, lon)) {
            LOG.debug("Vessel {} appeared at bbox edge, not suspicious", position.getMmsi());
            return;
        }

        // Check distance from nearest shore point
        double minDistanceNm = getMinDistanceFromShore(lat, lon);

        if (minDistanceNm > MIN_SHORE_DISTANCE_NM) {
            // Vessel appeared in open water - suspicious!
            LOG.warn("DARK AIS APPEARED: {} appeared {}nm from shore at ({}, {})",
                    position.getMmsi(), String.format("%.1f", minDistanceNm), lat, lon);

            Alert alert = createAppearedDarkAlert(position, minDistanceNm);
            out.collect(alert);
        }
    }

    /**
     * Check if position is at the edge of the monitoring bounding box.
     */
    private boolean isAtBoundingBoxEdge(double lat, double lon) {
        return lat < BBOX_MIN_LAT + BBOX_EDGE_MARGIN ||
               lat > BBOX_MAX_LAT - BBOX_EDGE_MARGIN ||
               lon < BBOX_MIN_LON + BBOX_EDGE_MARGIN ||
               lon > BBOX_MAX_LON - BBOX_EDGE_MARGIN;
    }

    /**
     * Calculate minimum distance from any coastal point.
     */
    private double getMinDistanceFromShore(double lat, double lon) {
        double minDistance = Double.MAX_VALUE;
        for (double[] coastal : COASTAL_POINTS) {
            double distance = distanceNauticalMiles(lat, lon, coastal[0], coastal[1]);
            minDistance = Math.min(minDistance, distance);
        }
        return minDistance;
    }

    /**
     * Calculate distance between two points in nautical miles.
     */
    private double distanceNauticalMiles(double lat1, double lon1, double lat2, double lon2) {
        double dLat = Math.toRadians(lat2 - lat1);
        double dLon = Math.toRadians(lon2 - lon1);

        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2)) *
                        Math.sin(dLon / 2) * Math.sin(dLon / 2);

        double c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

        return 3440.065 * c; // Earth radius in nautical miles
    }

    /**
     * Create alert for vessel that appeared with AIS off.
     */
    private Alert createAppearedDarkAlert(AISPosition position, double distanceFromShore) {
        String title = String.format("Dark AIS: %s Appeared in Open Water",
                position.getShipName() != null ? position.getShipName() : position.getMmsi());

        String description = String.format(
                "Vessel %s (MMSI: %s) suddenly appeared %.1f nm from shore at position (%.4f, %.4f). " +
                "This vessel was not previously tracked, indicating it was operating with AIS transponder off. " +
                "Vessels appearing in open water without prior tracking history are suspicious.",
                position.getShipName() != null ? position.getShipName() : "Unknown",
                position.getMmsi(),
                distanceFromShore,
                position.getLatitude(),
                position.getLongitude()
        );

        // Determine severity based on vessel type and distance
        Alert.Severity severity = Alert.Severity.MEDIUM;
        if (position.isTanker() || position.isCargoVessel()) {
            severity = Alert.Severity.HIGH;
        }
        if (distanceFromShore > 20) {
            severity = Alert.Severity.HIGH;
        }

        return Alert.darkEvent(position, severity, title, description, "APPEARED_DARK", distanceFromShore);
    }

    @Override
    public void onTimer(
            long timestamp,
            OnTimerContext ctx,
            Collector<Alert> out) throws Exception {

        VesselState state = vesselState.value();
        if (state == null) {
            return;  // No state, nothing to check
        }

        // Calculate gap since last transmission
        long gapMinutes = state.getMinutesSinceLastSeen();

        // Check if vessel meets dark criteria
        if (gapMinutes >= darkThresholdMinutes && shouldAlert(state)) {
            Boolean alreadyAlerted = alertedState.value();
            if (alreadyAlerted == null || !alreadyAlerted) {
                // Generate alert
                Alert alert = Alert.darkEvent(state, gapMinutes);

                // Adjust severity based on context
                adjustSeverity(alert, state, gapMinutes);

                LOG.info("Dark event detected: {} - {} minutes silent",
                        state.getMmsi(), gapMinutes);

                out.collect(alert);

                // Mark as alerted to avoid duplicates
                alertedState.update(true);
            }
        }

        // Re-register timer for next check (only if vessel might still be dark)
        if (gapMinutes < 24 * 60) {  // Stop checking after 24 hours
            long nextTimer = ctx.timerService().currentProcessingTime() + checkIntervalMs;
            ctx.timerService().registerProcessingTimeTimer(nextTimer);
        }
    }

    /**
     * Determine if we should alert for this vessel going dark.
     */
    private boolean shouldAlert(VesselState state) {
        // Must have enough history to establish transmission pattern
        if (state.getMessageCount() < 5) {
            return false;
        }

        // Check if vessel was moving (not in port)
        Double lastSpeed = state.getLastSpeed();
        if (lastSpeed != null && lastSpeed < 0.5) {
            // Vessel was stationary - might be in port, less suspicious
            return false;
        }

        // Check vessel type - focus on commercial vessels
        Integer shipType = state.getShipType();
        if (shipType != null) {
            // Skip pleasure craft (36-37), sailing vessels (36)
            if (shipType >= 36 && shipType <= 37) {
                return false;
            }
            // Skip passenger ships (60-69) - different transmission patterns
            if (shipType >= 60 && shipType <= 69) {
                return false;
            }
        }

        // Gap should be significantly longer than typical interval
        double avgInterval = state.getAvgIntervalSeconds();
        long currentGap = state.getMinutesSinceLastSeen() * 60;

        if (avgInterval > 0 && currentGap < avgInterval * 10) {
            // Gap isn't that unusual for this vessel
            return false;
        }

        return true;
    }

    /**
     * Adjust alert severity based on context.
     */
    private void adjustSeverity(Alert alert, VesselState state, long gapMinutes) {
        // Higher severity for longer gaps
        if (gapMinutes > 24 * 60) {
            alert.setSeverity(Alert.Severity.HIGH);
        } else if (gapMinutes > 6 * 60) {
            alert.setSeverity(Alert.Severity.MEDIUM);
        }

        // Critical if vessel is sanctioned
        if (state.isSanctioned()) {
            alert.setSeverity(Alert.Severity.CRITICAL);
            alert.addDetail("sanctioned", true);
            alert.addDetail("sanction_info", state.getSanctionInfo());
        }

        // Critical if last position was in sensitive zone
        if (state.isInSensitiveZone()) {
            alert.setSeverity(Alert.Severity.CRITICAL);
            alert.addDetail("sensitive_zone", state.getCurrentZone());
        }

        // Higher severity for tankers (potential sanctions evasion)
        Integer shipType = state.getShipType();
        if (shipType != null && shipType >= 80 && shipType <= 89) {
            if (alert.getSeverity() == Alert.Severity.LOW) {
                alert.setSeverity(Alert.Severity.MEDIUM);
            }
            alert.addDetail("vessel_category", "tanker");
        }
    }
}
