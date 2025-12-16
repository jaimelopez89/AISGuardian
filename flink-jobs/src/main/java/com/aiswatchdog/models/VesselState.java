package com.aiswatchdog.models;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.io.Serializable;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;

/**
 * Tracks the state of a vessel over time for stateful detection.
 * Used for "going dark" detection, pattern analysis, etc.
 */
public class VesselState implements Serializable {
    private static final long serialVersionUID = 1L;

    private String mmsi;

    @JsonProperty("ship_name")
    private String shipName;

    @JsonProperty("imo_number")
    private String imoNumber;

    @JsonProperty("ship_type")
    private Integer shipType;

    @JsonProperty("flag_state")
    private String flagState;

    // Last known position
    @JsonProperty("last_latitude")
    private double lastLatitude;

    @JsonProperty("last_longitude")
    private double lastLongitude;

    @JsonProperty("last_speed")
    private Double lastSpeed;

    @JsonProperty("last_course")
    private Double lastCourse;

    // Timing for gap detection
    @JsonProperty("last_seen")
    private String lastSeen;

    @JsonProperty("first_seen")
    private String firstSeen;

    @JsonProperty("message_count")
    private long messageCount;

    // Average transmission interval (for detecting abnormal gaps)
    @JsonProperty("avg_interval_seconds")
    private double avgIntervalSeconds;

    // Recent positions for pattern detection (circular buffer)
    @JsonProperty("recent_positions")
    private List<PositionPoint> recentPositions;

    private static final int MAX_RECENT_POSITIONS = 20;

    // Flags
    @JsonProperty("is_sanctioned")
    private boolean isSanctioned;

    @JsonProperty("sanction_info")
    private String sanctionInfo;

    @JsonProperty("in_sensitive_zone")
    private boolean inSensitiveZone;

    @JsonProperty("current_zone")
    private String currentZone;

    /**
     * Compact position for history tracking.
     */
    public static class PositionPoint implements Serializable {
        private static final long serialVersionUID = 1L;

        public double lat;
        public double lon;
        public Double speed;
        public Double course;
        public String timestamp;

        public PositionPoint() {}

        public PositionPoint(double lat, double lon, Double speed, Double course, String timestamp) {
            this.lat = lat;
            this.lon = lon;
            this.speed = speed;
            this.course = course;
            this.timestamp = timestamp;
        }
    }

    // Default constructor
    public VesselState() {
        this.recentPositions = new ArrayList<>();
        this.messageCount = 0;
        this.avgIntervalSeconds = 0;
    }

    // Constructor from first position
    public VesselState(AISPosition position) {
        this();
        this.mmsi = position.getMmsi();
        this.shipName = position.getShipName();
        this.imoNumber = position.getImoNumber();
        this.shipType = position.getShipType();
        this.lastLatitude = position.getLatitude();
        this.lastLongitude = position.getLongitude();
        this.lastSpeed = position.getSpeedOverGround();
        this.lastCourse = position.getCourseOverGround();
        this.lastSeen = position.getTimestamp();
        this.firstSeen = position.getTimestamp();
        this.messageCount = 1;

        addPosition(position);
    }

    /**
     * Update state with new position.
     */
    public void update(AISPosition position) {
        // Update timing stats
        if (lastSeen != null && position.getTimestamp() != null) {
            try {
                Instant lastTime = Instant.parse(lastSeen);
                Instant newTime = Instant.parse(position.getTimestamp());
                long intervalSeconds = ChronoUnit.SECONDS.between(lastTime, newTime);

                if (intervalSeconds > 0) {
                    // Update rolling average
                    avgIntervalSeconds = (avgIntervalSeconds * messageCount + intervalSeconds) / (messageCount + 1);
                }
            } catch (Exception e) {
                // Ignore parse errors
            }
        }

        // Update static info if available
        if (position.getShipName() != null) {
            this.shipName = position.getShipName();
        }
        if (position.getImoNumber() != null) {
            this.imoNumber = position.getImoNumber();
        }
        if (position.getShipType() != null) {
            this.shipType = position.getShipType();
        }

        // Update position
        this.lastLatitude = position.getLatitude();
        this.lastLongitude = position.getLongitude();
        this.lastSpeed = position.getSpeedOverGround();
        this.lastCourse = position.getCourseOverGround();
        this.lastSeen = position.getTimestamp();
        this.messageCount++;

        addPosition(position);
    }

    private void addPosition(AISPosition position) {
        PositionPoint point = new PositionPoint(
                position.getLatitude(),
                position.getLongitude(),
                position.getSpeedOverGround(),
                position.getCourseOverGround(),
                position.getTimestamp()
        );

        recentPositions.add(point);

        // Keep only recent positions
        while (recentPositions.size() > MAX_RECENT_POSITIONS) {
            recentPositions.remove(0);
        }
    }

    /**
     * Calculate minutes since last transmission.
     */
    public long getMinutesSinceLastSeen() {
        if (lastSeen == null) return 0;
        try {
            Instant lastTime = Instant.parse(lastSeen);
            return ChronoUnit.MINUTES.between(lastTime, Instant.now());
        } catch (Exception e) {
            return 0;
        }
    }

    /**
     * Check if vessel is potentially "going dark" (gap significantly exceeds average).
     */
    public boolean isPotentiallyDark(long thresholdMinutes) {
        long gap = getMinutesSinceLastSeen();

        // Must exceed absolute threshold
        if (gap < thresholdMinutes) {
            return false;
        }

        // If we have enough history, check against average
        if (messageCount > 10 && avgIntervalSeconds > 0) {
            long expectedIntervalMinutes = (long) (avgIntervalSeconds / 60);
            // Gap should be significantly larger than average (e.g., 10x)
            return gap > expectedIntervalMinutes * 10;
        }

        return true;
    }

    /**
     * Check if vessel appears to be moving (not at anchor/moored).
     */
    public boolean isMoving() {
        return lastSpeed != null && lastSpeed > 0.5;
    }

    /**
     * Analyze recent positions for fishing pattern.
     * Fishing vessels typically: slow speed, frequent course changes, staying in small area.
     */
    public boolean exhibitsFishingPattern() {
        if (recentPositions.size() < 10) {
            return false;
        }

        int courseChanges = 0;
        double totalSpeed = 0;
        int speedCount = 0;
        Double lastCourseVal = null;

        for (PositionPoint p : recentPositions) {
            if (p.speed != null) {
                totalSpeed += p.speed;
                speedCount++;
            }
            if (p.course != null && lastCourseVal != null) {
                double change = Math.abs(p.course - lastCourseVal);
                if (change > 180) change = 360 - change;
                if (change > 30) courseChanges++;
            }
            lastCourseVal = p.course;
        }

        double avgSpeed = speedCount > 0 ? totalSpeed / speedCount : 0;

        // Fishing pattern: slow speed + frequent course changes
        return avgSpeed < 5.0 && courseChanges >= 5;
    }

    // Getters and Setters
    public String getMmsi() {
        return mmsi;
    }

    public void setMmsi(String mmsi) {
        this.mmsi = mmsi;
    }

    public String getShipName() {
        return shipName;
    }

    public void setShipName(String shipName) {
        this.shipName = shipName;
    }

    public String getImoNumber() {
        return imoNumber;
    }

    public void setImoNumber(String imoNumber) {
        this.imoNumber = imoNumber;
    }

    public Integer getShipType() {
        return shipType;
    }

    public void setShipType(Integer shipType) {
        this.shipType = shipType;
    }

    public String getFlagState() {
        return flagState;
    }

    public void setFlagState(String flagState) {
        this.flagState = flagState;
    }

    public double getLastLatitude() {
        return lastLatitude;
    }

    public void setLastLatitude(double lastLatitude) {
        this.lastLatitude = lastLatitude;
    }

    public double getLastLongitude() {
        return lastLongitude;
    }

    public void setLastLongitude(double lastLongitude) {
        this.lastLongitude = lastLongitude;
    }

    public Double getLastSpeed() {
        return lastSpeed;
    }

    public void setLastSpeed(Double lastSpeed) {
        this.lastSpeed = lastSpeed;
    }

    public Double getLastCourse() {
        return lastCourse;
    }

    public void setLastCourse(Double lastCourse) {
        this.lastCourse = lastCourse;
    }

    public String getLastSeen() {
        return lastSeen;
    }

    public void setLastSeen(String lastSeen) {
        this.lastSeen = lastSeen;
    }

    public String getFirstSeen() {
        return firstSeen;
    }

    public void setFirstSeen(String firstSeen) {
        this.firstSeen = firstSeen;
    }

    public long getMessageCount() {
        return messageCount;
    }

    public void setMessageCount(long messageCount) {
        this.messageCount = messageCount;
    }

    public double getAvgIntervalSeconds() {
        return avgIntervalSeconds;
    }

    public void setAvgIntervalSeconds(double avgIntervalSeconds) {
        this.avgIntervalSeconds = avgIntervalSeconds;
    }

    public List<PositionPoint> getRecentPositions() {
        return recentPositions;
    }

    public void setRecentPositions(List<PositionPoint> recentPositions) {
        this.recentPositions = recentPositions;
    }

    public boolean isSanctioned() {
        return isSanctioned;
    }

    public void setSanctioned(boolean sanctioned) {
        isSanctioned = sanctioned;
    }

    public String getSanctionInfo() {
        return sanctionInfo;
    }

    public void setSanctionInfo(String sanctionInfo) {
        this.sanctionInfo = sanctionInfo;
    }

    public boolean isInSensitiveZone() {
        return inSensitiveZone;
    }

    public void setInSensitiveZone(boolean inSensitiveZone) {
        this.inSensitiveZone = inSensitiveZone;
    }

    public String getCurrentZone() {
        return currentZone;
    }

    public void setCurrentZone(String currentZone) {
        this.currentZone = currentZone;
    }

    @Override
    public String toString() {
        return "VesselState{" +
                "mmsi='" + mmsi + '\'' +
                ", shipName='" + shipName + '\'' +
                ", lastSeen='" + lastSeen + '\'' +
                ", messageCount=" + messageCount +
                ", lastPos=(" + lastLatitude + ", " + lastLongitude + ")" +
                '}';
    }
}
