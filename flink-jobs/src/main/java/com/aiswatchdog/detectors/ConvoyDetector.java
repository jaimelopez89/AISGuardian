package com.aiswatchdog.detectors;

import com.aiswatchdog.models.AISPosition;
import com.aiswatchdog.models.Alert;
import com.aiswatchdog.utils.GeoUtils;
import org.apache.flink.api.common.state.MapState;
import org.apache.flink.api.common.state.MapStateDescriptor;
import org.apache.flink.api.common.state.StateTtlConfig;
import org.apache.flink.api.common.time.Time;
import org.apache.flink.configuration.Configuration;
import org.apache.flink.streaming.api.functions.co.KeyedCoProcessFunction;
import org.apache.flink.util.Collector;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.*;
import java.util.stream.Collectors;

/**
 * Detects convoys - groups of vessels traveling together in coordinated fashion.
 *
 * A convoy is detected when:
 * 1. Multiple vessels (3+) are within proximity of each other
 * 2. They have similar speeds (within threshold)
 * 3. They have similar courses (within threshold)
 * 4. They maintain this formation for a sustained period
 *
 * Convoys can indicate:
 * - Military operations or exercises
 * - Coordinated smuggling operations
 * - Sanctions evasion (escort/protection of target vessels)
 * - Illegal fishing fleets
 *
 * This detector uses grid-based spatial partitioning for efficient nearby vessel lookup.
 */
public class ConvoyDetector extends KeyedCoProcessFunction<String, AISPosition, AISPosition, Alert> {

    private static final Logger LOG = LoggerFactory.getLogger(ConvoyDetector.class);

    // Convoy detection thresholds
    private final double proximityNm;      // Max distance between convoy vessels (NM)
    private final double speedTolerance;   // Max speed difference (knots)
    private final double courseTolerance;  // Max course difference (degrees)
    private final int minVessels;          // Minimum vessels to form a convoy
    private final long minDurationMinutes; // Minimum duration to confirm convoy

    // State for tracking vessel positions in this grid cell
    private MapState<String, VesselTrack> vesselTracksState;

    // Rate limiting
    private final Map<String, Long> lastAlertTime = new HashMap<>();
    private static final long ALERT_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

    // Track state expiration
    private static final long TRACK_EXPIRATION_MS = 10 * 60 * 1000; // 10 minutes

    /**
     * Internal class to track vessel positions and convoy membership.
     */
    public static class VesselTrack implements java.io.Serializable {
        private static final long serialVersionUID = 1L;

        String mmsi;
        String shipName;
        double latitude;
        double longitude;
        Double speed;
        Double course;
        long lastUpdateMs;
        String convoyId;
        long convoyStartMs;

        public VesselTrack() {}

        public VesselTrack(AISPosition pos) {
            this.mmsi = pos.getMmsi();
            this.shipName = pos.getShipName();
            this.latitude = pos.getLatitude();
            this.longitude = pos.getLongitude();
            this.speed = pos.getSpeedOverGround();
            this.course = pos.getCourseOverGround();
            this.lastUpdateMs = System.currentTimeMillis();
            this.convoyId = null;
            this.convoyStartMs = 0;
        }

        public void update(AISPosition pos) {
            this.latitude = pos.getLatitude();
            this.longitude = pos.getLongitude();
            this.speed = pos.getSpeedOverGround();
            this.course = pos.getCourseOverGround();
            this.shipName = pos.getShipName() != null ? pos.getShipName() : this.shipName;
            this.lastUpdateMs = System.currentTimeMillis();
        }
    }

    public ConvoyDetector(double proximityNm, double speedTolerance, double courseTolerance,
                          int minVessels, long minDurationMinutes) {
        this.proximityNm = proximityNm;
        this.speedTolerance = speedTolerance;
        this.courseTolerance = courseTolerance;
        this.minVessels = minVessels;
        this.minDurationMinutes = minDurationMinutes;
    }

    @Override
    public void open(Configuration parameters) throws Exception {
        // Configure state TTL to automatically clean up stale entries
        StateTtlConfig ttlConfig = StateTtlConfig
                .newBuilder(Time.minutes(30))  // State expires after 30 minutes of no updates
                .setUpdateType(StateTtlConfig.UpdateType.OnReadAndWrite)
                .setStateVisibility(StateTtlConfig.StateVisibility.NeverReturnExpired)
                .cleanupInRocksdbCompactFilter(1000)  // Cleanup during RocksDB compaction
                .build();

        MapStateDescriptor<String, VesselTrack> descriptor =
                new MapStateDescriptor<>("vesselTracks", String.class, VesselTrack.class);
        descriptor.enableTimeToLive(ttlConfig);
        vesselTracksState = getRuntimeContext().getMapState(descriptor);
    }

    @Override
    public void processElement1(AISPosition position, Context ctx, Collector<Alert> out) throws Exception {
        processPosition(position, out);
    }

    @Override
    public void processElement2(AISPosition position, Context ctx, Collector<Alert> out) throws Exception {
        processPosition(position, out);
    }

    private void processPosition(AISPosition position, Collector<Alert> out) throws Exception {
        String mmsi = position.getMmsi();
        long now = System.currentTimeMillis();

        // Update or create track for this vessel
        VesselTrack track = vesselTracksState.get(mmsi);
        if (track == null) {
            track = new VesselTrack(position);
        } else {
            track.update(position);
        }
        vesselTracksState.put(mmsi, track);

        // Clean expired tracks
        cleanExpiredTracks(now);

        // Get all active tracks in this grid cell
        List<VesselTrack> activeTracks = new ArrayList<>();
        for (VesselTrack t : vesselTracksState.values()) {
            if (now - t.lastUpdateMs < TRACK_EXPIRATION_MS) {
                activeTracks.add(t);
            }
        }

        // Need minimum vessels for convoy detection
        if (activeTracks.size() < minVessels) {
            return;
        }

        // Find convoy candidates - vessels moving together
        List<VesselTrack> convoyMembers = findConvoyMembers(track, activeTracks);

        if (convoyMembers.size() >= minVessels) {
            // Generate a convoy ID based on member MMSIs
            String convoyId = generateConvoyId(convoyMembers);

            // Check if this is a new convoy or existing one
            boolean isNewConvoy = track.convoyId == null || !track.convoyId.equals(convoyId);

            if (isNewConvoy) {
                // New convoy detected
                track.convoyId = convoyId;
                track.convoyStartMs = now;
            } else {
                // Existing convoy - check duration
                long durationMinutes = (now - track.convoyStartMs) / (60 * 1000);

                if (durationMinutes >= minDurationMinutes) {
                    // Convoy confirmed - emit alert
                    emitConvoyAlert(position, convoyMembers, durationMinutes, out);
                }
            }

            // Update convoy info for all members
            for (VesselTrack member : convoyMembers) {
                member.convoyId = convoyId;
                if (member.convoyStartMs == 0) {
                    member.convoyStartMs = now;
                }
                vesselTracksState.put(member.mmsi, member);
            }
        } else {
            // No longer in a convoy
            if (track.convoyId != null) {
                track.convoyId = null;
                track.convoyStartMs = 0;
                vesselTracksState.put(mmsi, track);
            }
        }
    }

    /**
     * Find vessels that could be in a convoy with the reference vessel.
     */
    private List<VesselTrack> findConvoyMembers(VesselTrack reference, List<VesselTrack> allTracks) {
        List<VesselTrack> members = new ArrayList<>();
        members.add(reference);

        // Skip if reference vessel isn't moving
        if (reference.speed == null || reference.speed < 1.0) {
            return members;
        }

        for (VesselTrack candidate : allTracks) {
            if (candidate.mmsi.equals(reference.mmsi)) {
                continue;
            }

            // Check proximity
            double distance = GeoUtils.distanceNauticalMiles(
                    reference.latitude, reference.longitude,
                    candidate.latitude, candidate.longitude
            );

            if (distance > proximityNm) {
                continue;
            }

            // Check speed similarity
            if (candidate.speed == null || Math.abs(candidate.speed - reference.speed) > speedTolerance) {
                continue;
            }

            // Check course similarity
            if (candidate.course == null || reference.course == null) {
                continue;
            }

            double courseDiff = Math.abs(candidate.course - reference.course);
            if (courseDiff > 180) {
                courseDiff = 360 - courseDiff;
            }
            if (courseDiff > courseTolerance) {
                continue;
            }

            // This vessel is a convoy member
            members.add(candidate);
        }

        return members;
    }

    /**
     * Generate a consistent convoy ID from member vessels.
     */
    private String generateConvoyId(List<VesselTrack> members) {
        return members.stream()
                .map(m -> m.mmsi)
                .sorted()
                .collect(Collectors.joining("-"));
    }

    /**
     * Emit an alert for a detected convoy.
     */
    private void emitConvoyAlert(AISPosition leadVessel, List<VesselTrack> members,
                                  long durationMinutes, Collector<Alert> out) {

        String convoyId = generateConvoyId(members);

        // Rate limiting
        long now = System.currentTimeMillis();
        Long lastAlert = lastAlertTime.get(convoyId);
        if (lastAlert != null && (now - lastAlert) < ALERT_COOLDOWN_MS) {
            return;
        }

        // Calculate average speed and course
        double avgSpeed = members.stream()
                .filter(m -> m.speed != null)
                .mapToDouble(m -> m.speed)
                .average()
                .orElse(0);

        double avgCourse = members.stream()
                .filter(m -> m.course != null)
                .mapToDouble(m -> m.course)
                .average()
                .orElse(0);

        // Build member list
        List<Map<String, Object>> memberList = new ArrayList<>();
        for (VesselTrack m : members) {
            Map<String, Object> memberInfo = new HashMap<>();
            memberInfo.put("mmsi", m.mmsi);
            memberInfo.put("name", m.shipName);
            memberInfo.put("speed", m.speed);
            memberInfo.put("course", m.course);
            memberList.add(memberInfo);
        }

        // Build alert details
        Map<String, Object> details = new HashMap<>();
        details.put("convoy_id", convoyId);
        details.put("vessel_count", members.size());
        details.put("duration_minutes", durationMinutes);
        details.put("average_speed", Math.round(avgSpeed * 10) / 10.0);
        details.put("average_course", Math.round(avgCourse));
        details.put("members", memberList);
        details.put("proximity_nm", proximityNm);

        // Determine severity based on convoy characteristics
        Alert.Severity severity;
        if (members.size() >= 5) {
            severity = Alert.Severity.HIGH;
        } else if (durationMinutes >= 60) {
            severity = Alert.Severity.HIGH;
        } else {
            severity = Alert.Severity.MEDIUM;
        }

        String memberNames = members.stream()
                .map(m -> m.shipName != null ? m.shipName : m.mmsi)
                .limit(3)
                .collect(Collectors.joining(", "));

        if (members.size() > 3) {
            memberNames += " +" + (members.size() - 3) + " more";
        }

        Alert alert = Alert.convoy(leadVessel, severity,
                "Convoy Detected",
                String.format("%d vessels traveling together at %.1f kts, course %.0f° for %d minutes: %s",
                        members.size(), avgSpeed, avgCourse, durationMinutes, memberNames),
                details);

        out.collect(alert);
        lastAlertTime.put(convoyId, now);

        LOG.info("Convoy alert: {} vessels ({})", members.size(), memberNames);
    }

    /**
     * Clean up expired vessel tracks.
     */
    private void cleanExpiredTracks(long now) throws Exception {
        List<String> toRemove = new ArrayList<>();
        for (Map.Entry<String, VesselTrack> entry : vesselTracksState.entries()) {
            if (now - entry.getValue().lastUpdateMs > TRACK_EXPIRATION_MS) {
                toRemove.add(entry.getKey());
            }
        }
        for (String mmsi : toRemove) {
            vesselTracksState.remove(mmsi);
        }
    }
}
