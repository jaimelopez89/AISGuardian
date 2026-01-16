import React, { useState, useCallback, useMemo, useEffect } from 'react'
import MapGL, { NavigationControl, ScaleControl } from 'react-map-gl'
import DeckGL from '@deck.gl/react'
import { ScatterplotLayer, PolygonLayer, TextLayer, PathLayer, IconLayer } from '@deck.gl/layers'
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
  onAlertClick,  // New prop for alert click handling
  mapboxToken,
  showTrails = true,
  showPorts = true,
  showCables = true,
  flyTo = null,  // { latitude, longitude, zoom? } - fly to this location
  investigationTrack = null,  // Historical track for investigation mode
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

  // Create arrow icon data URL with specified color
  const createArrowIcon = useCallback((fillColor, strokeColor = 'rgba(255,255,255,0.9)', strokeWidth = 1.5) => {
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
        <path d="M16 4 L24 26 L16 20 L8 26 Z" fill="${fillColor}" stroke="${strokeColor}" stroke-width="${strokeWidth}" stroke-linejoin="round"/>
      </svg>
    `
    return `data:image/svg+xml;base64,${btoa(svg)}`
  }, [])

  // Pre-generate icon URLs for different vessel states
  const vesselIconAtlas = useMemo(() => {
    const icons = {}
    // Standard vessel type colors
    const types = [
      { key: 'tanker', color: 'rgb(249, 115, 22)' },
      { key: 'cargo', color: 'rgb(139, 92, 246)' },
      { key: 'fishing', color: 'rgb(34, 197, 94)' },
      { key: 'passenger', color: 'rgb(59, 130, 246)' },
      { key: 'special', color: 'rgb(234, 179, 8)' },
      { key: 'other', color: 'rgb(107, 114, 128)' },
      { key: 'flagged', color: 'rgb(239, 68, 68)' },
      { key: 'selected', color: 'rgb(255, 255, 255)' },
    ]
    types.forEach(t => {
      const stroke = t.key === 'selected' ? 'rgb(59, 130, 246)' : 'rgba(255,255,255,0.9)'
      const strokeWidth = t.key === 'selected' || t.key === 'flagged' ? 2 : 1.5
      icons[t.key] = createArrowIcon(t.color, stroke, strokeWidth)
    })
    return icons
  }, [createArrowIcon])

  // Get icon key for vessel
  const getVesselIconKey = useCallback((vessel) => {
    if (selectedVessel && vessel.mmsi === selectedVessel.mmsi) return 'selected'
    const flagState = getFlagState(vessel.mmsi)
    if (flagState.flagged) return 'flagged'

    const shipType = vessel.ship_type
    if (shipType >= 80 && shipType <= 89) return 'tanker'
    if (shipType >= 70 && shipType <= 79) return 'cargo'
    if (shipType >= 30 && shipType <= 37) return 'fishing'
    if (shipType >= 60 && shipType <= 69) return 'passenger'
    if (shipType >= 50 && shipType <= 59) return 'special'
    return 'other'
  }, [selectedVessel])

  // Vessel layer - arrow icons showing heading direction
  const vesselLayer = useMemo(() => new IconLayer({
    id: 'vessels',
    data: vessels,
    pickable: true,
    getPosition: d => [d.longitude, d.latitude],
    getIcon: d => ({
      url: vesselIconAtlas[getVesselIconKey(d)],
      width: 32,
      height: 32,
      anchorY: 16,
      anchorX: 16,
    }),
    getSize: d => {
      if (selectedVessel && d.mmsi === selectedVessel.mmsi) return 28
      const flagState = getFlagState(d.mmsi)
      if (flagState.flagged) return 24
      return 20
    },
    getAngle: d => {
      // Rotate arrow to point in direction of travel
      const heading = d.heading ?? d.course_over_ground ?? 0
      return 360 - heading // Invert for correct rotation
    },
    sizeScale: 1,
    sizeUnits: 'pixels',
    sizeMinPixels: 12,
    sizeMaxPixels: 36,
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
      getIcon: [selectedVessel?.mmsi],
      getSize: [selectedVessel?.mmsi],
    },
  }), [vessels, selectedVessel, onVesselClick, hoverInfo, vesselIconAtlas, getVesselIconKey])


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

  // Investigation track layers - shows historical track with waypoints
  const investigationLayers = useMemo(() => {
    if (!investigationTrack) return []

    const layers = []

    // Track line - gradient from green (normal speed) to red (slow/alert)
    const trackLine = new PathLayer({
      id: 'investigation-track-line',
      data: [{
        path: investigationTrack.coordinates,
      }],
      pickable: false,
      widthUnits: 'pixels',
      widthScale: 1,
      widthMinPixels: 3,
      widthMaxPixels: 6,
      capRounded: true,
      jointRounded: true,
      getPath: d => d.path,
      getColor: [236, 72, 153, 200], // Pink for investigation
      getWidth: 4,
    })
    layers.push(trackLine)

    // Outer glow for track
    const trackGlow = new PathLayer({
      id: 'investigation-track-glow',
      data: [{
        path: investigationTrack.coordinates,
      }],
      pickable: false,
      widthUnits: 'pixels',
      getPath: d => d.path,
      getColor: [236, 72, 153, 60], // Pink glow
      getWidth: 12,
    })
    layers.push(trackGlow)

    // Waypoint markers - colored by status/alert
    const getWaypointColor = (wp) => {
      if (wp.alert === 'ANCHOR_DRAG_SUSPECTED' || wp.alert === 'ANCHOR_DRAG') {
        return [239, 68, 68, 255] // Red for anchor drag
      }
      if (wp.alert === 'CABLE_PROXIMITY_CRITICAL' || wp.alert === 'CABLE_DAMAGE_LIKELY') {
        return [249, 115, 22, 255] // Orange for cable critical
      }
      if (wp.alert === 'CABLE_PROXIMITY') {
        return [234, 179, 8, 255] // Yellow for cable proximity
      }
      if (wp.speed < 4) {
        return [239, 68, 68, 255] // Red for slow/stopped
      }
      if (wp.speed < 8) {
        return [234, 179, 8, 255] // Yellow for slowing
      }
      return [34, 197, 94, 255] // Green for normal speed
    }

    const waypointMarkers = new ScatterplotLayer({
      id: 'investigation-waypoints',
      data: investigationTrack.waypoints,
      pickable: true,
      opacity: 1,
      stroked: true,
      filled: true,
      radiusScale: 1,
      radiusMinPixels: 5,
      radiusMaxPixels: 12,
      lineWidthMinPixels: 2,
      getPosition: d => [d.lon, d.lat],
      getRadius: d => d.alert ? 8 : 5,
      getFillColor: d => getWaypointColor(d),
      getLineColor: [255, 255, 255, 200],
      onHover: info => {
        if (info.object) {
          setHoverInfo({ ...info, isInvestigationWaypoint: true })
        } else if (hoverInfo?.isInvestigationWaypoint) {
          setHoverInfo(null)
        }
      },
    })
    layers.push(waypointMarkers)

    // Alert waypoint labels (only at higher zoom)
    if (viewState.zoom >= 7) {
      const alertWaypoints = investigationTrack.waypoints.filter(wp => wp.alert)
      const waypointLabels = new TextLayer({
        id: 'investigation-waypoint-labels',
        data: alertWaypoints,
        pickable: false,
        getPosition: d => [d.lon, d.lat],
        getText: d => d.alert.replace(/_/g, ' '),
        getSize: 10,
        getColor: [255, 255, 255, 255],
        getTextAnchor: 'start',
        getAlignmentBaseline: 'center',
        getPixelOffset: [12, 0],
        fontFamily: 'Monaco, monospace',
        fontWeight: 'bold',
        outlineWidth: 2,
        outlineColor: [15, 23, 42, 255],
      })
      layers.push(waypointLabels)
    }

    return layers
  }, [investigationTrack, viewState.zoom, hoverInfo])

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
    onClick: info => {
      if (info.object && onAlertClick) {
        // onAlertClick (handleAlertClick) already handles setting both alert and vessel
        onAlertClick(info.object)
      }
    },
  }), [alerts, hoverInfo, onAlertClick])

  // Vessel name labels for larger zoom levels
  const labelLayer = useMemo(() => {
    if (viewState.zoom < 8) return null

    // Create a simple data fingerprint for updateTriggers
    const dataFingerprint = vessels.length > 0
      ? `${vessels.length}-${vessels[0]?.mmsi}-${vessels[vessels.length - 1]?.mmsi}`
      : 'empty'

    return new TextLayer({
      id: 'vessel-labels',
      data: vessels,
      pickable: false,
      getPosition: d => [d.longitude, d.latitude],
      getText: d => {
        const flagState = getFlagState(d.mmsi)
        return `${flagState.flag} ${d.ship_name || 'Unknown'}`
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
      updateTriggers: {
        getText: dataFingerprint,
        getPosition: dataFingerprint,
      },
    })
  }, [vessels, viewState.zoom])

  const layers = [
    ...cableZoneLayers,
    cableLabelLayer,
    portsLayer,
    portLabelLayer,
    trailsLayer,
    ...investigationLayers,  // Investigation track below alerts
    alertLayer,      // Alert circles below vessels
    vesselLayer,     // Vessel icons on top - get click priority
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

    // Investigation waypoint tooltip
    if (hoverInfo.isInvestigationWaypoint) {
      const time = new Date(object.timestamp).toLocaleString()
      const alertClass = object.alert
        ? (object.alert.includes('ANCHOR') ? 'text-red-400' : 'text-orange-400')
        : (object.speed < 4 ? 'text-red-400' : object.speed < 8 ? 'text-amber-400' : 'text-green-400')
      return (
        <div
          className="absolute pointer-events-none z-50"
          style={{ left: x + 15, top: y + 15 }}
        >
          <div className="bg-slate-900/95 backdrop-blur-sm border border-pink-600/50 rounded-lg p-3 shadow-2xl min-w-[220px]">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-lg">🔍</span>
              <div>
                <div className="font-bold text-pink-400 text-sm">FITBURG Investigation</div>
                <div className="text-slate-400 text-xs">{time}</div>
              </div>
            </div>

            <div className="text-slate-300 text-xs mb-2">{object.location}</div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs border-t border-slate-700 pt-2">
              <div className="text-slate-500">Speed</div>
              <div className={`font-mono ${alertClass}`}>{object.speed} kts</div>

              <div className="text-slate-500">Position</div>
              <div className="text-slate-200 font-mono text-[10px]">
                {object.lat.toFixed(4)}°N, {object.lon.toFixed(4)}°E
              </div>

              <div className="text-slate-500">Status</div>
              <div className="text-slate-200">{object.status}</div>
            </div>

            {object.alert && (
              <div className={`mt-2 px-2 py-1 rounded text-xs font-medium ${
                object.alert.includes('ANCHOR')
                  ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                  : 'bg-orange-500/20 text-orange-400 border border-orange-500/30'
              }`}>
                {object.alert.replace(/_/g, ' ')}
              </div>
            )}
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
        onHover={(info) => {
          // Clear tooltip when hovering over empty space (no object picked)
          if (!info.object && hoverInfo) {
            setHoverInfo(null)
          }
        }}
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
