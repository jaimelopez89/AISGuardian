import { useState, useEffect, useCallback, useRef } from 'react'

/**
 * Hook for fetching vessel positions from the backend API.
 *
 * @param {Object} options - Configuration options
 * @returns {Object} - { vessels, isConnected, error, stats }
 */
export function useVesselPositions(options = {}) {
  const {
    baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:8000',
    pollInterval = 2000,
  } = options

  const [vessels, setVessels] = useState([])
  const [vesselMap, setVesselMap] = useState(new Map())
  const [isConnected, setIsConnected] = useState(false)
  const [error, setError] = useState(null)
  const [stats, setStats] = useState({ messagesPerSecond: 0, totalMessages: 0 })

  const lastCountRef = useRef(0)

  const fetchVessels = useCallback(async () => {
    try {
      const response = await fetch(`${baseUrl}/api/vessels`)

      if (!response.ok) {
        throw new Error(`Failed to fetch vessels: ${response.statusText}`)
      }

      const data = await response.json()
      const vesselList = data.vessels || []

      // Update vessel map and list
      const newMap = new Map()
      vesselList.forEach(v => {
        newMap.set(v.mmsi, { ...v, lastUpdate: Date.now() })
      })

      setVesselMap(newMap)
      setVessels(vesselList)
      setIsConnected(true)
      setError(null)

      // Update stats
      const newCount = vesselList.length
      if (newCount !== lastCountRef.current) {
        setStats(prev => ({
          messagesPerSecond: Math.abs(newCount - lastCountRef.current),
          totalMessages: prev.totalMessages + Math.abs(newCount - lastCountRef.current),
        }))
        lastCountRef.current = newCount
      }

    } catch (err) {
      setError(err.message)
      setIsConnected(false)
    }
  }, [baseUrl])

  useEffect(() => {
    // Initial fetch
    fetchVessels()

    // Start polling
    const interval = setInterval(fetchVessels, pollInterval)

    return () => clearInterval(interval)
  }, [fetchVessels, pollInterval])

  return {
    vessels,
    vesselMap,
    isConnected,
    error,
    stats,
  }
}

/**
 * Hook for fetching alerts from the backend API.
 *
 * @param {Object} options - Configuration options
 * @returns {Object} - { alerts, alertsBySeverity, isConnected, error }
 */
export function useAlerts(options = {}) {
  const {
    baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:8000',
    pollInterval = 2000,
  } = options

  const [alerts, setAlerts] = useState([])
  const [isConnected, setIsConnected] = useState(false)
  const [error, setError] = useState(null)

  const fetchAlerts = useCallback(async () => {
    try {
      const response = await fetch(`${baseUrl}/api/alerts?limit=100`)

      if (!response.ok) {
        throw new Error(`Failed to fetch alerts: ${response.statusText}`)
      }

      const data = await response.json()
      setAlerts(data.alerts || [])
      setIsConnected(true)
      setError(null)

    } catch (err) {
      setError(err.message)
      setIsConnected(false)
    }
  }, [baseUrl])

  useEffect(() => {
    // Initial fetch
    fetchAlerts()

    // Start polling
    const interval = setInterval(fetchAlerts, pollInterval)

    return () => clearInterval(interval)
  }, [fetchAlerts, pollInterval])

  // Group alerts by severity
  const alertsBySeverity = {
    critical: alerts.filter(a => a.severity === 'CRITICAL'),
    high: alerts.filter(a => a.severity === 'HIGH'),
    medium: alerts.filter(a => a.severity === 'MEDIUM'),
    low: alerts.filter(a => a.severity === 'LOW'),
  }

  return {
    alerts,
    alertsBySeverity,
    isConnected,
    error,
    stats: { totalMessages: alerts.length },
  }
}

/**
 * Legacy hook for backwards compatibility.
 * Now wraps useVesselPositions.
 */
export function useKafkaStream(topic, options = {}) {
  if (topic === 'ais-raw') {
    return useVesselPositions(options)
  }
  if (topic === 'alerts' || topic === 'ais-alerts') {
    return useAlerts(options)
  }

  // Default: return empty state
  return {
    messages: [],
    isConnected: false,
    error: `Unknown topic: ${topic}`,
    stats: { messagesPerSecond: 0, totalMessages: 0 },
  }
}

export default useKafkaStream
