/**
 * Tests for geo utility functions.
 */

import { describe, it, expect } from 'vitest'
import {
  distanceNM,
  bearing,
  getVesselCategory,
  getVesselColor,
  getVesselTypeName,
  getAlertColor,
  formatCoordinates,
  formatSpeed,
  formatCourse,
  getNavStatusName,
} from './geo'

describe('distanceNM', () => {
  it('should calculate distance between two points', () => {
    // Genoa to Marseille (approximately 150-180 NM)
    const distance = distanceNM(44.4072, 8.9342, 43.2965, 5.3698)
    expect(distance).toBeGreaterThan(100)
    expect(distance).toBeLessThan(250)
  })

  it('should return 0 for same point', () => {
    const distance = distanceNM(38.5, 15.2, 38.5, 15.2)
    expect(distance).toBeCloseTo(0, 5)
  })
})

describe('bearing', () => {
  it('should calculate bearing north correctly', () => {
    const b = bearing(38.0, 15.0, 39.0, 15.0)
    expect(b).toBeCloseTo(0, 0) // North is 0°
  })

  it('should calculate bearing east correctly', () => {
    const b = bearing(38.0, 15.0, 38.0, 16.0)
    expect(b).toBeGreaterThan(85)
    expect(b).toBeLessThan(95) // East is ~90°
  })

  it('should calculate bearing south correctly', () => {
    const b = bearing(39.0, 15.0, 38.0, 15.0)
    expect(b).toBeGreaterThan(175)
    expect(b).toBeLessThan(185) // South is ~180°
  })
})

describe('getVesselCategory', () => {
  it('should identify cargo vessels', () => {
    expect(getVesselCategory(70)).toBe('cargo')
    expect(getVesselCategory(75)).toBe('cargo')
    expect(getVesselCategory(79)).toBe('cargo')
  })

  it('should identify tankers', () => {
    expect(getVesselCategory(80)).toBe('tanker')
    expect(getVesselCategory(84)).toBe('tanker')
    expect(getVesselCategory(89)).toBe('tanker')
  })

  it('should identify fishing vessels', () => {
    expect(getVesselCategory(30)).toBe('fishing')
    expect(getVesselCategory(35)).toBe('fishing')
  })

  it('should identify passenger vessels', () => {
    expect(getVesselCategory(60)).toBe('passenger')
    expect(getVesselCategory(69)).toBe('passenger')
  })

  it('should return unknown for null', () => {
    expect(getVesselCategory(null)).toBe('unknown')
    expect(getVesselCategory(undefined)).toBe('unknown')
  })

  it('should return other for unrecognized types', () => {
    expect(getVesselCategory(99)).toBe('other')
  })
})

describe('getVesselColor', () => {
  it('should return correct colors for vessel types', () => {
    const tankerColor = getVesselColor(80)
    expect(tankerColor).toEqual([249, 115, 22]) // Orange

    const cargoColor = getVesselColor(70)
    expect(cargoColor).toEqual([139, 92, 246]) // Purple

    const fishingColor = getVesselColor(30)
    expect(fishingColor).toEqual([34, 197, 94]) // Green
  })

  it('should return gray for unknown types', () => {
    const unknownColor = getVesselColor(null)
    expect(unknownColor).toEqual([107, 114, 128])
  })
})

describe('getVesselTypeName', () => {
  it('should return correct names for vessel types', () => {
    expect(getVesselTypeName(70)).toBe('Cargo')
    expect(getVesselTypeName(80)).toBe('Tanker')
    expect(getVesselTypeName(30)).toBe('Fishing')
    expect(getVesselTypeName(60)).toBe('Passenger')
  })

  it('should return Unknown for null', () => {
    expect(getVesselTypeName(null)).toBe('Unknown')
    expect(getVesselTypeName(undefined)).toBe('Unknown')
  })
})

describe('getAlertColor', () => {
  it('should return correct colors for severity levels', () => {
    expect(getAlertColor('LOW')).toEqual([34, 197, 94])      // Green
    expect(getAlertColor('MEDIUM')).toEqual([234, 179, 8])   // Yellow
    expect(getAlertColor('HIGH')).toEqual([249, 115, 22])    // Orange
    expect(getAlertColor('CRITICAL')).toEqual([239, 68, 68]) // Red
  })

  it('should return default for unknown severity', () => {
    expect(getAlertColor('UNKNOWN')).toEqual([234, 179, 8]) // Default to MEDIUM
  })
})

describe('formatCoordinates', () => {
  it('should format coordinates correctly', () => {
    expect(formatCoordinates(38.5, 15.2)).toBe('38.5000° N, 15.2000° E')
    expect(formatCoordinates(-33.9, -151.2)).toBe('33.9000° S, 151.2000° W')
  })
})

describe('formatSpeed', () => {
  it('should format speed with units', () => {
    expect(formatSpeed(12.3)).toBe('12.3 kts')
    expect(formatSpeed(0)).toBe('0.0 kts')
  })

  it('should return N/A for null', () => {
    expect(formatSpeed(null)).toBe('N/A')
    expect(formatSpeed(undefined)).toBe('N/A')
  })
})

describe('formatCourse', () => {
  it('should format course with degree symbol', () => {
    expect(formatCourse(180.5)).toBe('181°')
    expect(formatCourse(0)).toBe('0°')
  })

  it('should return N/A for null', () => {
    expect(formatCourse(null)).toBe('N/A')
  })
})

describe('getNavStatusName', () => {
  it('should return correct status names', () => {
    expect(getNavStatusName(0)).toBe('Under way using engine')
    expect(getNavStatusName(1)).toBe('At anchor')
    expect(getNavStatusName(5)).toBe('Moored')
    expect(getNavStatusName(7)).toBe('Engaged in fishing')
  })

  it('should return Unknown for unrecognized status', () => {
    expect(getNavStatusName(99)).toBe('Unknown')
  })
})
