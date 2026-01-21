import React, { useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import { getFlagState, getInfrastructureIcon } from '../utils/geo'

import 'mapbox-gl/dist/mapbox-gl.css'

const INITIAL_VIEW = { lng: 20, lat: 58, zoom: 5 }

// Vessel type to color mapping
function getVesselColor(shipType) {
  if (shipType >= 80 && shipType <= 89) return '#f97316' // tanker - orange
  if (shipType >= 70 && shipType <= 79) return '#8b5cf6' // cargo - purple
  if (shipType >= 30 && shipType <= 37) return '#22c55e' // fishing - green
  if (shipType >= 60 && shipType <= 69) return '#3b82f6' // passenger - blue
  if (shipType >= 50 && shipType <= 59) return '#eab308' // special - yellow
  return '#6b7280' // other - gray
}

function getAlertColor(severity) {
  if (severity === 'CRITICAL') return '#ef4444'
  if (severity === 'HIGH') return '#f97316'
  if (severity === 'MEDIUM') return '#eab308'
  return '#22c55e'
}

// Get ship icon name based on type and state
function getShipIcon(shipType, flagged, selected) {
  if (selected) return 'ship-selected'
  if (flagged) return 'ship-flagged'
  if (shipType >= 80 && shipType <= 89) return 'ship-tanker'
  if (shipType >= 70 && shipType <= 79) return 'ship-cargo'
  if (shipType >= 30 && shipType <= 37) return 'ship-fishing'
  if (shipType >= 60 && shipType <= 69) return 'ship-passenger'
  if (shipType >= 50 && shipType <= 59) return 'ship-special'
  return 'ship-other'
}

// Create ship icon as ImageData for Mapbox
function createShipIcon(color, size = 20) {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')

  // Draw ship shape (pointed triangle facing up)
  ctx.beginPath()
  ctx.moveTo(size / 2, 1)           // Top point (bow)
  ctx.lineTo(size - 2, size - 3)    // Bottom right
  ctx.lineTo(size / 2, size - 6)    // Bottom center indent
  ctx.lineTo(2, size - 3)           // Bottom left
  ctx.closePath()

  ctx.fillStyle = color
  ctx.fill()
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 1
  ctx.stroke()

  const imageData = ctx.getImageData(0, 0, size, size)
  return { width: size, height: size, data: imageData.data }
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
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const onVesselClickRef = useRef(onVesselClick)
  const onAlertClickRef = useRef(onAlertClick)
  const [mapLoaded, setMapLoaded] = useState(false)
  const [hoverInfo, setHoverInfo] = useState(null)

  // Keep callback refs updated
  useEffect(() => { onVesselClickRef.current = onVesselClick }, [onVesselClick])
  useEffect(() => { onAlertClickRef.current = onAlertClick }, [onAlertClick])

  // Initialize map once - NO callback dependencies to prevent reload
  useEffect(() => {
    if (!containerRef.current || !mapboxToken) return
    if (mapRef.current) return // Already initialized

    mapboxgl.accessToken = mapboxToken
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [INITIAL_VIEW.lng, INITIAL_VIEW.lat],
      zoom: INITIAL_VIEW.zoom,
      attributionControl: false,
    })

    map.addControl(new mapboxgl.NavigationControl(), 'top-right')
    map.addControl(new mapboxgl.ScaleControl({ unit: 'nautical' }), 'bottom-right')

    map.on('load', () => {
      // Add ship icons for each vessel type color
      const shipColors = {
        'ship-tanker': '#f97316',
        'ship-cargo': '#8b5cf6',
        'ship-fishing': '#22c55e',
        'ship-passenger': '#3b82f6',
        'ship-special': '#eab308',
        'ship-other': '#6b7280',
        'ship-flagged': '#ef4444',
        'ship-selected': '#3b82f6',
      }
      Object.entries(shipColors).forEach(([name, color]) => {
        map.addImage(name, createShipIcon(color, 20))
      })

      // Add empty sources
      map.addSource('vessels', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addSource('alerts', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addSource('trails', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addSource('cables', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addSource('ports', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addSource('investigation-track', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addSource('investigation-waypoints', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })

      // Cable zones - fill
      map.addLayer({
        id: 'cables-fill',
        type: 'fill',
        source: 'cables',
        paint: {
          'fill-color': ['get', 'color'],
          'fill-opacity': 0.15,
        },
      })

      // Cable zones - outline
      map.addLayer({
        id: 'cables-line',
        type: 'line',
        source: 'cables',
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 2,
          'line-opacity': 0.7,
        },
      })

      // Ports - fill
      map.addLayer({
        id: 'ports-fill',
        type: 'fill',
        source: 'ports',
        paint: {
          'fill-color': '#6495ed',
          'fill-opacity': 0.15,
        },
      })

      // Trails
      map.addLayer({
        id: 'trails-line',
        type: 'line',
        source: 'trails',
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 2,
          'line-opacity': 0.5,
        },
      })

      // Investigation track line (FITBURG)
      map.addLayer({
        id: 'investigation-track-line',
        type: 'line',
        source: 'investigation-track',
        paint: {
          'line-color': '#ec4899',
          'line-width': 3,
          'line-opacity': 0.8,
        },
      })

      // Investigation waypoints - circles with color based on status
      map.addLayer({
        id: 'investigation-waypoints-circle',
        type: 'circle',
        source: 'investigation-waypoints',
        paint: {
          'circle-radius': ['case', ['==', ['get', 'hasAlert'], 1], 10, 6],
          'circle-color': ['get', 'color'],
          'circle-stroke-width': 2,
          'circle-stroke-color': ['case', ['==', ['get', 'hasAlert'], 1], '#ef4444', '#ffffff'],
        },
      })

      // Investigation waypoint labels
      map.addLayer({
        id: 'investigation-waypoints-label',
        type: 'symbol',
        source: 'investigation-waypoints',
        layout: {
          'text-field': ['get', 'label'],
          'text-size': 10,
          'text-offset': [0, -1.5],
          'text-anchor': 'bottom',
          'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
        },
        paint: {
          'text-color': '#ec4899',
          'text-halo-color': '#0f172a',
          'text-halo-width': 1,
        },
      })

      // Alerts - circles
      map.addLayer({
        id: 'alerts-circle',
        type: 'circle',
        source: 'alerts',
        paint: {
          'circle-radius': 12,
          'circle-color': ['get', 'color'],
          'circle-opacity': 0.6,
          'circle-stroke-width': 2,
          'circle-stroke-color': ['get', 'color'],
        },
      })

      // Vessels - ship icons with rotation based on heading
      map.addLayer({
        id: 'vessels-symbol',
        type: 'symbol',
        source: 'vessels',
        layout: {
          'icon-image': ['get', 'icon'],
          'icon-size': ['case', ['==', ['get', 'selected'], 1], 1.3, ['==', ['get', 'flagged'], 1], 1.1, 0.9],
          'icon-rotate': ['get', 'heading'],
          'icon-rotation-alignment': 'map',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
      })

      // Vessel labels at high zoom (no emoji - causes glyph > 65535 error)
      map.addLayer({
        id: 'vessels-label',
        type: 'symbol',
        source: 'vessels',
        minzoom: 8,
        layout: {
          'text-field': ['get', 'name'],
          'text-size': 11,
          'text-offset': [1.5, 0],
          'text-anchor': 'left',
          'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
        },
        paint: {
          'text-color': '#ffffff',
          'text-halo-color': '#0f172a',
          'text-halo-width': 1,
        },
      })

      // Click handlers - use refs to get latest callbacks
      map.on('click', 'vessels-symbol', (e) => {
        if (e.features?.[0]?.properties && onVesselClickRef.current) {
          const props = e.features[0].properties
          onVesselClickRef.current({
            mmsi: props.mmsi,
            ship_name: props.name,
            ship_type: props.shipType,
            speed_over_ground: props.speed,
            course_over_ground: props.course,
            heading: props.heading,
            latitude: e.lngLat.lat,
            longitude: e.lngLat.lng,
          })
        }
      })

      map.on('click', 'alerts-circle', (e) => {
        if (e.features?.[0]?.properties && onAlertClickRef.current) {
          const props = e.features[0].properties
          onAlertClickRef.current({
            id: props.id,
            mmsi: props.mmsi,
            title: props.title,
            severity: props.severity,
            alert_type: props.alertType,
            latitude: e.lngLat.lat,
            longitude: e.lngLat.lng,
          })
        }
      })

      // Hover handlers
      map.on('mouseenter', 'vessels-symbol', (e) => {
        map.getCanvas().style.cursor = 'pointer'
        if (e.features?.[0]) {
          const props = e.features[0].properties
          setHoverInfo({
            x: e.point.x,
            y: e.point.y,
            type: 'vessel',
            data: { ...props, lat: e.lngLat.lat, lng: e.lngLat.lng },
          })
        }
      })

      map.on('mouseleave', 'vessels-symbol', () => {
        map.getCanvas().style.cursor = ''
        setHoverInfo(null)
      })

      map.on('mouseenter', 'alerts-circle', (e) => {
        map.getCanvas().style.cursor = 'pointer'
        if (e.features?.[0]) {
          setHoverInfo({
            x: e.point.x,
            y: e.point.y,
            type: 'alert',
            data: e.features[0].properties,
          })
        }
      })

      map.on('mouseleave', 'alerts-circle', () => {
        map.getCanvas().style.cursor = ''
        setHoverInfo(null)
      })

      map.on('mouseenter', 'cables-fill', (e) => {
        if (e.features?.[0]) {
          setHoverInfo({
            x: e.point.x,
            y: e.point.y,
            type: 'cable',
            data: e.features[0].properties,
          })
        }
      })

      map.on('mouseleave', 'cables-fill', () => {
        setHoverInfo(null)
      })

      mapRef.current = map
      setMapLoaded(true)
    })

    return () => {
      map.remove()
      mapRef.current = null
      setMapLoaded(false)
    }
  }, [mapboxToken]) // Only mapboxToken - callbacks use refs

  // Update vessels data
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return

    const features = vessels.map(v => {
      const flagState = getFlagState(v.mmsi)
      const isSelected = selectedVessel?.mmsi === v.mmsi
      // Use course if heading is unavailable (511 = not available per AIS spec)
      const rotation = (v.heading && v.heading !== 511) ? v.heading : (v.course_over_ground || 0)
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [v.longitude, v.latitude] },
        properties: {
          mmsi: v.mmsi,
          name: v.ship_name || 'Unknown',
          shipType: v.ship_type,
          speed: v.speed_over_ground,
          course: v.course_over_ground,
          heading: rotation,
          flag: flagState.flag,
          flagName: flagState.name,
          flagged: flagState.flagged ? 1 : 0,
          selected: isSelected ? 1 : 0,
          icon: getShipIcon(v.ship_type, flagState.flagged, isSelected),
          color: flagState.flagged ? '#ef4444' : getVesselColor(v.ship_type),
        },
      }
    })

    const source = map.getSource('vessels')
    if (source) source.setData({ type: 'FeatureCollection', features })
  }, [vessels, selectedVessel])

  // Update alerts data
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return

    const features = alerts.slice(0, 100).map(a => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [a.longitude, a.latitude] },
      properties: {
        id: a.id,
        mmsi: a.mmsi,
        title: a.title,
        severity: a.severity,
        alertType: a.alert_type,
        color: getAlertColor(a.severity),
      },
    }))

    const source = map.getSource('alerts')
    if (source) source.setData({ type: 'FeatureCollection', features })
  }, [alerts])

  // Update trails data
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded() || !showTrails) return

    const features = trails.map(t => ({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: t.coordinates },
      properties: { color: getVesselColor(t.ship_type) },
    }))

    const source = map.getSource('trails')
    if (source) source.setData({ type: 'FeatureCollection', features })
  }, [trails, showTrails])

  // Update cables data
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded() || !showCables) return

    const features = cables.map(c => ({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [c.coordinates] },
      properties: {
        name: c.name,
        type: c.type,
        severity: c.severity,
        color: `rgb(${c.color.join(',')})`,
      },
    }))

    const source = map.getSource('cables')
    if (source) source.setData({ type: 'FeatureCollection', features })
  }, [cables, showCables])

  // Update ports data
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded() || !showPorts) return

    const features = ports.map(p => ({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [p.coordinates] },
      properties: { name: p.name, country: p.country },
    }))

    const source = map.getSource('ports')
    if (source) source.setData({ type: 'FeatureCollection', features })
  }, [ports, showPorts])

  // Update investigation track data (FITBURG)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded() || !investigationTrack) return

    // Track line
    const trackFeature = {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: investigationTrack.coordinates,
      },
      properties: { name: investigationTrack.name },
    }

    const trackSource = map.getSource('investigation-track')
    if (trackSource) trackSource.setData({ type: 'FeatureCollection', features: [trackFeature] })

    // Waypoints
    const getWaypointColor = (trackColor) => {
      if (trackColor === 'green') return '#22c55e'
      if (trackColor === 'yellow') return '#eab308'
      if (trackColor === 'red') return '#ef4444'
      return '#6b7280'
    }

    const waypointFeatures = investigationTrack.waypoints.map((wp, idx) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [wp.lon, wp.lat] },
      properties: {
        label: wp.location,
        timestamp: wp.timestamp,
        speed: wp.speed,
        status: wp.status,
        hasAlert: wp.alert ? 1 : 0,
        color: getWaypointColor(wp.trackColor),
      },
    }))

    const waypointsSource = map.getSource('investigation-waypoints')
    if (waypointsSource) waypointsSource.setData({ type: 'FeatureCollection', features: waypointFeatures })
  }, [investigationTrack])

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

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="absolute inset-0" />

      {hoverInfo && <Tooltip info={hoverInfo} />}
      <Legend />
      <FlaggedWarning />
    </div>
  )
}

function Tooltip({ info }) {
  const { x, y, type, data } = info

  if (type === 'vessel') {
    return (
      <div className="absolute pointer-events-none z-50" style={{ left: x + 15, top: y + 15 }}>
        <div className="bg-slate-900/95 backdrop-blur-sm border border-slate-600 rounded-lg p-3 shadow-2xl min-w-[200px]">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-2xl">{data.flag}</span>
            <div>
              <div className="font-bold text-white">{data.name}</div>
              <div className="text-slate-400 text-xs flex items-center gap-1">
                {data.flagName}
                {data.flagged === 1 && <span className="px-1 bg-red-500/20 text-red-400 text-[10px] rounded">MONITORED</span>}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-1 text-xs border-t border-slate-700 pt-2">
            <span className="text-slate-500">MMSI</span>
            <span className="text-slate-200 font-mono">{data.mmsi}</span>
            <span className="text-slate-500">Speed</span>
            <span className="text-slate-200 font-mono">{data.speed?.toFixed?.(1) ?? '—'} kts</span>
          </div>
        </div>
      </div>
    )
  }

  if (type === 'alert') {
    return (
      <div className="absolute pointer-events-none z-50" style={{ left: x + 15, top: y + 15 }}>
        <div className="bg-slate-900/95 backdrop-blur-sm border border-slate-600 rounded-lg p-3 shadow-2xl max-w-xs">
          <div className="font-bold text-sm mb-1" style={{ color: data.color }}>{data.title}</div>
          <div className="text-slate-400 text-xs">{data.alertType?.replace(/_/g, ' ')}</div>
        </div>
      </div>
    )
  }

  if (type === 'cable') {
    return (
      <div className="absolute pointer-events-none z-50" style={{ left: x + 15, top: y + 15 }}>
        <div className="bg-slate-900/95 backdrop-blur-sm border border-slate-600 rounded-lg p-3 shadow-2xl max-w-xs">
          <div className="flex items-center gap-2 mb-1">
            <span>{getInfrastructureIcon(data.type)}</span>
            <span className="font-bold text-white text-sm">{data.name}</span>
          </div>
          <div className={`text-xs ${data.severity === 'CRITICAL' ? 'text-red-400' : 'text-amber-400'}`}>
            {data.severity} INFRASTRUCTURE
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
          <div className="font-semibold mb-2 text-slate-300 text-xs uppercase">Vessel Types</div>
          <div className="space-y-1">
            {[
              ['#f97316', 'Tanker'],
              ['#8b5cf6', 'Cargo'],
              ['#22c55e', 'Fishing'],
              ['#3b82f6', 'Passenger'],
              ['#6b7280', 'Other'],
              ['#ef4444', 'Flagged State'],
            ].map(([c, l]) => (
              <div key={l} className="flex items-center gap-2 text-xs">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: c }} />
                <span className="text-slate-400">{l}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="border-t border-slate-700 pt-3">
          <div className="font-semibold mb-2 text-slate-300 text-xs uppercase">Infrastructure</div>
          <div className="space-y-1 text-xs text-slate-400">
            <div>📡 Telecom Cable</div>
            <div>🔥 Gas Pipeline</div>
            <div>⚡ Power Cable</div>
          </div>
        </div>
      </div>
    </div>
  )
}

function FlaggedWarning() {
  return (
    <div className="absolute top-4 left-4 z-10">
      <div className="bg-red-950/80 backdrop-blur-sm border border-red-800/50 rounded-lg px-3 py-2">
        <div className="flex items-center gap-2 text-xs">
          <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          <span className="text-red-200 font-medium">Monitored:</span>
          <span className="text-red-300">🇷🇺 🇨🇳 🇭🇰 🇮🇷 🇰🇵</span>
        </div>
      </div>
    </div>
  )
}
