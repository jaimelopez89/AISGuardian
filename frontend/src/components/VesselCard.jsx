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
export default function VesselCard({ vessel, onClose, alerts = [] }) {
  if (!vessel) return null

  const category = getVesselCategory(vessel.ship_type)
  const vesselAlerts = alerts.filter(a => a.mmsi === vessel.mmsi)
  const flagState = getFlagState(vessel.mmsi)

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
          <Section title="Recent Alerts">
            <div className="space-y-2">
              {vesselAlerts.slice(0, 5).map((alert, i) => (
                <div
                  key={alert.alert_id || i}
                  className={`p-2 rounded border-l-2 bg-maritime-800/50 border-l-alert-${alert.severity?.toLowerCase()}`}
                >
                  <div className="flex items-center gap-2">
                    <AlertTriangle className={`w-3 h-3 text-alert-${alert.severity?.toLowerCase()}`} />
                    <span className="text-sm text-white">{alert.title}</span>
                  </div>
                  <div className="text-xs text-maritime-400 mt-1">
                    {alert.detected_at && formatDistanceToNow(new Date(alert.detected_at), { addSuffix: true })}
                  </div>
                </div>
              ))}
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
