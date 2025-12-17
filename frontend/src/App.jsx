import React, { useState, useCallback, useMemo } from 'react'
import Map from './components/Map'
import AlertFeed, { AlertStats } from './components/AlertFeed'
import VesselCard, { VesselListItem } from './components/VesselCard'
import Header from './components/Header'
import { useVesselPositions, useAlerts, useTrails } from './hooks/useKafkaStream'
import { Ship, AlertTriangle, BarChart3, Settings, Search, X, Eye, EyeOff, Layers, Anchor, Route } from 'lucide-react'
import { getVesselCategory, BALTIC_PORTS } from './utils/geo'

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

/**
 * Main application component.
 */
export default function App() {
  const [selectedVessel, setSelectedVessel] = useState(null)
  const [selectedAlert, setSelectedAlert] = useState(null)
  const [rightPanel, setRightPanel] = useState('alerts') // 'alerts' | 'stats' | 'vessels'

  // Map filtering state
  const [enabledVesselTypes, setEnabledVesselTypes] = useState(new Set(ALL_VESSEL_TYPES))
  const [showOnlyAlerts, setShowOnlyAlerts] = useState(false)
  const [showMapControls, setShowMapControls] = useState(false)

  // Map layer visibility
  const [showTrails, setShowTrails] = useState(true)
  const [showPorts, setShowPorts] = useState(true)

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

  // Connect to Kafka streams
  const {
    vessels,
    isConnected: vesselsConnected,
    error: vesselsError,
    stats: vesselStats,
  } = useVesselPositions({
    pollInterval: 1000,
  })

  const {
    alerts,
    alertsBySeverity,
    isConnected: alertsConnected,
    error: alertsError,
    stats: alertStats,
  } = useAlerts({
    pollInterval: 1000,
  })

  // Fetch vessel trails
  const { trails } = useTrails({
    pollInterval: 5000,
    enabled: showTrails,
  })

  const isConnected = vesselsConnected || alertsConnected
  const messagesPerSecond = vesselStats.messagesPerSecond + alertStats.messagesPerSecond

  // Handle vessel selection
  const handleVesselClick = useCallback((vessel) => {
    setSelectedVessel(vessel)
    setSelectedAlert(null)
  }, [])

  // Handle alert click - zoom to location and select vessel
  const handleAlertClick = useCallback((alert) => {
    setSelectedAlert(alert)
    // Find the vessel associated with this alert
    const vessel = vessels.find(v => v.mmsi === alert.mmsi)
    if (vessel) {
      setSelectedVessel(vessel)
    }
  }, [vessels])

  // Filter vessels based on type and alerts-only mode
  const displayVessels = useMemo(() => {
    let filtered = vessels

    // Filter by vessel type (multi-select)
    if (enabledVesselTypes.size < ALL_VESSEL_TYPES.size) {
      filtered = filtered.filter(v => {
        const category = getVesselCategory(v.ship_type)
        // Map 'unknown' to 'other' for filtering purposes
        const filterKey = category === 'unknown' ? 'other' : category
        return enabledVesselTypes.has(filterKey)
      })
    }

    // Filter to only show vessels with alerts
    if (showOnlyAlerts) {
      const alertMmsis = new Set(alerts.map(a => a.mmsi))
      filtered = filtered.filter(v => alertMmsis.has(v.mmsi))
    }

    return filtered
  }, [vessels, enabledVesselTypes, showOnlyAlerts, alerts])

  const displayAlerts = useMemo(() => {
    if (alerts.length > 0) return alerts
    return []
  }, [alerts])

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
          <Map
            vessels={displayVessels}
            alerts={displayAlerts}
            trails={trails}
            ports={BALTIC_PORTS}
            selectedVessel={selectedVessel}
            onVesselClick={handleVesselClick}
            mapboxToken={MAPBOX_TOKEN}
            showTrails={showTrails}
            showPorts={showPorts}
          />

          {/* Selected Vessel Card */}
          {selectedVessel && (
            <div className="absolute top-4 left-4 z-10">
              <VesselCard
                vessel={selectedVessel}
                alerts={displayAlerts}
                onClose={() => setSelectedVessel(null)}
              />
            </div>
          )}

          {/* Map Controls */}
          <div className="absolute bottom-4 left-4 z-10">
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
              <div className="absolute bottom-14 left-0 glass-panel p-4 w-64 space-y-4">
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
