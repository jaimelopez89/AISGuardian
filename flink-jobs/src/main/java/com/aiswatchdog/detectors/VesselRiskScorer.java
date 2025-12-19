package com.aiswatchdog.detectors;

import com.aiswatchdog.models.AISPosition;
import com.aiswatchdog.models.Alert;
import com.aiswatchdog.utils.GeoUtils;
import org.apache.flink.api.common.state.MapState;
import org.apache.flink.api.common.state.MapStateDescriptor;
import org.apache.flink.api.common.state.ValueState;
import org.apache.flink.api.common.state.ValueStateDescriptor;
import org.apache.flink.configuration.Configuration;
import org.apache.flink.streaming.api.functions.KeyedProcessFunction;
import org.apache.flink.util.Collector;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.time.Instant;
import java.util.*;

/**
 * Calculates risk scores for vessels based on historical behavior patterns.
 *
 * Risk factors tracked:
 * 1. Dark events (AIS transmission gaps) - vessels that frequently go dark
 * 2. Russian port visits - vessels that visit Russian Baltic ports
 * 3. Ship-to-ship transfer patterns - vessels that frequently rendezvous
 * 4. Erratic behavior - vessels with unusual movement patterns
 * 5. Flag changes - vessels that have changed flags
 * 6. High-risk flag state - vessels registered in shadow fleet nations
 *
 * Risk score thresholds:
 * - 0-25: Low risk (normal merchant vessel)
 * - 26-50: Medium risk (monitor)
 * - 51-75: High risk (enhanced monitoring)
 * - 76-100: Critical risk (immediate attention)
 */
public class VesselRiskScorer extends KeyedProcessFunction<String, AISPosition, Alert> {

    private static final Logger LOG = LoggerFactory.getLogger(VesselRiskScorer.class);

    // Russian Baltic ports coordinates (for proximity detection)
    private static final double[][] RUSSIAN_PORTS = {
        {59.9343, 30.3351},   // St. Petersburg
        {59.9126, 29.7725},   // Ust-Luga
        {59.7287, 30.1175},   // Primorsk
        {59.4500, 28.0333},   // Vysotsk
        {54.7065, 20.4522},   // Kaliningrad
        {54.6477, 19.8562},   // Baltiysk
    };

    // Threshold distance to consider "visited" a port (nautical miles)
    private static final double PORT_VISIT_DISTANCE_NM = 5.0;

    // Risk score weights
    private static final int DARK_EVENT_SCORE = 15;          // Per dark event
    private static final int RUSSIAN_PORT_VISIT_SCORE = 25;  // Per visit
    private static final int STS_TRANSFER_SCORE = 20;        // Per suspected transfer
    private static final int HIGH_RISK_FLAG_SCORE = 30;      // One-time
    private static final int NAME_CHANGE_SCORE = 10;         // Per name change
    private static final int ERRATIC_BEHAVIOR_SCORE = 5;     // Per incident

    // State
    private ValueState<Integer> darkEventCountState;
    private ValueState<Integer> russianPortVisitCountState;
    private ValueState<Integer> stsTransferCountState;
    private ValueState<Integer> erraticBehaviorCountState;
    private ValueState<Integer> nameChangeCountState;
    private ValueState<Boolean> highRiskFlagState;
    private ValueState<Integer> currentRiskScoreState;
    private ValueState<Long> lastRiskAlertTimeState;
    private MapState<String, Long> russianPortVisitsState; // port name -> last visit timestamp

    // Alert cooldown (only alert when risk score changes significantly)
    private static final long RISK_ALERT_COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4 hours
    private static final int RISK_SCORE_CHANGE_THRESHOLD = 15;

    // High-risk flag MIDs
    private static final Set<String> HIGH_RISK_MIDS = new HashSet<>(Arrays.asList(
        "273",  // Russia
        "422",  // Iran
        "445",  // North Korea
        "620",  // Cameroon
        "613",  // Gabon
        "572",  // Palau
        "667"   // Sierra Leone
    ));

    // Timer for decay calculation
    private final long decayCheckIntervalMs;

    public VesselRiskScorer(long decayCheckIntervalMs) {
        this.decayCheckIntervalMs = decayCheckIntervalMs;
    }

    @Override
    public void open(Configuration parameters) throws Exception {
        darkEventCountState = getRuntimeContext().getState(
                new ValueStateDescriptor<>("darkEventCount", Integer.class));
        russianPortVisitCountState = getRuntimeContext().getState(
                new ValueStateDescriptor<>("russianPortVisitCount", Integer.class));
        stsTransferCountState = getRuntimeContext().getState(
                new ValueStateDescriptor<>("stsTransferCount", Integer.class));
        erraticBehaviorCountState = getRuntimeContext().getState(
                new ValueStateDescriptor<>("erraticBehaviorCount", Integer.class));
        nameChangeCountState = getRuntimeContext().getState(
                new ValueStateDescriptor<>("nameChangeCount", Integer.class));
        highRiskFlagState = getRuntimeContext().getState(
                new ValueStateDescriptor<>("highRiskFlag", Boolean.class));
        currentRiskScoreState = getRuntimeContext().getState(
                new ValueStateDescriptor<>("currentRiskScore", Integer.class));
        lastRiskAlertTimeState = getRuntimeContext().getState(
                new ValueStateDescriptor<>("lastRiskAlertTime", Long.class));
        russianPortVisitsState = getRuntimeContext().getMapState(
                new MapStateDescriptor<>("russianPortVisits", String.class, Long.class));
    }

    @Override
    public void processElement(AISPosition position, Context ctx, Collector<Alert> out) throws Exception {
        String mmsi = position.getMmsi();
        long now = System.currentTimeMillis();

        // Initialize state if needed
        initializeStateIfNeeded();

        // Check for high-risk flag state (one-time check)
        checkHighRiskFlag(position);

        // Check for Russian port proximity
        checkRussianPortProximity(position, now);

        // Calculate current risk score
        int newRiskScore = calculateRiskScore();

        // Get previous score and check if we should alert
        Integer previousScore = currentRiskScoreState.value();
        if (previousScore == null) previousScore = 0;

        // Update risk score
        currentRiskScoreState.update(newRiskScore);

        // Determine if we should generate an alert
        Long lastAlertTime = lastRiskAlertTimeState.value();
        boolean shouldAlert = false;
        String alertReason = null;

        // Alert if score crossed into high/critical tier
        if (newRiskScore >= 75 && previousScore < 75) {
            shouldAlert = true;
            alertReason = "crossed into CRITICAL risk tier";
        } else if (newRiskScore >= 50 && previousScore < 50) {
            shouldAlert = true;
            alertReason = "crossed into HIGH risk tier";
        } else if (newRiskScore >= 25 && previousScore < 25) {
            shouldAlert = true;
            alertReason = "crossed into MEDIUM risk tier";
        }

        // Also alert if score increased significantly
        if (!shouldAlert && (newRiskScore - previousScore) >= RISK_SCORE_CHANGE_THRESHOLD) {
            if (lastAlertTime == null || (now - lastAlertTime) >= RISK_ALERT_COOLDOWN_MS) {
                shouldAlert = true;
                alertReason = String.format("risk score increased by %d points", newRiskScore - previousScore);
            }
        }

        // Generate alert if needed
        if (shouldAlert && newRiskScore >= 25) {
            Alert alert = createRiskAlert(position, newRiskScore, alertReason);
            out.collect(alert);
            lastRiskAlertTimeState.update(now);

            LOG.warn("VESSEL RISK ALERT: {} (MMSI: {}) - Score: {} - {}",
                    position.getShipName(), mmsi, newRiskScore, alertReason);
        }
    }

    private void initializeStateIfNeeded() throws Exception {
        if (darkEventCountState.value() == null) darkEventCountState.update(0);
        if (russianPortVisitCountState.value() == null) russianPortVisitCountState.update(0);
        if (stsTransferCountState.value() == null) stsTransferCountState.update(0);
        if (erraticBehaviorCountState.value() == null) erraticBehaviorCountState.update(0);
        if (nameChangeCountState.value() == null) nameChangeCountState.update(0);
        if (highRiskFlagState.value() == null) highRiskFlagState.update(false);
        if (currentRiskScoreState.value() == null) currentRiskScoreState.update(0);
    }

    private void checkHighRiskFlag(AISPosition position) throws Exception {
        if (highRiskFlagState.value()) {
            return; // Already checked
        }

        String mmsi = position.getMmsi();
        if (mmsi != null && mmsi.length() >= 3) {
            String mid = mmsi.substring(0, 3);
            if (HIGH_RISK_MIDS.contains(mid)) {
                highRiskFlagState.update(true);
                LOG.info("High-risk flag detected for MMSI {}: MID {}", mmsi, mid);
            }
        }
    }

    private void checkRussianPortProximity(AISPosition position, long timestamp) throws Exception {
        double lat = position.getLatitude();
        double lon = position.getLongitude();

        for (int i = 0; i < RUSSIAN_PORTS.length; i++) {
            double portLat = RUSSIAN_PORTS[i][0];
            double portLon = RUSSIAN_PORTS[i][1];

            double distanceNm = GeoUtils.distanceNauticalMiles(lat, lon, portLat, portLon);

            if (distanceNm <= PORT_VISIT_DISTANCE_NM) {
                String portKey = String.format("RU_PORT_%d", i);

                // Check if this is a new visit (not within last 24 hours)
                Long lastVisit = russianPortVisitsState.get(portKey);
                long twentyFourHours = 24 * 60 * 60 * 1000;

                if (lastVisit == null || (timestamp - lastVisit) > twentyFourHours) {
                    // New visit to Russian port
                    russianPortVisitsState.put(portKey, timestamp);
                    int visitCount = russianPortVisitCountState.value();
                    russianPortVisitCountState.update(visitCount + 1);

                    LOG.info("Vessel {} visited Russian port {} (visit #{})",
                            position.getMmsi(), getPortName(i), visitCount + 1);
                }
                break; // Only count one port per position
            }
        }
    }

    private String getPortName(int index) {
        switch (index) {
            case 0: return "St. Petersburg";
            case 1: return "Ust-Luga";
            case 2: return "Primorsk";
            case 3: return "Vysotsk";
            case 4: return "Kaliningrad";
            case 5: return "Baltiysk";
            default: return "Unknown";
        }
    }

    private int calculateRiskScore() throws Exception {
        int score = 0;

        // Dark events (capped at 4 events = 60 points)
        int darkEvents = Math.min(darkEventCountState.value(), 4);
        score += darkEvents * DARK_EVENT_SCORE;

        // Russian port visits (capped at 3 visits = 75 points)
        int russianVisits = Math.min(russianPortVisitCountState.value(), 3);
        score += russianVisits * RUSSIAN_PORT_VISIT_SCORE;

        // Ship-to-ship transfers (capped at 3 = 60 points)
        int stsTransfers = Math.min(stsTransferCountState.value(), 3);
        score += stsTransfers * STS_TRANSFER_SCORE;

        // High-risk flag (one-time 30 points)
        if (highRiskFlagState.value()) {
            score += HIGH_RISK_FLAG_SCORE;
        }

        // Name changes (capped at 3 = 30 points)
        int nameChanges = Math.min(nameChangeCountState.value(), 3);
        score += nameChanges * NAME_CHANGE_SCORE;

        // Erratic behavior (capped at 4 = 20 points)
        int erraticCount = Math.min(erraticBehaviorCountState.value(), 4);
        score += erraticCount * ERRATIC_BEHAVIOR_SCORE;

        // Cap at 100
        return Math.min(score, 100);
    }

    private Alert createRiskAlert(AISPosition position, int riskScore, String reason) throws Exception {
        Map<String, Object> details = new HashMap<>();
        details.put("risk_score", riskScore);
        details.put("dark_event_count", darkEventCountState.value());
        details.put("russian_port_visits", russianPortVisitCountState.value());
        details.put("sts_transfer_count", stsTransferCountState.value());
        details.put("high_risk_flag", highRiskFlagState.value());
        details.put("name_change_count", nameChangeCountState.value());
        details.put("erratic_behavior_count", erraticBehaviorCountState.value());
        details.put("alert_reason", reason);

        // Collect port visit details
        List<String> visitedPorts = new ArrayList<>();
        for (int i = 0; i < RUSSIAN_PORTS.length; i++) {
            String portKey = String.format("RU_PORT_%d", i);
            if (russianPortVisitsState.contains(portKey)) {
                visitedPorts.add(getPortName(i));
            }
        }
        if (!visitedPorts.isEmpty()) {
            details.put("visited_russian_ports", visitedPorts);
        }

        String riskTier;
        Alert.Severity severity;

        if (riskScore >= 75) {
            riskTier = "CRITICAL";
            severity = Alert.Severity.CRITICAL;
        } else if (riskScore >= 50) {
            riskTier = "HIGH";
            severity = Alert.Severity.HIGH;
        } else if (riskScore >= 25) {
            riskTier = "MEDIUM";
            severity = Alert.Severity.MEDIUM;
        } else {
            riskTier = "LOW";
            severity = Alert.Severity.LOW;
        }

        details.put("risk_tier", riskTier);

        String title = String.format("%s Risk Vessel: %s",
                riskTier,
                position.getShipName() != null ? position.getShipName() : position.getMmsi());

        StringBuilder descBuilder = new StringBuilder();
        descBuilder.append(String.format("Vessel %s (MMSI: %s) has a risk score of %d/100 (%s). ",
                position.getShipName() != null ? position.getShipName() : "Unknown",
                position.getMmsi(),
                riskScore,
                riskTier));

        // Add contributing factors
        List<String> factors = new ArrayList<>();
        if (russianPortVisitCountState.value() > 0) {
            factors.add(String.format("%d Russian port visit(s)", russianPortVisitCountState.value()));
        }
        if (darkEventCountState.value() > 0) {
            factors.add(String.format("%d dark event(s)", darkEventCountState.value()));
        }
        if (highRiskFlagState.value()) {
            factors.add("high-risk flag state");
        }
        if (stsTransferCountState.value() > 0) {
            factors.add(String.format("%d suspected STS transfer(s)", stsTransferCountState.value()));
        }
        if (nameChangeCountState.value() > 0) {
            factors.add(String.format("%d name change(s)", nameChangeCountState.value()));
        }

        if (!factors.isEmpty()) {
            descBuilder.append("Contributing factors: ");
            descBuilder.append(String.join(", ", factors));
            descBuilder.append(".");
        }

        Alert alert = new Alert(Alert.AlertType.SANCTIONS_MATCH, severity, position.getMmsi());
        alert.setVesselName(position.getShipName());
        alert.setImoNumber(position.getImoNumber());
        alert.setLatitude(position.getLatitude());
        alert.setLongitude(position.getLongitude());
        alert.setTitle(title);
        alert.setDescription(descBuilder.toString());
        alert.setDetails(details);

        return alert;
    }

    /**
     * Called by external detectors to increment dark event count.
     * This should be called when DarkEventDetector fires for this vessel.
     */
    public void incrementDarkEventCount() throws Exception {
        int count = darkEventCountState.value();
        darkEventCountState.update(count + 1);
    }

    /**
     * Called by external detectors to increment STS transfer count.
     * This should be called when RendezvousDetector fires for this vessel.
     */
    public void incrementStsTransferCount() throws Exception {
        int count = stsTransferCountState.value();
        stsTransferCountState.update(count + 1);
    }

    /**
     * Called by external detectors to increment name change count.
     * This should be called when AISSpoofingDetector detects a name change.
     */
    public void incrementNameChangeCount() throws Exception {
        int count = nameChangeCountState.value();
        nameChangeCountState.update(count + 1);
    }

    /**
     * Called by external detectors to increment erratic behavior count.
     * This should be called when AISSpoofingDetector detects suspicious behavior.
     */
    public void incrementErraticBehaviorCount() throws Exception {
        int count = erraticBehaviorCountState.value();
        erraticBehaviorCountState.update(count + 1);
    }
}
