package com.aiswatchdog.models;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.DisplayName;

import java.time.Instant;
import java.time.temporal.ChronoUnit;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Tests for VesselState model.
 */
class VesselStateTest {

    @Test
    @DisplayName("Should create VesselState from AISPosition")
    void testCreateFromPosition() {
        AISPosition position = createTestPosition();

        VesselState state = new VesselState(position);

        assertEquals("123456789", state.getMmsi());
        assertEquals("TEST VESSEL", state.getShipName());
        assertEquals(38.5, state.getLastLatitude(), 0.001);
        assertEquals(15.2, state.getLastLongitude(), 0.001);
        assertEquals(12.3, state.getLastSpeed(), 0.001);
        assertEquals(1, state.getMessageCount());
    }

    @Test
    @DisplayName("Should update state with new position")
    void testUpdateState() {
        AISPosition pos1 = createTestPosition();
        pos1.setTimestamp(Instant.now().minus(5, ChronoUnit.MINUTES).toString());

        VesselState state = new VesselState(pos1);

        AISPosition pos2 = createTestPosition();
        pos2.setLatitude(38.6);
        pos2.setLongitude(15.3);
        pos2.setSpeedOverGround(15.0);
        pos2.setTimestamp(Instant.now().toString());

        state.update(pos2);

        assertEquals(38.6, state.getLastLatitude(), 0.001);
        assertEquals(15.3, state.getLastLongitude(), 0.001);
        assertEquals(15.0, state.getLastSpeed(), 0.001);
        assertEquals(2, state.getMessageCount());
        assertTrue(state.getAvgIntervalSeconds() > 0);
    }

    @Test
    @DisplayName("Should track recent positions")
    void testRecentPositions() {
        AISPosition pos1 = createTestPosition();
        VesselState state = new VesselState(pos1);

        // Add more positions
        for (int i = 0; i < 25; i++) {
            AISPosition pos = createTestPosition();
            pos.setLatitude(38.5 + i * 0.01);
            state.update(pos);
        }

        // Should keep only MAX_RECENT_POSITIONS (20)
        assertEquals(20, state.getRecentPositions().size());
    }

    @Test
    @DisplayName("Should detect moving vessel")
    void testIsMoving() {
        AISPosition pos = createTestPosition();

        VesselState stateMoving = new VesselState(pos);
        stateMoving.setLastSpeed(5.0);
        assertTrue(stateMoving.isMoving());

        VesselState stateStopped = new VesselState(pos);
        stateStopped.setLastSpeed(0.3);
        assertFalse(stateStopped.isMoving());

        VesselState stateNull = new VesselState(pos);
        stateNull.setLastSpeed(null);
        assertFalse(stateNull.isMoving());
    }

    @Test
    @DisplayName("Should calculate minutes since last seen")
    void testGetMinutesSinceLastSeen() {
        AISPosition pos = createTestPosition();
        pos.setTimestamp(Instant.now().minus(30, ChronoUnit.MINUTES).toString());

        VesselState state = new VesselState(pos);
        long minutes = state.getMinutesSinceLastSeen();

        assertTrue(minutes >= 29 && minutes <= 31,
            "Should be approximately 30 minutes, got: " + minutes);
    }

    @Test
    @DisplayName("Should detect potential dark event")
    void testIsPotentiallyDark() {
        AISPosition pos = createTestPosition();
        pos.setTimestamp(Instant.now().minus(3, ChronoUnit.HOURS).toString());

        VesselState state = new VesselState(pos);
        state.setMessageCount(20);  // Enough history
        state.setAvgIntervalSeconds(180);  // 3 minute average

        // 3 hours gap with 3 minute average = potentially dark
        assertTrue(state.isPotentiallyDark(120));  // 2 hour threshold

        // Not dark if threshold not met
        assertFalse(state.isPotentiallyDark(240));  // 4 hour threshold
    }

    @Test
    @DisplayName("Should detect fishing pattern")
    void testExhibitsFishingPattern() {
        AISPosition pos = createTestPosition();
        VesselState state = new VesselState(pos);

        // Add positions that exhibit fishing pattern
        // (slow speed, frequent course changes)
        for (int i = 0; i < 15; i++) {
            AISPosition fishingPos = createTestPosition();
            fishingPos.setSpeedOverGround(3.0 + Math.random() * 2);  // 3-5 knots
            fishingPos.setCourseOverGround((i * 50) % 360);  // Frequent course changes
            state.update(fishingPos);
        }

        assertTrue(state.exhibitsFishingPattern());
    }

    @Test
    @DisplayName("Should not detect fishing pattern for fast vessel")
    void testNoFishingPatternFast() {
        AISPosition pos = createTestPosition();
        VesselState state = new VesselState(pos);

        // Add positions with high speed (not fishing)
        for (int i = 0; i < 15; i++) {
            AISPosition fastPos = createTestPosition();
            fastPos.setSpeedOverGround(15.0);  // Fast
            fastPos.setCourseOverGround(90.0); // Steady course
            state.update(fastPos);
        }

        assertFalse(state.exhibitsFishingPattern());
    }

    @Test
    @DisplayName("Should not detect fishing pattern with insufficient data")
    void testNoFishingPatternInsufficientData() {
        AISPosition pos = createTestPosition();
        VesselState state = new VesselState(pos);

        // Only 5 positions - not enough for analysis
        for (int i = 0; i < 4; i++) {
            state.update(createTestPosition());
        }

        assertFalse(state.exhibitsFishingPattern());
    }

    @Test
    @DisplayName("Should track sanctions status")
    void testSanctionsStatus() {
        AISPosition pos = createTestPosition();
        VesselState state = new VesselState(pos);

        assertFalse(state.isSanctioned());

        state.setSanctioned(true);
        state.setSanctionInfo("OFAC - North Korean sanctions");

        assertTrue(state.isSanctioned());
        assertEquals("OFAC - North Korean sanctions", state.getSanctionInfo());
    }

    @Test
    @DisplayName("Should track zone status")
    void testZoneStatus() {
        AISPosition pos = createTestPosition();
        VesselState state = new VesselState(pos);

        assertFalse(state.isInSensitiveZone());

        state.setInSensitiveZone(true);
        state.setCurrentZone("MPA-001");

        assertTrue(state.isInSensitiveZone());
        assertEquals("MPA-001", state.getCurrentZone());
    }

    private AISPosition createTestPosition() {
        AISPosition position = new AISPosition();
        position.setMmsi("123456789");
        position.setShipName("TEST VESSEL");
        position.setTimestamp(Instant.now().toString());
        position.setLatitude(38.5);
        position.setLongitude(15.2);
        position.setSpeedOverGround(12.3);
        position.setCourseOverGround(180.5);
        position.setShipType(70);
        return position;
    }
}
