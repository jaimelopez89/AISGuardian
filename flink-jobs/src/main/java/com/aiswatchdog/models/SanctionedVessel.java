package com.aiswatchdog.models;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.io.Serializable;
import java.util.List;

/**
 * Represents a sanctioned vessel from the shadow fleet database.
 */
public class SanctionedVessel implements Serializable {
    private static final long serialVersionUID = 1L;

    @JsonProperty("record_type")
    private String recordType;

    @JsonProperty("imo_number")
    private String imoNumber;

    @JsonProperty("mmsi")
    private String mmsi;

    @JsonProperty("vessel_name")
    private String vesselName;

    @JsonProperty("vessel_type")
    private String vesselType;

    @JsonProperty("sanctions_authorities")
    private List<String> sanctionsAuthorities;

    @JsonProperty("risk_level")
    private String riskLevel;

    private String notes;
    private String source;

    @JsonProperty("loaded_at")
    private String loadedAt;

    // For high-risk flags
    @JsonProperty("mid_code")
    private String midCode;

    @JsonProperty("country_code")
    private String countryCode;

    @JsonProperty("country_name")
    private String countryName;

    private String reason;

    public SanctionedVessel() {}

    // Getters and Setters
    public String getRecordType() { return recordType; }
    public void setRecordType(String recordType) { this.recordType = recordType; }

    public String getImoNumber() { return imoNumber; }
    public void setImoNumber(String imoNumber) { this.imoNumber = imoNumber; }

    public String getMmsi() { return mmsi; }
    public void setMmsi(String mmsi) { this.mmsi = mmsi; }

    public String getVesselName() { return vesselName; }
    public void setVesselName(String vesselName) { this.vesselName = vesselName; }

    public String getVesselType() { return vesselType; }
    public void setVesselType(String vesselType) { this.vesselType = vesselType; }

    public List<String> getSanctionsAuthorities() { return sanctionsAuthorities; }
    public void setSanctionsAuthorities(List<String> sanctionsAuthorities) { this.sanctionsAuthorities = sanctionsAuthorities; }

    public String getRiskLevel() { return riskLevel; }
    public void setRiskLevel(String riskLevel) { this.riskLevel = riskLevel; }

    public String getNotes() { return notes; }
    public void setNotes(String notes) { this.notes = notes; }

    public String getSource() { return source; }
    public void setSource(String source) { this.source = source; }

    public String getLoadedAt() { return loadedAt; }
    public void setLoadedAt(String loadedAt) { this.loadedAt = loadedAt; }

    public String getMidCode() { return midCode; }
    public void setMidCode(String midCode) { this.midCode = midCode; }

    public String getCountryCode() { return countryCode; }
    public void setCountryCode(String countryCode) { this.countryCode = countryCode; }

    public String getCountryName() { return countryName; }
    public void setCountryName(String countryName) { this.countryName = countryName; }

    public String getReason() { return reason; }
    public void setReason(String reason) { this.reason = reason; }

    public boolean isSanctionedVessel() {
        return "SANCTIONED_VESSEL".equals(recordType);
    }

    public boolean isHighRiskFlag() {
        return "HIGH_RISK_FLAG".equals(recordType);
    }

    @Override
    public String toString() {
        if (isSanctionedVessel()) {
            return String.format("SanctionedVessel[IMO=%s, name=%s, risk=%s]",
                    imoNumber, vesselName, riskLevel);
        } else {
            return String.format("HighRiskFlag[MID=%s, country=%s, risk=%s]",
                    midCode, countryCode, riskLevel);
        }
    }
}
