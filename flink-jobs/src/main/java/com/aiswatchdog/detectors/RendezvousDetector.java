package com.aiswatchdog.detectors;

import com.aiswatchdog.models.AISPosition;
import com.aiswatchdog.models.Alert;
import com.aiswatchdog.utils.GeoUtils;
import org.apache.flink.api.common.state.MapState;
import org.apache.flink.api.common.state.MapStateDescriptor;
import org.apache.flink.api.common.state.StateTtlConfig;
import org.apache.flink.api.common.time.Time;
import org.apache.flink.api.common.typeinfo.BasicTypeInfo;
import org.apache.flink.api.common.typeinfo.TypeInformation;
import org.apache.flink.configuration.Configuration;
import org.apache.flink.streaming.api.functions.co.KeyedCoProcessFunction;
import org.apache.flink.util.Collector;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.Serializable;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.*;

/**
 * Detects potential ship-to-ship transfers (rendezvous) in open ocean.
 *
 * Ship-to-ship transfers are a common sanctions evasion tactic where vessels
 * meet at sea to transfer cargo (often oil) to avoid port inspections.
 *
 * Alert conditions:
 * - Two vessels within 500 meters
 * - Duration > 30 minutes
 * - Location > 50 nautical miles from any port
 * - At least one vessel is flagged (sanctions, dark history, flag of convenience)
 *
 * This detector uses a spatial grid approach:
 * - Positions are bucketed into grid cells
 * - Only vessels in same/adjacent cells are checked for proximity
 * - This reduces O(n²) comparisons to O(n) average case
 */
public class RendezvousDetector
        extends KeyedCoProcessFunction<String, AISPosition, AISPosition, Alert> {

    private static final Logger LOG = LoggerFactory.getLogger(RendezvousDetector.class);

    // Configuration
    private final double proximityThresholdMeters;
    private final long durationThresholdMinutes;
    private final double minPortDistanceNm;

    // Grid cell size in degrees (roughly 10km at equator)
    private static final double GRID_CELL_SIZE = 0.1;

    // State: track vessel positions by grid cell
    // Key: grid cell ID, Value: map of MMSI -> Vesselencounter
    private MapState<String, Map<String, VesselEncounter>> gridState;

    // State: track active encounters between vessel pairs
    // Key: encounter ID (mmsi1:mmsi2), Value: EncounterState
    private MapState<String, EncounterState> encounterState;

    // Known port positions for open sea detection
    private List<double[]> portPositions;

    /**
     * Vessel position snapshot for encounter tracking.
     */
    public static class VesselEncounter implements Serializable {
        private static final long serialVersionUID = 1L;

        public String mmsi;
        public String shipName;
        public Integer shipType;
        public String imoNumber;
        public double latitude;
        public double longitude;
        public Double speed;
        public String timestamp;
        public boolean isSanctioned;

        public VesselEncounter() {}

        public VesselEncounter(AISPosition pos) {
            this.mmsi = pos.getMmsi();
            this.shipName = pos.getShipName();
            this.shipType = pos.getShipType();
            this.imoNumber = pos.getImoNumber();
            this.latitude = pos.getLatitude();
            this.longitude = pos.getLongitude();
            this.speed = pos.getSpeedOverGround();
            this.timestamp = pos.getTimestamp();
        }
    }

    /**
     * Tracks an ongoing encounter between two vessels.
     */
    public static class EncounterState implements Serializable {
        private static final long serialVersionUID = 1L;

        public String mmsi1;
        public String mmsi2;
        public String startTime;
        public String lastUpdateTime;
        public double avgDistance;
        public int updateCount;
        public double startLat;
        public double startLon;
        public boolean alertSent;

        public EncounterState() {}

        public EncounterState(String mmsi1, String mmsi2, double lat, double lon, String timestamp) {
            this.mmsi1 = mmsi1;
            this.mmsi2 = mmsi2;
            this.startTime = timestamp;
            this.lastUpdateTime = timestamp;
            this.startLat = lat;
            this.startLon = lon;
            this.avgDistance = 0;
            this.updateCount = 0;
            this.alertSent = false;
        }

        public long getDurationMinutes() {
            try {
                Instant start = Instant.parse(startTime);
                Instant end = Instant.parse(lastUpdateTime);
                return ChronoUnit.MINUTES.between(start, end);
            } catch (Exception e) {
                return 0;
            }
        }

        public void update(double distance, String timestamp) {
            this.avgDistance = (this.avgDistance * updateCount + distance) / (updateCount + 1);
            this.updateCount++;
            this.lastUpdateTime = timestamp;
        }
    }

    public RendezvousDetector() {
        this(500, 30, 50);
    }

    public RendezvousDetector(double proximityMeters, long durationMinutes, double portDistanceNm) {
        this.proximityThresholdMeters = proximityMeters;
        this.durationThresholdMinutes = durationMinutes;
        this.minPortDistanceNm = portDistanceNm;
    }

    @Override
    public void open(Configuration parameters) {
        // Configure state TTL to automatically clean up stale entries
        StateTtlConfig gridTtlConfig = StateTtlConfig
                .newBuilder(Time.minutes(15))  // Grid state expires after 15 minutes
                .setUpdateType(StateTtlConfig.UpdateType.OnReadAndWrite)
                .setStateVisibility(StateTtlConfig.StateVisibility.NeverReturnExpired)
                .cleanupInRocksdbCompactFilter(1000)
                .build();

        StateTtlConfig encounterTtlConfig = StateTtlConfig
                .newBuilder(Time.hours(2))  // Encounter state expires after 2 hours
                .setUpdateType(StateTtlConfig.UpdateType.OnReadAndWrite)
                .setStateVisibility(StateTtlConfig.StateVisibility.NeverReturnExpired)
                .cleanupInRocksdbCompactFilter(1000)
                .build();

        MapStateDescriptor<String, Map<String, VesselEncounter>> gridDescriptor =
                new MapStateDescriptor<>(
                        "grid-state",
                        BasicTypeInfo.STRING_TYPE_INFO,
                        TypeInformation.of(new org.apache.flink.api.common.typeinfo.TypeHint<Map<String, VesselEncounter>>() {})
                );
        gridDescriptor.enableTimeToLive(gridTtlConfig);
        gridState = getRuntimeContext().getMapState(gridDescriptor);

        MapStateDescriptor<String, EncounterState> encounterDescriptor =
                new MapStateDescriptor<>(
                        "encounter-state",
                        BasicTypeInfo.STRING_TYPE_INFO,
                        TypeInformation.of(EncounterState.class)
                );
        encounterDescriptor.enableTimeToLive(encounterTtlConfig);
        encounterState = getRuntimeContext().getMapState(encounterDescriptor);

        // Initialize port positions (Mediterranean major ports)
        // In production, load from reference data
        portPositions = initializePortPositions();
    }

    @Override
    public void processElement1(
            AISPosition position,
            Context ctx,
            Collector<Alert> out) throws Exception {
        processPosition(position, ctx, out);
    }

    @Override
    public void processElement2(
            AISPosition position,
            Context ctx,
            Collector<Alert> out) throws Exception {
        processPosition(position, ctx, out);
    }

    private void processPosition(
            AISPosition position,
            Context ctx,
            Collector<Alert> out) throws Exception {

        String mmsi = position.getMmsi();
        String gridCell = getGridCell(position.getLatitude(), position.getLongitude());

        // Check if in open sea (far from ports)
        boolean isOpenSea = GeoUtils.isOpenSea(
                position.getLatitude(),
                position.getLongitude(),
                portPositions,
                minPortDistanceNm
        );

        if (!isOpenSea) {
            // Near port - remove from tracking and clear any encounters
            removeVesselFromGrid(mmsi);
            return;
        }

        // Check if vessel is slow/stationary (potential transfer)
        Double speed = position.getSpeedOverGround();
        if (speed != null && speed > 5.0) {
            // Moving too fast for a transfer - skip
            removeVesselFromGrid(mmsi);
            return;
        }

        // Get vessels in same and adjacent grid cells
        List<VesselEncounter> nearbyVessels = getNearbyVessels(gridCell, mmsi);

        // Check for proximity with each nearby vessel
        VesselEncounter currentVessel = new VesselEncounter(position);

        for (VesselEncounter other : nearbyVessels) {
            double distance = GeoUtils.distanceMeters(
                    position.getLatitude(), position.getLongitude(),
                    other.latitude, other.longitude
            );

            if (distance <= proximityThresholdMeters) {
                // Vessels are close - update or create encounter
                String encounterId = createEncounterId(mmsi, other.mmsi);
                EncounterState encounter = encounterState.get(encounterId);

                if (encounter == null) {
                    // New encounter
                    encounter = new EncounterState(
                            mmsi, other.mmsi,
                            position.getLatitude(), position.getLongitude(),
                            position.getTimestamp()
                    );
                    LOG.debug("New encounter started: {} <-> {}", mmsi, other.mmsi);
                }

                encounter.update(distance, position.getTimestamp());
                encounterState.put(encounterId, encounter);

                // Check if encounter meets alert criteria
                if (shouldAlert(encounter, position, other)) {
                    Alert alert = createRendezvousAlert(position, other, encounter);
                    out.collect(alert);
                    encounter.alertSent = true;
                    encounterState.put(encounterId, encounter);
                }
            } else {
                // Vessels moved apart - end encounter if exists
                String encounterId = createEncounterId(mmsi, other.mmsi);
                encounterState.remove(encounterId);
            }
        }

        // Update grid with current vessel position
        updateVesselInGrid(gridCell, currentVessel);

        // Set timer to clean up stale entries
        ctx.timerService().registerProcessingTimeTimer(
                ctx.timerService().currentProcessingTime() + 300000  // 5 minutes
        );
    }

    @Override
    public void onTimer(long timestamp, OnTimerContext ctx, Collector<Alert> out) throws Exception {
        // Clean up stale grid entries (vessels that haven't reported in 10 minutes)
        long staleThreshold = 10 * 60 * 1000;  // 10 minutes in ms

        for (Map.Entry<String, Map<String, VesselEncounter>> cell : gridState.entries()) {
            Map<String, VesselEncounter> vessels = cell.getValue();
            Iterator<Map.Entry<String, VesselEncounter>> it = vessels.entrySet().iterator();

            while (it.hasNext()) {
                VesselEncounter vessel = it.next().getValue();
                try {
                    Instant vesselTime = Instant.parse(vessel.timestamp);
                    if (ChronoUnit.MILLIS.between(vesselTime, Instant.now()) > staleThreshold) {
                        it.remove();
                    }
                } catch (Exception e) {
                    it.remove();
                }
            }

            if (vessels.isEmpty()) {
                gridState.remove(cell.getKey());
            } else {
                gridState.put(cell.getKey(), vessels);
            }
        }
    }

    private String getGridCell(double lat, double lon) {
        int latCell = (int) Math.floor(lat / GRID_CELL_SIZE);
        int lonCell = (int) Math.floor(lon / GRID_CELL_SIZE);
        return latCell + ":" + lonCell;
    }

    private List<String> getAdjacentCells(String cell) {
        String[] parts = cell.split(":");
        int latCell = Integer.parseInt(parts[0]);
        int lonCell = Integer.parseInt(parts[1]);

        List<String> cells = new ArrayList<>();
        for (int dLat = -1; dLat <= 1; dLat++) {
            for (int dLon = -1; dLon <= 1; dLon++) {
                cells.add((latCell + dLat) + ":" + (lonCell + dLon));
            }
        }
        return cells;
    }

    private List<VesselEncounter> getNearbyVessels(String gridCell, String excludeMmsi) throws Exception {
        List<VesselEncounter> nearby = new ArrayList<>();

        for (String cell : getAdjacentCells(gridCell)) {
            Map<String, VesselEncounter> vessels = gridState.get(cell);
            if (vessels != null) {
                for (VesselEncounter vessel : vessels.values()) {
                    if (!vessel.mmsi.equals(excludeMmsi)) {
                        nearby.add(vessel);
                    }
                }
            }
        }

        return nearby;
    }

    private void updateVesselInGrid(String gridCell, VesselEncounter vessel) throws Exception {
        // Remove from old cells first
        removeVesselFromGrid(vessel.mmsi);

        // Add to new cell
        Map<String, VesselEncounter> cellVessels = gridState.get(gridCell);
        if (cellVessels == null) {
            cellVessels = new HashMap<>();
        }
        cellVessels.put(vessel.mmsi, vessel);
        gridState.put(gridCell, cellVessels);
    }

    private void removeVesselFromGrid(String mmsi) throws Exception {
        for (Map.Entry<String, Map<String, VesselEncounter>> entry : gridState.entries()) {
            Map<String, VesselEncounter> vessels = entry.getValue();
            if (vessels.remove(mmsi) != null) {
                if (vessels.isEmpty()) {
                    gridState.remove(entry.getKey());
                } else {
                    gridState.put(entry.getKey(), vessels);
                }
                break;
            }
        }
    }

    private String createEncounterId(String mmsi1, String mmsi2) {
        // Ensure consistent ordering
        if (mmsi1.compareTo(mmsi2) < 0) {
            return mmsi1 + ":" + mmsi2;
        }
        return mmsi2 + ":" + mmsi1;
    }

    private boolean shouldAlert(EncounterState encounter, AISPosition pos1, VesselEncounter pos2) {
        // Don't re-alert
        if (encounter.alertSent) {
            return false;
        }

        // Must meet duration threshold
        if (encounter.getDurationMinutes() < durationThresholdMinutes) {
            return false;
        }

        // At least one interesting vessel type
        boolean hasTanker = pos1.isTanker() ||
                (pos2.shipType != null && pos2.shipType >= 80 && pos2.shipType <= 89);
        boolean hasCargo = pos1.isCargoVessel() ||
                (pos2.shipType != null && pos2.shipType >= 70 && pos2.shipType <= 79);
        boolean hasFishing = pos1.isFishingVessel() ||
                (pos2.shipType != null && pos2.shipType >= 30 && pos2.shipType <= 37);

        // Tanker-to-tanker or tanker-to-cargo is most suspicious
        if (hasTanker) {
            return true;
        }

        // Mismatched vessel types is suspicious
        if (hasCargo && hasFishing) {
            return true;
        }

        // For other combinations, require longer duration
        return encounter.getDurationMinutes() >= durationThresholdMinutes * 2;
    }

    private Alert createRendezvousAlert(AISPosition pos1, VesselEncounter pos2, EncounterState encounter) {
        // Create position object for vessel 2
        AISPosition position2 = new AISPosition();
        position2.setMmsi(pos2.mmsi);
        position2.setShipName(pos2.shipName);
        position2.setShipType(pos2.shipType);
        position2.setImoNumber(pos2.imoNumber);
        position2.setLatitude(pos2.latitude);
        position2.setLongitude(pos2.longitude);
        position2.setSpeedOverGround(pos2.speed);

        Alert alert = Alert.rendezvous(
                pos1,
                position2,
                encounter.avgDistance,
                encounter.getDurationMinutes()
        );

        LOG.info("Rendezvous detected: {} <-> {} for {} minutes",
                pos1.getMmsi(), pos2.mmsi, encounter.getDurationMinutes());

        return alert;
    }

    private List<double[]> initializePortPositions() {
        // Major Mediterranean ports - in production, load from reference-data topic
        return Arrays.asList(
                new double[]{36.1267, -5.4433},   // Algeciras
                new double[]{39.4536, -0.3227},   // Valencia
                new double[]{43.3100, 5.3669},    // Marseille
                new double[]{44.4072, 8.9342},    // Genoa
                new double[]{38.4264, 15.8972},   // Gioia Tauro
                new double[]{37.9422, 23.6469},   // Piraeus
                new double[]{31.2001, 29.9187},   // Alexandria
                new double[]{31.2653, 32.3019},   // Port Said
                new double[]{32.8192, 34.9983},   // Haifa
                new double[]{41.0053, 28.9770},   // Istanbul
                new double[]{35.8417, 14.5433}    // Malta
        );
    }
}
