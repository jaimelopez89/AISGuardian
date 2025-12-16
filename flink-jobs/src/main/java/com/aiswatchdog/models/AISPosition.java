package com.aiswatchdog.models;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.io.Serializable;
import java.time.Instant;
import java.util.Objects;

/**
 * Represents a normalized AIS position message.
 * Matches the JSON structure produced by ais_connector.py.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public class AISPosition implements Serializable {
    private static final long serialVersionUID = 1L;

    private String mmsi;
    private String timestamp;
    private double latitude;
    private double longitude;

    @JsonProperty("course_over_ground")
    private Double courseOverGround;

    @JsonProperty("speed_over_ground")
    private Double speedOverGround;

    private Double heading;

    @JsonProperty("nav_status")
    private Integer navStatus;

    @JsonProperty("ship_name")
    private String shipName;

    @JsonProperty("ship_type")
    private Integer shipType;

    @JsonProperty("imo_number")
    private String imoNumber;

    @JsonProperty("call_sign")
    private String callSign;

    private String destination;
    private String eta;
    private Double draught;

    @JsonProperty("dimension_a")
    private Integer dimensionA;

    @JsonProperty("dimension_b")
    private Integer dimensionB;

    @JsonProperty("dimension_c")
    private Integer dimensionC;

    @JsonProperty("dimension_d")
    private Integer dimensionD;

    @JsonProperty("message_type")
    private int messageType;

    // Default constructor for Jackson
    public AISPosition() {}

    // Getters and Setters
    public String getMmsi() {
        return mmsi;
    }

    public void setMmsi(String mmsi) {
        this.mmsi = mmsi;
    }

    public String getTimestamp() {
        return timestamp;
    }

    public void setTimestamp(String timestamp) {
        this.timestamp = timestamp;
    }

    @JsonIgnore
    public Instant getTimestampAsInstant() {
        if (timestamp == null) return null;
        try {
            return Instant.parse(timestamp);
        } catch (Exception e) {
            return Instant.now();
        }
    }

    public double getLatitude() {
        return latitude;
    }

    public void setLatitude(double latitude) {
        this.latitude = latitude;
    }

    public double getLongitude() {
        return longitude;
    }

    public void setLongitude(double longitude) {
        this.longitude = longitude;
    }

    public Double getCourseOverGround() {
        return courseOverGround;
    }

    public void setCourseOverGround(Double courseOverGround) {
        this.courseOverGround = courseOverGround;
    }

    public Double getSpeedOverGround() {
        return speedOverGround;
    }

    public void setSpeedOverGround(Double speedOverGround) {
        this.speedOverGround = speedOverGround;
    }

    public Double getHeading() {
        return heading;
    }

    public void setHeading(Double heading) {
        this.heading = heading;
    }

    public Integer getNavStatus() {
        return navStatus;
    }

    public void setNavStatus(Integer navStatus) {
        this.navStatus = navStatus;
    }

    public String getShipName() {
        return shipName;
    }

    public void setShipName(String shipName) {
        this.shipName = shipName;
    }

    public Integer getShipType() {
        return shipType;
    }

    public void setShipType(Integer shipType) {
        this.shipType = shipType;
    }

    public String getImoNumber() {
        return imoNumber;
    }

    public void setImoNumber(String imoNumber) {
        this.imoNumber = imoNumber;
    }

    public String getCallSign() {
        return callSign;
    }

    public void setCallSign(String callSign) {
        this.callSign = callSign;
    }

    public String getDestination() {
        return destination;
    }

    public void setDestination(String destination) {
        this.destination = destination;
    }

    public String getEta() {
        return eta;
    }

    public void setEta(String eta) {
        this.eta = eta;
    }

    public Double getDraught() {
        return draught;
    }

    public void setDraught(Double draught) {
        this.draught = draught;
    }

    public Integer getDimensionA() {
        return dimensionA;
    }

    public void setDimensionA(Integer dimensionA) {
        this.dimensionA = dimensionA;
    }

    public Integer getDimensionB() {
        return dimensionB;
    }

    public void setDimensionB(Integer dimensionB) {
        this.dimensionB = dimensionB;
    }

    public Integer getDimensionC() {
        return dimensionC;
    }

    public void setDimensionC(Integer dimensionC) {
        this.dimensionC = dimensionC;
    }

    public Integer getDimensionD() {
        return dimensionD;
    }

    public void setDimensionD(Integer dimensionD) {
        this.dimensionD = dimensionD;
    }

    public int getMessageType() {
        return messageType;
    }

    public void setMessageType(int messageType) {
        this.messageType = messageType;
    }

    /**
     * Calculate vessel length from dimensions.
     */
    public Integer getVesselLength() {
        if (dimensionA != null && dimensionB != null) {
            return dimensionA + dimensionB;
        }
        return null;
    }

    /**
     * Calculate vessel width from dimensions.
     */
    public Integer getVesselWidth() {
        if (dimensionC != null && dimensionD != null) {
            return dimensionC + dimensionD;
        }
        return null;
    }

    /**
     * Check if this is a fishing vessel based on ship type.
     * Ship types 30-37 are fishing vessels.
     */
    public boolean isFishingVessel() {
        return shipType != null && shipType >= 30 && shipType <= 37;
    }

    /**
     * Check if this is a tanker based on ship type.
     * Ship types 80-89 are tankers.
     */
    public boolean isTanker() {
        return shipType != null && shipType >= 80 && shipType <= 89;
    }

    /**
     * Check if this is a cargo vessel based on ship type.
     * Ship types 70-79 are cargo.
     */
    public boolean isCargoVessel() {
        return shipType != null && shipType >= 70 && shipType <= 79;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        AISPosition that = (AISPosition) o;
        return Objects.equals(mmsi, that.mmsi) && Objects.equals(timestamp, that.timestamp);
    }

    @Override
    public int hashCode() {
        return Objects.hash(mmsi, timestamp);
    }

    @Override
    public String toString() {
        return "AISPosition{" +
                "mmsi='" + mmsi + '\'' +
                ", timestamp='" + timestamp + '\'' +
                ", lat=" + latitude +
                ", lon=" + longitude +
                ", sog=" + speedOverGround +
                ", cog=" + courseOverGround +
                ", shipName='" + shipName + '\'' +
                '}';
    }
}
