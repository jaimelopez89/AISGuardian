package com.aiswatchdog.utils;

import com.aiswatchdog.models.AISPosition;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.DisplayName;
import org.locationtech.jts.geom.Geometry;
import org.locationtech.jts.geom.Point;

import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Tests for GeoUtils geographic calculations.
 */
class GeoUtilsTest {

    private static final double DELTA = 0.01; // Tolerance for floating point comparisons

    @Test
    @DisplayName("Should create point from coordinates")
    void testCreatePoint() {
        Point point = GeoUtils.createPoint(38.5, 15.2);

        assertNotNull(point);
        assertEquals(15.2, point.getX(), DELTA); // X is longitude
        assertEquals(38.5, point.getY(), DELTA); // Y is latitude
    }

    @Test
    @DisplayName("Should create point from AISPosition")
    void testCreatePointFromPosition() {
        AISPosition position = new AISPosition();
        position.setLatitude(38.5);
        position.setLongitude(15.2);

        Point point = GeoUtils.createPoint(position);

        assertNotNull(point);
        assertEquals(15.2, point.getX(), DELTA);
        assertEquals(38.5, point.getY(), DELTA);
    }

    @Test
    @DisplayName("Should calculate distance in nautical miles")
    void testDistanceNauticalMiles() {
        // Genoa to Marseille (approximately 180 NM)
        double distance = GeoUtils.distanceNauticalMiles(
            44.4072, 8.9342,  // Genoa
            43.2965, 5.3698   // Marseille
        );

        // Should be approximately 150-200 NM
        assertTrue(distance > 100 && distance < 250,
            "Distance should be approximately 180 NM, got: " + distance);
    }

    @Test
    @DisplayName("Should calculate distance in meters")
    void testDistanceMeters() {
        // Two points 1km apart (approximately)
        double distance = GeoUtils.distanceMeters(
            38.5, 15.2,
            38.509, 15.2  // ~1km north
        );

        // Should be approximately 1000 meters
        assertTrue(distance > 900 && distance < 1100,
            "Distance should be approximately 1000m, got: " + distance);
    }

    @Test
    @DisplayName("Should calculate distance between AISPositions")
    void testDistanceMetersFromPositions() {
        AISPosition pos1 = new AISPosition();
        pos1.setLatitude(38.5);
        pos1.setLongitude(15.2);

        AISPosition pos2 = new AISPosition();
        pos2.setLatitude(38.509);
        pos2.setLongitude(15.2);

        double distance = GeoUtils.distanceMeters(pos1, pos2);
        assertTrue(distance > 900 && distance < 1100);
    }

    @Test
    @DisplayName("Should return zero distance for same point")
    void testZeroDistance() {
        double distance = GeoUtils.distanceMeters(38.5, 15.2, 38.5, 15.2);
        assertEquals(0, distance, DELTA);
    }

    @Test
    @DisplayName("Should calculate bearing correctly")
    void testBearing() {
        // North
        double bearingNorth = GeoUtils.bearing(38.0, 15.0, 39.0, 15.0);
        assertTrue(bearingNorth < 1 || bearingNorth > 359,
            "Bearing north should be ~0°, got: " + bearingNorth);

        // East
        double bearingEast = GeoUtils.bearing(38.0, 15.0, 38.0, 16.0);
        assertTrue(bearingEast > 85 && bearingEast < 95,
            "Bearing east should be ~90°, got: " + bearingEast);

        // South
        double bearingSouth = GeoUtils.bearing(39.0, 15.0, 38.0, 15.0);
        assertTrue(bearingSouth > 175 && bearingSouth < 185,
            "Bearing south should be ~180°, got: " + bearingSouth);

        // West
        double bearingWest = GeoUtils.bearing(38.0, 16.0, 38.0, 15.0);
        assertTrue(bearingWest > 265 && bearingWest < 275,
            "Bearing west should be ~270°, got: " + bearingWest);
    }

    @Test
    @DisplayName("Should detect vessels are close")
    void testAreVesselsClose() {
        AISPosition pos1 = new AISPosition();
        pos1.setLatitude(38.5);
        pos1.setLongitude(15.2);

        AISPosition pos2 = new AISPosition();
        pos2.setLatitude(38.5001);  // ~10 meters away
        pos2.setLongitude(15.2);

        assertTrue(GeoUtils.areVesselsClose(pos1, pos2, 500));  // Within 500m
        assertTrue(GeoUtils.areVesselsClose(pos1, pos2, 50));   // Within 50m

        // Move pos2 further away
        pos2.setLatitude(38.51);  // ~1km away
        assertFalse(GeoUtils.areVesselsClose(pos1, pos2, 500)); // Not within 500m
    }

    @Test
    @DisplayName("Should detect open sea correctly")
    void testIsOpenSea() {
        List<double[]> ports = Arrays.asList(
            new double[]{44.4072, 8.9342},   // Genoa
            new double[]{43.2965, 5.3698}    // Marseille
        );

        // Middle of Mediterranean - should be open sea
        assertTrue(GeoUtils.isOpenSea(38.5, 15.2, ports, 50));

        // Near Genoa - should NOT be open sea
        assertFalse(GeoUtils.isOpenSea(44.4, 8.9, ports, 50));
    }

    @Test
    @DisplayName("Should create bounding box correctly")
    void testCreateBoundingBox() {
        double[] bbox = GeoUtils.createBoundingBox(38.5, 15.2, 10); // 10 NM radius

        assertEquals(4, bbox.length);
        assertTrue(bbox[0] < 38.5); // minLat
        assertTrue(bbox[1] < 15.2); // minLon
        assertTrue(bbox[2] > 38.5); // maxLat
        assertTrue(bbox[3] > 15.2); // maxLon
    }

    @Test
    @DisplayName("Should check point in bounding box")
    void testIsInBoundingBox() {
        double[] bbox = new double[]{38.0, 15.0, 39.0, 16.0};

        assertTrue(GeoUtils.isInBoundingBox(38.5, 15.5, bbox));  // Inside
        assertFalse(GeoUtils.isInBoundingBox(37.5, 15.5, bbox)); // Below
        assertFalse(GeoUtils.isInBoundingBox(38.5, 14.5, bbox)); // Left
        assertFalse(GeoUtils.isInBoundingBox(39.5, 15.5, bbox)); // Above
        assertFalse(GeoUtils.isInBoundingBox(38.5, 16.5, bbox)); // Right
    }

    @Test
    @DisplayName("Should parse GeoJSON geometry")
    void testParseGeoJson() {
        Map<String, Object> geoJson = new HashMap<>();
        geoJson.put("type", "Polygon");
        geoJson.put("coordinates", Arrays.asList(
            Arrays.asList(
                Arrays.asList(15.0, 38.0),
                Arrays.asList(16.0, 38.0),
                Arrays.asList(16.0, 39.0),
                Arrays.asList(15.0, 39.0),
                Arrays.asList(15.0, 38.0)
            )
        ));

        Geometry geometry = GeoUtils.parseGeoJson(geoJson);

        assertNotNull(geometry);
        assertEquals("Polygon", geometry.getGeometryType());
    }

    @Test
    @DisplayName("Should check point in polygon")
    void testIsPointInPolygon() {
        Map<String, Object> geoJson = new HashMap<>();
        geoJson.put("type", "Polygon");
        geoJson.put("coordinates", Arrays.asList(
            Arrays.asList(
                Arrays.asList(15.0, 38.0),
                Arrays.asList(16.0, 38.0),
                Arrays.asList(16.0, 39.0),
                Arrays.asList(15.0, 39.0),
                Arrays.asList(15.0, 38.0)
            )
        ));

        Geometry polygon = GeoUtils.parseGeoJson(geoJson);

        // Point inside
        assertTrue(GeoUtils.isPointInPolygon(38.5, 15.5, polygon));

        // Point outside
        assertFalse(GeoUtils.isPointInPolygon(37.5, 15.5, polygon));
        assertFalse(GeoUtils.isPointInPolygon(38.5, 14.5, polygon));
    }

    @Test
    @DisplayName("Should calculate centroid of positions")
    void testCalculateCentroid() {
        AISPosition pos1 = new AISPosition();
        pos1.setLatitude(38.0);
        pos1.setLongitude(15.0);

        AISPosition pos2 = new AISPosition();
        pos2.setLatitude(39.0);
        pos2.setLongitude(16.0);

        double[] centroid = GeoUtils.calculateCentroid(Arrays.asList(pos1, pos2));

        assertNotNull(centroid);
        assertEquals(38.5, centroid[0], DELTA);
        assertEquals(15.5, centroid[1], DELTA);
    }

    @Test
    @DisplayName("Should return null centroid for empty list")
    void testCalculateCentroidEmpty() {
        double[] centroid = GeoUtils.calculateCentroid(Arrays.asList());
        assertNull(centroid);
    }

    @Test
    @DisplayName("Should calculate area covered")
    void testCalculateAreaCovered() {
        AISPosition pos1 = new AISPosition();
        pos1.setLatitude(38.0);
        pos1.setLongitude(15.0);

        AISPosition pos2 = new AISPosition();
        pos2.setLatitude(39.0);
        pos2.setLongitude(16.0);

        double area = GeoUtils.calculateAreaCovered(Arrays.asList(pos1, pos2));

        // Area should be roughly 60 x 60 = 3600 sq NM at this latitude
        assertTrue(area > 2000 && area < 5000,
            "Area should be approximately 3600 sq NM, got: " + area);
    }
}
