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
    pollInterval = 10000, // Increased from 2s to 10s to reduce bandwidth by 80%
    hiddenPollInterval = 60000, // 60s when tab is hidden (6× slower, 83% reduction)
    useSSE = true, // Use Server-Sent Events for real-time updates (70% bandwidth reduction)
    bounds = null, // Viewport bounds { minLat, maxLat, minLon, maxLon } for filtering (80-90% reduction)
  } = options

  const [vessels, setVessels] = useState([])
  const [vesselMap, setVesselMap] = useState(new Map())
  const [isConnected, setIsConnected] = useState(false)
  const [error, setError] = useState(null)
  const [stats, setStats] = useState({ messagesPerSecond: 0, totalMessages: 0 })
  const [connectionMode, setConnectionMode] = useState('connecting') // 'sse', 'polling', 'connecting'

  // Track message rate over time
  const messageCountsRef = useRef([])
  const lastVesselDataRef = useRef(new Map())
  const sseRef = useRef(null)
  const pollingIntervalRef = useRef(null)
  const sseRetriesRef = useRef(0)
  const maxSSERetries = 3

  const fetchVessels = useCallback(async () => {
    try {
      // Build query string with minimal=true and optional viewport bounds
      let url = `${baseUrl}/api/vessels?minimal=true`

      // Add viewport bounds if available (only send vessels in view)
      if (bounds && bounds.minLat && bounds.maxLat && bounds.minLon && bounds.maxLon) {
        url += `&min_lat=${bounds.minLat}&max_lat=${bounds.maxLat}&min_lon=${bounds.minLon}&max_lon=${bounds.maxLon}`
      }

      const response = await fetch(url)

      if (!response.ok) {
        throw new Error(`Failed to fetch vessels: ${response.statusText}`)
      }

      const data = await response.json()
      const vesselList = data.vessels || []

      // Count how many vessels have updated positions since last fetch
      let updatedCount = 0
      const newDataMap = new Map()
      vesselList.forEach(v => {
        const key = `${v.mmsi}-${v.latitude}-${v.longitude}`
        newDataMap.set(v.mmsi, key)

        const lastKey = lastVesselDataRef.current.get(v.mmsi)
        if (lastKey !== key) {
          updatedCount++
        }
      })
      lastVesselDataRef.current = newDataMap

      // Update vessel map and list
      const newMap = new Map()
      vesselList.forEach(v => {
        newMap.set(v.mmsi, { ...v, lastUpdate: Date.now() })
      })

      setVesselMap(newMap)
      setVessels(vesselList)
      setIsConnected(true)
      setError(null)

      // Track message rate (rolling window of last 5 seconds)
      const now = Date.now()
      messageCountsRef.current.push({ time: now, count: updatedCount })
      messageCountsRef.current = messageCountsRef.current.filter(m => now - m.time < 5000)

      const totalInWindow = messageCountsRef.current.reduce((sum, m) => sum + m.count, 0)
      const windowSeconds = Math.max(1, (now - (messageCountsRef.current[0]?.time || now)) / 1000)
      const msgPerSec = Math.round(totalInWindow / windowSeconds)

      setStats(prev => ({
        messagesPerSecond: msgPerSec,
        totalMessages: prev.totalMessages + updatedCount,
      }))

    } catch (err) {
      setError(err.message)
      setIsConnected(false)
    }
  }, [baseUrl, bounds])

  const updateVesselsFromSSE = useCallback((vessels) => {
    const now = Date.now()
    const updatedCount = vessels.length

    // Merge changed vessels into existing map
    setVesselMap(prev => {
      const newMap = new Map(prev)
      vessels.forEach(v => {
        newMap.set(v.mmsi, { ...v, lastUpdate: now })
      })
      return newMap
    })

    // Also update vessels array
    setVessels(prev => {
      const vesselMap = new Map(prev.map(v => [v.mmsi, v]))
      vessels.forEach(v => {
        vesselMap.set(v.mmsi, v)
      })
      return Array.from(vesselMap.values())
    })

    // Track message rate
    messageCountsRef.current.push({ time: now, count: updatedCount })
    messageCountsRef.current = messageCountsRef.current.filter(m => now - m.time < 5000)

    const totalInWindow = messageCountsRef.current.reduce((sum, m) => sum + m.count, 0)
    const windowSeconds = Math.max(1, (now - (messageCountsRef.current[0]?.time || now)) / 1000)
    const msgPerSec = Math.round(totalInWindow / windowSeconds)

    setStats(prev => ({
      messagesPerSecond: msgPerSec,
      totalMessages: prev.totalMessages + updatedCount,
    }))
  }, [])

  const startPolling = useCallback(() => {
    console.log('[useVesselPositions] Starting polling mode')
    setConnectionMode('polling')

    // Clear any existing polling interval
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current)
    }

    // Initial fetch
    fetchVessels()

    // Start polling
    pollingIntervalRef.current = setInterval(fetchVessels, pollInterval)
  }, [fetchVessels, pollInterval])

  const startSSE = useCallback(() => {
    // Don't retry SSE if we've exceeded max retries
    if (sseRetriesRef.current >= maxSSERetries) {
      console.log('[useVesselPositions] Max SSE retries exceeded, staying in polling mode')
      return
    }

    console.log('[useVesselPositions] Attempting SSE connection')

    try {
      // Close existing SSE connection if any
      if (sseRef.current) {
        sseRef.current.close()
      }

      const eventSource = new EventSource(`${baseUrl}/api/stream/vessels`)

      eventSource.onopen = () => {
        console.log('[useVesselPositions] SSE connected')
        setConnectionMode('sse')
        setIsConnected(true)
        setError(null)
        sseRetriesRef.current = 0 // Reset retry counter on success

        // Do initial fetch to populate state
        fetchVessels()
      }

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          if (data.vessels && Array.isArray(data.vessels)) {
            updateVesselsFromSSE(data.vessels)
          }
        } catch (err) {
          console.error('[useVesselPositions] Failed to parse SSE message:', err)
        }
      }

      eventSource.onerror = (err) => {
        console.error('[useVesselPositions] SSE error:', err)
        eventSource.close()
        sseRef.current = null
        setIsConnected(false)

        sseRetriesRef.current += 1

        if (sseRetriesRef.current >= maxSSERetries) {
          console.log('[useVesselPositions] Max SSE retries reached, falling back to polling permanently')
          setError('SSE unavailable, using polling mode')
          startPolling()
        } else {
          console.log(`[useVesselPositions] SSE retry ${sseRetriesRef.current}/${maxSSERetries} in 5s`)
          setTimeout(startSSE, 5000)
        }
      }

      sseRef.current = eventSource
    } catch (err) {
      console.error('[useVesselPositions] Failed to create SSE connection:', err)
      sseRetriesRef.current += 1

      if (sseRetriesRef.current >= maxSSERetries) {
        startPolling()
      }
    }
  }, [baseUrl, fetchVessels, updateVesselsFromSSE, startPolling])

  // Handle visibility changes for bandwidth optimization
  useEffect(() => {
    const handleVisibilityChange = () => {
      const isHidden = document.hidden

      if (isHidden) {
        console.log('[useVesselPositions] Tab hidden - slowing updates to 60s')

        // If in polling mode, restart with slower interval
        if (pollingIntervalRef.current && connectionMode === 'polling') {
          clearInterval(pollingIntervalRef.current)
          pollingIntervalRef.current = setInterval(fetchVessels, hiddenPollInterval)
        }
        // SSE stays connected (it's lightweight and we still want alerts)

      } else {
        console.log('[useVesselPositions] Tab visible - resuming normal updates')

        // Speed up polling again
        if (pollingIntervalRef.current && connectionMode === 'polling') {
          clearInterval(pollingIntervalRef.current)
          pollingIntervalRef.current = setInterval(fetchVessels, pollInterval)
        }

        // Immediate refresh to catch up on any missed updates
        fetchVessels()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [pollInterval, hiddenPollInterval, connectionMode, fetchVessels])

  useEffect(() => {
    // Try SSE first if enabled
    if (useSSE) {
      startSSE()
    } else {
      startPolling()
    }

    // Cleanup
    return () => {
      if (sseRef.current) {
        sseRef.current.close()
        sseRef.current = null
      }
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current)
        pollingIntervalRef.current = null
      }
    }
  }, [useSSE, startSSE, startPolling])

  return {
    vessels,
    vesselMap,
    isConnected,
    error,
    stats,
    connectionMode, // 'sse', 'polling', or 'connecting'
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
    pollInterval = 10000, // Increased from 2s to 10s to reduce bandwidth by 80%
    hiddenPollInterval = 60000, // 60s when tab is hidden (6× slower)
    useSSE = true, // Use Server-Sent Events for real-time alerts
  } = options

  const [alerts, setAlerts] = useState([])
  const [isConnected, setIsConnected] = useState(false)
  const [error, setError] = useState(null)
  const [connectionMode, setConnectionMode] = useState('connecting')

  const sseRef = useRef(null)
  const pollingIntervalRef = useRef(null)
  const sseRetriesRef = useRef(0)
  const maxSSERetries = 3

  const fetchAlerts = useCallback(async () => {
    try {
      const response = await fetch(`${baseUrl}/api/alerts?limit=20`)

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

  const startPolling = useCallback(() => {
    console.log('[useAlerts] Starting polling mode')
    setConnectionMode('polling')

    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current)
    }

    fetchAlerts()
    pollingIntervalRef.current = setInterval(fetchAlerts, pollInterval)
  }, [fetchAlerts, pollInterval])

  const startSSE = useCallback(() => {
    if (sseRetriesRef.current >= maxSSERetries) {
      console.log('[useAlerts] Max SSE retries exceeded, staying in polling mode')
      return
    }

    console.log('[useAlerts] Attempting SSE connection')

    try {
      if (sseRef.current) {
        sseRef.current.close()
      }

      const eventSource = new EventSource(`${baseUrl}/api/stream/alerts`)

      eventSource.onopen = () => {
        console.log('[useAlerts] SSE connected')
        setConnectionMode('sse')
        setIsConnected(true)
        setError(null)
        sseRetriesRef.current = 0

        // Initial fetch to populate state
        fetchAlerts()
      }

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          if (data.alerts && Array.isArray(data.alerts)) {
            // Prepend new alerts to the beginning (keep only last 20)
            setAlerts(prev => [...data.alerts, ...prev].slice(0, 20))
          }
        } catch (err) {
          console.error('[useAlerts] Failed to parse SSE message:', err)
        }
      }

      eventSource.onerror = (err) => {
        console.error('[useAlerts] SSE error:', err)
        eventSource.close()
        sseRef.current = null
        setIsConnected(false)

        sseRetriesRef.current += 1

        if (sseRetriesRef.current >= maxSSERetries) {
          console.log('[useAlerts] Max SSE retries reached, falling back to polling')
          setError('SSE unavailable, using polling mode')
          startPolling()
        } else {
          console.log(`[useAlerts] SSE retry ${sseRetriesRef.current}/${maxSSERetries} in 5s`)
          setTimeout(startSSE, 5000)
        }
      }

      sseRef.current = eventSource
    } catch (err) {
      console.error('[useAlerts] Failed to create SSE connection:', err)
      sseRetriesRef.current += 1

      if (sseRetriesRef.current >= maxSSERetries) {
        startPolling()
      }
    }
  }, [baseUrl, fetchAlerts, startPolling])

  // Handle visibility changes for bandwidth optimization
  useEffect(() => {
    const handleVisibilityChange = () => {
      const isHidden = document.hidden

      if (isHidden) {
        console.log('[useAlerts] Tab hidden - slowing updates to 60s')

        // If in polling mode, restart with slower interval
        if (pollingIntervalRef.current && connectionMode === 'polling') {
          clearInterval(pollingIntervalRef.current)
          pollingIntervalRef.current = setInterval(fetchAlerts, hiddenPollInterval)
        }
        // SSE stays connected for real-time alerts

      } else {
        console.log('[useAlerts] Tab visible - resuming normal updates')

        // Speed up polling again
        if (pollingIntervalRef.current && connectionMode === 'polling') {
          clearInterval(pollingIntervalRef.current)
          pollingIntervalRef.current = setInterval(fetchAlerts, pollInterval)
        }

        // Immediate refresh to catch up
        fetchAlerts()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [pollInterval, hiddenPollInterval, connectionMode, fetchAlerts])

  useEffect(() => {
    if (useSSE) {
      startSSE()
    } else {
      startPolling()
    }

    return () => {
      if (sseRef.current) {
        sseRef.current.close()
        sseRef.current = null
      }
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current)
        pollingIntervalRef.current = null
      }
    }
  }, [useSSE, startSSE, startPolling])

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
    stats: { messagesPerSecond: 0, totalMessages: alerts.length },
    connectionMode,
  }
}

/**
 * Hook for fetching vessel trails (position history) from the backend API.
 *
 * @param {Object} options - Configuration options
 * @returns {Object} - { trails, isLoading, error }
 */
export function useTrails(options = {}) {
  const {
    baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:8000',
    pollInterval = 30000, // Increased from 5s to 30s to reduce bandwidth by 83%
    enabled = false, // Disabled by default - only fetch on-demand (90% bandwidth reduction)
  } = options

  const [trails, setTrails] = useState([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)

  const fetchTrails = useCallback(async () => {
    if (!enabled) return

    try {
      setIsLoading(true)
      const response = await fetch(`${baseUrl}/api/trails`)

      if (!response.ok) {
        throw new Error(`Failed to fetch trails: ${response.statusText}`)
      }

      const data = await response.json()
      setTrails(data.trails || [])
      setError(null)

    } catch (err) {
      setError(err.message)
    } finally {
      setIsLoading(false)
    }
  }, [baseUrl, enabled])

  useEffect(() => {
    if (!enabled) return

    // Initial fetch
    fetchTrails()

    // Start polling
    const interval = setInterval(fetchTrails, pollInterval)

    return () => clearInterval(interval)
  }, [fetchTrails, pollInterval, enabled])

  return {
    trails,
    isLoading,
    error,
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
