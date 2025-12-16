import React from 'react'
import { formatDistanceToNow } from 'date-fns'
import {
  AlertTriangle,
  Radio,
  MapPin,
  Ship,
  Anchor,
  Fish,
} from 'lucide-react'

/**
 * Real-time alert feed component.
 */
export default function AlertFeed({ alerts = [], onAlertClick }) {
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
    <div className="h-full overflow-y-auto">
      <div className="p-4 border-b border-maritime-700 sticky top-0 bg-maritime-900/95 backdrop-blur z-10">
        <div className="flex items-center justify-between">
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
      </div>

      <div className="divide-y divide-maritime-800">
        {alerts.map((alert, index) => (
          <AlertItem
            key={alert.alert_id || index}
            alert={alert}
            onClick={() => onAlertClick?.(alert)}
          />
        ))}
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
    GEOFENCE_VIOLATION: MapPin,
    DARK_EVENT: Radio,
    RENDEZVOUS: Anchor,
    FISHING_IN_MPA: Fish,
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
    GEOFENCE_VIOLATION: 'Geofence',
    DARK_EVENT: 'Gone Dark',
    RENDEZVOUS: 'Rendezvous',
    FISHING_IN_MPA: 'Illegal Fishing',
    SANCTIONS_MATCH: 'Sanctions',
  }
  return names[type] || type
}
