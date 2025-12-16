/**
 * Geographic utility functions for the frontend.
 */

/**
 * Calculate distance between two points using Haversine formula.
 * @returns Distance in nautical miles
 */
export function distanceNM(lat1, lon1, lat2, lon2) {
  const R = 3440.065 // Earth radius in nautical miles
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)

  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2)

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

/**
 * Calculate bearing from point 1 to point 2.
 * @returns Bearing in degrees (0-360)
 */
export function bearing(lat1, lon1, lat2, lon2) {
  const dLon = toRad(lon2 - lon1)
  const lat1Rad = toRad(lat1)
  const lat2Rad = toRad(lat2)

  const y = Math.sin(dLon) * Math.cos(lat2Rad)
  const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) -
            Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon)

  const brng = Math.atan2(y, x)
  return (toDeg(brng) + 360) % 360
}

function toRad(deg) {
  return deg * (Math.PI / 180)
}

function toDeg(rad) {
  return rad * (180 / Math.PI)
}

/**
 * Get vessel type category from ship type code.
 */
export function getVesselCategory(shipType) {
  if (!shipType) return 'unknown'

  if (shipType >= 70 && shipType <= 79) return 'cargo'
  if (shipType >= 80 && shipType <= 89) return 'tanker'
  if (shipType >= 30 && shipType <= 37) return 'fishing'
  if (shipType >= 60 && shipType <= 69) return 'passenger'
  if (shipType >= 40 && shipType <= 49) return 'highspeed'
  if (shipType >= 50 && shipType <= 59) return 'special'
  if (shipType >= 20 && shipType <= 29) return 'wing'

  return 'other'
}

/**
 * Get color for vessel type.
 */
export function getVesselColor(shipType) {
  const category = getVesselCategory(shipType)

  const colors = {
    tanker: [249, 115, 22],    // Orange
    cargo: [139, 92, 246],     // Purple
    fishing: [34, 197, 94],    // Green
    passenger: [59, 130, 246], // Blue
    highspeed: [236, 72, 153], // Pink
    special: [234, 179, 8],    // Yellow
    unknown: [107, 114, 128],  // Gray
    other: [107, 114, 128],    // Gray
  }

  return colors[category] || colors.other
}

/**
 * Get display name for vessel type.
 */
export function getVesselTypeName(shipType) {
  if (!shipType) return 'Unknown'

  const types = {
    30: 'Fishing',
    31: 'Towing',
    32: 'Towing (large)',
    33: 'Dredging',
    34: 'Diving',
    35: 'Military',
    36: 'Sailing',
    37: 'Pleasure Craft',
    40: 'High Speed Craft',
    50: 'Pilot Vessel',
    51: 'Search & Rescue',
    52: 'Tug',
    53: 'Port Tender',
    54: 'Anti-pollution',
    55: 'Law Enforcement',
    60: 'Passenger',
    70: 'Cargo',
    71: 'Cargo - Hazardous A',
    72: 'Cargo - Hazardous B',
    73: 'Cargo - Hazardous C',
    74: 'Cargo - Hazardous D',
    80: 'Tanker',
    81: 'Tanker - Hazardous A',
    82: 'Tanker - Hazardous B',
    83: 'Tanker - Hazardous C',
    84: 'Tanker - Hazardous D',
  }

  // Handle ranges
  if (shipType >= 70 && shipType <= 79) return types[70] || 'Cargo'
  if (shipType >= 80 && shipType <= 89) return types[80] || 'Tanker'
  if (shipType >= 60 && shipType <= 69) return types[60] || 'Passenger'
  if (shipType >= 30 && shipType <= 37) return types[shipType] || 'Fishing'

  return types[shipType] || 'Unknown'
}

/**
 * Get alert severity color.
 */
export function getAlertColor(severity) {
  const colors = {
    LOW: [34, 197, 94],      // Green
    MEDIUM: [234, 179, 8],   // Yellow
    HIGH: [249, 115, 22],    // Orange
    CRITICAL: [239, 68, 68], // Red
  }

  return colors[severity] || colors.MEDIUM
}

/**
 * Format coordinates for display.
 */
export function formatCoordinates(lat, lon) {
  const latDir = lat >= 0 ? 'N' : 'S'
  const lonDir = lon >= 0 ? 'E' : 'W'

  return `${Math.abs(lat).toFixed(4)}° ${latDir}, ${Math.abs(lon).toFixed(4)}° ${lonDir}`
}

/**
 * Format speed for display.
 */
export function formatSpeed(speed) {
  if (speed == null) return 'N/A'
  return `${speed.toFixed(1)} kts`
}

/**
 * Format course for display.
 */
export function formatCourse(course) {
  if (course == null) return 'N/A'
  return `${Math.round(course)}°`
}

/**
 * Get navigation status name.
 */
export function getNavStatusName(status) {
  const statuses = {
    0: 'Under way using engine',
    1: 'At anchor',
    2: 'Not under command',
    3: 'Restricted maneuverability',
    4: 'Constrained by draught',
    5: 'Moored',
    6: 'Aground',
    7: 'Engaged in fishing',
    8: 'Under way sailing',
    11: 'Power-driven towing astern',
    12: 'Power-driven pushing/towing',
    14: 'AIS-SART active',
    15: 'Undefined',
  }

  return statuses[status] || 'Unknown'
}

/**
 * Generate icon for vessel based on type and heading.
 */
export function getVesselIcon(shipType, heading) {
  // Simple arrow icon, rotated by heading
  const rotation = heading || 0
  return {
    type: 'arrow',
    rotation,
    color: getVesselColor(shipType),
  }
}

/**
 * MID (Maritime Identification Digits) to country mapping.
 * First 3 digits of MMSI identify the flag state.
 */
const MID_TO_COUNTRY = {
  // Russia & Eastern Europe
  '273': { code: 'RU', name: 'Russia', flag: '🇷🇺', flagged: true },
  '272': { code: 'UA', name: 'Ukraine', flag: '🇺🇦' },
  '276': { code: 'EE', name: 'Estonia', flag: '🇪🇪' },
  '275': { code: 'LV', name: 'Latvia', flag: '🇱🇻' },
  '277': { code: 'LT', name: 'Lithuania', flag: '🇱🇹' },
  '278': { code: 'BY', name: 'Belarus', flag: '🇧🇾' },

  // Nordic
  '230': { code: 'FI', name: 'Finland', flag: '🇫🇮' },
  '231': { code: 'FI', name: 'Finland', flag: '🇫🇮' },
  '265': { code: 'SE', name: 'Sweden', flag: '🇸🇪' },
  '266': { code: 'SE', name: 'Sweden', flag: '🇸🇪' },
  '257': { code: 'NO', name: 'Norway', flag: '🇳🇴' },
  '258': { code: 'NO', name: 'Norway', flag: '🇳🇴' },
  '259': { code: 'NO', name: 'Norway', flag: '🇳🇴' },
  '219': { code: 'DK', name: 'Denmark', flag: '🇩🇰' },
  '220': { code: 'DK', name: 'Denmark', flag: '🇩🇰' },
  '251': { code: 'IS', name: 'Iceland', flag: '🇮🇸' },

  // Western Europe
  '211': { code: 'DE', name: 'Germany', flag: '🇩🇪' },
  '218': { code: 'DE', name: 'Germany', flag: '🇩🇪' },
  '244': { code: 'NL', name: 'Netherlands', flag: '🇳🇱' },
  '245': { code: 'NL', name: 'Netherlands', flag: '🇳🇱' },
  '246': { code: 'NL', name: 'Netherlands', flag: '🇳🇱' },
  '205': { code: 'BE', name: 'Belgium', flag: '🇧🇪' },
  '226': { code: 'FR', name: 'France', flag: '🇫🇷' },
  '227': { code: 'FR', name: 'France', flag: '🇫🇷' },
  '228': { code: 'FR', name: 'France', flag: '🇫🇷' },
  '232': { code: 'GB', name: 'United Kingdom', flag: '🇬🇧' },
  '233': { code: 'GB', name: 'United Kingdom', flag: '🇬🇧' },
  '234': { code: 'GB', name: 'United Kingdom', flag: '🇬🇧' },
  '235': { code: 'GB', name: 'United Kingdom', flag: '🇬🇧' },
  '250': { code: 'IE', name: 'Ireland', flag: '🇮🇪' },

  // Southern Europe
  '224': { code: 'ES', name: 'Spain', flag: '🇪🇸' },
  '225': { code: 'ES', name: 'Spain', flag: '🇪🇸' },
  '247': { code: 'IT', name: 'Italy', flag: '🇮🇹' },
  '263': { code: 'PT', name: 'Portugal', flag: '🇵🇹' },
  '237': { code: 'GR', name: 'Greece', flag: '🇬🇷' },
  '238': { code: 'HR', name: 'Croatia', flag: '🇭🇷' },
  '240': { code: 'GR', name: 'Greece', flag: '🇬🇷' },
  '241': { code: 'GR', name: 'Greece', flag: '🇬🇷' },
  '256': { code: 'MT', name: 'Malta', flag: '🇲🇹' },
  '249': { code: 'MT', name: 'Malta', flag: '🇲🇹' },
  '239': { code: 'GR', name: 'Greece', flag: '🇬🇷' },

  // Central/Eastern Europe
  '261': { code: 'PL', name: 'Poland', flag: '🇵🇱' },
  '271': { code: 'TR', name: 'Turkey', flag: '🇹🇷' },
  '279': { code: 'TR', name: 'Turkey', flag: '🇹🇷' },

  // Asia - Flagged states
  '412': { code: 'CN', name: 'China', flag: '🇨🇳', flagged: true },
  '413': { code: 'CN', name: 'China', flag: '🇨🇳', flagged: true },
  '414': { code: 'CN', name: 'China', flag: '🇨🇳', flagged: true },
  '477': { code: 'HK', name: 'Hong Kong', flag: '🇭🇰', flagged: true },
  '416': { code: 'TW', name: 'Taiwan', flag: '🇹🇼' },
  '431': { code: 'JP', name: 'Japan', flag: '🇯🇵' },
  '432': { code: 'JP', name: 'Japan', flag: '🇯🇵' },
  '440': { code: 'KR', name: 'South Korea', flag: '🇰🇷' },
  '441': { code: 'KR', name: 'South Korea', flag: '🇰🇷' },
  '445': { code: 'KP', name: 'North Korea', flag: '🇰🇵', flagged: true },
  '422': { code: 'IR', name: 'Iran', flag: '🇮🇷', flagged: true },
  '470': { code: 'AE', name: 'UAE', flag: '🇦🇪' },
  '403': { code: 'SA', name: 'Saudi Arabia', flag: '🇸🇦' },
  '508': { code: 'SG', name: 'Singapore', flag: '🇸🇬' },
  '533': { code: 'MY', name: 'Malaysia', flag: '🇲🇾' },
  '567': { code: 'TH', name: 'Thailand', flag: '🇹🇭' },
  '574': { code: 'VN', name: 'Vietnam', flag: '🇻🇳' },
  '525': { code: 'ID', name: 'Indonesia', flag: '🇮🇩' },
  '548': { code: 'PH', name: 'Philippines', flag: '🇵🇭' },
  '419': { code: 'IN', name: 'India', flag: '🇮🇳' },

  // Americas
  '303': { code: 'US', name: 'United States', flag: '🇺🇸' },
  '338': { code: 'US', name: 'United States', flag: '🇺🇸' },
  '366': { code: 'US', name: 'United States', flag: '🇺🇸' },
  '367': { code: 'US', name: 'United States', flag: '🇺🇸' },
  '368': { code: 'US', name: 'United States', flag: '🇺🇸' },
  '369': { code: 'US', name: 'United States', flag: '🇺🇸' },
  '316': { code: 'CA', name: 'Canada', flag: '🇨🇦' },
  '345': { code: 'MX', name: 'Mexico', flag: '🇲🇽' },
  '351': { code: 'BR', name: 'Brazil', flag: '🇧🇷' },
  '356': { code: 'PA', name: 'Panama', flag: '🇵🇦' },
  '357': { code: 'PA', name: 'Panama', flag: '🇵🇦' },
  '370': { code: 'PA', name: 'Panama', flag: '🇵🇦' },
  '371': { code: 'PA', name: 'Panama', flag: '🇵🇦' },
  '372': { code: 'PA', name: 'Panama', flag: '🇵🇦' },
  '373': { code: 'PA', name: 'Panama', flag: '🇵🇦' },
  '374': { code: 'PA', name: 'Panama', flag: '🇵🇦' },

  // Flag of Convenience
  '209': { code: 'CY', name: 'Cyprus', flag: '🇨🇾' },
  '210': { code: 'CY', name: 'Cyprus', flag: '🇨🇾' },
  '212': { code: 'CY', name: 'Cyprus', flag: '🇨🇾' },
  '229': { code: 'MT', name: 'Malta', flag: '🇲🇹' },
  '236': { code: 'GI', name: 'Gibraltar', flag: '🇬🇮' },
  '309': { code: 'BS', name: 'Bahamas', flag: '🇧🇸' },
  '311': { code: 'BS', name: 'Bahamas', flag: '🇧🇸' },
  '312': { code: 'BM', name: 'Bermuda', flag: '🇧🇲' },
  '314': { code: 'BB', name: 'Barbados', flag: '🇧🇧' },
  '319': { code: 'KY', name: 'Cayman Islands', flag: '🇰🇾' },
  '377': { code: 'LR', name: 'Liberia', flag: '🇱🇷' },
  '378': { code: 'LR', name: 'Liberia', flag: '🇱🇷' },
  '636': { code: 'LR', name: 'Liberia', flag: '🇱🇷' },
  '637': { code: 'LR', name: 'Liberia', flag: '🇱🇷' },
  '620': { code: 'MH', name: 'Marshall Islands', flag: '🇲🇭' },
  '621': { code: 'MH', name: 'Marshall Islands', flag: '🇲🇭' },

  // Africa
  '601': { code: 'ZA', name: 'South Africa', flag: '🇿🇦' },
  '618': { code: 'EG', name: 'Egypt', flag: '🇪🇬' },
  '622': { code: 'MA', name: 'Morocco', flag: '🇲🇦' },

  // Oceania
  '503': { code: 'AU', name: 'Australia', flag: '🇦🇺' },
  '512': { code: 'NZ', name: 'New Zealand', flag: '🇳🇿' },
}

/**
 * Extract flag state information from MMSI.
 * @param {string} mmsi - Maritime Mobile Service Identity
 * @returns {Object} Flag state info with code, name, flag emoji, and flagged status
 */
export function getFlagState(mmsi) {
  if (!mmsi || mmsi.length < 3) {
    return { code: 'XX', name: 'Unknown', flag: '🏴', flagged: false }
  }

  const mid = mmsi.substring(0, 3)
  const country = MID_TO_COUNTRY[mid]

  if (country) {
    return {
      code: country.code,
      name: country.name,
      flag: country.flag,
      flagged: country.flagged || false,
      mid,
    }
  }

  return { code: mid, name: `MID ${mid}`, flag: '🏴', flagged: false, mid }
}

/**
 * Check if a vessel is from a flagged/monitored state.
 */
export function isFlaggedState(mmsi) {
  const flagState = getFlagState(mmsi)
  return flagState.flagged
}

/**
 * Baltic Sea cable infrastructure geofences.
 * These define protection zones around critical undersea infrastructure.
 */
export const BALTIC_CABLE_GEOFENCES = [
  {
    id: 'CABLE-CLION1',
    name: 'C-Lion1 Data Cable',
    subtitle: 'Helsinki → Rostock',
    type: 'telecommunications',
    severity: 'CRITICAL',
    color: [59, 130, 246], // Blue
    coordinates: [
      [24.8, 59.9], [24.5, 59.4], [23.5, 58.8], [21.0, 57.5],
      [19.5, 56.5], [18.0, 55.5], [15.0, 54.5], [12.2, 54.2],
      [12.0, 54.3], [15.0, 54.7], [18.0, 55.7], [19.5, 56.7],
      [21.0, 57.7], [23.5, 59.0], [24.5, 59.6], [25.0, 60.1], [24.8, 59.9]
    ]
  },
  {
    id: 'CABLE-BALTICCONNECTOR',
    name: 'Balticconnector',
    subtitle: 'Gas Pipeline FI → EE',
    type: 'gas_pipeline',
    severity: 'CRITICAL',
    color: [239, 68, 68], // Red
    coordinates: [
      [24.2, 59.9], [24.0, 59.7], [23.8, 59.5],
      [24.0, 59.45], [24.2, 59.5], [24.4, 59.7], [24.4, 59.9], [24.2, 59.9]
    ]
  },
  {
    id: 'CABLE-ESTLINK1',
    name: 'Estlink 1',
    subtitle: 'HVDC Power FI → EE',
    type: 'power',
    severity: 'HIGH',
    color: [234, 179, 8], // Yellow
    coordinates: [
      [25.0, 59.8], [24.8, 59.6], [25.0, 59.45],
      [25.2, 59.5], [25.2, 59.7], [25.0, 59.8]
    ]
  },
  {
    id: 'CABLE-ESTLINK2',
    name: 'Estlink 2',
    subtitle: 'HVDC Power FI → EE',
    type: 'power',
    severity: 'HIGH',
    color: [234, 179, 8], // Yellow
    coordinates: [
      [25.3, 59.85], [25.1, 59.65], [25.3, 59.5],
      [25.5, 59.55], [25.5, 59.75], [25.3, 59.85]
    ]
  },
  {
    id: 'CABLE-SWEPOL',
    name: 'SwePol Link',
    subtitle: 'HVDC Power SE → PL',
    type: 'power',
    severity: 'HIGH',
    color: [168, 85, 247], // Purple
    coordinates: [
      [14.0, 55.4], [14.5, 55.2], [15.5, 54.8], [16.0, 54.6],
      [16.2, 54.7], [15.5, 55.0], [14.5, 55.4], [14.0, 55.6], [14.0, 55.4]
    ]
  },
  {
    id: 'CABLE-NORDBALT',
    name: 'NordBalt',
    subtitle: 'HVDC Power SE → LT',
    type: 'power',
    severity: 'HIGH',
    color: [34, 197, 94], // Green
    coordinates: [
      [17.5, 56.2], [18.5, 55.8], [19.5, 55.6], [20.5, 55.7],
      [20.5, 55.9], [19.5, 55.8], [18.5, 56.0], [17.5, 56.4], [17.5, 56.2]
    ]
  }
]

/**
 * Get infrastructure type icon.
 */
export function getInfrastructureIcon(type) {
  const icons = {
    telecommunications: '📡',
    gas_pipeline: '🔥',
    power: '⚡',
  }
  return icons[type] || '📍'
}
