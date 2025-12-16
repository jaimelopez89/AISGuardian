package com.aiswatchdog;

import com.aiswatchdog.detectors.CableProximityDetector;
import com.aiswatchdog.detectors.DarkEventDetector;
import com.aiswatchdog.detectors.FishingPatternDetector;
import com.aiswatchdog.detectors.GeofenceViolationDetector;
import com.aiswatchdog.detectors.RendezvousDetector;
import com.aiswatchdog.models.AISPosition;
import com.aiswatchdog.models.Alert;
import com.aiswatchdog.models.Geofence;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.apache.flink.api.common.eventtime.WatermarkStrategy;
import org.apache.flink.api.common.serialization.SimpleStringSchema;
import org.apache.flink.connector.kafka.sink.KafkaRecordSerializationSchema;
import org.apache.flink.connector.kafka.sink.KafkaSink;
import org.apache.flink.connector.kafka.source.KafkaSource;
import org.apache.flink.connector.kafka.source.enumerator.initializer.OffsetsInitializer;
import org.apache.flink.streaming.api.datastream.BroadcastStream;
import org.apache.flink.streaming.api.datastream.DataStream;
import org.apache.flink.streaming.api.datastream.KeyedStream;
import org.apache.flink.streaming.api.datastream.SingleOutputStreamOperator;
import org.apache.flink.streaming.api.environment.StreamExecutionEnvironment;
import org.apache.flink.api.common.state.MapStateDescriptor;
import org.apache.flink.api.common.typeinfo.BasicTypeInfo;
import org.apache.flink.api.common.typeinfo.TypeInformation;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.Properties;

/**
 * Main Flink job for AIS Watchdog maritime anomaly detection.
 *
 * This job:
 * 1. Consumes raw AIS positions from Kafka (ais-raw topic)
 * 2. Broadcasts reference data (geofences, sanctions) to all operators
 * 3. Runs multiple detection algorithms in parallel:
 *    - Geofence violations (zone entry)
 *    - Dark events (AIS transmission gaps)
 *    - Rendezvous detection (ship-to-ship meetings)
 *    - Fishing pattern detection (in protected areas)
 * 4. Produces alerts to Kafka (alerts topic)
 *
 * Architecture:
 *                                    ┌──────────────────────┐
 *                                    │  Geofence Detector   │──┐
 *                                    └──────────────────────┘  │
 *   ┌─────────┐    ┌───────────┐     ┌──────────────────────┐  │    ┌────────┐
 *   │ais-raw  │───▶│  Parse &  │────▶│  Dark Event Detector │──┼───▶│ alerts │
 *   │  topic  │    │  Filter   │     └──────────────────────┘  │    │ topic  │
 *   └─────────┘    └───────────┘     ┌──────────────────────┐  │    └────────┘
 *                       │            │ Rendezvous Detector  │──┤
 *                       │            └──────────────────────┘  │
 *   ┌─────────┐         │            ┌──────────────────────┐  │
 *   │reference│─────────┴───────────▶│  Fishing Detector    │──┘
 *   │  data   │    (broadcast)       └──────────────────────┘
 *   └─────────┘
 */
public class AISWatchdogJob {
    private static final Logger LOG = LoggerFactory.getLogger(AISWatchdogJob.class);

    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();

    // Kafka topics
    private static final String AIS_RAW_TOPIC = "ais-raw";
    private static final String REFERENCE_DATA_TOPIC = "reference-data";
    private static final String ALERTS_TOPIC = "alerts";
    private static final String ENRICHED_TOPIC = "ais-enriched";

    // Broadcast state descriptor for geofences
    public static final MapStateDescriptor<String, Geofence> GEOFENCE_STATE_DESCRIPTOR =
            new MapStateDescriptor<>(
                    "geofences",
                    BasicTypeInfo.STRING_TYPE_INFO,
                    TypeInformation.of(Geofence.class)
            );

    public static void main(String[] args) throws Exception {
        // Get configuration from environment or arguments
        String kafkaBootstrapServers = getConfig("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092");
        String kafkaGroupId = getConfig("KAFKA_GROUP_ID", "ais-watchdog-flink");

        // Detection thresholds (configurable via env vars)
        long darkThresholdMinutes = Long.parseLong(getConfig("DARK_THRESHOLD_MINUTES", "120"));
        double rendezvousDistanceMeters = Double.parseDouble(getConfig("RENDEZVOUS_DISTANCE_METERS", "500"));
        long rendezvousDurationMinutes = Long.parseLong(getConfig("RENDEZVOUS_DURATION_MINUTES", "30"));

        LOG.info("Starting AIS Watchdog Flink Job");
        LOG.info("Kafka Bootstrap Servers: {}", kafkaBootstrapServers);
        LOG.info("Dark event threshold: {} minutes", darkThresholdMinutes);
        LOG.info("Rendezvous detection: {}m for {} minutes", rendezvousDistanceMeters, rendezvousDurationMinutes);

        // Set up execution environment
        StreamExecutionEnvironment env = StreamExecutionEnvironment.getExecutionEnvironment();

        // Enable checkpointing for fault tolerance (every 60 seconds)
        env.enableCheckpointing(60000);

        // Set parallelism (adjust based on Kafka partitions)
        env.setParallelism(2);

        // Build Kafka properties
        Properties kafkaProps = buildKafkaProperties(kafkaBootstrapServers);

        // ========== SOURCE: AIS Raw Positions ==========
        KafkaSource<String> aisSource = KafkaSource.<String>builder()
                .setBootstrapServers(kafkaBootstrapServers)
                .setTopics(AIS_RAW_TOPIC)
                .setGroupId(kafkaGroupId)
                .setStartingOffsets(OffsetsInitializer.latest())
                .setValueOnlyDeserializer(new SimpleStringSchema())
                .setProperties(kafkaProps)
                .build();

        DataStream<String> aisRawStream = env.fromSource(
                aisSource,
                WatermarkStrategy.noWatermarks(),
                "AIS Raw Source"
        );

        // Parse AIS positions
        SingleOutputStreamOperator<AISPosition> aisPositions = aisRawStream
                .map(json -> OBJECT_MAPPER.readValue(json, AISPosition.class))
                .name("Parse AIS Positions")
                .filter(pos -> pos.getMmsi() != null && !pos.getMmsi().isEmpty())
                .name("Filter Valid Positions");

        // Key by MMSI for stateful processing
        KeyedStream<AISPosition, String> keyedPositions = aisPositions
                .keyBy(AISPosition::getMmsi);

        // ========== SOURCE: Reference Data (Geofences) ==========
        KafkaSource<String> referenceSource = KafkaSource.<String>builder()
                .setBootstrapServers(kafkaBootstrapServers)
                .setTopics(REFERENCE_DATA_TOPIC)
                .setGroupId(kafkaGroupId + "-reference")
                .setStartingOffsets(OffsetsInitializer.earliest())
                .setValueOnlyDeserializer(new SimpleStringSchema())
                .setProperties(kafkaProps)
                .build();

        DataStream<String> referenceStream = env.fromSource(
                referenceSource,
                WatermarkStrategy.noWatermarks(),
                "Reference Data Source"
        );

        // Parse and filter geofence records
        DataStream<Geofence> geofenceStream = referenceStream
                .filter(json -> {
                    try {
                        JsonNode node = OBJECT_MAPPER.readTree(json);
                        return "geofence".equals(node.path("record_type").asText());
                    } catch (Exception e) {
                        return false;
                    }
                })
                .map(json -> {
                    JsonNode node = OBJECT_MAPPER.readTree(json);
                    JsonNode data = node.path("data");
                    return OBJECT_MAPPER.treeToValue(data, Geofence.class);
                })
                .name("Parse Geofences");

        // Broadcast geofences to all parallel instances
        BroadcastStream<Geofence> broadcastGeofences = geofenceStream
                .broadcast(GEOFENCE_STATE_DESCRIPTOR);

        // ========== DETECTOR 1: Geofence Violations ==========
        SingleOutputStreamOperator<Alert> geofenceAlerts = aisPositions
                .connect(broadcastGeofences)
                .process(new GeofenceViolationDetector())
                .name("Geofence Violation Detector");

        // ========== DETECTOR 2: Dark Events (Going Dark) ==========
        SingleOutputStreamOperator<Alert> darkAlerts = keyedPositions
                .process(new DarkEventDetector(darkThresholdMinutes, 60000))
                .name("Dark Event Detector");

        // ========== DETECTOR 3: Rendezvous Detection ==========
        // For rendezvous, we need to compare positions across vessels
        // Use a grid-based approach with keyed state
        SingleOutputStreamOperator<Alert> rendezvousAlerts = aisPositions
                .keyBy(pos -> getGridCell(pos.getLatitude(), pos.getLongitude()))
                .connect(aisPositions.keyBy(pos -> getGridCell(pos.getLatitude(), pos.getLongitude())))
                .process(new RendezvousDetector(
                        rendezvousDistanceMeters,
                        rendezvousDurationMinutes,
                        50  // min port distance NM
                ))
                .name("Rendezvous Detector");

        // ========== DETECTOR 4: Fishing Pattern Detection ==========
        SingleOutputStreamOperator<Alert> fishingAlerts = keyedPositions
                .connect(broadcastGeofences)
                .process(new FishingPatternDetector())
                .name("Fishing Pattern Detector");

        // ========== DETECTOR 5: Cable Proximity Detection (Baltic Sea) ==========
        // Monitors vessels near undersea cables and pipelines
        // Alerts on suspicious behavior (slow speed, anchoring) near critical infrastructure
        SingleOutputStreamOperator<Alert> cableAlerts = aisPositions
                .connect(broadcastGeofences)
                .process(new CableProximityDetector())
                .name("Cable Proximity Detector");

        // ========== UNION ALL ALERTS ==========
        DataStream<Alert> allAlerts = geofenceAlerts
                .union(darkAlerts)
                .union(rendezvousAlerts)
                .union(fishingAlerts)
                .union(cableAlerts);

        // ========== SINK: Alerts to Kafka ==========
        KafkaSink<String> alertsSink = KafkaSink.<String>builder()
                .setBootstrapServers(kafkaBootstrapServers)
                .setRecordSerializer(KafkaRecordSerializationSchema.builder()
                        .setTopic(ALERTS_TOPIC)
                        .setValueSerializationSchema(new SimpleStringSchema())
                        .build())
                .setKafkaProducerConfig(kafkaProps)
                .build();

        // Serialize alerts to JSON and send to Kafka
        allAlerts
                .map(alert -> OBJECT_MAPPER.writeValueAsString(alert))
                .name("Serialize Alerts")
                .sinkTo(alertsSink)
                .name("Alerts Kafka Sink");

        // ========== SINK: Enriched Positions (for frontend) ==========
        KafkaSink<String> enrichedSink = KafkaSink.<String>builder()
                .setBootstrapServers(kafkaBootstrapServers)
                .setRecordSerializer(KafkaRecordSerializationSchema.builder()
                        .setTopic(ENRICHED_TOPIC)
                        .setValueSerializationSchema(new SimpleStringSchema())
                        .build())
                .setKafkaProducerConfig(kafkaProps)
                .build();

        aisPositions
                .map(pos -> OBJECT_MAPPER.writeValueAsString(pos))
                .name("Serialize Enriched Positions")
                .sinkTo(enrichedSink)
                .name("Enriched Kafka Sink");

        // Log alerts to console for debugging
        allAlerts.print("ALERT");

        // Execute the job
        env.execute("AIS Watchdog - Maritime Anomaly Detection");
    }

    /**
     * Get grid cell for spatial partitioning in rendezvous detection.
     * Grid cells are ~10km at equator.
     */
    private static String getGridCell(double lat, double lon) {
        int latCell = (int) Math.floor(lat / 0.1);
        int lonCell = (int) Math.floor(lon / 0.1);
        return latCell + ":" + lonCell;
    }

    /**
     * Build Kafka properties with SSL support for Aiven.
     * Uses Java KeyStores (JKS/PKCS12) converted from PEM certificates.
     */
    private static Properties buildKafkaProperties(String bootstrapServers) {
        Properties props = new Properties();

        // Check for SSL configuration (Aiven) - using Java KeyStores
        String truststoreLocation = System.getenv("KAFKA_SSL_TRUSTSTORE_LOCATION");
        String truststorePassword = System.getenv("KAFKA_SSL_TRUSTSTORE_PASSWORD");
        String keystoreLocation = System.getenv("KAFKA_SSL_KEYSTORE_LOCATION");
        String keystorePassword = System.getenv("KAFKA_SSL_KEYSTORE_PASSWORD");

        if (truststoreLocation != null && keystoreLocation != null) {
            LOG.info("Configuring SSL for Kafka connection (Aiven)");
            LOG.info("Truststore: {}", truststoreLocation);
            LOG.info("Keystore: {}", keystoreLocation);

            props.setProperty("security.protocol", "SSL");

            // Truststore (CA certificate)
            props.setProperty("ssl.truststore.location", truststoreLocation);
            props.setProperty("ssl.truststore.password", truststorePassword != null ? truststorePassword : "changeit");
            props.setProperty("ssl.truststore.type", "JKS");

            // Keystore (client certificate + key)
            props.setProperty("ssl.keystore.location", keystoreLocation);
            props.setProperty("ssl.keystore.password", keystorePassword != null ? keystorePassword : "changeit");
            props.setProperty("ssl.keystore.type", "PKCS12");

            // Key password (same as keystore password for PKCS12)
            props.setProperty("ssl.key.password", keystorePassword != null ? keystorePassword : "changeit");
        }

        return props;
    }

    /**
     * Get configuration from environment variable or use default.
     */
    private static String getConfig(String envVar, String defaultValue) {
        String value = System.getenv(envVar);
        return value != null ? value : defaultValue;
    }
}
