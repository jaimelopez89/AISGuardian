package com.aiswatchdog.detectors;

import com.aiswatchdog.models.AISPosition;
import com.aiswatchdog.models.Alert;
import com.aiswatchdog.models.SanctionedVessel;
import org.apache.flink.api.common.state.BroadcastState;
import org.apache.flink.api.common.state.MapStateDescriptor;
import org.apache.flink.api.common.state.ReadOnlyBroadcastState;
import org.apache.flink.api.common.state.ValueState;
import org.apache.flink.api.common.state.ValueStateDescriptor;
import org.apache.flink.api.common.typeinfo.BasicTypeInfo;
import org.apache.flink.api.common.typeinfo.TypeInformation;
import org.apache.flink.configuration.Configuration;
import org.apache.flink.streaming.api.functions.co.KeyedBroadcastProcessFunction;
import org.apache.flink.util.Collector;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.*;

/**
 * Detects vessels from Russia's shadow fleet based on sanctions lists.
 *
 * Detection methods:
 * 1. IMO number match against sanctioned vessels database
 * 2. High-risk flag state detection (based on MMSI MID code)
 * 3. Name matching against known shadow fleet vessels
 *
 * The shadow fleet consists of tankers and cargo ships used to evade
 * Western sanctions on Russian oil exports. These vessels often:
 * - Use flags of convenience (Cameroon, Gabon, Palau, etc.)
 * - Disable AIS transponders
 * - Conduct ship-to-ship transfers in open sea
 * - Use falsified documents and identities
 */
public class ShadowFleetDetector
        extends KeyedBroadcastProcessFunction<String, AISPosition, SanctionedVessel, Alert> {

    private static final Logger LOG = LoggerFactory.getLogger(ShadowFleetDetector.class);

    // Broadcast state descriptor for sanctions data
    public static final MapStateDescriptor<String, SanctionedVessel> SANCTIONS_STATE_DESCRIPTOR =
            new MapStateDescriptor<>(
                    "sanctions-state",
                    BasicTypeInfo.STRING_TYPE_INFO,
                    TypeInformation.of(SanctionedVessel.class)
            );

    // Track last alert time per vessel to avoid spam
    private ValueState<Long> lastAlertTimeState;
    private static final long ALERT_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

    // Track if vessel was already identified as shadow fleet
    private ValueState<Boolean> identifiedAsShadowFleetState;

    @Override
    public void open(Configuration parameters) throws Exception {
        lastAlertTimeState = getRuntimeContext().getState(
                new ValueStateDescriptor<>("lastAlertTime", Long.class));

        identifiedAsShadowFleetState = getRuntimeContext().getState(
                new ValueStateDescriptor<>("identifiedAsShadowFleet", Boolean.class));
    }

    @Override
    public void processElement(
            AISPosition position,
            ReadOnlyContext ctx,
            Collector<Alert> out) throws Exception {

        String mmsi = position.getMmsi();
        String imoNumber = position.getImoNumber();
        long now = System.currentTimeMillis();

        // Check rate limiting
        Long lastAlert = lastAlertTimeState.value();
        if (lastAlert != null && (now - lastAlert) < ALERT_COOLDOWN_MS) {
            return; // Already alerted recently
        }

        // Get broadcast sanctions state
        ReadOnlyBroadcastState<String, SanctionedVessel> sanctionsState =
                ctx.getBroadcastState(SANCTIONS_STATE_DESCRIPTOR);

        List<Alert> alerts = new ArrayList<>();

        // Check 1: IMO number exact match (highest confidence)
        if (imoNumber != null && !imoNumber.isEmpty()) {
            SanctionedVessel sanctionedByImo = sanctionsState.get("IMO:" + imoNumber);
            if (sanctionedByImo != null && sanctionedByImo.isSanctionedVessel()) {
                Alert alert = createSanctionedVesselAlert(position, sanctionedByImo, "IMO_EXACT_MATCH");
                alerts.add(alert);
                LOG.warn("SHADOW FLEET VESSEL DETECTED (IMO match): {} (IMO: {}) - {}",
                        position.getShipName(), imoNumber, sanctionedByImo.getVesselName());
            }
        }

        // Check 2: MMSI exact match (for vessels in sanctions list by MMSI)
        if (mmsi != null && !mmsi.isEmpty()) {
            SanctionedVessel sanctionedByMmsi = sanctionsState.get("MMSI:" + mmsi);
            if (sanctionedByMmsi != null && sanctionedByMmsi.isSanctionedVessel()) {
                // Check if we already matched by IMO to avoid duplicates
                boolean alreadyMatched = alerts.stream()
                        .anyMatch(a -> a.getDetails() != null &&
                                "IMO_EXACT_MATCH".equals(a.getDetails().get("match_type")));

                if (!alreadyMatched) {
                    Alert alert = createSanctionedVesselAlert(position, sanctionedByMmsi, "MMSI_EXACT_MATCH");
                    alerts.add(alert);
                    LOG.warn("SHADOW FLEET VESSEL DETECTED (MMSI match): {} (MMSI: {}) - {}",
                            position.getShipName(), mmsi, sanctionedByMmsi.getVesselName());
                }
            }
        }

        // Check 3: High-risk flag state based on MMSI MID code (lower priority)
        // Note: Name matching has been removed - only exact IMO/MMSI matches trigger shadow fleet alerts
        if (mmsi != null && mmsi.length() >= 3 && alerts.isEmpty()) {
            String mid = mmsi.substring(0, 3);
            SanctionedVessel flagRisk = sanctionsState.get("FLAG:" + mid);
            if (flagRisk != null && flagRisk.isHighRiskFlag()) {
                // Only alert for critical risk flags with tankers
                String riskLevel = flagRisk.getRiskLevel();
                boolean isTanker = position.isTanker();

                if ("critical".equals(riskLevel) && isTanker) {
                    Alert alert = createHighRiskFlagAlert(position, flagRisk);
                    alerts.add(alert);
                }
            }
        }

        // Emit alerts
        if (!alerts.isEmpty()) {
            for (Alert alert : alerts) {
                out.collect(alert);
            }
            lastAlertTimeState.update(now);
            identifiedAsShadowFleetState.update(true);
        }
    }

    @Override
    public void processBroadcastElement(
            SanctionedVessel vessel,
            Context ctx,
            Collector<Alert> out) throws Exception {

        BroadcastState<String, SanctionedVessel> state = ctx.getBroadcastState(SANCTIONS_STATE_DESCRIPTOR);

        if (vessel.isSanctionedVessel()) {
            // Store by IMO number for IMO matching
            if (vessel.getImoNumber() != null && !vessel.getImoNumber().isEmpty()) {
                state.put("IMO:" + vessel.getImoNumber(), vessel);
                LOG.info("Loaded sanctioned vessel: {} (IMO: {})",
                        vessel.getVesselName(), vessel.getImoNumber());
            }
            // Also store by MMSI for MMSI matching
            if (vessel.getMmsi() != null && !vessel.getMmsi().isEmpty()) {
                state.put("MMSI:" + vessel.getMmsi(), vessel);
                LOG.info("Loaded sanctioned vessel: {} (MMSI: {})",
                        vessel.getVesselName(), vessel.getMmsi());
            }
        } else if (vessel.isHighRiskFlag()) {
            state.put("FLAG:" + vessel.getMidCode(), vessel);
            LOG.info("Loaded high-risk flag: {} ({})",
                    vessel.getCountryName(), vessel.getMidCode());
        }
    }

    /**
     * Create alert for a vessel matched by IMO or MMSI number (exact match).
     */
    private Alert createSanctionedVesselAlert(AISPosition position, SanctionedVessel sanctioned, String matchType) {
        Map<String, Object> details = new HashMap<>();
        details.put("sanctioned_imo", sanctioned.getImoNumber());
        details.put("sanctioned_mmsi", sanctioned.getMmsi());
        details.put("sanctioned_name", sanctioned.getVesselName());
        details.put("sanctions_authorities", sanctioned.getSanctionsAuthorities());
        details.put("risk_level", sanctioned.getRiskLevel());
        details.put("vessel_type", sanctioned.getVesselType());
        if (sanctioned.getNotes() != null && !sanctioned.getNotes().isEmpty()) {
            details.put("notes", sanctioned.getNotes());
        }
        details.put("match_type", matchType);
        // Mark as exact match so frontend knows to persist this alert
        details.put("exact_match", true);
        details.put("persistent", true);

        // Exact matches are always CRITICAL severity
        Alert.Severity severity = Alert.Severity.CRITICAL;

        String title = String.format("SHADOW FLEET: %s Detected",
                position.getShipName() != null ? position.getShipName() : "Unknown Vessel");

        String authList = String.join(", ", sanctioned.getSanctionsAuthorities());
        String matchInfo = matchType.contains("IMO") ?
                "IMO: " + sanctioned.getImoNumber() :
                "MMSI: " + sanctioned.getMmsi();
        String description = String.format(
                "CONFIRMED SANCTIONED VESSEL %s (MMSI: %s) detected in Baltic Sea. " +
                "Exact %s match against sanctions database. Sanctioned by: %s. " +
                "Risk level: CRITICAL.",
                position.getShipName() != null ? position.getShipName() : sanctioned.getVesselName(),
                position.getMmsi(),
                matchInfo,
                authList
        );

        return Alert.sanctionsMatch(position, severity, title, description, details);
    }

    /**
     * Create alert for a vessel with high-risk flag state.
     */
    private Alert createHighRiskFlagAlert(AISPosition position, SanctionedVessel flag) {
        Map<String, Object> details = new HashMap<>();
        details.put("flag_mid", flag.getMidCode());
        details.put("flag_country", flag.getCountryName());
        details.put("flag_code", flag.getCountryCode());
        details.put("risk_level", flag.getRiskLevel());
        details.put("reason", flag.getReason());
        details.put("match_type", "HIGH_RISK_FLAG");

        Alert.Severity severity = "critical".equals(flag.getRiskLevel()) ?
                Alert.Severity.HIGH : Alert.Severity.MEDIUM;

        // Elevate severity for tankers
        if (position.isTanker() && severity == Alert.Severity.MEDIUM) {
            severity = Alert.Severity.HIGH;
        }

        String vesselType = position.isTanker() ? "Tanker" : "Vessel";
        String title = String.format("%s with %s Flag",
                vesselType, flag.getCountryName());

        String description = String.format(
                "%s %s (MMSI: %s) flying %s flag detected. " +
                "%s Risk level: %s.",
                vesselType,
                position.getShipName() != null ? position.getShipName() : "Unknown",
                position.getMmsi(),
                flag.getCountryName(),
                flag.getReason(),
                flag.getRiskLevel().toUpperCase()
        );

        return Alert.sanctionsMatch(position, severity, title, description, details);
    }
}
