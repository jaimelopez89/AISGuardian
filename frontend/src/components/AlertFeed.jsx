import React, { useState, useMemo } from 'react'
import { formatDistanceToNow } from 'date-fns'
import {
  AlertTriangle,
  Radio,
  MapPin,
  Ship,
  Anchor,
  Fish,
  Cable,
  Timer,
  Search,
  X,
  ChevronDown,
  ChevronUp,
  Ghost,
  Users,
  Navigation,
} from 'lucide-react'

// Available alert types for filtering
const ALERT_TYPES = [
  { value: 'CABLE_PROXIMITY', label: 'Cable Proximity', icon: Cable, color: 'text-yellow-400' },
  { value: 'ANCHOR_DRAGGING', label: 'Anchor Dragging', icon: Anchor, color: 'text-red-500' },
  { value: 'TRAJECTORY_PREDICTION', label: 'Trajectory Prediction', icon: Navigation, color: 'text-cyan-400' },
  { value: 'GEOFENCE_VIOLATION', label: 'Geofence', icon: MapPin, color: 'text-purple-400' },
  { value: 'DARK_EVENT', label: 'Dark AIS', icon: Radio, color: 'text-red-400' },
  { value: 'AIS_SPOOFING', label: 'AIS Spoofing', icon: Ghost, color: 'text-pink-400' },
  { value: 'RENDEZVOUS', label: 'Rendezvous', icon: Ship, color: 'text-blue-400' },
  { value: 'CONVOY', label: 'Convoy', icon: Users, color: 'text-indigo-400' },
  { value: 'FISHING_IN_MPA', label: 'Illegal Fishing', icon: Fish, color: 'text-green-400' },
  { value: 'LOITERING', label: 'Loitering', icon: Timer, color: 'text-orange-400' },
  { value: 'SANCTIONS_MATCH', label: 'Sanctions', icon: AlertTriangle, color: 'text-red-500' },
]

const SEVERITY_CONFIG = {
  CRITICAL: { color: 'bg-alert-critical', textColor: 'text-alert-critical', label: 'Critical' },
  HIGH: { color: 'bg-alert-high', textColor: 'text-alert-high', label: 'High' },
  MEDIUM: { color: 'bg-alert-medium', textColor: 'text-alert-medium', label: 'Medium' },
  LOW: { color: 'bg-alert-low', textColor: 'text-alert-low', label: 'Low' },
}

const SEVERITY_LEVELS = Object.keys(SEVERITY_CONFIG)

/**
 * Real-time alert feed component with filtering.
 */
export default function AlertFeed({ alerts = [], onAlertClick, selectedAlert }) {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedSeverities, setSelectedSeverities] = useState(new Set(SEVERITY_LEVELS))
  const [selectedTypes, setSelectedTypes] = useState(new Set(ALERT_TYPES.map(t => t.value)))
  const [showFilters, setShowFilters] = useState(true) // Show filters by default

  // Filter alerts based on search and filters
  const filteredAlerts = useMemo(() => {
    return alerts.filter(alert => {
      // Check severity filter
      if (!selectedSeverities.has(alert.severity)) return false

      // Check type filter
      if (!selectedTypes.has(alert.alert_type)) return false

      // Check search query
      if (searchQuery) {
        const query = searchQuery.toLowerCase()
        const matchesName = alert.vessel_name?.toLowerCase().includes(query)
        const matchesMmsi = alert.mmsi?.toLowerCase().includes(query)
        const matchesTitle = alert.title?.toLowerCase().includes(query)
        const matchesDesc = alert.description?.toLowerCase().includes(query)
        if (!matchesName && !matchesMmsi && !matchesTitle && !matchesDesc) return false
      }

      return true
    })
  }, [alerts, selectedSeverities, selectedTypes, searchQuery])

  // Toggle functions
  const toggleSeverity = (severity) => {
    setSelectedSeverities(prev => {
      const next = new Set(prev)
      if (next.has(severity)) {
        next.delete(severity)
      } else {
        next.add(severity)
      }
      return next
    })
  }

  const toggleType = (type) => {
    setSelectedTypes(prev => {
      const next = new Set(prev)
      if (next.has(type)) {
        next.delete(type)
      } else {
        next.add(type)
      }
      return next
    })
  }

  // Select all/none helpers
  const selectAllSeverities = () => setSelectedSeverities(new Set(SEVERITY_LEVELS))
  const selectNoSeverities = () => setSelectedSeverities(new Set())
  const selectAllTypes = () => setSelectedTypes(new Set(ALERT_TYPES.map(t => t.value)))
  const selectNoTypes = () => setSelectedTypes(new Set())

  const hasActiveFilters = searchQuery ||
    selectedSeverities.size < SEVERITY_LEVELS.length ||
    selectedTypes.size < ALERT_TYPES.length

  // Count alerts by type for badges
  const alertCountsByType = useMemo(() => {
    return ALERT_TYPES.reduce((acc, type) => {
      acc[type.value] = alerts.filter(a => a.alert_type === type.value).length
      return acc
    }, {})
  }, [alerts])

  // Count alerts by severity for badges
  const alertCountsBySeverity = useMemo(() => {
    return SEVERITY_LEVELS.reduce((acc, sev) => {
      acc[sev] = alerts.filter(a => a.severity === sev).length
      return acc
    }, {})
  }, [alerts])

  if (alerts.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-maritime-400 p-8">
        <Radio className="w-12 h-12 mb-4 animate-pulse" />
        <div className="text-center">
          <div className="font-semibold">Monitoring Active</div>
          <div className="text-sm mt-1">No alerts detected yet</div>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="p-3 border-b border-maritime-700 bg-maritime-900/95 backdrop-blur z-10">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold text-sm">Live Alerts</h2>
          <div className="flex items-center gap-2 text-xs">
            {alertCountsBySeverity.CRITICAL > 0 && (
              <span className="flex items-center gap-1 px-1.5 py-0.5 bg-alert-critical/20 text-alert-critical rounded">
                <span className="w-1.5 h-1.5 rounded-full bg-alert-critical animate-pulse" />
                {alertCountsBySeverity.CRITICAL}
              </span>
            )}
            {alertCountsBySeverity.HIGH > 0 && (
              <span className="flex items-center gap-1 px-1.5 py-0.5 bg-alert-high/20 text-alert-high rounded">
                <span className="w-1.5 h-1.5 rounded-full bg-alert-high" />
                {alertCountsBySeverity.HIGH}
              </span>
            )}
          </div>
        </div>

        {/* Search input */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-maritime-500" />
          <input
            type="text"
            placeholder="Search alerts..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-8 py-1.5 bg-maritime-800 border border-maritime-700 rounded text-white placeholder-maritime-500 text-sm focus:outline-none focus:border-blue-500"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-maritime-500 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Filter toggle */}
        <button
          onClick={() => setShowFilters(!showFilters)}
          className="mt-2 w-full flex items-center justify-between text-xs px-2 py-1.5 rounded bg-maritime-800 hover:bg-maritime-750 text-maritime-300"
        >
          <span className="flex items-center gap-1.5">
            Filters
            {hasActiveFilters && (
              <span className="px-1.5 py-0.5 bg-blue-500 text-white rounded text-xs">
                Active
              </span>
            )}
          </span>
          {showFilters ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {/* Filter panel */}
      {showFilters && (
        <div className="p-3 border-b border-maritime-700 bg-maritime-850 space-y-3">
          {/* Severity filters */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-maritime-400 font-medium">Severity</span>
              <div className="flex gap-2 text-xs">
                <button onClick={selectAllSeverities} className="text-blue-400 hover:text-blue-300">
                  All
                </button>
                <span className="text-maritime-600">|</span>
                <button onClick={selectNoSeverities} className="text-blue-400 hover:text-blue-300">
                  None
                </button>
              </div>
            </div>
            <div className="space-y-1">
              {SEVERITY_LEVELS.map(severity => {
                const config = SEVERITY_CONFIG[severity]
                const count = alertCountsBySeverity[severity]
                return (
                  <label
                    key={severity}
                    className="flex items-center gap-2 cursor-pointer hover:bg-maritime-800/50 p-1 rounded"
                  >
                    <input
                      type="checkbox"
                      checked={selectedSeverities.has(severity)}
                      onChange={() => toggleSeverity(severity)}
                      className="rounded border-maritime-600 bg-maritime-800 text-blue-600 focus:ring-blue-500 focus:ring-offset-0"
                    />
                    <span className={`w-2.5 h-2.5 rounded-full ${config.color}`} />
                    <span className={`text-sm flex-1 ${selectedSeverities.has(severity) ? 'text-white' : 'text-maritime-500'}`}>
                      {config.label}
                    </span>
                    <span className="text-xs text-maritime-500">{count}</span>
                  </label>
                )
              })}
            </div>
          </div>

          {/* Type filters */}
          <div className="pt-2 border-t border-maritime-700">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-maritime-400 font-medium">Alert Type</span>
              <div className="flex gap-2 text-xs">
                <button onClick={selectAllTypes} className="text-blue-400 hover:text-blue-300">
                  All
                </button>
                <span className="text-maritime-600">|</span>
                <button onClick={selectNoTypes} className="text-blue-400 hover:text-blue-300">
                  None
                </button>
              </div>
            </div>
            <div className="space-y-1">
              {ALERT_TYPES.map(type => {
                const Icon = type.icon
                const count = alertCountsByType[type.value]
                return (
                  <label
                    key={type.value}
                    className="flex items-center gap-2 cursor-pointer hover:bg-maritime-800/50 p-1 rounded"
                  >
                    <input
                      type="checkbox"
                      checked={selectedTypes.has(type.value)}
                      onChange={() => toggleType(type.value)}
                      className="rounded border-maritime-600 bg-maritime-800 text-blue-600 focus:ring-blue-500 focus:ring-offset-0"
                    />
                    <Icon className={`w-4 h-4 ${type.color}`} />
                    <span className={`text-sm flex-1 ${selectedTypes.has(type.value) ? 'text-white' : 'text-maritime-500'}`}>
                      {type.label}
                    </span>
                    <span className="text-xs text-maritime-500">{count}</span>
                  </label>
                )
              })}
            </div>
          </div>

          {/* Filter stats */}
          <div className="text-xs text-maritime-400 pt-2 border-t border-maritime-700">
            Showing {filteredAlerts.length} of {alerts.length} alerts
          </div>
        </div>
      )}

      {/* Alert list */}
      <div className="flex-1 overflow-y-auto">
        {filteredAlerts.length === 0 ? (
          <div className="p-8 text-center text-maritime-400">
            <AlertTriangle className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <div className="text-sm">No alerts match your filters</div>
            {hasActiveFilters && (
              <button
                onClick={() => {
                  selectAllSeverities()
                  selectAllTypes()
                  setSearchQuery('')
                }}
                className="mt-2 text-xs text-blue-400 hover:text-blue-300"
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-maritime-800">
            {filteredAlerts.map((alert, index) => (
              <AlertItem
                key={alert.alert_id || index}
                alert={alert}
                onClick={() => onAlertClick?.(alert)}
                isSelected={selectedAlert?.alert_id === alert.alert_id || selectedAlert?.mmsi === alert.mmsi && selectedAlert?.detected_at === alert.detected_at}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function AlertItem({ alert, onClick, isSelected }) {
  const severityClasses = {
    LOW: 'border-l-alert-low',
    MEDIUM: 'border-l-alert-medium',
    HIGH: 'border-l-alert-high',
    CRITICAL: 'border-l-alert-critical',
  }

  const severityBadgeClasses = {
    LOW: 'severity-low',
    MEDIUM: 'severity-medium',
    HIGH: 'severity-high',
    CRITICAL: 'severity-critical',
  }

  const Icon = getAlertIcon(alert.alert_type)
  const timeAgo = alert.detected_at
    ? formatDistanceToNow(new Date(alert.detected_at), { addSuffix: true })
    : 'just now'

  return (
    <div
      className={`p-3 border-l-4 ${severityClasses[alert.severity]} ${isSelected ? 'bg-maritime-700/70 ring-1 ring-blue-500/50' : 'hover:bg-maritime-800/50'} cursor-pointer transition-all`}
      onClick={onClick}
    >
      <div className="flex items-start gap-2">
        <div className={`p-1.5 rounded-lg ${severityBadgeClasses[alert.severity]} border`}>
          <Icon className="w-3.5 h-3.5" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${severityBadgeClasses[alert.severity]} border`}>
              {alert.severity}
            </span>
            <span className="text-xs text-maritime-400">
              {timeAgo}
            </span>
            {isSelected && (
              <span className="text-xs text-blue-400 ml-auto">Selected</span>
            )}
          </div>

          <div className={`font-medium text-sm text-white ${isSelected ? '' : 'truncate'}`}>
            {alert.title}
          </div>

          <div className={`text-xs text-maritime-300 mt-0.5 ${isSelected ? '' : 'line-clamp-2'}`}>
            {alert.description}
          </div>

          {/* Show additional details when selected */}
          {isSelected && alert.details && (
            <div className="mt-2 p-2 bg-maritime-800/50 rounded text-xs space-y-1">
              {alert.details.cable_name && (
                <div className="flex justify-between">
                  <span className="text-maritime-400">Cable:</span>
                  <span className="text-white">{alert.details.cable_name}</span>
                </div>
              )}
              {alert.details.vessel_speed !== undefined && (
                <div className="flex justify-between">
                  <span className="text-maritime-400">Speed:</span>
                  <span className="text-white">{alert.details.vessel_speed?.toFixed(1)} kts</span>
                </div>
              )}
              {alert.details.flag_state && (
                <div className="flex justify-between">
                  <span className="text-maritime-400">Flag:</span>
                  <span className="text-white">{alert.details.flag_state}</span>
                </div>
              )}
              {alert.details.risk_factor && (
                <div className="flex justify-between">
                  <span className="text-maritime-400">Risk:</span>
                  <span className="text-yellow-400">{alert.details.risk_factor}</span>
                </div>
              )}
              {alert.details.drift_distance_m !== undefined && (
                <div className="flex justify-between">
                  <span className="text-maritime-400">Drift:</span>
                  <span className="text-white">{alert.details.drift_distance_m}m</span>
                </div>
              )}
              {alert.details.loiter_duration_minutes !== undefined && (
                <div className="flex justify-between">
                  <span className="text-maritime-400">Duration:</span>
                  <span className="text-white">{alert.details.loiter_duration_minutes} min</span>
                </div>
              )}
            </div>
          )}

          <div className="flex items-center gap-3 mt-1.5 text-xs text-maritime-400">
            <span className="flex items-center gap-1">
              <Ship className="w-3 h-3" />
              {alert.vessel_name || alert.mmsi}
            </span>
            <span className="flex items-center gap-1">
              <MapPin className="w-3 h-3" />
              {alert.latitude?.toFixed(4)}, {alert.longitude?.toFixed(4)}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

function getAlertIcon(alertType) {
  const icons = {
    CABLE_PROXIMITY: Cable,
    ANCHOR_DRAGGING: Anchor,
    TRAJECTORY_PREDICTION: Navigation,
    GEOFENCE_VIOLATION: MapPin,
    DARK_EVENT: Radio,
    AIS_SPOOFING: Ghost,
    RENDEZVOUS: Ship,
    CONVOY: Users,
    FISHING_IN_MPA: Fish,
    LOITERING: Timer,
    SANCTIONS_MATCH: AlertTriangle,
  }

  return icons[alertType] || AlertTriangle
}

/**
 * Alert statistics summary component.
 */
export function AlertStats({ alerts }) {
  const stats = {
    total: alerts.length,
    critical: alerts.filter(a => a.severity === 'CRITICAL').length,
    high: alerts.filter(a => a.severity === 'HIGH').length,
    medium: alerts.filter(a => a.severity === 'MEDIUM').length,
    low: alerts.filter(a => a.severity === 'LOW').length,
  }

  const byType = alerts.reduce((acc, alert) => {
    acc[alert.alert_type] = (acc[alert.alert_type] || 0) + 1
    return acc
  }, {})

  return (
    <div className="p-4 space-y-4">
      <div className="glass-panel p-4">
        <div className="text-sm text-maritime-400 mb-3">By Severity</div>
        <div className="space-y-2">
          <StatBar label="Critical" value={stats.critical} total={stats.total} color="bg-alert-critical" />
          <StatBar label="High" value={stats.high} total={stats.total} color="bg-alert-high" />
          <StatBar label="Medium" value={stats.medium} total={stats.total} color="bg-alert-medium" />
          <StatBar label="Low" value={stats.low} total={stats.total} color="bg-alert-low" />
        </div>
      </div>

      <div className="glass-panel p-4">
        <div className="text-sm text-maritime-400 mb-3">By Type</div>
        <div className="space-y-2">
          {ALERT_TYPES.map(type => {
            const count = byType[type.value] || 0
            const Icon = type.icon
            return (
              <div key={type.value} className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm text-maritime-300">
                  <Icon className={`w-4 h-4 ${type.color}`} />
                  {type.label}
                </span>
                <span className="text-white font-medium">{count}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function StatBar({ label, value, total, color }) {
  const percentage = total > 0 ? (value / total) * 100 : 0

  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-maritime-300">{label}</span>
        <span className="text-white">{value}</span>
      </div>
      <div className="h-1.5 bg-maritime-800 rounded-full overflow-hidden">
        <div
          className={`h-full ${color} rounded-full transition-all duration-500`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  )
}
