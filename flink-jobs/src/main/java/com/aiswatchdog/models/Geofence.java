package com.aiswatchdog.models;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.io.Serializable;
import java.util.Map;

/**
 * Represents a geographic zone for geofence detection.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public class Geofence implements Serializable {
    private static final long serialVersionUID = 1L;

    @JsonProperty("zone_id")
    private String zoneId;

    @JsonProperty("zone_name")
    private String zoneName;

    @JsonProperty("zone_type")
    private String zoneType;

    private String jurisdiction;
    private Map<String, Object> geometry;
    private Map<String, Object> rules;
    private Map<String, Object> metadata;

    // Default constructor
    public Geofence() {}

    // Getters and Setters
    public String getZoneId() {
        return zoneId;
    }

    public void setZoneId(String zoneId) {
        this.zoneId = zoneId;
    }

    public String getZoneName() {
        return zoneName;
    }

    public void setZoneName(String zoneName) {
        this.zoneName = zoneName;
    }

    public String getZoneType() {
        return zoneType;
    }

    public void setZoneType(String zoneType) {
        this.zoneType = zoneType;
    }

    public String getJurisdiction() {
        return jurisdiction;
    }

    public void setJurisdiction(String jurisdiction) {
        this.jurisdiction = jurisdiction;
    }

    public Map<String, Object> getGeometry() {
        return geometry;
    }

    public void setGeometry(Map<String, Object> geometry) {
        this.geometry = geometry;
    }

    public Map<String, Object> getRules() {
        return rules;
    }

    public void setRules(Map<String, Object> rules) {
        this.rules = rules;
    }

    public Map<String, Object> getMetadata() {
        return metadata;
    }

    public void setMetadata(Map<String, Object> metadata) {
        this.metadata = metadata;
    }

    /**
     * Check if this zone should alert for all vessels.
     */
    public boolean alertsAllVessels() {
        if (rules == null) return false;
        Object val = rules.get("alert_all_vessels");
        return val != null && (Boolean) val;
    }

    /**
     * Check if this zone monitors fishing behavior.
     */
    public boolean alertsOnFishing() {
        if (rules == null) return false;
        Object val = rules.get("alert_on_fishing_behavior");
        return val != null && (Boolean) val;
    }

    /**
     * Get severity level for this zone.
     */
    public String getSeverity() {
        if (rules == null) return "MEDIUM";
        Object val = rules.get("severity");
        return val != null ? val.toString() : "MEDIUM";
    }

    /**
     * Check if zone is sanctioned waters.
     */
    public boolean isSanctionedWaters() {
        return "sanctioned_waters".equals(zoneType);
    }

    /**
     * Check if zone is a Marine Protected Area.
     */
    public boolean isMPA() {
        return "MPA".equals(zoneType);
    }

    @Override
    public String toString() {
        return "Geofence{" +
                "zoneId='" + zoneId + '\'' +
                ", zoneName='" + zoneName + '\'' +
                ", zoneType='" + zoneType + '\'' +
                '}';
    }
}
