package com.aiswatchdog.models;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.DisplayName;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Tests for Alert model.
 */
class AlertTest {

    @Test
    @DisplayName("Should create alert with basic constructor")
    void testBasicConstructor() {
        Alert alert = new Alert(Alert.AlertType.GEOFENCE_VIOLATION, Alert.Severity.HIGH, "123456789");

        assertNotNull(alert.getAlertId());
        assertEquals(Alert.AlertType.GEOFENCE_VIOLATION, alert.getAlertType());
        assertEquals(Alert.Severity.HIGH, alert.getSeverity());
        assertEquals("123456789", alert.getMmsi());
        assertNotNull(alert.getDetectedAt());
        assertNotNull(alert.getDetails());
    }

    @Test
    @DisplayName("Should create geofence violation alert")
    void testGeofenceViolationFactory() {
        AISPosition position = createTestPosition();

        Alert alert = Alert.geofenceViolation(position, "Test MPA", "MPA");

        assertEquals(Alert.AlertType.GEOFENCE_VIOLATION, alert.getAlertType());
        assertEquals(Alert.Severity.HIGH, alert.getSeverity());
        assertEquals("123456789", alert.getMmsi());
        assertEquals("TEST VESSEL", alert.getVesselName());
        assertTrue(alert.getTitle().contains("Test MPA"));
        assertEquals("Test MPA", alert.getDetails().get("zone_name"));
        assertEquals("MPA", alert.getDetails().get("zone_type"));
    }

    @Test
    @DisplayName("Should set CRITICAL severity for sanctioned waters")
    void testGeofenceViolationSanctionedWaters() {
        AISPosition position = createTestPosition();

        Alert alert = Alert.geofenceViolation(position, "Syria EEZ", "sanctioned_waters");

        assertEquals(Alert.Severity.CRITICAL, alert.getSeverity());
    }

    @Test
    @DisplayName("Should set CRITICAL severity for fishing vessel in MPA")
    void testGeofenceViolationFishingInMPA() {
        AISPosition position = createTestPosition();
        position.setShipType(30); // Fishing vessel

        Alert alert = Alert.geofenceViolation(position, "Test MPA", "MPA");

        assertEquals(Alert.Severity.CRITICAL, alert.getSeverity());
    }

    @Test
    @DisplayName("Should create dark event alert with correct severity")
    void testDarkEventFactory() {
        VesselState state = new VesselState();
        state.setMmsi("123456789");
        state.setShipName("TEST VESSEL");
        state.setLastLatitude(38.5);
        state.setLastLongitude(15.2);
        state.setLastSpeed(12.0);
        state.setLastSeen("2024-01-15T10:00:00Z");

        // 3 hour gap - should be LOW
        Alert alertLow = Alert.darkEvent(state, 180);
        assertEquals(Alert.AlertType.DARK_EVENT, alertLow.getAlertType());
        assertEquals(Alert.Severity.LOW, alertLow.getSeverity());

        // 8 hour gap - should be MEDIUM
        Alert alertMedium = Alert.darkEvent(state, 480);
        assertEquals(Alert.Severity.MEDIUM, alertMedium.getSeverity());

        // 25 hour gap - should be HIGH
        Alert alertHigh = Alert.darkEvent(state, 1500);
        assertEquals(Alert.Severity.HIGH, alertHigh.getSeverity());
    }

    @Test
    @DisplayName("Should create rendezvous alert")
    void testRendezvousFactory() {
        AISPosition vessel1 = createTestPosition();
        vessel1.setShipType(70); // Cargo

        AISPosition vessel2 = new AISPosition();
        vessel2.setMmsi("987654321");
        vessel2.setShipName("OTHER VESSEL");
        vessel2.setLatitude(38.51);
        vessel2.setLongitude(15.21);
        vessel2.setShipType(80); // Tanker

        Alert alert = Alert.rendezvous(vessel1, vessel2, 450.0, 45);

        assertEquals(Alert.AlertType.RENDEZVOUS, alert.getAlertType());
        assertEquals(Alert.Severity.HIGH, alert.getSeverity()); // Tanker involved
        assertEquals("987654321", alert.getDetails().get("vessel2_mmsi"));
        assertEquals(450.0, alert.getDetails().get("distance_meters"));
        assertEquals(45L, alert.getDetails().get("duration_minutes"));
    }

    @Test
    @DisplayName("Should create sanctions match alert")
    void testSanctionsMatchFactory() {
        AISPosition position = createTestPosition();

        Alert alert = Alert.sanctionsMatch(position, "OFAC", "North Korean sanctions evasion");

        assertEquals(Alert.AlertType.SANCTIONS_MATCH, alert.getAlertType());
        assertEquals(Alert.Severity.CRITICAL, alert.getSeverity());
        assertEquals("OFAC", alert.getDetails().get("sanction_source"));
        assertTrue(alert.getDescription().contains("OFAC"));
    }

    @Test
    @DisplayName("Should add details correctly")
    void testAddDetails() {
        Alert alert = new Alert();

        alert.addDetail("key1", "value1");
        alert.addDetail("key2", 123);
        alert.addDetail("key3", true);

        assertEquals("value1", alert.getDetails().get("key1"));
        assertEquals(123, alert.getDetails().get("key2"));
        assertEquals(true, alert.getDetails().get("key3"));
    }

    private AISPosition createTestPosition() {
        AISPosition position = new AISPosition();
        position.setMmsi("123456789");
        position.setShipName("TEST VESSEL");
        position.setImoNumber("1234567");
        position.setLatitude(38.5);
        position.setLongitude(15.2);
        position.setSpeedOverGround(12.3);
        position.setCourseOverGround(180.5);
        position.setShipType(70);
        return position;
    }
}
