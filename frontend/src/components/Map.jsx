import React, { useState, useCallback, useMemo, useEffect } from 'react'
import MapGL, { NavigationControl, ScaleControl } from 'react-map-gl'
import DeckGL from '@deck.gl/react'
import { ScatterplotLayer, PolygonLayer, TextLayer, PathLayer } from '@deck.gl/layers'
import {
  getVesselColor,
  getAlertColor,
  getFlagState,
  BALTIC_CABLE_GEOFENCES,
  getInfrastructureIcon
} from '../utils/geo'

// Default map view - centered on Baltic Sea (cable monitoring)
const INITIAL_VIEW_STATE = {
  longitude: 20,
  latitude: 58,
  zoom: 5,
  pitch: 0,
  bearing: 0,
}

// SVG arrow icon for vessels - pointing up (0 degrees)
const VESSEL_ARROW_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
  <path d="M16 2 L26 28 L16 22 L6 28 Z" fill="COLOR" stroke="STROKE" stroke-width="1.5"/>
</svg>
`

/**
 * Create a data URL for the vessel arrow icon with specified color.
 */
function createVesselIcon(fillColor, strokeColor = 'rgba(255,255,255,0.8)') {
  const svg = VESSEL_ARROW_SVG
    .replace('COLOR', fillColor)
    .replace('STROKE', strokeColor)
  return `data:image/svg+xml;base64,${btoa(svg)}`
}

/**
 * Main map component displaying vessels, alerts, trails, ports, and cable infrastructure.
 */
export default function Map({
  vessels = [],
  alerts = [],
  trails = [],
  ports = [],
  cables = [],
  selectedVessel,
  onVesselClick,
  mapboxToken,
  showTrails = true,
  showPorts = true,
  showCables = true,
  flyTo = null,  // { latitude, longitude, zoom? } - fly to this location
}) {
  const [viewState, setViewState] = useState(INITIAL_VIEW_STATE)
  const [hoverInfo, setHoverInfo] = useState(null)

  // Handle flyTo prop changes - animate to new location
  useEffect(() => {
    if (flyTo && flyTo.latitude && flyTo.longitude) {
      setViewState(prev => ({
        ...prev,
        latitude: flyTo.latitude,
        longitude: flyTo.longitude,
        zoom: flyTo.zoom || 10,
        transitionDuration: 1000,
      }))
    }
  }, [flyTo])

  // Pre-generate icon URLs for vessel types
  const vesselIcons = useMemo(() => {
    const icons = {}
    const types = [null, 30, 60, 70, 80] // unknown, fishing, passenger, cargo, tanker
    types.forEach(type => {
      const [r, g, b] = getVesselColor(type)
      icons[type || 'default'] = createVesselIcon(`rgb(${r},${g},${b})`)
    })
    return icons
  }, [])

  // Cable protection zone layers - filled polygons with animated borders
  const cableZoneLayers = useMemo(() => {
    if (!showCables || cables.length === 0) return []

    // Fill layer
    const fillLayer = new PolygonLayer({
      id: 'cable-zones-fill',
      data: cables,
      pickable: true,
      stroked: false,
      filled: true,
      extruded: false,
      getPolygon: d => d.coordinates,
      getFillColor: d => [...d.color, 40], // Very transparent fill
      onHover: info => {
        if (info.object) {
          setHoverInfo({ ...info, isCableZone: true })
        } else if (hoverInfo?.isCableZone) {
          setHoverInfo(null)
        }
      },
    })

    // Border layer with glow effect
    const borderLayer = new PathLayer({
      id: 'cable-zones-border',
      data: cables,
      pickable: false,
      widthUnits: 'pixels',
      widthScale: 1,
      getPath: d => d.coordinates,
      getColor: d => [...d.color, 180],
      getWidth: d => d.severity === 'CRITICAL' ? 3 : 2,
      getDashArray: d => d.severity === 'CRITICAL' ? [0, 0] : [8, 4],
    })

    // Outer glow for critical zones
    const glowLayer = new PathLayer({
      id: 'cable-zones-glow',
      data: cables.filter(z => z.severity === 'CRITICAL'),
      pickable: false,
      widthUnits: 'pixels',
      widthScale: 1,
      getPath: d => d.coordinates,
      getColor: d => [...d.color, 60],
      getWidth: 8,
    })

    return [glowLayer, fillLayer, borderLayer]
  }, [cables, showCables, hoverInfo])

  // Cable zone labels
  const cableLabelLayer = useMemo(() => {
    if (!showCables || cables.length === 0 || viewState.zoom < 6) return null

    return new TextLayer({
      id: 'cable-labels',
      data: cables,
      pickable: false,
      getPosition: d => {
        // Get centroid of polygon
        const coords = d.coordinates
        const sumLon = coords.reduce((sum, c) => sum + c[0], 0)
        const sumLat = coords.reduce((sum, c) => sum + c[1], 0)
        return [sumLon / coords.length, sumLat / coords.length]
      },
      getText: d => `${getInfrastructureIcon(d.type)} ${d.name}`,
      getSize: 12,
      getColor: d => [...d.color, 255],
      getTextAnchor: 'middle',
      getAlignmentBaseline: 'center',
      fontFamily: 'Monaco, monospace',
      fontWeight: 'bold',
      outlineWidth: 2,
      outlineColor: [15, 23, 42, 255],
    })
  }, [cables, showCables, viewState.zoom])

  // Vessel layer - arrows showing heading direction
  const vesselLayer = useMemo(() => new ScatterplotLayer({
    id: 'vessels',
    data: vessels,
    pickable: true,
    opacity: 1,
    stroked: true,
    filled: true,
    radiusScale: 1,
    radiusMinPixels: 6,
    radiusMaxPixels: 24,
    lineWidthMinPixels: 1,
    getPosition: d => [d.longitude, d.latitude],
    getRadius: d => {
      // Size based on vessel length or default
      const length = d.dimension_a && d.dimension_b
        ? d.dimension_a + d.dimension_b
        : 100
      return Math.max(60, length)
    },
    getFillColor: d => {
      const flagState = getFlagState(d.mmsi)
      if (selectedVessel && d.mmsi === selectedVessel.mmsi) {
        return [255, 255, 255, 255] // White for selected
      }
      // Highlight flagged states with a red tint
      if (flagState.flagged) {
        return [239, 68, 68, 230] // Red for flagged states
      }
      return [...getVesselColor(d.ship_type), 220]
    },
    getLineColor: d => {
      if (selectedVessel && d.mmsi === selectedVessel.mmsi) {
        return [59, 130, 246, 255] // Blue border for selected
      }
      const flagState = getFlagState(d.mmsi)
      if (flagState.flagged) {
        return [255, 255, 255, 255] // White border for flagged
      }
      return [255, 255, 255, 120]
    },
    getLineWidth: d => {
      if (selectedVessel && d.mmsi === selectedVessel.mmsi) return 3
      const flagState = getFlagState(d.mmsi)
      if (flagState.flagged) return 2
      return 1
    },
    // Custom rendering to show heading direction
    // Using angle parameter to rotate the point
    getAngle: d => {
      const heading = d.heading ?? d.course_over_ground ?? 0
      return 360 - heading // Invert for correct rotation direction
    },
    onHover: info => {
      if (info.object) {
        setHoverInfo({ ...info, isVessel: true })
      } else if (hoverInfo?.isVessel) {
        setHoverInfo(null)
      }
    },
    onClick: info => {
      if (info.object && onVesselClick) {
        onVesselClick(info.object)
      }
    },
    updateTriggers: {
      getFillColor: [selectedVessel?.mmsi],
      getLineColor: [selectedVessel?.mmsi],
      getLineWidth: [selectedVessel?.mmsi],
    },
  }), [vessels, selectedVessel, onVesselClick, hoverInfo])

  // Heading indicator arrows (triangular shape showing direction)
  const headingLayer = useMemo(() => new ScatterplotLayer({
    id: 'vessel-headings',
    data: vessels.filter(v => v.speed_over_ground > 0.5), // Only show for moving vessels
    pickable: false,
    opacity: 1,
    stroked: false,
    filled: true,
    radiusScale: 1,
    radiusMinPixels: 3,
    radiusMaxPixels: 10,
    getPosition: d => {
      // Offset position in direction of heading
      const heading = d.heading ?? d.course_over_ground ?? 0
      const headingRad = (heading * Math.PI) / 180
      const speed = d.speed_over_ground || 1
      const offset = 0.008 * Math.min(speed / 10, 1.5) // Scale offset by speed
      return [
        d.longitude + Math.sin(headingRad) * offset,
        d.latitude + Math.cos(headingRad) * offset,
      ]
    },
    getRadius: 25,
    getFillColor: d => {
      const flagState = getFlagState(d.mmsi)
      if (flagState.flagged) {
        return [239, 68, 68, 200]
      }
      return [...getVesselColor(d.ship_type), 180]
    },
  }), [vessels])

  // Vessel trails layer - shows recent position history as fading lines
  const trailsLayer = useMemo(() => {
    if (!showTrails || trails.length === 0) return null

    return new PathLayer({
      id: 'vessel-trails',
      data: trails,
      pickable: false,
      widthUnits: 'pixels',
      widthScale: 1,
      widthMinPixels: 1,
      widthMaxPixels: 3,
      capRounded: true,
      jointRounded: true,
      getPath: d => d.coordinates,
      getColor: d => {
        // Color based on vessel type
        const shipType = d.ship_type || 0
        const color = getVesselColor(shipType)
        return [...color, 120] // Semi-transparent
      },
      getWidth: 2,
    })
  }, [trails, showTrails])

  // Ports layer - shows port boundaries
  const portsLayer = useMemo(() => {
    if (!showPorts || ports.length === 0) return null

    return new PolygonLayer({
      id: 'ports',
      data: ports,
      pickable: true,
      stroked: true,
      filled: true,
      extruded: false,
      wireframe: false,
      getPolygon: d => d.coordinates,
      getFillColor: [100, 149, 237, 40], // Cornflower blue, very transparent
      getLineColor: [100, 149, 237, 180],
      getLineWidth: 2,
      lineWidthUnits: 'pixels',
      onHover: info => {
        if (info.object) {
          setHoverInfo({ ...info, isPort: true })
        } else if (hoverInfo?.isPort) {
          setHoverInfo(null)
        }
      },
    })
  }, [ports, showPorts, hoverInfo])

  // Port labels
  const portLabelLayer = useMemo(() => {
    if (!showPorts || ports.length === 0 || viewState.zoom < 7) return null

    return new TextLayer({
      id: 'port-labels',
      data: ports,
      pickable: false,
      getPosition: d => d.center || d.coordinates[0],
      getText: d => `⚓ ${d.name}`,
      getSize: 11,
      getColor: [100, 149, 237, 255],
      getTextAnchor: 'middle',
      getAlignmentBaseline: 'center',
      fontFamily: 'Monaco, monospace',
      fontWeight: 'bold',
      outlineWidth: 2,
      outlineColor: [15, 23, 42, 255],
    })
  }, [ports, showPorts, viewState.zoom])

  // Alert layer - shows alert locations as pulsing markers
  const alertLayer = useMemo(() => new ScatterplotLayer({
    id: 'alerts',
    data: alerts.slice(0, 50), // Show recent alerts
    pickable: true,
    opacity: 0.8,
    stroked: true,
    filled: true,
    radiusScale: 1,
    radiusMinPixels: 10,
    radiusMaxPixels: 35,
    lineWidthMinPixels: 2,
    getPosition: d => [d.longitude, d.latitude],
    getRadius: 250,
    getFillColor: d => [...getAlertColor(d.severity), 100],
    getLineColor: d => [...getAlertColor(d.severity), 255],
    onHover: info => {
      if (info.object) {
        setHoverInfo({ ...info, isAlert: true })
      } else if (hoverInfo?.isAlert) {
        setHoverInfo(null)
      }
    },
  }), [alerts, hoverInfo])

  // Vessel name labels for larger zoom levels
  const labelLayer = useMemo(() => {
    if (viewState.zoom < 8) return null

    return new TextLayer({
      id: 'vessel-labels',
      data: vessels.filter(v => v.ship_name),
      pickable: false,
      getPosition: d => [d.longitude, d.latitude],
      getText: d => {
        const flagState = getFlagState(d.mmsi)
        return `${flagState.flag} ${d.ship_name}`
      },
      getSize: 12,
      getColor: [255, 255, 255, 255],
      getTextAnchor: 'start',
      getAlignmentBaseline: 'center',
      getPixelOffset: [14, 0],
      fontFamily: 'Monaco, monospace',
      fontWeight: 'bold',
      outlineWidth: 2,
      outlineColor: [15, 23, 42, 255],
    })
  }, [vessels, viewState.zoom])

  const layers = [
    ...cableZoneLayers,
    cableLabelLayer,
    portsLayer,
    portLabelLayer,
    trailsLayer,
    vesselLayer,
    headingLayer,
    alertLayer,
    labelLayer,
  ].filter(Boolean)

  // Render hover tooltip
  const renderTooltip = () => {
    if (!hoverInfo) return null

    const { x, y, object, isAlert, isVessel, isCableZone, isPort } = hoverInfo

    if (isCableZone) {
      return (
        <div
          className="absolute pointer-events-none z-50"
          style={{ left: x + 15, top: y + 15 }}
        >
          <div className="bg-slate-900/95 backdrop-blur-sm border border-slate-600 rounded-lg p-3 shadow-2xl max-w-xs">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-lg">{getInfrastructureIcon(object.type)}</span>
              <div>
                <div className="font-bold text-white text-sm">{object.name}</div>
                <div className="text-slate-400 text-xs">{object.subtitle}</div>
              </div>
            </div>
            <div className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
              object.severity === 'CRITICAL'
                ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
            }`}>
              {object.severity} INFRASTRUCTURE
            </div>
          </div>
        </div>
      )
    }

    if (isPort) {
      return (
        <div
          className="absolute pointer-events-none z-50"
          style={{ left: x + 15, top: y + 15 }}
        >
          <div className="bg-slate-900/95 backdrop-blur-sm border border-slate-600 rounded-lg p-3 shadow-2xl max-w-xs">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-lg">⚓</span>
              <div className="font-bold text-white text-sm">{object.name}</div>
            </div>
            <div className="text-slate-400 text-xs">{object.country}</div>
            {object.type && (
              <div className="text-slate-500 text-xs mt-1">{object.type}</div>
            )}
          </div>
        </div>
      )
    }

    if (isAlert) {
      return (
        <div
          className="absolute pointer-events-none z-50"
          style={{ left: x + 15, top: y + 15 }}
        >
          <div className="bg-slate-900/95 backdrop-blur-sm border border-slate-600 rounded-lg p-3 shadow-2xl max-w-xs">
            <div className={`font-bold text-sm mb-1 ${
              object.severity === 'CRITICAL' ? 'text-red-400' :
              object.severity === 'HIGH' ? 'text-orange-400' :
              object.severity === 'MEDIUM' ? 'text-amber-400' : 'text-green-400'
            }`}>
              {object.title}
            </div>
            <div className="text-slate-300 text-xs leading-relaxed">
              {object.description?.slice(0, 120)}...
            </div>
          </div>
        </div>
      )
    }

    if (isVessel) {
      const flagState = getFlagState(object.mmsi)
      return (
        <div
          className="absolute pointer-events-none z-50"
          style={{ left: x + 15, top: y + 15 }}
        >
          <div className="bg-slate-900/95 backdrop-blur-sm border border-slate-600 rounded-lg p-3 shadow-2xl min-w-[200px]">
            {/* Header with flag */}
            <div className="flex items-center gap-2 mb-2">
              <span className="text-2xl">{flagState.flag}</span>
              <div className="flex-1">
                <div className="font-bold text-white">
                  {object.ship_name || 'Unknown Vessel'}
                </div>
                <div className="text-slate-400 text-xs flex items-center gap-1">
                  <span>{flagState.name}</span>
                  {flagState.flagged && (
                    <span className="px-1.5 py-0.5 bg-red-500/20 text-red-400 text-[10px] rounded font-medium">
                      MONITORED
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Info grid */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs border-t border-slate-700 pt-2">
              <div className="text-slate-500">MMSI</div>
              <div className="text-slate-200 font-mono">{object.mmsi}</div>

              <div className="text-slate-500">Speed</div>
              <div className="text-slate-200 font-mono">
                {object.speed_over_ground?.toFixed(1) ?? '—'} kts
              </div>

              <div className="text-slate-500">Course</div>
              <div className="text-slate-200 font-mono">
                {object.course_over_ground?.toFixed(0) ?? '—'}°
              </div>

              {object.heading != null && (
                <>
                  <div className="text-slate-500">Heading</div>
                  <div className="text-slate-200 font-mono">{Math.round(object.heading)}°</div>
                </>
              )}
            </div>
          </div>
        </div>
      )
    }

    return null
  }

  return (
    <div className="relative w-full h-full">
      <DeckGL
        viewState={viewState}
        onViewStateChange={({ viewState }) => setViewState(viewState)}
        controller={true}
        layers={layers}
      >
        <MapGL
          mapboxAccessToken={mapboxToken}
          mapStyle="mapbox://styles/mapbox/dark-v11"
          attributionControl={false}
        >
          <NavigationControl position="top-right" />
          <ScaleControl position="bottom-right" unit="nautical" />
        </MapGL>
      </DeckGL>

      {renderTooltip()}

      {/* Map legend */}
      <div className="absolute bottom-20 left-4 z-10">
        <div className="bg-slate-900/90 backdrop-blur-sm border border-slate-700 rounded-lg p-4 shadow-xl">
          {/* Vessel types */}
          <div className="mb-4">
            <div className="font-semibold mb-2 text-slate-300 text-xs uppercase tracking-wider">
              Vessel Types
            </div>
            <div className="space-y-1.5">
              <LegendItem color="rgb(249, 115, 22)" label="Tanker" />
              <LegendItem color="rgb(139, 92, 246)" label="Cargo" />
              <LegendItem color="rgb(34, 197, 94)" label="Fishing" />
              <LegendItem color="rgb(59, 130, 246)" label="Passenger" />
              <LegendItem color="rgb(107, 114, 128)" label="Other" />
              <LegendItem color="rgb(239, 68, 68)" label="Flagged State" isHighlight />
            </div>
          </div>

          {/* Infrastructure */}
          <div className="border-t border-slate-700 pt-3">
            <div className="font-semibold mb-2 text-slate-300 text-xs uppercase tracking-wider">
              Infrastructure
            </div>
            <div className="space-y-1.5">
              <LegendItem color="rgb(59, 130, 246)" label="📡 Telecom Cable" isZone />
              <LegendItem color="rgb(239, 68, 68)" label="🔥 Gas Pipeline" isZone />
              <LegendItem color="rgb(234, 179, 8)" label="⚡ Power Cable" isZone />
            </div>
          </div>
        </div>
      </div>

      {/* Flagged states warning */}
      <div className="absolute top-4 left-4 z-10">
        <div className="bg-red-950/80 backdrop-blur-sm border border-red-800/50 rounded-lg px-3 py-2 shadow-lg">
          <div className="flex items-center gap-2 text-xs">
            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <span className="text-red-200 font-medium">Monitored States:</span>
            <span className="text-red-300">🇷🇺 🇨🇳 🇭🇰 🇮🇷 🇰🇵</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function LegendItem({ color, label, isHighlight, isZone }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      {isZone ? (
        <div
          className="w-4 h-2 rounded-sm border"
          style={{
            backgroundColor: `${color}33`,
            borderColor: color
          }}
        />
      ) : (
        <div
          className={`w-3 h-3 rounded-full ${isHighlight ? 'ring-2 ring-white/30' : ''}`}
          style={{ backgroundColor: color }}
        />
      )}
      <span className="text-slate-400">{label}</span>
    </div>
  )
}
