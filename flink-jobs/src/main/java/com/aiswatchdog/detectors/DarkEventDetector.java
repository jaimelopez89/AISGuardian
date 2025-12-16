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

/**
 * Detects "going dark" events where vessels stop transmitting AIS.
 *
 * A vessel "goes dark" when:
 * - It was actively transmitting (>1 msg per 5 min)
 * - Current gap exceeds threshold (default 2 hours)
 * - Last known position was not in port (speed > 0.5 knots)
 * - Vessel type is cargo, tanker, or fishing (not pleasure craft)
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
