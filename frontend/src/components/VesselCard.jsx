import React from 'react'
import { formatDistanceToNow } from 'date-fns'
import {
  X,
  Ship,
  Navigation,
  Compass,
  Gauge,
  Flag,
  MapPin,
  Clock,
  Anchor,
  AlertTriangle,
} from 'lucide-react'
import {
  getVesselTypeName,
  getVesselCategory,
  formatCoordinates,
  formatSpeed,
  formatCourse,
  getNavStatusName,
  getFlagState,
} from '../utils/geo'

/**
 * Vessel detail card shown when a vessel is selected.
 */
export default function VesselCard({ vessel, onClose, alerts = [], selectedAlert = null, onAlertClick }) {
  if (!vessel) return null

  const category = getVesselCategory(vessel.ship_type)
  const vesselAlerts = alerts.filter(a => a.mmsi === vessel.mmsi)
  const flagState = getFlagState(vessel.mmsi)

  // If there's a selected alert for this vessel, show it prominently
  const activeAlert = selectedAlert && selectedAlert.mmsi === vessel.mmsi ? selectedAlert : null

  return (
    <div className="glass-panel w-80 max-h-[80vh] overflow-hidden flex flex-col">
      {/* Flagged state warning banner */}
      {flagState.flagged && (
        <div className="bg-red-950/90 border-b border-red-800 px-4 py-2">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <span className="text-red-200 text-xs font-medium uppercase tracking-wide">
              Monitored Flag State
            </span>
          </div>
        </div>
      )}

      {/* Active Alert Detail - shown when an alert is selected */}
      {activeAlert && (
        <div className={`p-4 border-b-2 ${
          activeAlert.severity === 'CRITICAL' ? 'bg-red-950/90 border-red-500' :
          activeAlert.severity === 'HIGH' ? 'bg-orange-950/90 border-orange-500' :
          activeAlert.severity === 'MEDIUM' ? 'bg-amber-950/90 border-amber-500' :
          'bg-green-950/90 border-green-500'
        }`}>
          <div className="flex items-start gap-2 mb-2">
            <AlertTriangle className={`w-5 h-5 flex-shrink-0 ${
              activeAlert.severity === 'CRITICAL' ? 'text-red-400' :
              activeAlert.severity === 'HIGH' ? 'text-orange-400' :
              activeAlert.severity === 'MEDIUM' ? 'text-amber-400' :
              'text-green-400'
            }`} />
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                  activeAlert.severity === 'CRITICAL' ? 'bg-red-500/30 text-red-300' :
                  activeAlert.severity === 'HIGH' ? 'bg-orange-500/30 text-orange-300' :
                  activeAlert.severity === 'MEDIUM' ? 'bg-amber-500/30 text-amber-300' :
                  'bg-green-500/30 text-green-300'
                }`}>
                  {activeAlert.severity}
                </span>
                <span className="text-xs text-maritime-400">
                  {activeAlert.detected_at && formatDistanceToNow(new Date(activeAlert.detected_at), { addSuffix: true })}
                </span>
              </div>
              <div className="font-semibold text-white text-sm mb-1">
                {activeAlert.title}
              </div>
              <div className="text-sm text-maritime-200 leading-relaxed">
                {activeAlert.description}
              </div>

              {/* Alert Details */}
              {activeAlert.details && Object.keys(activeAlert.details).length > 0 && (
                <div className="mt-3 p-2 bg-black/30 rounded text-xs space-y-1">
                  {activeAlert.details.cable_name && (
                    <div className="flex justify-between">
                      <span className="text-maritime-400">Cable:</span>
                      <span className="text-white font-medium">{activeAlert.details.cable_name}</span>
                    </div>
                  )}
                  {activeAlert.details.zone_name && (
                    <div className="flex justify-between">
                      <span className="text-maritime-400">Zone:</span>
                      <span className="text-white font-medium">{activeAlert.details.zone_name}</span>
                    </div>
                  )}
                  {activeAlert.details.vessel_speed !== undefined && (
                    <div className="flex justify-between">
                      <span className="text-maritime-400">Speed:</span>
                      <span className="text-white font-medium">{activeAlert.details.vessel_speed?.toFixed(1)} kts</span>
                    </div>
                  )}
                  {activeAlert.details.distance_meters !== undefined && (
                    <div className="flex justify-between">
                      <span className="text-maritime-400">Distance:</span>
                      <span className="text-white font-medium">{activeAlert.details.distance_meters}m</span>
                    </div>
                  )}
                  {activeAlert.details.gap_minutes !== undefined && (
                    <div className="flex justify-between">
                      <span className="text-maritime-400">Gap Duration:</span>
                      <span className="text-white font-medium">{activeAlert.details.gap_minutes} min</span>
                    </div>
                  )}
                  {activeAlert.details.drift_distance_m !== undefined && (
                    <div className="flex justify-between">
                      <span className="text-maritime-400">Drift:</span>
                      <span className="text-white font-medium">{activeAlert.details.drift_distance_m}m</span>
                    </div>
                  )}
                  {activeAlert.details.loiter_duration_minutes !== undefined && (
                    <div className="flex justify-between">
                      <span className="text-maritime-400">Duration:</span>
                      <span className="text-white font-medium">{activeAlert.details.loiter_duration_minutes} min</span>
                    </div>
                  )}
                  {activeAlert.details.risk_factor && (
                    <div className="flex justify-between">
                      <span className="text-maritime-400">Risk Factor:</span>
                      <span className="text-yellow-400 font-medium">{activeAlert.details.risk_factor}</span>
                    </div>
                  )}
                  {activeAlert.details.flag_state && (
                    <div className="flex justify-between">
                      <span className="text-maritime-400">Flag:</span>
                      <span className="text-white font-medium">{activeAlert.details.flag_state}</span>
                    </div>
                  )}
                  {activeAlert.details.sanctioned_name && (
                    <div className="flex justify-between">
                      <span className="text-maritime-400">Sanctioned As:</span>
                      <span className="text-red-400 font-medium">{activeAlert.details.sanctioned_name}</span>
                    </div>
                  )}
                  {activeAlert.details.sanctions_authorities && (
                    <div className="flex justify-between">
                      <span className="text-maritime-400">Sanctions:</span>
                      <span className="text-red-400 font-medium">
                        {Array.isArray(activeAlert.details.sanctions_authorities)
                          ? activeAlert.details.sanctions_authorities.join(', ')
                          : activeAlert.details.sanctions_authorities}
                      </span>
                    </div>
                  )}
                  {activeAlert.details.risk_score !== undefined && (
                    <div className="flex justify-between">
                      <span className="text-maritime-400">Risk Score:</span>
                      <span className={`font-medium ${
                        activeAlert.details.risk_score >= 75 ? 'text-red-400' :
                        activeAlert.details.risk_score >= 50 ? 'text-orange-400' :
                        activeAlert.details.risk_score >= 25 ? 'text-yellow-400' : 'text-green-400'
                      }`}>{activeAlert.details.risk_score}/100</span>
                    </div>
                  )}
                  {activeAlert.details.reason && (
                    <div className="mt-1 pt-1 border-t border-maritime-700">
                      <span className="text-maritime-400">Reason: </span>
                      <span className="text-white">{activeAlert.details.reason}</span>
                    </div>
                  )}
                  {activeAlert.details.notes && (
                    <div className="mt-1 pt-1 border-t border-maritime-700">
                      <span className="text-maritime-400">Notes: </span>
                      <span className="text-white">{activeAlert.details.notes}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className={`p-4 border-b border-maritime-700 ${
        flagState.flagged
          ? 'bg-gradient-to-r from-red-950/50 to-maritime-900'
          : 'bg-gradient-to-r from-maritime-800 to-maritime-900'
      }`}>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            {/* Flag emoji */}
            <div className="text-4xl">{flagState.flag}</div>
            <div>
              <h3 className="font-bold text-lg text-white">
                {vessel.ship_name || 'Unknown Vessel'}
              </h3>
              <div className="flex items-center gap-2">
                <span className="text-sm text-maritime-300">
                  {getVesselTypeName(vessel.ship_type)}
                </span>
                <span className="text-maritime-500">•</span>
                <span className={`text-sm ${flagState.flagged ? 'text-red-400' : 'text-maritime-400'}`}>
                  {flagState.name}
                </span>
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-maritime-700 rounded transition-colors"
          >
            <X className="w-5 h-5 text-maritime-400" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Identifiers */}
        <Section title="Identification">
          <InfoRow icon={Ship} label="MMSI" value={vessel.mmsi} />
          <InfoRow
            icon={Flag}
            label="Flag"
            value={
              <span className="flex items-center gap-1.5">
                <span>{flagState.flag}</span>
                <span>{flagState.name}</span>
                {flagState.flagged && (
                  <span className="px-1 py-0.5 bg-red-500/20 text-red-400 text-[10px] rounded font-medium">
                    MONITORED
                  </span>
                )}
              </span>
            }
          />
          {vessel.imo_number && (
            <InfoRow icon={Anchor} label="IMO" value={vessel.imo_number} />
          )}
          {vessel.call_sign && (
            <InfoRow icon={Navigation} label="Call Sign" value={vessel.call_sign} />
          )}
        </Section>

        {/* Position & Movement */}
        <Section title="Position & Movement">
          <InfoRow
            icon={MapPin}
            label="Position"
            value={formatCoordinates(vessel.latitude, vessel.longitude)}
          />
          <InfoRow
            icon={Gauge}
            label="Speed"
            value={formatSpeed(vessel.speed_over_ground)}
          />
          <InfoRow
            icon={Compass}
            label="Course"
            value={formatCourse(vessel.course_over_ground)}
          />
          {vessel.heading != null && (
            <InfoRow
              icon={Navigation}
              label="Heading"
              value={`${Math.round(vessel.heading)}°`}
            />
          )}
          {vessel.nav_status != null && (
            <InfoRow
              icon={Anchor}
              label="Status"
              value={getNavStatusName(vessel.nav_status)}
            />
          )}
        </Section>

        {/* Voyage Info */}
        {(vessel.destination || vessel.eta) && (
          <Section title="Voyage">
            {vessel.destination && (
              <InfoRow icon={MapPin} label="Destination" value={vessel.destination} />
            )}
            {vessel.eta && (
              <InfoRow icon={Clock} label="ETA" value={vessel.eta} />
            )}
            {vessel.draught && (
              <InfoRow icon={Anchor} label="Draught" value={`${vessel.draught}m`} />
            )}
          </Section>
        )}

        {/* Dimensions */}
        {vessel.dimension_a && vessel.dimension_b && (
          <Section title="Dimensions">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="bg-maritime-800 rounded p-2 text-center">
                <div className="text-maritime-400 text-xs">Length</div>
                <div className="text-white font-medium">
                  {vessel.dimension_a + vessel.dimension_b}m
                </div>
              </div>
              {vessel.dimension_c && vessel.dimension_d && (
                <div className="bg-maritime-800 rounded p-2 text-center">
                  <div className="text-maritime-400 text-xs">Width</div>
                  <div className="text-white font-medium">
                    {vessel.dimension_c + vessel.dimension_d}m
                  </div>
                </div>
              )}
            </div>
          </Section>
        )}

        {/* Recent Alerts */}
        {vesselAlerts.length > 0 && (
          <Section title={`Recent Alerts (${vesselAlerts.length})`}>
            <div className="space-y-2">
              {vesselAlerts.slice(0, 5).map((alert, i) => {
                const isActive = activeAlert && (activeAlert.alert_id === alert.alert_id ||
                  (activeAlert.mmsi === alert.mmsi && activeAlert.detected_at === alert.detected_at))
                return (
                  <div
                    key={alert.alert_id || i}
                    onClick={() => onAlertClick?.(alert)}
                    className={`p-2 rounded border-l-2 cursor-pointer transition-all ${
                      isActive
                        ? 'bg-maritime-700 ring-1 ring-blue-500/50'
                        : 'bg-maritime-800/50 hover:bg-maritime-700/50'
                    } ${
                      alert.severity === 'CRITICAL' ? 'border-l-red-500' :
                      alert.severity === 'HIGH' ? 'border-l-orange-500' :
                      alert.severity === 'MEDIUM' ? 'border-l-amber-500' :
                      'border-l-green-500'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <AlertTriangle className={`w-3 h-3 ${
                        alert.severity === 'CRITICAL' ? 'text-red-400' :
                        alert.severity === 'HIGH' ? 'text-orange-400' :
                        alert.severity === 'MEDIUM' ? 'text-amber-400' :
                        'text-green-400'
                      }`} />
                      <span className="text-sm text-white flex-1 truncate">{alert.title}</span>
                      {isActive && (
                        <span className="text-xs text-blue-400">Selected</span>
                      )}
                    </div>
                    <div className="text-xs text-maritime-400 mt-1">
                      {alert.detected_at && formatDistanceToNow(new Date(alert.detected_at), { addSuffix: true })}
                    </div>
                  </div>
                )
              })}
            </div>
          </Section>
        )}

        {/* Last Update */}
        <div className="text-xs text-maritime-500 text-center pt-2 border-t border-maritime-800">
          Last update: {vessel.timestamp
            ? formatDistanceToNow(new Date(vessel.timestamp), { addSuffix: true })
            : 'Unknown'}
        </div>
      </div>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div>
      <h4 className="text-xs font-semibold text-maritime-400 uppercase tracking-wider mb-2">
        {title}
      </h4>
      <div className="space-y-2">
        {children}
      </div>
    </div>
  )
}

function InfoRow({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <Icon className="w-4 h-4 text-maritime-500 flex-shrink-0" />
      <span className="text-maritime-400 flex-shrink-0">{label}</span>
      <span className="text-white ml-auto font-medium truncate">{value}</span>
    </div>
  )
}

/**
 * Compact vessel list item for sidebar.
 */
export function VesselListItem({ vessel, isSelected, onClick }) {
  const category = getVesselCategory(vessel.ship_type)
  const flagState = getFlagState(vessel.mmsi)

  return (
    <div
      className={`p-3 cursor-pointer transition-colors border-l-2 ${
        isSelected
          ? 'bg-maritime-700/50 border-l-blue-500'
          : flagState.flagged
            ? 'hover:bg-red-950/30 border-l-red-500/50'
            : 'hover:bg-maritime-800/50 border-l-transparent'
      }`}
      onClick={onClick}
    >
      <div className="flex items-center gap-3">
        <div className="text-xl">{flagState.flag}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`font-medium truncate ${flagState.flagged ? 'text-red-300' : 'text-white'}`}>
              {vessel.ship_name || vessel.mmsi}
            </span>
            {flagState.flagged && (
              <span className="flex-shrink-0 w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            )}
          </div>
          <div className="text-xs text-maritime-400 flex items-center gap-2">
            <span>{flagState.code}</span>
            <span>•</span>
            <span>{formatSpeed(vessel.speed_over_ground)}</span>
            <span>•</span>
            <span>{formatCourse(vessel.course_over_ground)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
