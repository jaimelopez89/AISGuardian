package com.aiswatchdog.detectors;

import com.aiswatchdog.models.AISPosition;
import com.aiswatchdog.models.Alert;
import org.apache.flink.api.common.state.ListState;
import org.apache.flink.api.common.state.ListStateDescriptor;
import org.apache.flink.api.common.state.ValueState;
import org.apache.flink.api.common.state.ValueStateDescriptor;
import org.apache.flink.api.common.typeinfo.TypeInformation;
import org.apache.flink.configuration.Configuration;
import org.apache.flink.streaming.api.functions.KeyedProcessFunction;
import org.apache.flink.util.Collector;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.Serializable;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Detects loitering behavior - vessels staying in a small area for extended periods.
 *
 * Suspicious loitering patterns include:
 * - Circling/orbiting in one location
 * - Drifting slowly in a confined area
 * - Anchoring in unusual locations (not designated anchorages)
 * - Repeated back-and-forth movements
 *
 * This can indicate:
 * - Surveillance of undersea infrastructure
 * - Ship-to-ship transfer preparation
 * - Illegal fishing
 * - Search/recovery operations
 */
public class LoiteringDetector
        extends KeyedProcessFunction<String, AISPosition, Alert> {

    private static final Logger LOG = LoggerFactory.getLogger(LoiteringDetector.class);

    // Configuration
    private final double radiusNM;           // Max distance from center to still be "loitering"
    private final long minDurationMinutes;   // Minimum time to trigger alert
    private final long maxHistoryMinutes;    // How long to keep position history
    private final long checkIntervalMs;      // How often to check for loitering

    // Keyed state
    private ListState<TimestampedPosition> positionHistory;
    private ValueState<Long> lastAlertTime;
    private ValueState<LoiteringState> loiteringState;

    /**
     * Create detector with default thresholds.
     * Default: 0.5 NM radius, 30 min duration
     */
    public LoiteringDetector() {
        this(0.5, 30, 120, 60000);
    }

    /**
     * Create detector with custom thresholds.
     *
     * @param radiusNM           Radius in nautical miles
     * @param minDurationMinutes Minimum loitering duration to alert
     * @param maxHistoryMinutes  Maximum position history to keep
     * @param checkIntervalMs    Check interval in milliseconds
     */
    public LoiteringDetector(double radiusNM, long minDurationMinutes,
                             long maxHistoryMinutes, long checkIntervalMs) {
        this.radiusNM = radiusNM;
        this.minDurationMinutes = minDurationMinutes;
        this.maxHistoryMinutes = maxHistoryMinutes;
        this.checkIntervalMs = checkIntervalMs;
    }

    @Override
    public void open(Configuration parameters) {
        positionHistory = getRuntimeContext().getListState(
                new ListStateDescriptor<>("position-history", TypeInformation.of(TimestampedPosition.class))
        );

        lastAlertTime = getRuntimeContext().getState(
                new ValueStateDescriptor<>("last-alert-time", Long.class)
        );

        loiteringState = getRuntimeContext().getState(
                new ValueStateDescriptor<>("loitering-state", TypeInformation.of(LoiteringState.class))
        );
    }

    @Override
    public void processElement(
            AISPosition position,
            Context ctx,
            Collector<Alert> out) throws Exception {

        long currentTime = System.currentTimeMillis();

        // Add position to history
        TimestampedPosition tp = new TimestampedPosition(
                position.getLatitude(),
                position.getLongitude(),
                currentTime,
                position.getSpeedOverGround(),
                position.getShipName(),
                position.getShipType()
        );
        positionHistory.add(tp);

        // Clean old positions
        cleanOldPositions(currentTime);

        // Check for loitering
        checkLoitering(position, ctx, out, currentTime);

        // Register timer for periodic checks
        ctx.timerService().registerProcessingTimeTimer(currentTime + checkIntervalMs);
    }

    @Override
    public void onTimer(
            long timestamp,
            OnTimerContext ctx,
            Collector<Alert> out) throws Exception {

        // Periodic loitering check even without new positions
        List<TimestampedPosition> positions = getPositionList();
        if (!positions.isEmpty()) {
            TimestampedPosition last = positions.get(positions.size() - 1);
            AISPosition fakePos = new AISPosition();
            fakePos.setMmsi(ctx.getCurrentKey());
            fakePos.setLatitude(last.lat);
            fakePos.setLongitude(last.lon);
            fakePos.setShipName(last.shipName);
            fakePos.setShipType(last.shipType);

            checkLoitering(fakePos, ctx, out, timestamp);
        }
    }

    private void checkLoitering(
            AISPosition position,
            Context ctx,
            Collector<Alert> out,
            long currentTime) throws Exception {

        List<TimestampedPosition> positions = getPositionList();
        if (positions.size() < 3) {
            return; // Need at least a few positions
        }

        // Calculate centroid
        double centerLat = 0, centerLon = 0;
        for (TimestampedPosition p : positions) {
            centerLat += p.lat;
            centerLon += p.lon;
        }
        centerLat /= positions.size();
        centerLon /= positions.size();

        // Check if all positions are within radius
        double maxDistance = 0;
        long earliestTime = Long.MAX_VALUE;
        long latestTime = 0;

        for (TimestampedPosition p : positions) {
            double dist = distanceNM(centerLat, centerLon, p.lat, p.lon);
            maxDistance = Math.max(maxDistance, dist);
            earliestTime = Math.min(earliestTime, p.timestamp);
            latestTime = Math.max(latestTime, p.timestamp);
        }

        long durationMinutes = (latestTime - earliestTime) / 60000;

        // Update loitering state
        LoiteringState state = loiteringState.value();
        if (state == null) {
            state = new LoiteringState();
        }

        if (maxDistance <= radiusNM) {
            // Vessel is loitering
            state.isLoitering = true;
            state.centerLat = centerLat;
            state.centerLon = centerLon;
            state.durationMinutes = durationMinutes;
            state.radius = maxDistance;
            loiteringState.update(state);

            // Check if should alert
            if (durationMinutes >= minDurationMinutes) {
                Long lastAlert = lastAlertTime.value();
                // Only alert once per hour for same loitering event
                if (lastAlert == null || (currentTime - lastAlert) > 3600000) {
                    Alert alert = createLoiteringAlert(position, state, positions);
                    out.collect(alert);
                    lastAlertTime.update(currentTime);

                    LOG.info("Loitering detected: {} at ({}, {}) for {} minutes",
                            position.getMmsi(), centerLat, centerLon, durationMinutes);
                }
            }
        } else {
            // Not loitering anymore
            if (state.isLoitering) {
                state.isLoitering = false;
                loiteringState.update(state);
            }
        }
    }

    private Alert createLoiteringAlert(
            AISPosition position,
            LoiteringState state,
            List<TimestampedPosition> positions) {

        String mmsi = position.getMmsi();
        String shipName = position.getShipName() != null ? position.getShipName() : "Unknown";

        // Determine severity based on duration and context
        Alert.Severity severity = Alert.Severity.MEDIUM;
        if (state.durationMinutes > 120) {
            severity = Alert.Severity.HIGH;
        }
        if (state.durationMinutes > 360) {
            severity = Alert.Severity.CRITICAL;
        }

        // Check average speed - very slow movement is more suspicious
        double avgSpeed = 0;
        int speedCount = 0;
        for (TimestampedPosition p : positions) {
            if (p.speed != null) {
                avgSpeed += p.speed;
                speedCount++;
            }
        }
        if (speedCount > 0) {
            avgSpeed /= speedCount;
        }

        String title = String.format("%s: Vessel Loitering Detected",
                severity == Alert.Severity.CRITICAL ? "CRITICAL" :
                        severity == Alert.Severity.HIGH ? "HIGH" : "MEDIUM");

        String description = String.format(
                "Vessel %s (MMSI: %s) has been loitering at position (%.4f, %.4f) " +
                        "for %d minutes within a %.2f NM radius. Average speed: %.1f kts.",
                shipName, mmsi, state.centerLat, state.centerLon,
                state.durationMinutes, state.radius, avgSpeed);

        Map<String, Object> details = new HashMap<>();
        details.put("loiter_duration_minutes", state.durationMinutes);
        details.put("loiter_radius_nm", state.radius);
        details.put("center_lat", state.centerLat);
        details.put("center_lon", state.centerLon);
        details.put("average_speed", avgSpeed);
        details.put("position_count", positions.size());

        Alert alert = Alert.loitering(position, severity, title, description, details);
        return alert;
    }

    private void cleanOldPositions(long currentTime) throws Exception {
        List<TimestampedPosition> positions = getPositionList();
        long cutoffTime = currentTime - (maxHistoryMinutes * 60 * 1000);

        List<TimestampedPosition> newPositions = new ArrayList<>();
        for (TimestampedPosition p : positions) {
            if (p.timestamp >= cutoffTime) {
                newPositions.add(p);
            }
        }

        // Update state with cleaned positions
        positionHistory.clear();
        for (TimestampedPosition p : newPositions) {
            positionHistory.add(p);
        }
    }

    private List<TimestampedPosition> getPositionList() throws Exception {
        List<TimestampedPosition> list = new ArrayList<>();
        for (TimestampedPosition p : positionHistory.get()) {
            list.add(p);
        }
        return list;
    }

    /**
     * Calculate distance between two points in nautical miles.
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
     * Position with timestamp for history tracking.
     */
    public static class TimestampedPosition implements Serializable {
        public double lat;
        public double lon;
        public long timestamp;
        public Double speed;
        public String shipName;
        public Integer shipType;

        public TimestampedPosition() {}

        public TimestampedPosition(double lat, double lon, long timestamp,
                                   Double speed, String shipName, Integer shipType) {
            this.lat = lat;
            this.lon = lon;
            this.timestamp = timestamp;
            this.speed = speed;
            this.shipName = shipName;
            this.shipType = shipType;
        }
    }

    /**
     * Current loitering state for a vessel.
     */
    public static class LoiteringState implements Serializable {
        public boolean isLoitering = false;
        public double centerLat;
        public double centerLon;
        public long durationMinutes;
        public double radius;
    }
}
