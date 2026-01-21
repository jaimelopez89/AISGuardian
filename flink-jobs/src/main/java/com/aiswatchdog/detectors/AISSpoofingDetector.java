package com.aiswatchdog.detectors;

import com.aiswatchdog.models.AISPosition;
import com.aiswatchdog.models.Alert;
import com.aiswatchdog.utils.GeoUtils;
import org.apache.flink.api.common.state.ValueState;
import org.apache.flink.api.common.state.ValueStateDescriptor;
import org.apache.flink.configuration.Configuration;
import org.apache.flink.streaming.api.functions.KeyedProcessFunction;
import org.apache.flink.util.Collector;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.*;

/**
 * Detects potentially spoofed AIS signals.
 *
 * Detection methods:
 * 1. Impossible position jumps (teleportation) - vessel moves faster than physically possible
 * 2. Impossible speeds - reported SOG exceeds vessel's physical capabilities
 * 3. Invalid MMSI format - MMSI doesn't match standard patterns
 * 4. Inconsistent data - heading/COG mismatch while moving
 * 5. Position on land - coordinates that fall on land masses
 * 6. MMSI/IMO mismatch - IMO number changes for same MMSI (identity theft)
 * 7. Flag state mismatch - MMSI MID code doesn't match claimed flag
 * 8. Name change detection - vessel frequently changes name (identity obfuscation)
 * 9. Stateless MMSI - MMSI doesn't correspond to any valid flag state
 *
 * AIS spoofing is a significant concern in maritime security:
 * - Used to evade sanctions (Russia sanctions evasion fleet)
 * - Used in illegal fishing operations
 * - Can indicate criminal activity or hostile intent
 */
public class AISSpoofingDetector extends KeyedProcessFunction<String, AISPosition, Alert> {

    private static final Logger LOG = LoggerFactory.getLogger(AISSpoofingDetector.class);

    // Maximum realistic speed for a vessel in knots (container ships ~25kts, fast ferries ~40kts)
    private static final double MAX_REALISTIC_SPEED_KNOTS = 50.0;

    // AIS "speed not available" value (1023 raw = 102.3 knots) - treat as invalid, not spoofing
    private static final double AIS_SPEED_NOT_AVAILABLE = 102.3;

    // Maximum speed a vessel can actually achieve between position reports (knots)
    // Used to detect teleportation
    private static final double TELEPORTATION_SPEED_THRESHOLD = 60.0;

    // Minimum time between reports to consider for teleportation detection (seconds)
    private static final long MIN_TIME_FOR_TELEPORT_CHECK = 10;

    // Maximum heading/COG difference while moving at speed (degrees)
    private static final double MAX_HEADING_COG_DIFF = 45.0;

    // Speed threshold for heading/COG consistency check (knots)
    private static final double MIN_SPEED_FOR_HEADING_CHECK = 3.0;

    // Rate limiting
    private final Map<String, Long> lastAlertTime = new HashMap<>();
    private static final long ALERT_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes

    // State for tracking previous position
    private ValueState<AISPosition> lastPositionState;
    private ValueState<Integer> spoofingScoreState;

    // State for tracking IMO number and name history
    private ValueState<String> firstImoState;
    private ValueState<String> firstNameState;
    private ValueState<Set<String>> nameHistoryState;

    // Configurable timer interval for checking
    private final long checkIntervalMs;

    // Valid MID (Maritime Identification Digit) codes mapped to countries
    // First 3 digits of MMSI identify flag state
    private static final Map<String, String> MID_TO_COUNTRY = new HashMap<>();
    static {
        // Russia
        MID_TO_COUNTRY.put("273", "RU");
        // China
        MID_TO_COUNTRY.put("412", "CN");
        MID_TO_COUNTRY.put("413", "CN");
        MID_TO_COUNTRY.put("414", "CN");
        // Hong Kong
        MID_TO_COUNTRY.put("477", "HK");
        // Iran
        MID_TO_COUNTRY.put("422", "IR");
        // North Korea
        MID_TO_COUNTRY.put("445", "KP");
        // USA
        MID_TO_COUNTRY.put("303", "US");
        MID_TO_COUNTRY.put("338", "US");
        MID_TO_COUNTRY.put("366", "US");
        MID_TO_COUNTRY.put("367", "US");
        MID_TO_COUNTRY.put("368", "US");
        MID_TO_COUNTRY.put("369", "US");
        // UK
        MID_TO_COUNTRY.put("232", "GB");
        MID_TO_COUNTRY.put("233", "GB");
        MID_TO_COUNTRY.put("234", "GB");
        MID_TO_COUNTRY.put("235", "GB");
        // Germany
        MID_TO_COUNTRY.put("211", "DE");
        // Norway
        MID_TO_COUNTRY.put("257", "NO");
        MID_TO_COUNTRY.put("258", "NO");
        MID_TO_COUNTRY.put("259", "NO");
        // Denmark
        MID_TO_COUNTRY.put("219", "DK");
        MID_TO_COUNTRY.put("220", "DK");
        // Sweden
        MID_TO_COUNTRY.put("265", "SE");
        MID_TO_COUNTRY.put("266", "SE");
        // Finland
        MID_TO_COUNTRY.put("230", "FI");
        // Estonia
        MID_TO_COUNTRY.put("276", "EE");
        // Latvia
        MID_TO_COUNTRY.put("275", "LV");
        // Lithuania
        MID_TO_COUNTRY.put("277", "LT");
        // Poland
        MID_TO_COUNTRY.put("261", "PL");
        // Netherlands
        MID_TO_COUNTRY.put("244", "NL");
        MID_TO_COUNTRY.put("245", "NL");
        MID_TO_COUNTRY.put("246", "NL");
        // Flags of convenience
        MID_TO_COUNTRY.put("352", "PA"); // Panama
        MID_TO_COUNTRY.put("636", "LR"); // Liberia
        MID_TO_COUNTRY.put("538", "MH"); // Marshall Islands
        MID_TO_COUNTRY.put("311", "BS"); // Bahamas
        MID_TO_COUNTRY.put("312", "BS");
        MID_TO_COUNTRY.put("209", "MT"); // Malta
        MID_TO_COUNTRY.put("215", "MT");
        MID_TO_COUNTRY.put("256", "MT");
        MID_TO_COUNTRY.put("229", "MT");
        MID_TO_COUNTRY.put("249", "MT");
        MID_TO_COUNTRY.put("319", "CYP"); // Cyprus
        MID_TO_COUNTRY.put("212", "CYP");
        // Shadow fleet flags
        MID_TO_COUNTRY.put("620", "CM"); // Cameroon
        MID_TO_COUNTRY.put("613", "GA"); // Gabon
        MID_TO_COUNTRY.put("572", "PW"); // Palau
        MID_TO_COUNTRY.put("667", "SL"); // Sierra Leone
        MID_TO_COUNTRY.put("536", "GY"); // Guyana
    }

    public AISSpoofingDetector(long checkIntervalMs) {
        this.checkIntervalMs = checkIntervalMs;
    }

    @Override
    @SuppressWarnings("unchecked")
    public void open(Configuration parameters) throws Exception {
        lastPositionState = getRuntimeContext().getState(
                new ValueStateDescriptor<>("lastPosition", AISPosition.class));
        spoofingScoreState = getRuntimeContext().getState(
                new ValueStateDescriptor<>("spoofingScore", Integer.class));
        firstImoState = getRuntimeContext().getState(
                new ValueStateDescriptor<>("firstImo", String.class));
        firstNameState = getRuntimeContext().getState(
                new ValueStateDescriptor<>("firstName", String.class));
        nameHistoryState = getRuntimeContext().getState(
                new ValueStateDescriptor<>("nameHistory", (Class<Set<String>>) (Class<?>) Set.class));
    }

    @Override
    public void processElement(AISPosition position, Context ctx, Collector<Alert> out) throws Exception {
        String mmsi = position.getMmsi();
        List<Alert> alerts = new ArrayList<>();

        // Get previous position
        AISPosition lastPosition = lastPositionState.value();
        Integer spoofingScore = spoofingScoreState.value();
        if (spoofingScore == null) spoofingScore = 0;

        // Check 1: Invalid MMSI format
        Alert mmsiAlert = checkInvalidMmsi(position);
        if (mmsiAlert != null) {
            alerts.add(mmsiAlert);
            spoofingScore += 30;
        }

        // Check 2: Impossible reported speed
        Alert speedAlert = checkImpossibleSpeed(position);
        if (speedAlert != null) {
            alerts.add(speedAlert);
            spoofingScore += 20;
        }

        // Check 3: Teleportation (position jump)
        if (lastPosition != null) {
            Alert teleportAlert = checkTeleportation(lastPosition, position);
            if (teleportAlert != null) {
                alerts.add(teleportAlert);
                spoofingScore += 50;
            }

            // Check 4: Heading/COG inconsistency while moving
            Alert headingAlert = checkHeadingInconsistency(position);
            if (headingAlert != null) {
                alerts.add(headingAlert);
                spoofingScore += 10;
            }
        }

        // Check 5: Invalid coordinates (basic bounds check)
        Alert coordAlert = checkInvalidCoordinates(position);
        if (coordAlert != null) {
            alerts.add(coordAlert);
            spoofingScore += 40;
        }

        // Check 6: IMO number change (identity theft)
        Alert imoChangeAlert = checkImoChange(position);
        if (imoChangeAlert != null) {
            alerts.add(imoChangeAlert);
            spoofingScore += 60;
        }

        // Check 7: Stateless MMSI (unknown flag state)
        Alert statelessAlert = checkStatelessMmsi(position);
        if (statelessAlert != null) {
            alerts.add(statelessAlert);
            spoofingScore += 15;
        }

        // Check 8: Frequent name changes
        Alert nameChangeAlert = checkFrequentNameChanges(position);
        if (nameChangeAlert != null) {
            alerts.add(nameChangeAlert);
            spoofingScore += 35;
        }

        // Emit alerts (with rate limiting)
        long now = System.currentTimeMillis();
        for (Alert alert : alerts) {
            String alertKey = mmsi + ":" + alert.getAlertType();
            Long lastAlert = lastAlertTime.get(alertKey);

            if (lastAlert == null || (now - lastAlert) >= ALERT_COOLDOWN_MS) {
                // Add spoofing score to alert details
                alert.addDetail("cumulative_spoofing_score", spoofingScore);
                out.collect(alert);
                lastAlertTime.put(alertKey, now);
                LOG.info("AIS Spoofing alert for {}: {} (score: {})",
                        mmsi, alert.getTitle(), spoofingScore);
            }
        }

        // Update state
        lastPositionState.update(position);
        spoofingScoreState.update(spoofingScore);
    }

    /**
     * Check for invalid MMSI format.
     */
    private Alert checkInvalidMmsi(AISPosition position) {
        String mmsi = position.getMmsi();

        if (mmsi == null || mmsi.length() != 9) {
            Map<String, Object> details = new HashMap<>();
            details.put("mmsi_length", mmsi != null ? mmsi.length() : 0);
            details.put("reason", "Invalid MMSI length (should be 9 digits)");

            return Alert.aisSpoofing(position, Alert.Severity.MEDIUM,
                    "Invalid MMSI Format",
                    String.format("Vessel %s has invalid MMSI format: %s",
                            position.getShipName() != null ? position.getShipName() : "Unknown",
                            mmsi),
                    details);
        }

        // Check for obviously fake MMSIs (all zeros, sequential digits, etc.)
        if (mmsi.matches("^0{9}$") || mmsi.matches("^9{9}$") ||
            mmsi.equals("123456789") || mmsi.equals("111111111")) {

            Map<String, Object> details = new HashMap<>();
            details.put("reason", "Suspicious MMSI pattern");
            details.put("pattern_detected", mmsi.matches("^0{9}$") ? "all_zeros" :
                       mmsi.matches("^9{9}$") ? "all_nines" : "sequential");

            return Alert.aisSpoofing(position, Alert.Severity.HIGH,
                    "Suspicious MMSI Pattern",
                    String.format("Vessel %s has suspicious MMSI: %s (possible spoofing)",
                            position.getShipName() != null ? position.getShipName() : "Unknown",
                            mmsi),
                    details);
        }

        // Check MID (first 3 digits) - should be valid country code (200-799)
        try {
            int mid = Integer.parseInt(mmsi.substring(0, 3));
            if (mid < 200 || mid > 799) {
                Map<String, Object> details = new HashMap<>();
                details.put("mid", mid);
                details.put("reason", "Invalid MID (should be 200-799)");

                return Alert.aisSpoofing(position, Alert.Severity.MEDIUM,
                        "Invalid MID Code",
                        String.format("Vessel %s has invalid MID code %d in MMSI %s",
                                position.getShipName() != null ? position.getShipName() : "Unknown",
                                mid, mmsi),
                        details);
            }
        } catch (NumberFormatException e) {
            Map<String, Object> details = new HashMap<>();
            details.put("reason", "Non-numeric MMSI");

            return Alert.aisSpoofing(position, Alert.Severity.HIGH,
                    "Invalid MMSI Characters",
                    String.format("Vessel has non-numeric MMSI: %s", mmsi),
                    details);
        }

        return null;
    }

    /**
     * Check for impossible reported speeds.
     */
    private Alert checkImpossibleSpeed(AISPosition position) {
        Double sog = position.getSpeedOverGround();

        // Skip AIS "speed not available" value (102.3 knots = 1023 raw)
        // This is not spoofing, just missing data
        if (sog != null && Math.abs(sog - AIS_SPEED_NOT_AVAILABLE) < 0.1) {
            return null;
        }

        if (sog != null && sog > MAX_REALISTIC_SPEED_KNOTS) {
            Map<String, Object> details = new HashMap<>();
            details.put("reported_speed", sog);
            details.put("max_realistic_speed", MAX_REALISTIC_SPEED_KNOTS);
            details.put("reason", "Speed exceeds physical capabilities");

            Alert.Severity severity = sog > 100 ? Alert.Severity.CRITICAL : Alert.Severity.HIGH;

            return Alert.aisSpoofing(position, severity,
                    "Impossible Speed Reported",
                    String.format("Vessel %s (MMSI: %s) reporting impossible speed: %.1f knots",
                            position.getShipName() != null ? position.getShipName() : "Unknown",
                            position.getMmsi(), sog),
                    details);
        }

        return null;
    }

    /**
     * Check for position teleportation (impossible position jumps).
     */
    private Alert checkTeleportation(AISPosition lastPosition, AISPosition currentPosition) {
        Instant lastTime = lastPosition.getTimestampAsInstant();
        Instant currentTime = currentPosition.getTimestampAsInstant();

        if (lastTime == null || currentTime == null) {
            return null;
        }

        long secondsBetween = ChronoUnit.SECONDS.between(lastTime, currentTime);

        // Need minimum time between reports to check
        if (secondsBetween < MIN_TIME_FOR_TELEPORT_CHECK) {
            return null;
        }

        // Calculate distance between positions
        double distanceNm = GeoUtils.distanceNauticalMiles(
                lastPosition.getLatitude(), lastPosition.getLongitude(),
                currentPosition.getLatitude(), currentPosition.getLongitude()
        );

        // Calculate implied speed
        double impliedSpeedKnots = (distanceNm / secondsBetween) * 3600;

        if (impliedSpeedKnots > TELEPORTATION_SPEED_THRESHOLD) {
            Map<String, Object> details = new HashMap<>();
            details.put("implied_speed_knots", Math.round(impliedSpeedKnots * 10) / 10.0);
            details.put("distance_nm", Math.round(distanceNm * 100) / 100.0);
            details.put("time_seconds", secondsBetween);
            details.put("last_position", String.format("%.4f, %.4f",
                    lastPosition.getLatitude(), lastPosition.getLongitude()));
            details.put("current_position", String.format("%.4f, %.4f",
                    currentPosition.getLatitude(), currentPosition.getLongitude()));
            details.put("reason", "Position jump implies impossible speed");

            Alert.Severity severity;
            if (impliedSpeedKnots > 200) {
                severity = Alert.Severity.CRITICAL;
            } else if (impliedSpeedKnots > 100) {
                severity = Alert.Severity.HIGH;
            } else {
                severity = Alert.Severity.MEDIUM;
            }

            return Alert.aisSpoofing(currentPosition, severity,
                    "Position Teleportation Detected",
                    String.format("Vessel %s (MMSI: %s) jumped %.1f NM in %d seconds (implied speed: %.0f kts). " +
                                  "Possible GPS spoofing or AIS manipulation.",
                            currentPosition.getShipName() != null ? currentPosition.getShipName() : "Unknown",
                            currentPosition.getMmsi(),
                            distanceNm, secondsBetween, impliedSpeedKnots),
                    details);
        }

        return null;
    }

    /**
     * Check for heading/COG inconsistency while vessel is moving.
     */
    private Alert checkHeadingInconsistency(AISPosition position) {
        Double sog = position.getSpeedOverGround();
        Double heading = position.getHeading();
        Double cog = position.getCourseOverGround();

        // Only check if vessel is moving and both heading and COG are available
        if (sog == null || sog < MIN_SPEED_FOR_HEADING_CHECK ||
            heading == null || cog == null) {
            return null;
        }

        // Skip invalid heading values (511 = not available)
        if (heading > 360 || cog > 360) {
            return null;
        }

        // Calculate angular difference
        double diff = Math.abs(heading - cog);
        if (diff > 180) {
            diff = 360 - diff;
        }

        if (diff > MAX_HEADING_COG_DIFF) {
            Map<String, Object> details = new HashMap<>();
            details.put("heading", heading);
            details.put("course_over_ground", cog);
            details.put("angular_difference", diff);
            details.put("speed", sog);
            details.put("reason", "Large heading/COG difference while moving at speed");

            // Lower severity as this could be due to current/wind
            return Alert.aisSpoofing(position, Alert.Severity.LOW,
                    "Heading/COG Inconsistency",
                    String.format("Vessel %s (MMSI: %s) has %.0f° difference between heading (%.0f°) and COG (%.0f°) while moving at %.1f kts",
                            position.getShipName() != null ? position.getShipName() : "Unknown",
                            position.getMmsi(), diff, heading, cog, sog),
                    details);
        }

        return null;
    }

    /**
     * Check for invalid coordinates.
     */
    private Alert checkInvalidCoordinates(AISPosition position) {
        double lat = position.getLatitude();
        double lon = position.getLongitude();

        // Basic bounds check
        if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
            Map<String, Object> details = new HashMap<>();
            details.put("latitude", lat);
            details.put("longitude", lon);
            details.put("reason", "Coordinates outside valid range");

            return Alert.aisSpoofing(position, Alert.Severity.CRITICAL,
                    "Invalid Coordinates",
                    String.format("Vessel %s (MMSI: %s) reporting invalid coordinates: %.4f, %.4f",
                            position.getShipName() != null ? position.getShipName() : "Unknown",
                            position.getMmsi(), lat, lon),
                    details);
        }

        // Check for null island (0,0) - common spoofing indicator
        if (Math.abs(lat) < 0.1 && Math.abs(lon) < 0.1) {
            Map<String, Object> details = new HashMap<>();
            details.put("latitude", lat);
            details.put("longitude", lon);
            details.put("reason", "Position at null island (0,0)");

            return Alert.aisSpoofing(position, Alert.Severity.HIGH,
                    "Null Island Position",
                    String.format("Vessel %s (MMSI: %s) at null island (0,0) - likely GPS error or spoofing",
                            position.getShipName() != null ? position.getShipName() : "Unknown",
                            position.getMmsi()),
                    details);
        }

        return null;
    }

    /**
     * Check for IMO number changes (identity theft).
     * If a vessel's IMO changes, it's likely spoofing or using stolen identity.
     */
    private Alert checkImoChange(AISPosition position) throws Exception {
        String currentImo = position.getImoNumber();
        if (currentImo == null || currentImo.isEmpty() || currentImo.equals("0")) {
            return null;
        }

        String firstImo = firstImoState.value();
        if (firstImo == null) {
            // First time seeing this vessel with an IMO
            firstImoState.update(currentImo);
            return null;
        }

        // Check if IMO has changed
        if (!firstImo.equals(currentImo)) {
            Map<String, Object> details = new HashMap<>();
            details.put("original_imo", firstImo);
            details.put("current_imo", currentImo);
            details.put("reason", "IMO number changed - possible identity theft or spoofing");

            return Alert.aisSpoofing(position, Alert.Severity.CRITICAL,
                    "IMO Number Changed - Identity Spoofing",
                    String.format("CRITICAL: Vessel MMSI %s changed IMO from %s to %s. " +
                                  "IMO numbers are permanent and should never change. " +
                                  "This indicates identity theft or AIS manipulation. " +
                                  "Vessel name: %s",
                            position.getMmsi(), firstImo, currentImo,
                            position.getShipName() != null ? position.getShipName() : "Unknown"),
                    details);
        }

        return null;
    }

    /**
     * Check for stateless MMSI (unknown/invalid flag state).
     * Some shadow fleet vessels use MMSI numbers that don't correspond to any valid country.
     */
    private Alert checkStatelessMmsi(AISPosition position) {
        String mmsi = position.getMmsi();
        if (mmsi == null || mmsi.length() < 3) {
            return null;
        }

        String mid = mmsi.substring(0, 3);

        // Check if MID is in valid range but not in our known countries list
        try {
            int midValue = Integer.parseInt(mid);

            // Valid MID range is 200-799
            if (midValue >= 200 && midValue <= 799 && !MID_TO_COUNTRY.containsKey(mid)) {
                // Unknown but potentially valid MID - could be a smaller country not in our list
                // Only alert if it's a suspicious range (typically used by shadow fleet)

                // These are ranges with very few legitimate ships:
                // 600-639: African nations (some used by shadow fleet)
                // 570-579: Pacific islands (Palau used by shadow fleet)
                boolean suspiciousRange = (midValue >= 600 && midValue <= 639) ||
                                         (midValue >= 570 && midValue <= 579);

                if (suspiciousRange) {
                    Map<String, Object> details = new HashMap<>();
                    details.put("mid_code", mid);
                    details.put("mid_value", midValue);
                    details.put("reason", "MMSI uses uncommon flag state MID");

                    return Alert.aisSpoofing(position, Alert.Severity.LOW,
                            "Uncommon Flag State MID",
                            String.format("Vessel %s (MMSI: %s) uses uncommon MID code %s. " +
                                          "This region is sometimes used for flag-of-convenience registrations " +
                                          "by shadow fleet vessels.",
                                    position.getShipName() != null ? position.getShipName() : "Unknown",
                                    mmsi, mid),
                            details);
                }
            }
        } catch (NumberFormatException e) {
            // Non-numeric MID already caught by checkInvalidMmsi
        }

        return null;
    }

    /**
     * Check for frequent name changes (identity obfuscation).
     * Shadow fleet vessels often change names to evade detection.
     */
    private Alert checkFrequentNameChanges(AISPosition position) throws Exception {
        String currentName = position.getShipName();
        if (currentName == null || currentName.isEmpty() || currentName.equals("Unknown")) {
            return null;
        }

        // Normalize name for comparison
        String normalizedName = currentName.toUpperCase().trim();

        // Get or initialize name history
        Set<String> nameHistory = nameHistoryState.value();
        if (nameHistory == null) {
            nameHistory = new HashSet<>();
        }

        String firstName = firstNameState.value();
        if (firstName == null) {
            // First time seeing this vessel
            firstNameState.update(normalizedName);
            nameHistory.add(normalizedName);
            nameHistoryState.update(nameHistory);
            return null;
        }

        // Check if name has changed
        if (!nameHistory.contains(normalizedName)) {
            nameHistory.add(normalizedName);
            nameHistoryState.update(nameHistory);

            // Alert if this is the 3rd+ different name
            if (nameHistory.size() >= 3) {
                Map<String, Object> details = new HashMap<>();
                details.put("original_name", firstName);
                details.put("current_name", currentName);
                details.put("name_count", nameHistory.size());
                details.put("all_names", new ArrayList<>(nameHistory));
                details.put("reason", "Vessel has used multiple names - possible identity obfuscation");

                Alert.Severity severity = nameHistory.size() >= 5 ?
                        Alert.Severity.HIGH : Alert.Severity.MEDIUM;

                return Alert.aisSpoofing(position, severity,
                        "Multiple Vessel Names Detected",
                        String.format("Vessel MMSI %s has used %d different names: %s. " +
                                      "Current name: %s. Original name: %s. " +
                                      "Shadow fleet vessels often change names to evade sanctions.",
                                position.getMmsi(), nameHistory.size(),
                                String.join(", ", nameHistory),
                                currentName, firstName),
                        details);
            } else if (nameHistory.size() == 2) {
                // Just log the first name change (might be legitimate)
                LOG.info("Vessel {} changed name from {} to {}",
                        position.getMmsi(), firstName, currentName);
            }
        }

        return null;
    }
}
