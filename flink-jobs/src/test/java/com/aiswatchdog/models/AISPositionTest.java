package com.aiswatchdog.models;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.DisplayName;

import java.time.Instant;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Tests for AISPosition model.
 */
class AISPositionTest {

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    @DisplayName("Should create AISPosition with all fields")
    void testCreatePosition() {
        AISPosition position = new AISPosition();
        position.setMmsi("123456789");
        position.setTimestamp("2024-01-15T12:00:00Z");
        position.setLatitude(38.5);
        position.setLongitude(15.2);
        position.setCourseOverGround(180.5);
        position.setSpeedOverGround(12.3);
        position.setHeading(179.0);
        position.setShipName("TEST VESSEL");
        position.setShipType(70);

        assertEquals("123456789", position.getMmsi());
        assertEquals(38.5, position.getLatitude(), 0.001);
        assertEquals(15.2, position.getLongitude(), 0.001);
        assertEquals("TEST VESSEL", position.getShipName());
    }

    @Test
    @DisplayName("Should parse timestamp correctly")
    void testTimestampParsing() {
        AISPosition position = new AISPosition();
        position.setTimestamp("2024-01-15T12:00:00Z");

        Instant instant = position.getTimestampAsInstant();
        assertNotNull(instant);
    }

    @Test
    @DisplayName("Should identify fishing vessel by ship type")
    void testIsFishingVessel() {
        AISPosition position = new AISPosition();

        // Fishing vessel types: 30-37
        position.setShipType(30);
        assertTrue(position.isFishingVessel());

        position.setShipType(35);
        assertTrue(position.isFishingVessel());

        position.setShipType(37);
        assertTrue(position.isFishingVessel());

        // Non-fishing
        position.setShipType(70);
        assertFalse(position.isFishingVessel());

        position.setShipType(null);
        assertFalse(position.isFishingVessel());
    }

    @Test
    @DisplayName("Should identify tanker by ship type")
    void testIsTanker() {
        AISPosition position = new AISPosition();

        // Tanker types: 80-89
        position.setShipType(80);
        assertTrue(position.isTanker());

        position.setShipType(84);
        assertTrue(position.isTanker());

        // Non-tanker
        position.setShipType(70);
        assertFalse(position.isTanker());
    }

    @Test
    @DisplayName("Should identify cargo vessel by ship type")
    void testIsCargoVessel() {
        AISPosition position = new AISPosition();

        // Cargo types: 70-79
        position.setShipType(70);
        assertTrue(position.isCargoVessel());

        position.setShipType(75);
        assertTrue(position.isCargoVessel());

        // Non-cargo
        position.setShipType(80);
        assertFalse(position.isCargoVessel());
    }

    @Test
    @DisplayName("Should calculate vessel length from dimensions")
    void testVesselLength() {
        AISPosition position = new AISPosition();
        position.setDimensionA(100);
        position.setDimensionB(50);

        assertEquals(150, position.getVesselLength());
    }

    @Test
    @DisplayName("Should return null for vessel length when dimensions missing")
    void testVesselLengthMissing() {
        AISPosition position = new AISPosition();
        position.setDimensionA(100);
        // dimensionB is null

        assertNull(position.getVesselLength());
    }

    @Test
    @DisplayName("Should deserialize from JSON")
    void testJsonDeserialization() throws Exception {
        String json = """
            {
                "mmsi": "123456789",
                "timestamp": "2024-01-15T12:00:00Z",
                "latitude": 38.5,
                "longitude": 15.2,
                "course_over_ground": 180.5,
                "speed_over_ground": 12.3,
                "ship_name": "TEST VESSEL",
                "ship_type": 70,
                "message_type": 1
            }
            """;

        AISPosition position = objectMapper.readValue(json, AISPosition.class);

        assertEquals("123456789", position.getMmsi());
        assertEquals(38.5, position.getLatitude(), 0.001);
        assertEquals(180.5, position.getCourseOverGround(), 0.001);
        assertEquals("TEST VESSEL", position.getShipName());
        assertEquals(70, position.getShipType());
    }

    @Test
    @DisplayName("Should handle unknown fields in JSON")
    void testJsonUnknownFields() throws Exception {
        String json = """
            {
                "mmsi": "123456789",
                "latitude": 38.5,
                "longitude": 15.2,
                "unknown_field": "should be ignored",
                "message_type": 1
            }
            """;

        AISPosition position = objectMapper.readValue(json, AISPosition.class);
        assertEquals("123456789", position.getMmsi());
    }

    @Test
    @DisplayName("Should implement equals correctly")
    void testEquals() {
        AISPosition pos1 = new AISPosition();
        pos1.setMmsi("123456789");
        pos1.setTimestamp("2024-01-15T12:00:00Z");

        AISPosition pos2 = new AISPosition();
        pos2.setMmsi("123456789");
        pos2.setTimestamp("2024-01-15T12:00:00Z");

        AISPosition pos3 = new AISPosition();
        pos3.setMmsi("987654321");
        pos3.setTimestamp("2024-01-15T12:00:00Z");

        assertEquals(pos1, pos2);
        assertNotEquals(pos1, pos3);
    }
}
