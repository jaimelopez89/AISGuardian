import React, { useState, useCallback, useMemo } from 'react'
import Map from './components/Map'
import AlertFeed, { AlertStats } from './components/AlertFeed'
import VesselCard, { VesselListItem } from './components/VesselCard'
import Header from './components/Header'
import { useVesselPositions, useAlerts } from './hooks/useKafkaStream'
import { Ship, AlertTriangle, BarChart3, Settings } from 'lucide-react'

// Get Mapbox token from environment
const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN || ''

/**
 * Main application component.
 */
export default function App() {
  const [selectedVessel, setSelectedVessel] = useState(null)
  const [selectedAlert, setSelectedAlert] = useState(null)
  const [rightPanel, setRightPanel] = useState('alerts') // 'alerts' | 'stats' | 'vessels'

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

  // Demo mode with mock data if not connected
  const displayVessels = useMemo(() => {
    if (vessels.length > 0) return vessels
    // Return empty for now - will show real data when connected
    return []
  }, [vessels])

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
            selectedVessel={selectedVessel}
            onVesselClick={handleVesselClick}
            mapboxToken={MAPBOX_TOKEN}
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

          {/* Connection Error */}
          {(vesselsError || alertsError) && (
            <div className="absolute top-4 right-4 z-10">
              <div className="glass-panel p-4 border-l-4 border-l-alert-high max-w-sm">
                <div className="font-semibold text-alert-high">Connection Issue</div>
                <div className="text-sm text-maritime-300 mt-1">
                  {vesselsError || alertsError}
                </div>
                <div className="text-xs text-maritime-500 mt-2">
                  Make sure Kafka REST Proxy is running on port 8082
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
    <div className="h-full overflow-y-auto">
      <div className="p-4 border-b border-maritime-700 sticky top-0 bg-maritime-900/95 backdrop-blur">
        <input
          type="text"
          placeholder="Search vessels..."
          className="w-full px-3 py-2 bg-maritime-800 border border-maritime-700 rounded text-white placeholder-maritime-500 text-sm focus:outline-none focus:border-blue-500"
        />
      </div>
      <div className="divide-y divide-maritime-800">
        {vessels.map((vessel) => (
          <VesselListItem
            key={vessel.mmsi}
            vessel={vessel}
            isSelected={selectedVessel?.mmsi === vessel.mmsi}
            onClick={() => onVesselClick(vessel)}
          />
        ))}
      </div>
    </div>
  )
}
