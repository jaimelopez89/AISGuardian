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
  Filter,
  X,
} from 'lucide-react'

// Available alert types for filtering
const ALERT_TYPES = [
  { value: 'CABLE_PROXIMITY', label: 'Cable Proximity', icon: Cable },
  { value: 'GEOFENCE_VIOLATION', label: 'Geofence', icon: MapPin },
  { value: 'DARK_EVENT', label: 'Gone Dark', icon: Radio },
  { value: 'RENDEZVOUS', label: 'Rendezvous', icon: Anchor },
  { value: 'FISHING_IN_MPA', label: 'Illegal Fishing', icon: Fish },
  { value: 'LOITERING', label: 'Loitering', icon: Timer },
  { value: 'SANCTIONS_MATCH', label: 'Sanctions', icon: AlertTriangle },
]

const SEVERITY_LEVELS = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']

/**
 * Real-time alert feed component with filtering.
 */
export default function AlertFeed({ alerts = [], onAlertClick }) {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedSeverities, setSelectedSeverities] = useState(new Set(SEVERITY_LEVELS))
  const [selectedTypes, setSelectedTypes] = useState(new Set(ALERT_TYPES.map(t => t.value)))
  const [showFilters, setShowFilters] = useState(false)

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

  const clearFilters = () => {
    setSearchQuery('')
    setSelectedSeverities(new Set(SEVERITY_LEVELS))
    setSelectedTypes(new Set(ALERT_TYPES.map(t => t.value)))
  }

  const hasActiveFilters = searchQuery ||
    selectedSeverities.size < SEVERITY_LEVELS.length ||
    selectedTypes.size < ALERT_TYPES.length

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
      {/* Header with search and filter toggle */}
      <div className="p-4 border-b border-maritime-700 bg-maritime-900/95 backdrop-blur z-10">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-lg">Live Alerts</h2>
          <div className="flex items-center gap-2 text-xs">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-alert-critical animate-pulse" />
              {alerts.filter(a => a.severity === 'CRITICAL').length}
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-alert-high" />
              {alerts.filter(a => a.severity === 'HIGH').length}
            </span>
          </div>
        </div>

        {/* Search input */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-maritime-500" />
          <input
            type="text"
            placeholder="Search alerts..."
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

        {/* Filter toggle button */}
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`mt-2 flex items-center gap-2 text-xs px-2 py-1 rounded ${
            showFilters || hasActiveFilters
              ? 'bg-blue-500/20 text-blue-400'
              : 'text-maritime-400 hover:text-white'
          }`}
        >
          <Filter className="w-3 h-3" />
          <span>Filters</span>
          {hasActiveFilters && (
            <span className="px-1.5 py-0.5 bg-blue-500 text-white rounded-full text-xs">
              {(SEVERITY_LEVELS.length - selectedSeverities.size) +
               (ALERT_TYPES.length - selectedTypes.size) +
               (searchQuery ? 1 : 0)}
            </span>
          )}
        </button>
      </div>

      {/* Filter panel */}
      {showFilters && (
        <div className="p-4 border-b border-maritime-700 bg-maritime-850 space-y-3">
          {/* Severity filters */}
          <div>
            <div className="text-xs text-maritime-400 mb-2">Severity</div>
            <div className="flex flex-wrap gap-1">
              {SEVERITY_LEVELS.map(severity => (
                <button
                  key={severity}
                  onClick={() => toggleSeverity(severity)}
                  className={`px-2 py-1 text-xs rounded border transition-colors ${
                    selectedSeverities.has(severity)
                      ? `severity-${severity.toLowerCase()} border-current`
                      : 'bg-maritime-800 border-maritime-700 text-maritime-500'
                  }`}
                >
                  {severity}
                </button>
              ))}
            </div>
          </div>

          {/* Type filters */}
          <div>
            <div className="text-xs text-maritime-400 mb-2">Alert Type</div>
            <div className="flex flex-wrap gap-1">
              {ALERT_TYPES.map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => toggleType(value)}
                  className={`px-2 py-1 text-xs rounded border transition-colors ${
                    selectedTypes.has(value)
                      ? 'bg-blue-500/20 border-blue-500/50 text-blue-400'
                      : 'bg-maritime-800 border-maritime-700 text-maritime-500'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Clear filters */}
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="text-xs text-maritime-400 hover:text-white flex items-center gap-1"
            >
              <X className="w-3 h-3" />
              Clear all filters
            </button>
          )}
        </div>
      )}

      {/* Results count */}
      {hasActiveFilters && (
        <div className="px-4 py-2 text-xs text-maritime-400 border-b border-maritime-700">
          Showing {filteredAlerts.length} of {alerts.length} alerts
        </div>
      )}

      {/* Alert list */}
      <div className="flex-1 overflow-y-auto">
        {filteredAlerts.length === 0 ? (
          <div className="p-8 text-center text-maritime-400">
            <Filter className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <div className="text-sm">No alerts match your filters</div>
          </div>
        ) : (
          <div className="divide-y divide-maritime-800">
            {filteredAlerts.map((alert, index) => (
              <AlertItem
                key={alert.alert_id || index}
                alert={alert}
                onClick={() => onAlertClick?.(alert)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function AlertItem({ alert, onClick }) {
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
      className={`p-4 border-l-4 ${severityClasses[alert.severity]} hover:bg-maritime-800/50 cursor-pointer transition-colors`}
      onClick={onClick}
    >
      <div className="flex items-start gap-3">
        <div className={`p-2 rounded-lg ${severityBadgeClasses[alert.severity]} border`}>
          <Icon className="w-4 h-4" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-xs font-medium px-2 py-0.5 rounded ${severityBadgeClasses[alert.severity]} border`}>
              {alert.severity}
            </span>
            <span className="text-xs text-maritime-400">
              {timeAgo}
            </span>
          </div>

          <div className="font-medium text-white truncate">
            {alert.title}
          </div>

          <div className="text-sm text-maritime-300 mt-1 line-clamp-2">
            {alert.description}
          </div>

          <div className="flex items-center gap-4 mt-2 text-xs text-maritime-400">
            <span className="flex items-center gap-1">
              <Ship className="w-3 h-3" />
              {alert.vessel_name || alert.mmsi}
            </span>
            <span className="flex items-center gap-1">
              <MapPin className="w-3 h-3" />
              {alert.latitude?.toFixed(3)}, {alert.longitude?.toFixed(3)}
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
    GEOFENCE_VIOLATION: MapPin,
    DARK_EVENT: Radio,
    RENDEZVOUS: Anchor,
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
    <div className="grid grid-cols-2 gap-4 p-4">
      <div className="glass-panel p-4">
        <div className="text-sm text-maritime-400 mb-2">By Severity</div>
        <div className="space-y-2">
          <StatBar label="Critical" value={stats.critical} total={stats.total} color="bg-alert-critical" />
          <StatBar label="High" value={stats.high} total={stats.total} color="bg-alert-high" />
          <StatBar label="Medium" value={stats.medium} total={stats.total} color="bg-alert-medium" />
          <StatBar label="Low" value={stats.low} total={stats.total} color="bg-alert-low" />
        </div>
      </div>

      <div className="glass-panel p-4">
        <div className="text-sm text-maritime-400 mb-2">By Type</div>
        <div className="space-y-2 text-sm">
          {Object.entries(byType).map(([type, count]) => (
            <div key={type} className="flex justify-between">
              <span className="text-maritime-300">{formatAlertType(type)}</span>
              <span className="text-white font-medium">{count}</span>
            </div>
          ))}
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

function formatAlertType(type) {
  const names = {
    CABLE_PROXIMITY: 'Cable Proximity',
    GEOFENCE_VIOLATION: 'Geofence',
    DARK_EVENT: 'Gone Dark',
    RENDEZVOUS: 'Rendezvous',
    FISHING_IN_MPA: 'Illegal Fishing',
    LOITERING: 'Loitering',
    SANCTIONS_MATCH: 'Sanctions',
  }
  return names[type] || type
}
