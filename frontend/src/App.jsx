import React, { useState, useCallback, useMemo, useEffect } from 'react'
import Map from './components/Map'
import ErrorBoundary from './components/ErrorBoundary'
import AlertFeed, { AlertStats } from './components/AlertFeed'
import VesselCard, { VesselListItem } from './components/VesselCard'
import Header from './components/Header'
import { useVesselPositions, useAlerts, useTrails } from './hooks/useKafkaStream'
import { Ship, AlertTriangle, BarChart3, Settings, Search, X, Eye, EyeOff, Layers, Anchor, Route, Cable, Filter, Wifi, Fuel, Zap, Target, MapPin, Clock } from 'lucide-react'
import { getVesselCategory, BALTIC_PORTS, BALTIC_CABLE_GEOFENCES } from './utils/geo'

// FITBURG investigation track data (extracted from VesselFinder)
import fitburgTrack from '../../reference-data/fitburg_track_vesselfinder.json'

// Get Mapbox token from environment
const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN || ''

// Vessel type categories for filtering (without 'all' - that's handled separately)
const VESSEL_TYPES = [
  { key: 'tanker', label: 'Tankers', color: 'bg-orange-500' },
  { key: 'cargo', label: 'Cargo', color: 'bg-purple-500' },
  { key: 'fishing', label: 'Fishing', color: 'bg-green-500' },
  { key: 'passenger', label: 'Passenger', color: 'bg-blue-500' },
  { key: 'special', label: 'Special', color: 'bg-yellow-500' },
  { key: 'other', label: 'Other/Unknown', color: 'bg-gray-500' },
]

// All vessel type keys for initial state
const ALL_VESSEL_TYPES = new Set(VESSEL_TYPES.map(t => t.key))

// Speed filter categories
const SPEED_FILTERS = [
  { key: 'stopped', label: 'Stopped', range: [0, 0.5], color: 'bg-red-500' },
  { key: 'slow', label: 'Slow (<3 kts)', range: [0.5, 3], color: 'bg-yellow-500' },
  { key: 'normal', label: 'Normal', range: [3, 15], color: 'bg-green-500' },
  { key: 'fast', label: 'Fast (>15 kts)', range: [15, 999], color: 'bg-blue-500' },
]

const ALL_SPEED_FILTERS = new Set(SPEED_FILTERS.map(s => s.key))

// Infrastructure types for filtering
const INFRASTRUCTURE_TYPES = [
  { key: 'telecommunications', label: 'Data Cables', icon: Wifi, color: 'text-blue-400' },
  { key: 'gas_pipeline', label: 'Gas Pipelines', icon: Fuel, color: 'text-red-400' },
  { key: 'power', label: 'Power Cables', icon: Zap, color: 'text-yellow-400' },
]

const ALL_INFRASTRUCTURE_TYPES = new Set(INFRASTRUCTURE_TYPES.map(t => t.key))

/**
 * Main application component.
 */
export default function App() {
  const [selectedVessel, setSelectedVessel] = useState(null)
  const [selectedAlert, setSelectedAlert] = useState(null)
  const [rightPanel, setRightPanel] = useState('alerts') // 'alerts' | 'stats' | 'vessels'
  const [flyTo, setFlyTo] = useState(null) // { latitude, longitude, zoom } for map animation

  // Map filtering state
  const [enabledVesselTypes, setEnabledVesselTypes] = useState(new Set(ALL_VESSEL_TYPES))
  const [showOnlyAlerts, setShowOnlyAlerts] = useState(false)
  const [showMapControls, setShowMapControls] = useState(false)

  // Map layer visibility
  const [showTrails, setShowTrails] = useState(true)
  const [showPorts, setShowPorts] = useState(true)
  const [showCables, setShowCables] = useState(true)

  // Trail time horizon in hours (0 = none, 72 = max)
  const [trailHorizonHours, setTrailHorizonHours] = useState(24)

  // Infrastructure type filter
  const [enabledInfraTypes, setEnabledInfraTypes] = useState(new Set(ALL_INFRASTRUCTURE_TYPES))

  // Speed filter state
  const [enabledSpeedFilters, setEnabledSpeedFilters] = useState(new Set(ALL_SPEED_FILTERS))

  // Flagged states filter
  const [showOnlyFlagged, setShowOnlyFlagged] = useState(false)

  // Investigation mode - focus on specific vessel
  const [focusVesselMmsi, setFocusVesselMmsi] = useState(null) // e.g., '375068000' for FITBURG
  const [showInvestigationTrack, setShowInvestigationTrack] = useState(false) // Hidden by default

  // Parse investigation track into usable format
  const investigationTrack = useMemo(() => {
    if (!fitburgTrack) return null
    return {
      mmsi: fitburgTrack.metadata.mmsi,
      name: fitburgTrack.metadata.vessel,
      flag: fitburgTrack.metadata.flag,
      coordinates: fitburgTrack.track_geojson.geometry.coordinates,
      waypoints: fitburgTrack.track.map(wp => ({
        timestamp: wp.timestamp,
        lat: wp.lat,
        lon: wp.lon,
        speed: wp.speed_kn,
        status: wp.status,
        location: wp.location,
        alert: wp.alert,
        trackColor: wp.track_color,
      })),
      cableAnalysis: fitburgTrack.cable_zone_analysis,
    }
  }, [])

  // Generate synthetic alerts from investigation track for FITBURG
  const investigationAlerts = useMemo(() => {
    if (!fitburgTrack) return []

    const alertWaypoints = fitburgTrack.track.filter(wp => wp.alert)
    return alertWaypoints.map((wp, idx) => ({
      id: `investigation-alert-${idx}`,
      mmsi: fitburgTrack.metadata.mmsi,
      vessel_name: fitburgTrack.metadata.vessel,
      timestamp: wp.timestamp,
      latitude: wp.lat,
      longitude: wp.lon,
      severity: wp.alert.includes('ANCHOR_DRAG') ? 'CRITICAL' :
                wp.alert.includes('CRITICAL') ? 'CRITICAL' : 'HIGH',
      alert_type: wp.alert.includes('ANCHOR') ? 'ANCHOR_DRAG' : 'CABLE_PROXIMITY',
      title: wp.alert.replace(/_/g, ' '),
      description: `${fitburgTrack.metadata.vessel} (MMSI: ${fitburgTrack.metadata.mmsi}) - ${wp.location}. Speed: ${wp.speed_kn} kts. Status: ${wp.status}. Flag: St. Vincent & Grenadines (VC). Vessel arrived from Saint Petersburg, Russia.`,
      zone_id: 'CABLE-ELISA-FEC1',
      zone_name: 'Elisa FEC Cable Zone',
      speed: wp.speed_kn,
      isInvestigationAlert: true,
    }))
  }, [])

  // Toggle a vessel type on/off
  const toggleVesselType = useCallback((typeKey) => {
    setEnabledVesselTypes(prev => {
      const next = new Set(prev)
      if (next.has(typeKey)) {
        next.delete(typeKey)
      } else {
        next.add(typeKey)
      }
      return next
    })
  }, [])

  // Select all or none
  const selectAllTypes = useCallback(() => {
    setEnabledVesselTypes(new Set(ALL_VESSEL_TYPES))
  }, [])

  const selectNoTypes = useCallback(() => {
    setEnabledVesselTypes(new Set())
  }, [])

  // Toggle a speed filter on/off
  const toggleSpeedFilter = useCallback((speedKey) => {
    setEnabledSpeedFilters(prev => {
      const next = new Set(prev)
      if (next.has(speedKey)) {
        next.delete(speedKey)
      } else {
        next.add(speedKey)
      }
      return next
    })
  }, [])

  // Toggle an infrastructure type on/off
  const toggleInfraType = useCallback((typeKey) => {
    setEnabledInfraTypes(prev => {
      const next = new Set(prev)
      if (next.has(typeKey)) {
        next.delete(typeKey)
      } else {
        next.add(typeKey)
      }
      return next
    })
  }, [])

  // Select all/none infrastructure types
  const selectAllInfraTypes = useCallback(() => {
    setEnabledInfraTypes(new Set(ALL_INFRASTRUCTURE_TYPES))
  }, [])

  const selectNoInfraTypes = useCallback(() => {
    setEnabledInfraTypes(new Set())
  }, [])

  // Filter cables based on enabled infrastructure types
  const displayCables = useMemo(() => {
    if (!showCables) return []
    return BALTIC_CABLE_GEOFENCES.filter(cable => enabledInfraTypes.has(cable.type))
  }, [showCables, enabledInfraTypes])

  // Connect to Kafka streams
  const {
    vessels,
    isConnected: vesselsConnected,
    error: vesselsError,
    stats: vesselStats,
  } = useVesselPositions({
    pollInterval: 5000,  // Reduced from 1s to 5s to lower egress costs
  })

  const {
    alerts,
    alertsBySeverity,
    isConnected: alertsConnected,
    error: alertsError,
    stats: alertStats,
  } = useAlerts({
    pollInterval: 3000,  // Reduced from 1s to 3s to lower egress costs
  })

  // Fetch vessel trails
  const { trails: rawTrails } = useTrails({
    pollInterval: 15000,  // Reduced from 5s to 15s - trails don't change fast
    enabled: showTrails && trailHorizonHours > 0,
  })

  // Filter trails based on time horizon
  const timeFilteredTrails = useMemo(() => {
    if (trailHorizonHours === 0 || !rawTrails || rawTrails.length === 0) {
      return []
    }

    const cutoffTime = Date.now() - (trailHorizonHours * 60 * 60 * 1000)

    return rawTrails.map(trail => {
      // If no timestamps, return trail as-is (can't filter)
      if (!trail.timestamps || trail.timestamps.length === 0) {
        return trail.coordinates?.length >= 2 ? trail : null
      }

      // Filter coordinates and timestamps based on time horizon
      const filteredIndices = []
      let hasInvalidTimestamps = false

      trail.timestamps.forEach((ts, idx) => {
        const timestamp = new Date(ts).getTime()
        if (isNaN(timestamp) || !ts) {
          // Invalid timestamp - track this but include the point
          hasInvalidTimestamps = true
          filteredIndices.push(idx)
        } else if (timestamp >= cutoffTime) {
          filteredIndices.push(idx)
        }
      })

      // If all timestamps are valid and within range, return as-is
      if (filteredIndices.length === trail.coordinates.length) {
        return trail
      }

      // If we have invalid timestamps and no valid recent ones,
      // return the full trail (can't reliably filter)
      if (hasInvalidTimestamps && filteredIndices.length === 0) {
        return trail.coordinates?.length >= 2 ? trail : null
      }

      // Filter coordinates to only include recent/valid points
      if (filteredIndices.length < 2) {
        return null // Not enough points for a trail
      }

      return {
        ...trail,
        coordinates: filteredIndices.map(i => trail.coordinates[i]),
        timestamps: filteredIndices.map(i => trail.timestamps[i]),
        point_count: filteredIndices.length,
      }
    }).filter(Boolean) // Remove null entries
  }, [rawTrails, trailHorizonHours])

  // Filter trails to only show vessels with alerts when showOnlyAlerts is enabled
  const trails = useMemo(() => {
    if (!showOnlyAlerts) {
      return timeFilteredTrails
    }
    // Only show trails for vessels that have alerts
    const alertMmsis = new Set(alerts.map(a => a.mmsi))
    return timeFilteredTrails.filter(trail => alertMmsis.has(trail.mmsi))
  }, [timeFilteredTrails, showOnlyAlerts, alerts])

  const isConnected = vesselsConnected || alertsConnected
  const messagesPerSecond = vesselStats.messagesPerSecond + alertStats.messagesPerSecond

  // Handle vessel selection - clear any selected alert and show vessel
  const handleVesselClick = useCallback((vessel) => {
    setSelectedVessel(vessel)
    setSelectedAlert(null) // Clear alert when directly clicking a vessel
    // Fly to vessel location
    if (vessel.latitude && vessel.longitude) {
      setFlyTo({
        latitude: vessel.latitude,
        longitude: vessel.longitude,
        zoom: 10,
        timestamp: Date.now(),
      })
    }
  }, [])

  // Handle alert click - zoom to location and select vessel
  const handleAlertClick = useCallback((alert) => {
    setSelectedAlert(alert)
    // Find the vessel associated with this alert
    const vessel = vessels.find(v => v.mmsi === alert.mmsi)
    if (vessel) {
      setSelectedVessel(vessel)
    }
    // Fly to the alert location
    if (alert.latitude && alert.longitude) {
      setFlyTo({
        latitude: alert.latitude,
        longitude: alert.longitude,
        zoom: 10,
        timestamp: Date.now(), // Force re-trigger even for same location
      })
    }
  }, [vessels])

  // Filter vessels based on type, speed, alerts, and flagged states
  const displayVessels = useMemo(() => {
    let filtered = vessels

    // Filter by vessel type (multi-select)
    if (enabledVesselTypes.size < ALL_VESSEL_TYPES.size) {
      filtered = filtered.filter(v => {
        const category = getVesselCategory(v.ship_type)
        const filterKey = category === 'unknown' ? 'other' : category
        return enabledVesselTypes.has(filterKey)
      })
    }

    // Filter by speed category
    if (enabledSpeedFilters.size < ALL_SPEED_FILTERS.size) {
      filtered = filtered.filter(v => {
        const speed = v.speed_over_ground ?? -1
        if (speed < 0) return enabledSpeedFilters.has('stopped') // No speed data treated as stopped
        return SPEED_FILTERS.some(sf =>
          enabledSpeedFilters.has(sf.key) && speed >= sf.range[0] && speed < sf.range[1]
        )
      })
    }

    // Filter to only show vessels with alerts
    if (showOnlyAlerts) {
      const alertMmsis = new Set(alerts.map(a => a.mmsi))
      filtered = filtered.filter(v => alertMmsis.has(v.mmsi))
    }

    // Filter to only show flagged/monitored states
    if (showOnlyFlagged) {
      const flaggedMids = ['273', '412', '413', '414', '477', '445', '422'] // RU, CN, HK, KP, IR
      filtered = filtered.filter(v => {
        const mid = v.mmsi?.substring(0, 3)
        return flaggedMids.includes(mid)
      })
    }

    // Focus on a specific vessel (investigation mode)
    if (focusVesselMmsi) {
      filtered = filtered.filter(v => v.mmsi === focusVesselMmsi)
    }

    return filtered
  }, [vessels, enabledVesselTypes, enabledSpeedFilters, showOnlyAlerts, showOnlyFlagged, alerts, focusVesselMmsi])

  const displayAlerts = useMemo(() => {
    // In investigation mode, show only the investigated vessel's alerts
    if (focusVesselMmsi) {
      // Combine real alerts for this vessel with investigation alerts
      const realAlerts = alerts.filter(a => a.mmsi === focusVesselMmsi)
      const combined = [...realAlerts, ...investigationAlerts]
      // Sort by timestamp descending
      return combined.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    }
    // Normal mode - show all alerts
    if (alerts.length > 0) return alerts
    return []
  }, [alerts, focusVesselMmsi, investigationAlerts])

  // Check for missing Mapbox token
  if (!MAPBOX_TOKEN) {
    return (
      <div className="h-screen bg-maritime-950 flex items-center justify-center">
        <div className="glass-panel p-8 max-w-md text-center">
          <Settings className="w-12 h-12 text-maritime-400 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-white mb-2">Configuration Required</h2>
          <p className="text-maritime-300 mb-4">
            Please set your Mapbox access token to display the map.
          </p>
          <div className="bg-maritime-800 rounded p-3 text-left text-sm">
            <code className="text-maritime-200">
              VITE_MAPBOX_TOKEN=your_token_here
            </code>
          </div>
          <p className="text-xs text-maritime-500 mt-4">
            Get a free token at <a href="https://mapbox.com" className="text-blue-400 hover:underline">mapbox.com</a>
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col bg-maritime-950">
      {/* Header */}
      <Header
        vesselCount={displayVessels.length}
        alertCount={displayAlerts.length}
        isConnected={isConnected}
        messagesPerSecond={messagesPerSecond}
      />

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Map */}
        <div className="flex-1 relative">
          <ErrorBoundary>
            <Map
              vessels={displayVessels}
              alerts={displayAlerts}
              trails={trails}
              ports={BALTIC_PORTS}
              cables={displayCables}
              selectedVessel={selectedVessel}
              onVesselClick={handleVesselClick}
              onAlertClick={handleAlertClick}
              mapboxToken={MAPBOX_TOKEN}
              showTrails={showTrails}
              showPorts={showPorts}
              showCables={showCables}
              flyTo={flyTo}
              investigationTrack={showInvestigationTrack ? investigationTrack : null}
            />
          </ErrorBoundary>

          {/* Selected Vessel Card - top left, max height to avoid overlap */}
          {selectedVessel && (
            <div className="absolute top-4 left-4 z-10 max-h-[calc(100%-120px)] overflow-auto">
              <VesselCard
                vessel={selectedVessel}
                alerts={displayAlerts}
                selectedAlert={selectedAlert}
                onClose={() => {
                  setSelectedVessel(null)
                  setSelectedAlert(null)
                }}
                onAlertClick={handleAlertClick}
              />
            </div>
          )}

          {/* Map Controls - bottom right to avoid overlap with vessel card */}
          <div className="absolute bottom-4 right-[400px] z-10">
            <button
              onClick={() => setShowMapControls(!showMapControls)}
              className={`p-3 rounded-lg shadow-lg transition-colors ${
                showMapControls ? 'bg-blue-600 text-white' : 'bg-maritime-800 text-maritime-300 hover:bg-maritime-700'
              }`}
              title="Map Layers"
            >
              <Layers className="w-5 h-5" />
            </button>

            {showMapControls && (
              <div className="absolute bottom-14 right-0 glass-panel p-4 w-64 space-y-4 max-h-[70vh] overflow-y-auto">
                <div className="text-sm font-medium text-white">Map Layers</div>

                {/* Trails Toggle */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Route className="w-4 h-4 text-maritime-400" />
                    <span className="text-sm text-maritime-300">Vessel Trails</span>
                  </div>
                  <button
                    onClick={() => setShowTrails(!showTrails)}
                    className={`p-1.5 rounded ${showTrails ? 'bg-blue-600 text-white' : 'bg-maritime-700 text-maritime-400'}`}
                  >
                    {showTrails ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                  </button>
                </div>

                {/* Trail Time Horizon Slider */}
                {showTrails && (
                  <div className="ml-6 mt-2 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Clock className="w-3 h-3 text-maritime-500" />
                        <span className="text-xs text-maritime-400">Time Horizon</span>
                      </div>
                      <span className="text-xs font-mono text-blue-400">
                        {trailHorizonHours === 0 ? 'None' : `${trailHorizonHours}h`}
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="72"
                      step="1"
                      value={trailHorizonHours}
                      onChange={(e) => setTrailHorizonHours(parseInt(e.target.value))}
                      className="w-full h-1.5 bg-maritime-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                    />
                    <div className="flex justify-between text-[10px] text-maritime-500">
                      <span>None</span>
                      <span>12h</span>
                      <span>24h</span>
                      <span>48h</span>
                      <span>72h</span>
                    </div>
                  </div>
                )}

                {/* Ports Toggle */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Anchor className="w-4 h-4 text-maritime-400" />
                    <span className="text-sm text-maritime-300">Ports</span>
                  </div>
                  <button
                    onClick={() => setShowPorts(!showPorts)}
                    className={`p-1.5 rounded ${showPorts ? 'bg-blue-600 text-white' : 'bg-maritime-700 text-maritime-400'}`}
                  >
                    {showPorts ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                  </button>
                </div>

                {/* Infrastructure Section */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Cable className="w-4 h-4 text-maritime-400" />
                    <span className="text-sm text-maritime-300">Infrastructure</span>
                  </div>
                  <button
                    onClick={() => setShowCables(!showCables)}
                    className={`p-1.5 rounded ${showCables ? 'bg-blue-600 text-white' : 'bg-maritime-700 text-maritime-400'}`}
                  >
                    {showCables ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                  </button>
                </div>

                {/* Infrastructure Type Filter */}
                {showCables && (
                  <div className="ml-6 mt-2">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-maritime-400">Type</span>
                      <div className="flex gap-2 text-xs">
                        <button
                          onClick={selectAllInfraTypes}
                          className="text-blue-400 hover:text-blue-300"
                        >
                          All
                        </button>
                        <span className="text-maritime-600">|</span>
                        <button
                          onClick={selectNoInfraTypes}
                          className="text-blue-400 hover:text-blue-300"
                        >
                          None
                        </button>
                      </div>
                    </div>
                    <div className="space-y-1">
                      {INFRASTRUCTURE_TYPES.map(infra => {
                        const Icon = infra.icon
                        const count = BALTIC_CABLE_GEOFENCES.filter(c => c.type === infra.key).length
                        return (
                          <label
                            key={infra.key}
                            className="flex items-center gap-2 cursor-pointer hover:bg-maritime-800/50 p-1 rounded"
                          >
                            <input
                              type="checkbox"
                              checked={enabledInfraTypes.has(infra.key)}
                              onChange={() => toggleInfraType(infra.key)}
                              className="rounded border-maritime-600 bg-maritime-800 text-blue-600 focus:ring-blue-500 focus:ring-offset-0"
                            />
                            <Icon className={`w-4 h-4 ${infra.color}`} />
                            <span className={`text-sm flex-1 ${enabledInfraTypes.has(infra.key) ? 'text-white' : 'text-maritime-500'}`}>
                              {infra.label}
                            </span>
                            <span className="text-xs text-maritime-500">{count}</span>
                          </label>
                        )
                      })}
                    </div>
                  </div>
                )}

                <div className="border-t border-maritime-700 pt-3">
                  <div className="text-sm font-medium text-white mb-3">Vessel Filters</div>

                  {/* Alerts Only Toggle */}
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm text-maritime-300">Show only vessels with alerts</span>
                    <button
                      onClick={() => setShowOnlyAlerts(!showOnlyAlerts)}
                      className={`p-1.5 rounded ${showOnlyAlerts ? 'bg-blue-600 text-white' : 'bg-maritime-700 text-maritime-400'}`}
                    >
                      {showOnlyAlerts ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Vessel Type Filter */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-maritime-400">Vessel Types</span>
                    <div className="flex gap-2 text-xs">
                      <button
                        onClick={selectAllTypes}
                        className="text-blue-400 hover:text-blue-300"
                      >
                        All
                      </button>
                      <span className="text-maritime-600">|</span>
                      <button
                        onClick={selectNoTypes}
                        className="text-blue-400 hover:text-blue-300"
                      >
                        None
                      </button>
                    </div>
                  </div>
                  <div className="space-y-1">
                    {VESSEL_TYPES.map(type => (
                      <label
                        key={type.key}
                        className="flex items-center gap-2 cursor-pointer hover:bg-maritime-800/50 p-1 rounded"
                      >
                        <input
                          type="checkbox"
                          checked={enabledVesselTypes.has(type.key)}
                          onChange={() => toggleVesselType(type.key)}
                          className="rounded border-maritime-600 bg-maritime-800 text-blue-600 focus:ring-blue-500 focus:ring-offset-0"
                        />
                        <span className={`w-3 h-3 rounded-full ${type.color}`} />
                        <span className={`text-sm ${enabledVesselTypes.has(type.key) ? 'text-white' : 'text-maritime-500'}`}>
                          {type.label}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Speed Filter */}
                <div className="pt-3 border-t border-maritime-700">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-maritime-400">Speed</span>
                    <div className="flex gap-2 text-xs">
                      <button
                        onClick={() => setEnabledSpeedFilters(new Set(ALL_SPEED_FILTERS))}
                        className="text-blue-400 hover:text-blue-300"
                      >
                        All
                      </button>
                      <span className="text-maritime-600">|</span>
                      <button
                        onClick={() => setEnabledSpeedFilters(new Set())}
                        className="text-blue-400 hover:text-blue-300"
                      >
                        None
                      </button>
                    </div>
                  </div>
                  <div className="space-y-1">
                    {SPEED_FILTERS.map(sf => (
                      <label
                        key={sf.key}
                        className="flex items-center gap-2 cursor-pointer hover:bg-maritime-800/50 p-1 rounded"
                      >
                        <input
                          type="checkbox"
                          checked={enabledSpeedFilters.has(sf.key)}
                          onChange={() => toggleSpeedFilter(sf.key)}
                          className="rounded border-maritime-600 bg-maritime-800 text-blue-600 focus:ring-blue-500 focus:ring-offset-0"
                        />
                        <span className={`w-3 h-3 rounded-full ${sf.color}`} />
                        <span className={`text-sm ${enabledSpeedFilters.has(sf.key) ? 'text-white' : 'text-maritime-500'}`}>
                          {sf.label}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Flagged States Filter */}
                <div className="pt-3 border-t border-maritime-700">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Filter className="w-4 h-4 text-alert-high" />
                      <span className="text-sm text-maritime-300">Monitored States Only</span>
                    </div>
                    <button
                      onClick={() => setShowOnlyFlagged(!showOnlyFlagged)}
                      className={`p-1.5 rounded ${showOnlyFlagged ? 'bg-alert-high text-white' : 'bg-maritime-700 text-maritime-400'}`}
                    >
                      {showOnlyFlagged ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                    </button>
                  </div>
                  <div className="text-xs text-maritime-500 mt-1">
                    RU, CN, HK, KP, IR vessels
                  </div>
                </div>

                {/* Investigation Mode */}
                <div className="pt-3 border-t border-maritime-700">
                  <div className="text-sm font-medium text-pink-400 mb-2 flex items-center gap-2">
                    <Target className="w-4 h-4" />
                    Investigation Mode
                  </div>

                  {/* Focus Vessel Toggle */}
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Ship className="w-4 h-4 text-pink-400" />
                      <span className="text-sm text-maritime-300">Focus: FITBURG</span>
                    </div>
                    <button
                      onClick={() => setFocusVesselMmsi(prev => prev ? null : '375068000')}
                      className={`p-1.5 rounded ${focusVesselMmsi === '375068000' ? 'bg-pink-600 text-white' : 'bg-maritime-700 text-maritime-400'}`}
                    >
                      {focusVesselMmsi === '375068000' ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                    </button>
                  </div>

                  {/* Investigation Track Toggle */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <MapPin className="w-4 h-4 text-pink-400" />
                      <span className="text-sm text-maritime-300">Historical Track</span>
                    </div>
                    <button
                      onClick={() => setShowInvestigationTrack(!showInvestigationTrack)}
                      className={`p-1.5 rounded ${showInvestigationTrack ? 'bg-pink-600 text-white' : 'bg-maritime-700 text-maritime-400'}`}
                    >
                      {showInvestigationTrack ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                    </button>
                  </div>

                  <div className="text-xs text-pink-300/70 mt-2">
                    MMSI 375068000 | Dec 30-31, 2025
                  </div>
                </div>

                {/* Stats */}
                <div className="text-xs text-maritime-400 pt-2 border-t border-maritime-700">
                  Showing {displayVessels.length} of {vessels.length} vessels
                </div>
              </div>
            )}
          </div>

          {/* Connection Error */}
          {(vesselsError || alertsError) && (
            <div className="absolute top-4 right-4 z-10">
              <div className="glass-panel p-4 border-l-4 border-l-alert-high max-w-sm">
                <div className="font-semibold text-alert-high">Connection Issue</div>
                <div className="text-sm text-maritime-300 mt-1">
                  {vesselsError || alertsError}
                </div>
                <div className="text-xs text-maritime-500 mt-2">
                  Make sure the backend API is running on port 8000
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right Sidebar */}
        <div className="w-96 border-l border-maritime-700 bg-maritime-900 flex flex-col">
          {/* Sidebar Tabs */}
          <div className="flex border-b border-maritime-700">
            <TabButton
              icon={AlertTriangle}
              label="Alerts"
              isActive={rightPanel === 'alerts'}
              onClick={() => setRightPanel('alerts')}
              badge={alertsBySeverity.critical.length + alertsBySeverity.high.length}
            />
            <TabButton
              icon={BarChart3}
              label="Stats"
              isActive={rightPanel === 'stats'}
              onClick={() => setRightPanel('stats')}
            />
            <TabButton
              icon={Ship}
              label="Vessels"
              isActive={rightPanel === 'vessels'}
              onClick={() => setRightPanel('vessels')}
              badge={displayVessels.length}
            />
          </div>

          {/* Sidebar Content */}
          <div className="flex-1 overflow-hidden">
            {rightPanel === 'alerts' && (
              <AlertFeed
                alerts={displayAlerts}
                onAlertClick={handleAlertClick}
                selectedAlert={selectedAlert}
              />
            )}
            {rightPanel === 'stats' && (
              <AlertStats alerts={displayAlerts} />
            )}
            {rightPanel === 'vessels' && (
              <VesselList
                vessels={displayVessels}
                selectedVessel={selectedVessel}
                onVesselClick={handleVesselClick}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function TabButton({ icon: Icon, label, isActive, onClick, badge }) {
  return (
    <button
      className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${
        isActive
          ? 'text-white bg-maritime-800 border-b-2 border-blue-500'
          : 'text-maritime-400 hover:text-white hover:bg-maritime-800/50'
      }`}
      onClick={onClick}
    >
      <Icon className="w-4 h-4" />
      <span>{label}</span>
      {badge > 0 && (
        <span className="ml-1 px-1.5 py-0.5 text-xs bg-maritime-700 rounded-full">
          {badge}
        </span>
      )}
    </button>
  )
}

function VesselList({ vessels, selectedVessel, onVesselClick }) {
  const [searchQuery, setSearchQuery] = useState('')

  // Filter vessels based on search query
  const filteredVessels = useMemo(() => {
    if (!searchQuery) return vessels

    const query = searchQuery.toLowerCase()
    return vessels.filter(vessel => {
      const matchesName = vessel.ship_name?.toLowerCase().includes(query)
      const matchesMmsi = vessel.mmsi?.toLowerCase().includes(query)
      const matchesFlag = vessel.flag_state?.toLowerCase().includes(query)
      const matchesType = vessel.ship_type?.toString().includes(query)
      return matchesName || matchesMmsi || matchesFlag || matchesType
    })
  }, [vessels, searchQuery])

  if (vessels.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-maritime-400 p-8">
        <Ship className="w-12 h-12 mb-4 opacity-50" />
        <div className="text-center">
          <div className="font-semibold">No Vessels</div>
          <div className="text-sm mt-1">Waiting for AIS data...</div>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="p-4 border-b border-maritime-700 bg-maritime-900/95 backdrop-blur">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-maritime-500" />
          <input
            type="text"
            placeholder="Search by name, MMSI, or flag..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-9 py-2 bg-maritime-800 border border-maritime-700 rounded text-white placeholder-maritime-500 text-sm focus:outline-none focus:border-blue-500"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-maritime-500 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        {searchQuery && (
          <div className="text-xs text-maritime-400 mt-2">
            Found {filteredVessels.length} of {vessels.length} vessels
          </div>
        )}
      </div>
      <div className="flex-1 overflow-y-auto">
        {filteredVessels.length === 0 ? (
          <div className="p-8 text-center text-maritime-400">
            <Ship className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <div className="text-sm">No vessels match "{searchQuery}"</div>
          </div>
        ) : (
          <div className="divide-y divide-maritime-800">
            {filteredVessels.map((vessel) => (
              <VesselListItem
                key={vessel.mmsi}
                vessel={vessel}
                isSelected={selectedVessel?.mmsi === vessel.mmsi}
                onClick={() => onVesselClick(vessel)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
