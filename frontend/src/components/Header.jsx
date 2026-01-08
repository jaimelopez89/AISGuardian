import React from 'react'
import { Radio, AlertTriangle, Activity, Ship } from 'lucide-react'

/**
 * Application header with live stats.
 */
export default function Header({ vesselCount, alertCount, isConnected, messagesPerSecond }) {
  return (
    <header className="bg-maritime-900 border-b border-maritime-700 px-4 py-3">
      <div className="flex items-center justify-between">
        {/* Logo & Title */}
        <div className="flex items-center gap-3">
          <img
            src="/aisguardian_favicon.png"
            alt="AIS Guardian"
            className="w-10 h-10"
          />
          <div>
            <h1 className="text-xl font-bold text-white">AIS Guardian</h1>
            <p className="text-xs text-maritime-400">Baltic Sea Infrastructure Protection</p>
          </div>
        </div>

        {/* Live Stats */}
        <div className="flex items-center gap-6">
          <StatBadge
            icon={Ship}
            label="Vessels"
            value={vesselCount}
            color="text-blue-400"
          />
          <StatBadge
            icon={AlertTriangle}
            label="Alerts"
            value={alertCount}
            color="text-orange-400"
          />
          <StatBadge
            icon={Activity}
            label="Msg/sec"
            value={messagesPerSecond}
            color="text-green-400"
          />

          {/* Connection Status */}
          <div className="flex items-center gap-2 pl-4 border-l border-maritime-700">
            <div className="relative">
              <Radio className={`w-4 h-4 ${isConnected ? 'text-green-400' : 'text-red-400'}`} />
              {isConnected && (
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-green-400 rounded-full animate-ping-slow" />
              )}
            </div>
            <span className={`text-sm ${isConnected ? 'text-green-400' : 'text-red-400'}`}>
              {isConnected ? 'Live' : 'Disconnected'}
            </span>
          </div>
        </div>
      </div>
    </header>
  )
}

function StatBadge({ icon: Icon, label, value, color }) {
  const displayValue = typeof value === 'number' && !isNaN(value)
    ? value.toLocaleString()
    : '0'

  return (
    <div className="flex items-center gap-2">
      <Icon className={`w-4 h-4 ${color}`} />
      <div>
        <div className="text-lg font-bold text-white">{displayValue}</div>
        <div className="text-xs text-maritime-400">{label}</div>
      </div>
    </div>
  )
}
