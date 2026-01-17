import React, { useState, useCallback, useEffect, useRef } from 'react'
import mapboxgl from 'mapbox-gl'
import { Deck } from '@deck.gl/core'
import { ScatterplotLayer, PolygonLayer, TextLayer, PathLayer, IconLayer } from '@deck.gl/layers'
import {
  getVesselColor,
  getAlertColor,
  getFlagState,
  getInfrastructureIcon
} from '../utils/geo'

import 'mapbox-gl/dist/mapbox-gl.css'

// Default map view - centered on Baltic Sea
const INITIAL_VIEW_STATE = {
  longitude: 20,
  latitude: 58,
  zoom: 5,
  pitch: 0,
  bearing: 0,
}

function createArrowIcon(fillColor, strokeColor = 'rgba(255,255,255,0.9)', strokeWidth = 1.5) {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
      <path d="M16 4 L24 26 L16 20 L8 26 Z" fill="${fillColor}" stroke="${strokeColor}" stroke-width="${strokeWidth}" stroke-linejoin="round"/>
    </svg>
  `
  return `data:image/svg+xml;base64,${btoa(svg)}`
}

const VESSEL_ICONS = {
  tanker: createArrowIcon('rgb(249, 115, 22)'),
  cargo: createArrowIcon('rgb(139, 92, 246)'),
  fishing: createArrowIcon('rgb(34, 197, 94)'),
  passenger: createArrowIcon('rgb(59, 130, 246)'),
  special: createArrowIcon('rgb(234, 179, 8)'),
  other: createArrowIcon('rgb(107, 114, 128)'),
  flagged: createArrowIcon('rgb(239, 68, 68)', 'rgba(255,255,255,0.9)', 2),
  selected: createArrowIcon('rgb(255, 255, 255)', 'rgb(59, 130, 246)', 2),
}

function getVesselIconKey(vessel, selectedMmsi) {
  if (selectedMmsi && vessel.mmsi === selectedMmsi) return 'selected'
  const flagState = getFlagState(vessel.mmsi)
  if (flagState.flagged) return 'flagged'
  const shipType = vessel.ship_type
  if (shipType >= 80 && shipType <= 89) return 'tanker'
  if (shipType >= 70 && shipType <= 79) return 'cargo'
  if (shipType >= 30 && shipType <= 37) return 'fishing'
  if (shipType >= 60 && shipType <= 69) return 'passenger'
  if (shipType >= 50 && shipType <= 59) return 'special'
  return 'other'
}

// Build layers outside React to avoid hook issues
function buildLayers(props, currentZoom, hoverInfoRef, setHoverInfo, onVesselClick, onAlertClick) {
  const { vessels, alerts, trails, ports, cables, selectedVessel, showTrails, showPorts, showCables, investigationTrack } = props
  const selectedMmsi = selectedVessel?.mmsi
  const result = []

  // Cable zones
  if (showCables && cables.length > 0) {
    result.push(new PathLayer({
      id: 'cable-zones-glow',
      data: cables.filter(z => z.severity === 'CRITICAL'),
      pickable: false,
      widthUnits: 'pixels',
      getPath: d => d.coordinates,
      getColor: d => [...d.color, 60],
      getWidth: 8,
    }))
    result.push(new PolygonLayer({
      id: 'cable-zones-fill',
      data: cables,
      pickable: true,
      stroked: false,
      filled: true,
      getPolygon: d => d.coordinates,
      getFillColor: d => [...d.color, 40],
      onHover: info => {
        if (info.object) {
          hoverInfoRef.current = { ...info, isCableZone: true }
          setHoverInfo(hoverInfoRef.current)
        } else if (hoverInfoRef.current?.isCableZone) {
          hoverInfoRef.current = null
          setHoverInfo(null)
        }
      },
    }))
    result.push(new PathLayer({
      id: 'cable-zones-border',
      data: cables,
      pickable: false,
      widthUnits: 'pixels',
      getPath: d => d.coordinates,
      getColor: d => [...d.color, 180],
      getWidth: d => d.severity === 'CRITICAL' ? 3 : 2,
    }))
    if (currentZoom >= 6) {
      result.push(new TextLayer({
        id: 'cable-labels',
        data: cables,
        pickable: false,
        getPosition: d => {
          const coords = d.coordinates
          return [coords.reduce((s, c) => s + c[0], 0) / coords.length, coords.reduce((s, c) => s + c[1], 0) / coords.length]
        },
        getText: d => `${getInfrastructureIcon(d.type)} ${d.name}`,
        getSize: 12,
        getColor: d => [...d.color, 255],
        getTextAnchor: 'middle',
        fontFamily: 'Monaco, monospace',
        fontWeight: 'bold',
        outlineWidth: 2,
        outlineColor: [15, 23, 42, 255],
      }))
    }
  }

  // Ports
  if (showPorts && ports.length > 0) {
    result.push(new PolygonLayer({
      id: 'ports',
      data: ports,
      pickable: true,
      stroked: true,
      filled: true,
      getPolygon: d => d.coordinates,
      getFillColor: [100, 149, 237, 40],
      getLineColor: [100, 149, 237, 180],
      getLineWidth: 2,
      lineWidthUnits: 'pixels',
      onHover: info => {
        if (info.object) {
          hoverInfoRef.current = { ...info, isPort: true }
          setHoverInfo(hoverInfoRef.current)
        } else if (hoverInfoRef.current?.isPort) {
          hoverInfoRef.current = null
          setHoverInfo(null)
        }
      },
    }))
    if (currentZoom >= 7) {
      result.push(new TextLayer({
        id: 'port-labels',
        data: ports,
        pickable: false,
        getPosition: d => d.center || d.coordinates[0],
        getText: d => `⚓ ${d.name}`,
        getSize: 11,
        getColor: [100, 149, 237, 255],
        getTextAnchor: 'middle',
        fontFamily: 'Monaco, monospace',
        fontWeight: 'bold',
        outlineWidth: 2,
        outlineColor: [15, 23, 42, 255],
      }))
    }
  }

  // Trails
  if (showTrails && trails.length > 0) {
    result.push(new PathLayer({
      id: 'vessel-trails',
      data: trails,
      pickable: false,
      widthUnits: 'pixels',
      widthMinPixels: 1,
      widthMaxPixels: 3,
      capRounded: true,
      jointRounded: true,
      getPath: d => d.coordinates,
      getColor: d => [...getVesselColor(d.ship_type || 0), 120],
      getWidth: 2,
    }))
  }

  // Investigation track
  if (investigationTrack) {
    result.push(new PathLayer({
      id: 'investigation-track-glow',
      data: [{ path: investigationTrack.coordinates }],
      pickable: false,
      widthUnits: 'pixels',
      getPath: d => d.path,
      getColor: [236, 72, 153, 60],
      getWidth: 12,
    }))
    result.push(new PathLayer({
      id: 'investigation-track-line',
      data: [{ path: investigationTrack.coordinates }],
      pickable: false,
      widthUnits: 'pixels',
      widthMinPixels: 3,
      capRounded: true,
      jointRounded: true,
      getPath: d => d.path,
      getColor: [236, 72, 153, 200],
      getWidth: 4,
    }))
    const getWpColor = wp => {
      if (wp.alert?.includes('ANCHOR')) return [239, 68, 68, 255]
      if (wp.alert?.includes('CRITICAL') || wp.alert?.includes('DAMAGE')) return [249, 115, 22, 255]
      if (wp.alert) return [234, 179, 8, 255]
      if (wp.speed < 4) return [239, 68, 68, 255]
      if (wp.speed < 8) return [234, 179, 8, 255]
      return [34, 197, 94, 255]
    }
    result.push(new ScatterplotLayer({
      id: 'investigation-waypoints',
      data: investigationTrack.waypoints,
      pickable: true,
      stroked: true,
      filled: true,
      radiusMinPixels: 5,
      radiusMaxPixels: 12,
      lineWidthMinPixels: 2,
      getPosition: d => [d.lon, d.lat],
      getRadius: d => d.alert ? 8 : 5,
      getFillColor: d => getWpColor(d),
      getLineColor: [255, 255, 255, 200],
      onHover: info => {
        if (info.object) {
          hoverInfoRef.current = { ...info, isInvestigationWaypoint: true }
          setHoverInfo(hoverInfoRef.current)
        } else if (hoverInfoRef.current?.isInvestigationWaypoint) {
          hoverInfoRef.current = null
          setHoverInfo(null)
        }
      },
    }))
  }

  // Alerts
  const regularAlerts = alerts.filter(a => !(a.alert_type === 'SANCTIONS_MATCH' && a.details?.persistent && a.details?.exact_match)).slice(0, 50)
  if (regularAlerts.length > 0) {
    result.push(new ScatterplotLayer({
      id: 'alerts',
      data: regularAlerts,
      pickable: true,
      opacity: 0.8,
      stroked: true,
      filled: true,
      radiusMinPixels: 10,
      radiusMaxPixels: 35,
      lineWidthMinPixels: 2,
      getPosition: d => [d.longitude, d.latitude],
      getRadius: 250,
      getFillColor: d => [...getAlertColor(d.severity), 100],
      getLineColor: d => [...getAlertColor(d.severity), 255],
      onHover: info => {
        if (info.object) {
          hoverInfoRef.current = { ...info, isAlert: true }
          setHoverInfo(hoverInfoRef.current)
        } else if (hoverInfoRef.current?.isAlert) {
          hoverInfoRef.current = null
          setHoverInfo(null)
        }
      },
      onClick: info => info.object && onAlertClick?.(info.object),
    }))
  }

  // Vessels
  if (vessels.length > 0) {
    result.push(new IconLayer({
      id: 'vessels',
      data: vessels,
      pickable: true,
      getPosition: d => [d.longitude, d.latitude],
      getIcon: d => ({
        url: VESSEL_ICONS[getVesselIconKey(d, selectedMmsi)],
        width: 32,
        height: 32,
        anchorY: 16,
        anchorX: 16,
      }),
      getSize: d => {
        if (selectedMmsi && d.mmsi === selectedMmsi) return 28
        if (getFlagState(d.mmsi).flagged) return 24
        return 20
      },
      getAngle: d => 360 - (d.heading ?? d.course_over_ground ?? 0),
      sizeUnits: 'pixels',
      sizeMinPixels: 12,
      sizeMaxPixels: 36,
      onHover: info => {
        if (info.object) {
          hoverInfoRef.current = { ...info, isVessel: true }
          setHoverInfo(hoverInfoRef.current)
        } else if (hoverInfoRef.current?.isVessel) {
          hoverInfoRef.current = null
          setHoverInfo(null)
        }
      },
      onClick: info => info.object && onVesselClick?.(info.object),
      updateTriggers: {
        getIcon: [selectedMmsi],
        getSize: [selectedMmsi],
      },
    }))
  }

  // Persistent alerts
  const persistentAlerts = alerts.filter(a => a.alert_type === 'SANCTIONS_MATCH' && a.details?.persistent && a.details?.exact_match)
  if (persistentAlerts.length > 0) {
    const vesselMap = new Map(vessels.map(v => [v.mmsi, v]))
    const alertsWithPos = persistentAlerts.map(a => {
      const v = vesselMap.get(a.mmsi)
      return v ? { ...a, longitude: v.longitude, latitude: v.latitude } : a
    })
    result.push(new ScatterplotLayer({
      id: 'persistent-alerts',
      data: alertsWithPos,
      pickable: true,
      stroked: true,
      filled: true,
      radiusMinPixels: 14,
      radiusMaxPixels: 40,
      lineWidthMinPixels: 3,
      getPosition: d => [d.longitude, d.latitude],
      getRadius: 300,
      getFillColor: [220, 38, 38, 150],
      getLineColor: [220, 38, 38, 255],
      onHover: info => {
        if (info.object) {
          hoverInfoRef.current = { ...info, isAlert: true, isPersistent: true }
          setHoverInfo(hoverInfoRef.current)
        } else if (hoverInfoRef.current?.isAlert) {
          hoverInfoRef.current = null
          setHoverInfo(null)
        }
      },
      onClick: info => info.object && onAlertClick?.(info.object),
    }))
  }

  // Vessel labels
  if (currentZoom >= 8) {
    const labeled = vessels.filter(v => v.ship_name)
    if (labeled.length > 0) {
      result.push(new TextLayer({
        id: 'vessel-labels',
        data: labeled,
        pickable: false,
        getPosition: d => [d.longitude, d.latitude],
        getText: d => `${getFlagState(d.mmsi).flag} ${d.ship_name}`,
        getSize: 12,
        getColor: [255, 255, 255, 255],
        getTextAnchor: 'start',
        getPixelOffset: [14, 0],
        fontFamily: 'Arial, sans-serif',
        fontWeight: 'bold',
        outlineWidth: 2,
        outlineColor: [15, 23, 42, 255],
      }))
    }
  }

  return result
}

export default function Map({
  vessels = [],
  alerts = [],
  trails = [],
  ports = [],
  cables = [],
  selectedVessel,
  onVesselClick,
  onAlertClick,
  mapboxToken,
  showTrails = true,
  showPorts = true,
  showCables = true,
  flyTo = null,
  investigationTrack = null,
}) {
  // All hooks at top level - NEVER conditional
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const deckRef = useRef(null)
  const hoverInfoRef = useRef(null)
  const zoomRef = useRef(INITIAL_VIEW_STATE.zoom)
  const [hoverInfo, setHoverInfo] = useState(null)

  // Initialize map and deck once
  useEffect(() => {
    if (!containerRef.current || !mapboxToken) return

    mapboxgl.accessToken = mapboxToken
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [INITIAL_VIEW_STATE.longitude, INITIAL_VIEW_STATE.latitude],
      zoom: INITIAL_VIEW_STATE.zoom,
      pitch: INITIAL_VIEW_STATE.pitch,
      bearing: INITIAL_VIEW_STATE.bearing,
      attributionControl: false,
    })

    map.addControl(new mapboxgl.NavigationControl(), 'top-right')
    map.addControl(new mapboxgl.ScaleControl({ unit: 'nautical' }), 'bottom-right')

    const deck = new Deck({
      parent: containerRef.current,
      style: { position: 'absolute', top: 0, left: 0, zIndex: 1 },
      initialViewState: INITIAL_VIEW_STATE,
      controller: true,
      onViewStateChange: ({ viewState }) => {
        zoomRef.current = viewState.zoom
        map.jumpTo({
          center: [viewState.longitude, viewState.latitude],
          zoom: viewState.zoom,
          pitch: viewState.pitch,
          bearing: viewState.bearing,
        })
      },
      layers: [],
    })

    mapRef.current = map
    deckRef.current = deck

    return () => {
      deck.finalize()
      map.remove()
      mapRef.current = null
      deckRef.current = null
    }
  }, [mapboxToken])

  // Handle flyTo
  useEffect(() => {
    if (flyTo?.latitude && flyTo?.longitude && mapRef.current) {
      mapRef.current.flyTo({
        center: [flyTo.longitude, flyTo.latitude],
        zoom: flyTo.zoom || 10,
        duration: 1000,
      })
    }
  }, [flyTo])

  // Update layers when data changes - NOT using useMemo to avoid hook count issues
  useEffect(() => {
    if (!deckRef.current) return

    const layers = buildLayers(
      { vessels, alerts, trails, ports, cables, selectedVessel, showTrails, showPorts, showCables, investigationTrack },
      zoomRef.current,
      hoverInfoRef,
      setHoverInfo,
      onVesselClick,
      onAlertClick
    )
    deckRef.current.setProps({ layers })
  }, [vessels, alerts, trails, ports, cables, selectedVessel, showTrails, showPorts, showCables, investigationTrack, onVesselClick, onAlertClick])

  // Render tooltip based on hover state
  const tooltip = hoverInfo ? renderTooltip(hoverInfo) : null

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="absolute inset-0" />
      {tooltip}
      <Legend />
      <FlaggedStatesWarning />
    </div>
  )
}

function renderTooltip(info) {
  const { x, y, object, isAlert, isVessel, isCableZone, isPort, isInvestigationWaypoint } = info

  if (isCableZone) {
    return (
      <div className="absolute pointer-events-none z-50" style={{ left: x + 15, top: y + 15 }}>
        <div className="bg-slate-900/95 backdrop-blur-sm border border-slate-600 rounded-lg p-3 shadow-2xl max-w-xs">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-lg">{getInfrastructureIcon(object.type)}</span>
            <div>
              <div className="font-bold text-white text-sm">{object.name}</div>
              <div className="text-slate-400 text-xs">{object.subtitle}</div>
            </div>
          </div>
          <div className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${object.severity === 'CRITICAL' ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'}`}>
            {object.severity} INFRASTRUCTURE
          </div>
        </div>
      </div>
    )
  }

  if (isPort) {
    return (
      <div className="absolute pointer-events-none z-50" style={{ left: x + 15, top: y + 15 }}>
        <div className="bg-slate-900/95 backdrop-blur-sm border border-slate-600 rounded-lg p-3 shadow-2xl max-w-xs">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg">⚓</span>
            <div className="font-bold text-white text-sm">{object.name}</div>
          </div>
          <div className="text-slate-400 text-xs">{object.country}</div>
        </div>
      </div>
    )
  }

  if (isAlert) {
    return (
      <div className="absolute pointer-events-none z-50" style={{ left: x + 15, top: y + 15 }}>
        <div className="bg-slate-900/95 backdrop-blur-sm border border-slate-600 rounded-lg p-3 shadow-2xl max-w-xs">
          <div className={`font-bold text-sm mb-1 ${object.severity === 'CRITICAL' ? 'text-red-400' : object.severity === 'HIGH' ? 'text-orange-400' : object.severity === 'MEDIUM' ? 'text-amber-400' : 'text-green-400'}`}>
            {object.title}
          </div>
          <div className="text-slate-300 text-xs leading-relaxed">{object.description?.slice(0, 120)}...</div>
        </div>
      </div>
    )
  }

  if (isInvestigationWaypoint) {
    return (
      <div className="absolute pointer-events-none z-50" style={{ left: x + 15, top: y + 15 }}>
        <div className="bg-slate-900/95 backdrop-blur-sm border border-pink-600/50 rounded-lg p-3 shadow-2xl min-w-[220px]">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-lg">🔍</span>
            <div>
              <div className="font-bold text-pink-400 text-sm">FITBURG Investigation</div>
              <div className="text-slate-400 text-xs">{new Date(object.timestamp).toLocaleString()}</div>
            </div>
          </div>
          <div className="text-slate-300 text-xs mb-2">{object.location}</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs border-t border-slate-700 pt-2">
            <div className="text-slate-500">Speed</div>
            <div className="font-mono text-slate-200">{object.speed} kts</div>
            <div className="text-slate-500">Status</div>
            <div className="text-slate-200">{object.status}</div>
          </div>
          {object.alert && <div className="mt-2 px-2 py-1 rounded text-xs font-medium bg-orange-500/20 text-orange-400 border border-orange-500/30">{object.alert.replace(/_/g, ' ')}</div>}
        </div>
      </div>
    )
  }

  if (isVessel) {
    const flagState = getFlagState(object.mmsi)
    return (
      <div className="absolute pointer-events-none z-50" style={{ left: x + 15, top: y + 15 }}>
        <div className="bg-slate-900/95 backdrop-blur-sm border border-slate-600 rounded-lg p-3 shadow-2xl min-w-[200px]">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-2xl">{flagState.flag}</span>
            <div className="flex-1">
              <div className="font-bold text-white">{object.ship_name || 'Unknown Vessel'}</div>
              <div className="text-slate-400 text-xs flex items-center gap-1">
                <span>{flagState.name}</span>
                {flagState.flagged && <span className="px-1.5 py-0.5 bg-red-500/20 text-red-400 text-[10px] rounded font-medium">MONITORED</span>}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs border-t border-slate-700 pt-2">
            <div className="text-slate-500">MMSI</div>
            <div className="text-slate-200 font-mono">{object.mmsi}</div>
            <div className="text-slate-500">Speed</div>
            <div className="text-slate-200 font-mono">{object.speed_over_ground?.toFixed(1) ?? '—'} kts</div>
            <div className="text-slate-500">Course</div>
            <div className="text-slate-200 font-mono">{object.course_over_ground?.toFixed(0) ?? '—'}°</div>
          </div>
        </div>
      </div>
    )
  }

  return null
}

function Legend() {
  return (
    <div className="absolute bottom-20 left-4 z-10">
      <div className="bg-slate-900/90 backdrop-blur-sm border border-slate-700 rounded-lg p-4 shadow-xl">
        <div className="mb-4">
          <div className="font-semibold mb-2 text-slate-300 text-xs uppercase tracking-wider">Vessel Types</div>
          <div className="space-y-1.5">
            <LegendItem color="rgb(249, 115, 22)" label="Tanker" />
            <LegendItem color="rgb(139, 92, 246)" label="Cargo" />
            <LegendItem color="rgb(34, 197, 94)" label="Fishing" />
            <LegendItem color="rgb(59, 130, 246)" label="Passenger" />
            <LegendItem color="rgb(107, 114, 128)" label="Other" />
            <LegendItem color="rgb(239, 68, 68)" label="Flagged State" isHighlight />
          </div>
        </div>
        <div className="border-t border-slate-700 pt-3">
          <div className="font-semibold mb-2 text-slate-300 text-xs uppercase tracking-wider">Infrastructure</div>
          <div className="space-y-1.5">
            <LegendItem color="rgb(59, 130, 246)" label="📡 Telecom Cable" isZone />
            <LegendItem color="rgb(239, 68, 68)" label="🔥 Gas Pipeline" isZone />
            <LegendItem color="rgb(234, 179, 8)" label="⚡ Power Cable" isZone />
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
        <div className="w-4 h-2 rounded-sm border" style={{ backgroundColor: `${color}33`, borderColor: color }} />
      ) : (
        <div className={`w-3 h-3 rounded-full ${isHighlight ? 'ring-2 ring-white/30' : ''}`} style={{ backgroundColor: color }} />
      )}
      <span className="text-slate-400">{label}</span>
    </div>
  )
}

function FlaggedStatesWarning() {
  return (
    <div className="absolute top-4 left-4 z-10">
      <div className="bg-red-950/80 backdrop-blur-sm border border-red-800/50 rounded-lg px-3 py-2 shadow-lg">
        <div className="flex items-center gap-2 text-xs">
          <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          <span className="text-red-200 font-medium">Monitored States:</span>
          <span className="text-red-300">🇷🇺 🇨🇳 🇭🇰 🇮🇷 🇰🇵</span>
        </div>
      </div>
    </div>
  )
}
