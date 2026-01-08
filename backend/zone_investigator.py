#!/usr/bin/env python3
"""
Zone Investigator - Historical AIS analysis for cable protection zones.

Queries historical AIS data from Kafka to find vessels that crossed
a specified cable protection zone within a given timeframe.

Usage:
    python zone_investigator.py CABLE-LT-LV-FIBER --timeframe 48h
    python zone_investigator.py CABLE-LT-LV-FIBER -o reports/investigation.md
    python zone_investigator.py --list-zones
"""

import argparse
import json
import os
import re
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, Generator, List, Optional, Tuple

from confluent_kafka import Consumer, TopicPartition
from dotenv import load_dotenv
from shapely.geometry import Point, shape
from shapely.prepared import prep

# Load environment variables
env_path = Path(__file__).parent.parent / '.env'
load_dotenv(env_path)

# MMSI prefix to flag state mapping (Maritime Identification Digits)
MMSI_FLAG_MAP = {
    "201": "AL",  # Albania
    "209": "CY",  # Cyprus
    "210": "CY",  # Cyprus
    "211": "DE",  # Germany
    "212": "CY",  # Cyprus
    "218": "DE",  # Germany
    "219": "DK",  # Denmark
    "220": "DK",  # Denmark
    "224": "ES",  # Spain
    "225": "ES",  # Spain
    "226": "FR",  # France
    "227": "FR",  # France
    "228": "FR",  # France
    "229": "MT",  # Malta
    "230": "FI",  # Finland
    "231": "FI",  # Finland
    "232": "GB",  # United Kingdom
    "233": "GB",  # United Kingdom
    "234": "GB",  # United Kingdom
    "235": "GB",  # United Kingdom
    "236": "GI",  # Gibraltar
    "237": "GR",  # Greece
    "238": "HR",  # Croatia
    "239": "GR",  # Greece
    "240": "GR",  # Greece
    "241": "GR",  # Greece
    "242": "MA",  # Morocco
    "243": "HU",  # Hungary
    "244": "NL",  # Netherlands
    "245": "NL",  # Netherlands
    "246": "NL",  # Netherlands
    "247": "IT",  # Italy
    "248": "MT",  # Malta
    "249": "MT",  # Malta
    "250": "IE",  # Ireland
    "255": "PT",  # Portugal/Madeira
    "256": "MT",  # Malta
    "257": "NO",  # Norway
    "258": "NO",  # Norway
    "259": "NO",  # Norway
    "261": "PL",  # Poland
    "262": "ME",  # Montenegro
    "263": "PT",  # Portugal
    "264": "RO",  # Romania
    "265": "SE",  # Sweden
    "266": "SE",  # Sweden
    "267": "SK",  # Slovakia
    "268": "SM",  # San Marino
    "269": "CH",  # Switzerland
    "270": "CZ",  # Czech Republic
    "271": "TR",  # Turkey
    "272": "UA",  # Ukraine
    "273": "RU",  # Russia
    "274": "MK",  # North Macedonia
    "275": "LV",  # Latvia
    "276": "EE",  # Estonia
    "277": "LT",  # Lithuania
    "278": "SI",  # Slovenia
    "279": "RS",  # Serbia
    "303": "US",  # USA
    "304": "AG",  # Antigua and Barbuda
    "305": "AG",  # Antigua and Barbuda
    "306": "CW",  # Curacao
    "307": "CW",  # Curacao
    "308": "BS",  # Bahamas
    "309": "BS",  # Bahamas
    "310": "BM",  # Bermuda
    "311": "BS",  # Bahamas
    "312": "BZ",  # Belize
    "314": "BB",  # Barbados
    "316": "CA",  # Canada
    "319": "KY",  # Cayman Islands
    "321": "CR",  # Costa Rica
    "323": "CU",  # Cuba
    "325": "DM",  # Dominica
    "327": "DO",  # Dominican Republic
    "329": "GP",  # Guadeloupe
    "330": "GD",  # Grenada
    "331": "GL",  # Greenland
    "332": "GT",  # Guatemala
    "334": "HN",  # Honduras
    "336": "HT",  # Haiti
    "338": "US",  # USA
    "339": "JM",  # Jamaica
    "341": "VC",  # St. Vincent and Grenadines
    "343": "LC",  # St. Lucia
    "345": "MX",  # Mexico
    "347": "MQ",  # Martinique
    "348": "MS",  # Montserrat
    "350": "NI",  # Nicaragua
    "351": "PA",  # Panama
    "352": "PA",  # Panama
    "353": "PA",  # Panama
    "354": "PA",  # Panama
    "355": "PA",  # Panama
    "356": "PA",  # Panama
    "357": "PA",  # Panama
    "358": "PR",  # Puerto Rico
    "359": "SV",  # El Salvador
    "361": "PM",  # St Pierre and Miquelon
    "362": "TT",  # Trinidad and Tobago
    "364": "TC",  # Turks and Caicos
    "366": "US",  # USA
    "367": "US",  # USA
    "368": "US",  # USA
    "369": "US",  # USA
    "370": "PA",  # Panama
    "371": "PA",  # Panama
    "372": "PA",  # Panama
    "373": "PA",  # Panama
    "374": "PA",  # Panama
    "375": "VC",  # St. Vincent and Grenadines
    "376": "VC",  # St. Vincent and Grenadines
    "377": "VC",  # St. Vincent and Grenadines
    "378": "VG",  # British Virgin Islands
    "379": "VI",  # US Virgin Islands
    "403": "SA",  # Saudi Arabia
    "412": "CN",  # China
    "413": "CN",  # China
    "414": "CN",  # China
    "416": "TW",  # Taiwan
    "417": "TW",  # Taiwan
    "419": "IN",  # India
    "422": "IR",  # Iran
    "431": "JP",  # Japan
    "432": "JP",  # Japan
    "440": "KR",  # South Korea
    "441": "KR",  # South Korea
    "445": "KP",  # North Korea
    "447": "KW",  # Kuwait
    "450": "LB",  # Lebanon
    "453": "MO",  # Macao
    "455": "MV",  # Maldives
    "457": "MN",  # Mongolia
    "459": "NP",  # Nepal
    "461": "OM",  # Oman
    "463": "PK",  # Pakistan
    "466": "QA",  # Qatar
    "468": "SY",  # Syria
    "470": "AE",  # UAE
    "472": "TJ",  # Tajikistan
    "473": "YE",  # Yemen
    "477": "HK",  # Hong Kong
    "478": "BA",  # Bosnia and Herzegovina
    "501": "AQ",  # Antarctica
    "503": "AU",  # Australia
    "506": "MM",  # Myanmar
    "508": "BN",  # Brunei
    "510": "FM",  # Micronesia
    "511": "PW",  # Palau
    "512": "NZ",  # New Zealand
    "514": "KH",  # Cambodia
    "515": "KH",  # Cambodia
    "516": "CX",  # Christmas Island
    "518": "CK",  # Cook Islands
    "520": "FJ",  # Fiji
    "523": "CC",  # Cocos Islands
    "525": "ID",  # Indonesia
    "529": "KI",  # Kiribati
    "531": "LA",  # Laos
    "533": "MY",  # Malaysia
    "536": "MP",  # Northern Mariana Islands
    "538": "MH",  # Marshall Islands
    "540": "NC",  # New Caledonia
    "542": "NU",  # Niue
    "544": "NR",  # Nauru
    "546": "PF",  # French Polynesia
    "548": "PH",  # Philippines
    "553": "PG",  # Papua New Guinea
    "555": "PN",  # Pitcairn
    "557": "SB",  # Solomon Islands
    "559": "AS",  # American Samoa
    "561": "WS",  # Samoa
    "563": "SG",  # Singapore
    "564": "SG",  # Singapore
    "565": "SG",  # Singapore
    "566": "SG",  # Singapore
    "567": "TH",  # Thailand
    "570": "TO",  # Tonga
    "572": "TV",  # Tuvalu
    "574": "VN",  # Vietnam
    "576": "VU",  # Vanuatu
    "577": "VU",  # Vanuatu
    "578": "WF",  # Wallis and Futuna
    "601": "ZA",  # South Africa
    "603": "AO",  # Angola
    "605": "DZ",  # Algeria
    "607": "TF",  # French Southern Territories
    "608": "IO",  # British Indian Ocean Territory
    "609": "BI",  # Burundi
    "610": "BJ",  # Benin
    "611": "BW",  # Botswana
    "612": "CF",  # Central African Republic
    "613": "CM",  # Cameroon
    "615": "CG",  # Congo
    "616": "KM",  # Comoros
    "617": "CV",  # Cape Verde
    "618": "AQ",  # Crozet Archipelago
    "619": "CI",  # Ivory Coast
    "620": "KM",  # Comoros
    "621": "DJ",  # Djibouti
    "622": "EG",  # Egypt
    "624": "ET",  # Ethiopia
    "625": "ER",  # Eritrea
    "626": "GA",  # Gabon
    "627": "GH",  # Ghana
    "629": "GM",  # Gambia
    "630": "GW",  # Guinea-Bissau
    "631": "GQ",  # Equatorial Guinea
    "632": "GN",  # Guinea
    "633": "BF",  # Burkina Faso
    "634": "KE",  # Kenya
    "635": "AQ",  # Kerguelen Islands
    "636": "LR",  # Liberia
    "637": "LR",  # Liberia
    "638": "SS",  # South Sudan
    "642": "LY",  # Libya
    "644": "LS",  # Lesotho
    "645": "MU",  # Mauritius
    "647": "MG",  # Madagascar
    "649": "ML",  # Mali
    "650": "MZ",  # Mozambique
    "654": "MR",  # Mauritania
    "655": "MW",  # Malawi
    "656": "NE",  # Niger
    "657": "NG",  # Nigeria
    "659": "NA",  # Namibia
    "660": "RE",  # Reunion
    "661": "RW",  # Rwanda
    "662": "SD",  # Sudan
    "663": "SN",  # Senegal
    "664": "SC",  # Seychelles
    "665": "SH",  # St Helena
    "666": "SO",  # Somalia
    "667": "SL",  # Sierra Leone
    "668": "ST",  # Sao Tome and Principe
    "669": "SZ",  # Eswatini
    "670": "TD",  # Chad
    "671": "TG",  # Togo
    "672": "TN",  # Tunisia
    "674": "TZ",  # Tanzania
    "675": "UG",  # Uganda
    "676": "CD",  # DR Congo
    "677": "TZ",  # Tanzania
    "678": "ZM",  # Zambia
    "679": "ZW",  # Zimbabwe
}

# Flags of convenience - often used to obscure vessel ownership
FLAGS_OF_CONVENIENCE = {
    "PA",  # Panama
    "LR",  # Liberia
    "MH",  # Marshall Islands
    "BS",  # Bahamas
    "MT",  # Malta
    "CY",  # Cyprus
    "VC",  # St. Vincent and Grenadines
    "SG",  # Singapore
    "HK",  # Hong Kong
    "BM",  # Bermuda
    "KY",  # Cayman Islands
    "AG",  # Antigua and Barbuda
    "VU",  # Vanuatu
    "BB",  # Barbados
    "SL",  # Sierra Leone
    "CM",  # Cameroon
    "TG",  # Togo
    "TZ",  # Tanzania
    "KH",  # Cambodia
    "MN",  # Mongolia
    "BO",  # Bolivia
}

# High-risk flag states for geopolitical monitoring
HIGH_RISK_FLAGS = {"RU", "CN", "IR", "KP", "SY"}


@dataclass
class ZoneCrossing:
    """A single zone entry or exit event."""
    timestamp: datetime
    latitude: float
    longitude: float
    crossing_type: str  # "entry" or "exit"
    speed: Optional[float] = None
    heading: Optional[float] = None
    nav_status: Optional[int] = None


# Memory limits for investigation
MAX_POSITIONS_PER_VESSEL = 1000  # Limit stored positions per vessel
MAX_VESSELS_TO_TRACK = 5000  # Maximum vessels to track in a single investigation


@dataclass
class VesselTrack:
    """Complete track for a vessel during the investigation period."""
    mmsi: str
    ship_name: Optional[str] = None
    ship_type: Optional[int] = None
    flag_state: Optional[str] = None
    imo_number: Optional[str] = None
    positions: List[dict] = field(default_factory=list)
    zone_entries: List[ZoneCrossing] = field(default_factory=list)
    zone_exits: List[ZoneCrossing] = field(default_factory=list)
    suspicious_indicators: List[str] = field(default_factory=list)
    positions_in_zone: List[dict] = field(default_factory=list)

    def add_position(self, pos: dict) -> bool:
        """Add position with memory limit. Returns False if limit reached."""
        if len(self.positions) < MAX_POSITIONS_PER_VESSEL:
            self.positions.append(pos)
            return True
        return False

    def add_position_in_zone(self, pos: dict) -> bool:
        """Add zone position with memory limit. Returns False if limit reached."""
        if len(self.positions_in_zone) < MAX_POSITIONS_PER_VESSEL:
            self.positions_in_zone.append(pos)
            return True
        return False

    @property
    def total_time_in_zone_minutes(self) -> float:
        """Calculate total time spent in zone."""
        total = 0.0
        for i, entry in enumerate(self.zone_entries):
            if i < len(self.zone_exits):
                delta = self.zone_exits[i].timestamp - entry.timestamp
                total += delta.total_seconds() / 60
        return total

    @property
    def min_speed_in_zone(self) -> Optional[float]:
        """Minimum speed observed while in zone."""
        speeds = [p.get('speed_over_ground') for p in self.positions_in_zone
                  if p.get('speed_over_ground') is not None]
        return min(speeds) if speeds else None

    @property
    def max_speed_in_zone(self) -> Optional[float]:
        """Maximum speed observed while in zone."""
        speeds = [p.get('speed_over_ground') for p in self.positions_in_zone
                  if p.get('speed_over_ground') is not None]
        return max(speeds) if speeds else None

    @property
    def avg_speed_in_zone(self) -> Optional[float]:
        """Average speed while in zone."""
        speeds = [p.get('speed_over_ground') for p in self.positions_in_zone
                  if p.get('speed_over_ground') is not None]
        return sum(speeds) / len(speeds) if speeds else None


@dataclass
class InvestigationResult:
    """Complete investigation report."""
    asset_id: str
    asset_name: str
    asset_properties: dict
    timeframe_start: datetime
    timeframe_end: datetime
    vessels_that_crossed: List[VesselTrack]
    total_positions_analyzed: int
    report_generated_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


def get_flag_from_mmsi(mmsi: str) -> Optional[str]:
    """Extract flag state from MMSI prefix."""
    if not mmsi or len(mmsi) < 3:
        return None
    prefix = mmsi[:3]
    return MMSI_FLAG_MAP.get(prefix)


def load_cable_zones(geojson_path: Optional[str] = None) -> Dict[str, dict]:
    """Load all cable zones from GeoJSON file."""
    if geojson_path is None:
        geojson_path = Path(__file__).parent.parent / 'reference-data' / 'geofences' / 'baltic_cables.geojson'

    with open(geojson_path, 'r') as f:
        data = json.load(f)

    zones = {}
    for feature in data.get('features', []):
        props = feature.get('properties', {})
        zone_id = props.get('id')
        if zone_id:
            zones[zone_id] = {
                'properties': props,
                'geometry': feature.get('geometry'),
                'polygon': shape(feature.get('geometry'))
            }
    return zones


def load_cable_zone(asset_id: str, geojson_path: Optional[str] = None) -> Tuple[dict, any]:
    """Load a specific cable zone by ID."""
    zones = load_cable_zones(geojson_path)
    if asset_id not in zones:
        available = list(zones.keys())
        raise ValueError(f"Zone '{asset_id}' not found. Available zones: {available}")

    zone = zones[asset_id]
    return zone['properties'], zone['polygon']


def parse_timeframe(timeframe: str) -> Tuple[datetime, datetime]:
    """
    Parse timeframe specification.

    Formats:
        - "48h" -> now minus 48 hours to now
        - "72h" -> now minus 72 hours to now
        - "2025-12-30T00:00:00Z/2025-12-31T12:00:00Z" -> ISO range
    """
    now = datetime.now(timezone.utc)

    # Check for hours format (e.g., "48h", "72h")
    hours_match = re.match(r'^(\d+)h$', timeframe.lower())
    if hours_match:
        hours = int(hours_match.group(1))
        return now - timedelta(hours=hours), now

    # Check for ISO8601 range format
    if '/' in timeframe:
        start_str, end_str = timeframe.split('/')
        start = datetime.fromisoformat(start_str.replace('Z', '+00:00'))
        end = datetime.fromisoformat(end_str.replace('Z', '+00:00'))
        return start, end

    raise ValueError(f"Invalid timeframe format: {timeframe}. Use '48h' or ISO8601 range.")


def get_kafka_config() -> dict:
    """Get Kafka configuration from environment."""
    return {
        'bootstrap.servers': os.getenv('KAFKA_BOOTSTRAP_SERVERS'),
        'security.protocol': 'SSL',
        'ssl.ca.location': os.getenv('KAFKA_SSL_CA_CERT', './ca.pem'),
        'ssl.certificate.location': os.getenv('KAFKA_SSL_CERT', './service.cert'),
        'ssl.key.location': os.getenv('KAFKA_SSL_KEY', './service.key'),
        'group.id': f'zone-investigator-{uuid.uuid4().hex[:8]}',
        'auto.offset.reset': 'earliest',
        'enable.auto.commit': False,
    }


def consume_historical_ais(
    start_time: datetime,
    end_time: datetime,
    bounding_box: Tuple[float, float, float, float],
    progress_callback=None
) -> Generator[dict, None, None]:
    """
    Consume historical AIS messages from Kafka within timeframe and bounding box.

    Args:
        start_time: Start of investigation period
        end_time: End of investigation period
        bounding_box: (min_lat, min_lon, max_lat, max_lon) for pre-filtering
        progress_callback: Optional callback(count, msg) for progress updates

    Yields:
        AIS position dictionaries
    """
    config = get_kafka_config()
    consumer = Consumer(config)

    start_ms = int(start_time.timestamp() * 1000)
    end_ms = int(end_time.timestamp() * 1000)

    min_lat, min_lon, max_lat, max_lon = bounding_box

    msg_count = 0
    yielded_count = 0
    empty_polls = 0
    max_empty_polls = 50

    try:
        # First, get cluster metadata to find partitions
        print("  Getting topic metadata...")
        metadata = consumer.list_topics('ais-raw', timeout=10.0)
        topic_metadata = metadata.topics.get('ais-raw')

        if not topic_metadata:
            print("  Error: Topic 'ais-raw' not found")
            return

        partitions = list(topic_metadata.partitions.keys())
        print(f"  Found {len(partitions)} partition(s): {partitions}")

        # Create TopicPartition objects and get offsets for start time
        tps_for_time = [TopicPartition('ais-raw', p, start_ms) for p in partitions]

        print(f"  Looking up offsets for {start_time.isoformat()}...")
        offsets = consumer.offsets_for_times(tps_for_time, timeout=15.0)

        # Create assignment with target offsets
        tps_to_assign = []
        for tp in offsets:
            if tp.offset >= 0:
                print(f"  Partition {tp.partition}: start offset = {tp.offset}")
                tps_to_assign.append(TopicPartition(tp.topic, tp.partition, tp.offset))
            else:
                print(f"  Partition {tp.partition}: no data at timestamp, using beginning")
                tps_to_assign.append(TopicPartition(tp.topic, tp.partition, 0))

        # Get watermarks
        for tp in tps_to_assign:
            try:
                low, high = consumer.get_watermark_offsets(tp, timeout=10.0)
                print(f"  Partition {tp.partition} watermarks: [{low}, {high}), seeking to {tp.offset}")
                msgs_avail = high - tp.offset if tp.offset >= 0 else high - low
                print(f"    ~{msgs_avail:,} messages to process")
            except Exception as e:
                print(f"  Could not get watermarks for partition {tp.partition}: {e}")

        # Assign partitions directly (not subscribe)
        print("  Assigning partitions...")
        # First assign without offset
        consumer.assign([TopicPartition(tp.topic, tp.partition) for tp in tps_to_assign])

        # Then seek to the target offsets
        time.sleep(0.5)  # Brief pause for assignment to settle
        for tp in tps_to_assign:
            consumer.seek(tp)
            print(f"  Seeked partition {tp.partition} to offset {tp.offset}")

        print("  Consuming messages...")

        while empty_polls < max_empty_polls:
            msg = consumer.poll(1.0)

            if msg is None:
                empty_polls += 1
                if empty_polls % 10 == 0:
                    print(f"  Still waiting... ({empty_polls} empty polls)")
                continue

            empty_polls = 0  # Reset on any message

            if msg.error():
                print(f"  Message error: {msg.error()}")
                continue

            try:
                data = json.loads(msg.value().decode('utf-8'))
            except (json.JSONDecodeError, UnicodeDecodeError):
                continue

            msg_count += 1

            # Check timestamp
            ts_str = data.get('timestamp')
            if ts_str:
                try:
                    ts = datetime.fromisoformat(ts_str.replace('Z', '+00:00'))
                    if ts > end_time:
                        break  # Past our window
                    if ts < start_time:
                        continue  # Before our window
                except (ValueError, TypeError):
                    pass

            # Pre-filter by bounding box
            lat = data.get('latitude')
            lon = data.get('longitude')
            if lat is None or lon is None:
                continue

            if not (min_lat <= lat <= max_lat and min_lon <= lon <= max_lon):
                continue

            yielded_count += 1

            if progress_callback and yielded_count % 1000 == 0:
                progress_callback(yielded_count, f"Processed {msg_count} messages, {yielded_count} in area")

            yield data

    finally:
        consumer.close()

    if progress_callback:
        progress_callback(yielded_count, f"Done: {msg_count} total messages, {yielded_count} in area")


class VesselStateTracker:
    """Track vessel inside/outside state and detect zone crossings."""

    def __init__(self, polygon):
        self.polygon = polygon
        self.prepared_polygon = prep(polygon)
        self.vessel_states: Dict[str, bool] = {}  # mmsi -> is_inside
        self.vessel_tracks: Dict[str, VesselTrack] = {}
        self.bounds = polygon.bounds  # (minx, miny, maxx, maxy) = (min_lon, min_lat, max_lon, max_lat)

    def get_bounding_box(self, buffer_degrees: float = 0.5) -> Tuple[float, float, float, float]:
        """Get bounding box for pre-filtering (min_lat, min_lon, max_lat, max_lon)."""
        min_lon, min_lat, max_lon, max_lat = self.bounds
        return (
            min_lat - buffer_degrees,
            min_lon - buffer_degrees,
            max_lat + buffer_degrees,
            max_lon + buffer_degrees
        )

    def process_position(self, pos: dict) -> Optional[ZoneCrossing]:
        """
        Process an AIS position, detect zone crossings.

        Returns ZoneCrossing if a crossing was detected, None otherwise.
        """
        mmsi = str(pos.get('mmsi', ''))
        if not mmsi:
            return None

        lat = pos.get('latitude')
        lon = pos.get('longitude')
        if lat is None or lon is None:
            return None

        # Quick bounding box rejection
        if not (self.bounds[1] <= lat <= self.bounds[3] and
                self.bounds[0] <= lon <= self.bounds[2]):
            is_inside = False
        else:
            point = Point(lon, lat)  # Shapely uses (x, y) = (lon, lat)
            is_inside = self.prepared_polygon.contains(point)

        # Check for state change first (before creating track)
        was_inside = self.vessel_states.get(mmsi, False)

        # Only create track for vessels that enter the zone or are already tracked
        # This prevents memory bloat from vessels that just pass nearby
        if mmsi not in self.vessel_tracks:
            if not is_inside and not was_inside:
                # Vessel is outside zone and wasn't inside before - don't track
                return None

            # Check vessel limit
            if len(self.vessel_tracks) >= MAX_VESSELS_TO_TRACK:
                # At limit - only track if vessel is entering zone
                if not is_inside:
                    return None

            flag = get_flag_from_mmsi(mmsi)
            self.vessel_tracks[mmsi] = VesselTrack(
                mmsi=mmsi,
                ship_name=pos.get('ship_name', '').strip() if pos.get('ship_name') else None,
                ship_type=pos.get('ship_type'),
                flag_state=flag,
                imo_number=pos.get('imo_number')
            )

        track = self.vessel_tracks[mmsi]

        # Update ship info if we have better data
        if pos.get('ship_name') and not track.ship_name:
            track.ship_name = pos.get('ship_name', '').strip()
        if pos.get('imo_number') and not track.imo_number:
            track.imo_number = pos.get('imo_number')

        # Record positions using memory-limited methods
        track.add_position(pos)

        crossing = None

        try:
            ts = datetime.fromisoformat(pos.get('timestamp', '').replace('Z', '+00:00'))
        except (ValueError, TypeError):
            ts = datetime.now(timezone.utc)

        if not was_inside and is_inside:
            # Entry event
            crossing = ZoneCrossing(
                timestamp=ts,
                latitude=lat,
                longitude=lon,
                crossing_type="entry",
                speed=pos.get('speed_over_ground'),
                heading=pos.get('course_over_ground'),
                nav_status=pos.get('nav_status')
            )
            track.zone_entries.append(crossing)

        elif was_inside and not is_inside:
            # Exit event
            crossing = ZoneCrossing(
                timestamp=ts,
                latitude=lat,
                longitude=lon,
                crossing_type="exit",
                speed=pos.get('speed_over_ground'),
                heading=pos.get('course_over_ground'),
                nav_status=pos.get('nav_status')
            )
            track.zone_exits.append(crossing)

        if is_inside:
            track.add_position_in_zone(pos)

        self.vessel_states[mmsi] = is_inside
        return crossing

    def get_vessels_that_crossed(self) -> List[VesselTrack]:
        """Get all vessels that entered the zone at least once."""
        return [track for track in self.vessel_tracks.values()
                if len(track.zone_entries) > 0]


def analyze_suspicious_behavior(track: VesselTrack) -> List[str]:
    """Analyze vessel track for suspicious behavior patterns."""
    indicators = []

    # Check for stopped behavior in zone
    stopped_positions = [p for p in track.positions_in_zone
                        if p.get('speed_over_ground', 999) < 0.5]
    if len(stopped_positions) >= 3:
        indicators.append("STOPPED_IN_ZONE")

    # Check for anchor status
    anchored_positions = [p for p in track.positions_in_zone
                         if p.get('nav_status') in [1, 5]]  # At anchor or moored
    if anchored_positions:
        indicators.append("ANCHOR_STATUS")

    # Check for slow transit
    if track.avg_speed_in_zone is not None and track.avg_speed_in_zone < 3.0:
        indicators.append("SLOW_TRANSIT")

    # Check for flag of convenience
    if track.flag_state in FLAGS_OF_CONVENIENCE:
        indicators.append("FLAG_OF_CONVENIENCE")

    # Check for high-risk flag state
    if track.flag_state in HIGH_RISK_FLAGS:
        indicators.append("HIGH_RISK_FLAG")

    # Check for prolonged time in zone (> 30 minutes for what should be transit)
    if track.total_time_in_zone_minutes > 30:
        indicators.append("PROLONGED_TIME")

    # Check for significant speed changes
    if track.min_speed_in_zone is not None and track.max_speed_in_zone is not None:
        if track.max_speed_in_zone > 0 and track.min_speed_in_zone / track.max_speed_in_zone < 0.3:
            indicators.append("SPEED_VARIATION")

    track.suspicious_indicators = indicators
    return indicators


def generate_report(result: InvestigationResult) -> str:
    """Generate markdown investigation report."""
    lines = []

    # Header
    lines.append(f"# Cable Zone Investigation Report")
    lines.append("")
    lines.append(f"**Generated:** {result.report_generated_at.strftime('%Y-%m-%d %H:%M:%S UTC')}")
    lines.append(f"**Case ID:** INV-{result.report_generated_at.strftime('%Y%m%d')}-{result.asset_id}")
    lines.append("")

    # Zone Details
    lines.append("## Zone Details")
    lines.append("")
    props = result.asset_properties
    lines.append(f"- **Asset ID:** {result.asset_id}")
    lines.append(f"- **Name:** {props.get('name', 'Unknown')}")
    lines.append(f"- **Type:** {props.get('infrastructure_type', 'Unknown')}")
    lines.append(f"- **Severity:** {props.get('severity', 'Unknown')}")
    lines.append(f"- **Owner:** {props.get('owner', 'Unknown')}")
    lines.append(f"- **Description:** {props.get('description', 'N/A')}")
    lines.append("")

    # Investigation Period
    lines.append("## Investigation Period")
    lines.append("")
    lines.append(f"- **Start:** {result.timeframe_start.strftime('%Y-%m-%d %H:%M:%S UTC')}")
    lines.append(f"- **End:** {result.timeframe_end.strftime('%Y-%m-%d %H:%M:%S UTC')}")
    lines.append(f"- **Duration:** {(result.timeframe_end - result.timeframe_start).total_seconds() / 3600:.1f} hours")
    lines.append(f"- **Positions Analyzed:** {result.total_positions_analyzed:,}")
    lines.append("")

    # Summary
    vessels = result.vessels_that_crossed
    lines.append("## Summary")
    lines.append("")
    lines.append(f"**{len(vessels)} vessel(s)** crossed the protection zone during the investigation period.")
    lines.append("")

    if not vessels:
        lines.append("No vessels detected crossing the protection zone.")
        return "\n".join(lines)

    # Vessels Table
    lines.append("## Vessels That Crossed Zone")
    lines.append("")
    lines.append("| MMSI | Name | Flag | Entries | Time in Zone | Min Speed | Avg Speed | Indicators |")
    lines.append("|------|------|------|---------|--------------|-----------|-----------|------------|")

    for v in sorted(vessels, key=lambda x: x.zone_entries[0].timestamp if x.zone_entries else datetime.min.replace(tzinfo=timezone.utc)):
        analyze_suspicious_behavior(v)
        name = v.ship_name or "Unknown"
        flag = v.flag_state or "??"
        entries = len(v.zone_entries)
        time_in = f"{v.total_time_in_zone_minutes:.1f} min"
        min_spd = f"{v.min_speed_in_zone:.1f}" if v.min_speed_in_zone is not None else "-"
        avg_spd = f"{v.avg_speed_in_zone:.1f}" if v.avg_speed_in_zone is not None else "-"
        indicators = ", ".join(v.suspicious_indicators) if v.suspicious_indicators else "-"

        lines.append(f"| {v.mmsi} | {name[:20]} | {flag} | {entries} | {time_in} | {min_spd} | {avg_spd} | {indicators} |")

    lines.append("")

    # Timeline
    lines.append("## Crossing Timeline")
    lines.append("")

    all_crossings = []
    for v in vessels:
        for entry in v.zone_entries:
            all_crossings.append((entry.timestamp, "ENTRY", v, entry))
        for exit in v.zone_exits:
            all_crossings.append((exit.timestamp, "EXIT", v, exit))

    all_crossings.sort(key=lambda x: x[0])

    lines.append("| Time (UTC) | Event | MMSI | Name | Speed | Heading |")
    lines.append("|------------|-------|------|------|-------|---------|")

    for ts, event_type, vessel, crossing in all_crossings:
        time_str = ts.strftime("%Y-%m-%d %H:%M:%S")
        name = vessel.ship_name or "Unknown"
        speed = f"{crossing.speed:.1f}" if crossing.speed is not None else "-"
        heading = f"{crossing.heading:.0f}" if crossing.heading is not None else "-"
        lines.append(f"| {time_str} | {event_type} | {vessel.mmsi} | {name[:15]} | {speed} | {heading} |")

    lines.append("")

    # Flag State Analysis
    lines.append("## Flag State Analysis")
    lines.append("")

    flag_counts = {}
    for v in vessels:
        flag = v.flag_state or "Unknown"
        flag_counts[flag] = flag_counts.get(flag, 0) + 1

    lines.append("| Flag | Count | Category |")
    lines.append("|------|-------|----------|")

    for flag, count in sorted(flag_counts.items(), key=lambda x: -x[1]):
        if flag in HIGH_RISK_FLAGS:
            category = "HIGH RISK"
        elif flag in FLAGS_OF_CONVENIENCE:
            category = "Flag of Convenience"
        else:
            category = "Standard"
        lines.append(f"| {flag} | {count} | {category} |")

    lines.append("")

    # Suspicious Vessels Detail
    suspicious_vessels = [v for v in vessels if v.suspicious_indicators]
    if suspicious_vessels:
        lines.append("## Suspicious Behavior Detail")
        lines.append("")

        for v in suspicious_vessels:
            lines.append(f"### {v.mmsi} - {v.ship_name or 'Unknown'}")
            lines.append("")
            lines.append(f"- **Flag:** {v.flag_state or 'Unknown'}")
            lines.append(f"- **IMO:** {v.imo_number or 'Unknown'}")
            lines.append(f"- **Indicators:** {', '.join(v.suspicious_indicators)}")
            lines.append(f"- **Time in Zone:** {v.total_time_in_zone_minutes:.1f} minutes")
            lines.append(f"- **Speed Range:** {v.min_speed_in_zone or 0:.1f} - {v.max_speed_in_zone or 0:.1f} kts")
            lines.append("")

            if v.zone_entries:
                e = v.zone_entries[0]
                lines.append(f"**First Entry:** {e.timestamp.strftime('%Y-%m-%d %H:%M:%S')} at ({e.latitude:.4f}, {e.longitude:.4f})")
            if v.zone_exits:
                x = v.zone_exits[-1]
                lines.append(f"**Last Exit:** {x.timestamp.strftime('%Y-%m-%d %H:%M:%S')} at ({x.latitude:.4f}, {x.longitude:.4f})")
            lines.append("")

    return "\n".join(lines)


class ZoneInvestigator:
    """Main investigation orchestrator."""

    def __init__(self, geojson_path: Optional[str] = None):
        self.geojson_path = geojson_path
        self.zones = load_cable_zones(geojson_path)

    def list_zones(self) -> List[dict]:
        """List available cable zones."""
        result = []
        for zone_id, zone in self.zones.items():
            props = zone['properties']
            result.append({
                'id': zone_id,
                'name': props.get('name'),
                'type': props.get('infrastructure_type'),
                'severity': props.get('severity'),
            })
        return result

    def investigate(
        self,
        asset_id: str,
        timeframe: str,
        output_path: Optional[str] = None,
        verbose: bool = True
    ) -> InvestigationResult:
        """
        Run complete investigation for a cable zone.

        Args:
            asset_id: Zone identifier (e.g., "CABLE-LT-LV-FIBER")
            timeframe: "48h" or ISO8601 range
            output_path: Optional path to save markdown report
            verbose: Print progress messages

        Returns:
            InvestigationResult with all findings
        """
        # Load zone
        if verbose:
            print(f"Loading zone: {asset_id}")

        properties, polygon = load_cable_zone(asset_id, self.geojson_path)

        # Parse timeframe
        start_time, end_time = parse_timeframe(timeframe)
        if verbose:
            print(f"Investigation period: {start_time} to {end_time}")

        # Initialize tracker
        tracker = VesselStateTracker(polygon)
        bbox = tracker.get_bounding_box()

        if verbose:
            print(f"Bounding box: {bbox}")
            print("Consuming historical AIS data from Kafka...")

        # Consume historical data
        position_count = 0

        def progress(count, msg):
            if verbose:
                print(f"  {msg}")

        for pos in consume_historical_ais(start_time, end_time, bbox, progress):
            tracker.process_position(pos)
            position_count += 1

        # Get results
        vessels = tracker.get_vessels_that_crossed()

        if verbose:
            print(f"\nAnalysis complete:")
            print(f"  Positions analyzed: {position_count}")
            print(f"  Vessels crossed zone: {len(vessels)}")

        # Analyze suspicious behavior
        for v in vessels:
            analyze_suspicious_behavior(v)

        # Create result
        result = InvestigationResult(
            asset_id=asset_id,
            asset_name=properties.get('name', asset_id),
            asset_properties=properties,
            timeframe_start=start_time,
            timeframe_end=end_time,
            vessels_that_crossed=vessels,
            total_positions_analyzed=position_count
        )

        # Generate and save report
        if output_path or verbose:
            report = generate_report(result)

            if output_path:
                Path(output_path).parent.mkdir(parents=True, exist_ok=True)
                with open(output_path, 'w') as f:
                    f.write(report)
                if verbose:
                    print(f"\nReport saved to: {output_path}")

            if verbose and not output_path:
                print("\n" + "=" * 80)
                print(report)

        return result


def main():
    parser = argparse.ArgumentParser(
        description="Investigate vessels crossing cable protection zones",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s CABLE-LT-LV-FIBER --timeframe 48h
  %(prog)s CABLE-LT-LV-FIBER -o reports/investigation.md
  %(prog)s --list-zones
        """
    )

    parser.add_argument(
        "asset_id",
        nargs="?",
        help="Cable zone ID (e.g., CABLE-LT-LV-FIBER)"
    )
    parser.add_argument(
        "--timeframe", "-t",
        default="48h",
        help="Timeframe: 48h, 72h, or ISO8601 range (default: 48h)"
    )
    parser.add_argument(
        "--output", "-o",
        help="Output report path (markdown)"
    )
    parser.add_argument(
        "--list-zones", "-l",
        action="store_true",
        help="List available zones"
    )
    parser.add_argument(
        "--quiet", "-q",
        action="store_true",
        help="Suppress progress output"
    )

    args = parser.parse_args()

    investigator = ZoneInvestigator()

    if args.list_zones:
        zones = investigator.list_zones()
        print("\nAvailable Cable Protection Zones:")
        print("-" * 80)
        for z in zones:
            print(f"  {z['id']}")
            print(f"    Name: {z['name']}")
            print(f"    Type: {z['type']}")
            print(f"    Severity: {z['severity']}")
            print()
        return

    if not args.asset_id:
        parser.error("asset_id is required (or use --list-zones)")

    try:
        result = investigator.investigate(
            asset_id=args.asset_id,
            timeframe=args.timeframe,
            output_path=args.output,
            verbose=not args.quiet
        )

        # Summary
        print(f"\n{'=' * 60}")
        print(f"INVESTIGATION COMPLETE")
        print(f"{'=' * 60}")
        print(f"Zone: {result.asset_name}")
        print(f"Period: {result.timeframe_start} to {result.timeframe_end}")
        print(f"Vessels that crossed: {len(result.vessels_that_crossed)}")

        suspicious = [v for v in result.vessels_that_crossed if v.suspicious_indicators]
        if suspicious:
            print(f"\nSUSPICIOUS VESSELS ({len(suspicious)}):")
            for v in suspicious:
                print(f"  - {v.mmsi} ({v.ship_name or 'Unknown'}) [{v.flag_state}]: {', '.join(v.suspicious_indicators)}")

    except ValueError as e:
        print(f"Error: {e}")
        return 1
    except KeyboardInterrupt:
        print("\nInterrupted")
        return 1


if __name__ == "__main__":
    exit(main() or 0)
