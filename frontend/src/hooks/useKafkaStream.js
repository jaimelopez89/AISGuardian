import { useState, useEffect, useCallback, useRef } from 'react'

/**
 * Hook for consuming Kafka topics via REST Proxy.
 *
 * The Kafka REST Proxy allows consuming messages via HTTP polling.
 * This hook manages the consumer lifecycle and message fetching.
 *
 * @param {string} topic - Kafka topic to consume
 * @param {Object} options - Configuration options
 * @returns {Object} - { messages, isConnected, error, stats }
 */
// Unique session ID per page load to avoid stale consumer conflicts
const SESSION_ID = Date.now()

export function useKafkaStream(topic, options = {}) {
  const {
    baseUrl = '/kafka',
    groupId = `ais-session-${SESSION_ID}`,
    autoOffsetReset = 'earliest',
    maxMessages = 1000,
    pollInterval = 3000,
    onMessage = null,
  } = options

  const [messages, setMessages] = useState([])
  const [isConnected, setIsConnected] = useState(false)
  const [error, setError] = useState(null)
  const [stats, setStats] = useState({ messagesPerSecond: 0, totalMessages: 0 })

  const consumerRef = useRef(null)
  const pollingRef = useRef(null)
  const messageCountRef = useRef(0)
  const lastCountTimeRef = useRef(Date.now())

  // Create consumer instance
  const createConsumer = useCallback(async () => {
    try {
      const consumerName = `${groupId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

      // Create consumer
      const createResponse = await fetch(`${baseUrl}/consumers/${groupId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/vnd.kafka.v2+json',
        },
        body: JSON.stringify({
          name: consumerName,
          format: 'json',
          'auto.offset.reset': autoOffsetReset,
        }),
      })

      if (!createResponse.ok) {
        const errorText = await createResponse.text()
        throw new Error(`Failed to create consumer: ${createResponse.statusText} - ${errorText}`)
      }

      const consumer = await createResponse.json()

      // The REST proxy returns an internal Docker URL - rewrite it to use our proxy
      const fixedBaseUri = `${baseUrl}/consumers/${groupId}/instances/${consumerName}`

      consumerRef.current = {
        ...consumer,
        base_uri: fixedBaseUri,
        groupId,
        name: consumerName,
      }

      // Subscribe to topic
      const subscribeResponse = await fetch(
        `${fixedBaseUri}/subscription`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/vnd.kafka.v2+json',
          },
          body: JSON.stringify({
            topics: [topic],
          }),
        }
      )

      if (!subscribeResponse.ok) {
        const errorText = await subscribeResponse.text()
        throw new Error(`Failed to subscribe: ${subscribeResponse.statusText} - ${errorText}`)
      }

      setIsConnected(true)
      setError(null)
      return consumer

    } catch (err) {
      setError(err.message)
      setIsConnected(false)
      return null
    }
  }, [baseUrl, groupId, topic, autoOffsetReset])

  // Poll for messages
  const pollMessages = useCallback(async () => {
    if (!consumerRef.current) return

    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 5000)

      const response = await fetch(
        `${consumerRef.current.base_uri}/records`,
        {
          method: 'GET',
          headers: {
            'Accept': 'application/vnd.kafka.json.v2+json',
          },
          signal: controller.signal,
        }
      )
      clearTimeout(timeoutId)

      if (!response.ok) {
        if (response.status === 404 || response.status === 500) {
          // Consumer expired or error - recreate with new name
          console.log('[Kafka] Consumer error, recreating...')
          consumerRef.current = null
          await createConsumer()
          return
        }
        throw new Error(`Failed to fetch records: ${response.statusText}`)
      }

      const records = await response.json()

      if (records.length > 0) {
        const newMessages = records.map(record => ({
          key: record.key,
          value: record.value,
          topic: record.topic,
          partition: record.partition,
          offset: record.offset,
          timestamp: Date.now(),
        }))

        // Update messages (keep only recent ones)
        setMessages(prev => {
          const updated = [...newMessages, ...prev].slice(0, maxMessages)
          return updated
        })

        // Call onMessage callback for each new message
        if (onMessage) {
          newMessages.forEach(msg => onMessage(msg))
        }

        // Update stats
        messageCountRef.current += records.length
        const now = Date.now()
        const elapsed = (now - lastCountTimeRef.current) / 1000
        if (elapsed >= 1) {
          setStats({
            messagesPerSecond: Math.round(messageCountRef.current / elapsed),
            totalMessages: stats.totalMessages + messageCountRef.current,
          })
          messageCountRef.current = 0
          lastCountTimeRef.current = now
        }
      }

      setError(null)
    } catch (err) {
      setError(err.message)
    }
  }, [createConsumer, maxMessages, onMessage, stats.totalMessages])

  // Delete consumer on cleanup
  const deleteConsumer = useCallback(async () => {
    if (!consumerRef.current) return

    try {
      await fetch(consumerRef.current.base_uri, {
        method: 'DELETE',
      })
    } catch (err) {
      // Ignore cleanup errors
    }
    consumerRef.current = null
  }, [])

  // Initialize consumer and start polling
  useEffect(() => {
    let mounted = true

    const init = async () => {
      const consumer = await createConsumer()
      if (!consumer || !mounted) return

      // Start polling
      pollingRef.current = setInterval(() => {
        if (mounted) pollMessages()
      }, pollInterval)
    }

    // Cleanup on page unload
    const handleUnload = () => {
      if (consumerRef.current) {
        navigator.sendBeacon(
          `${baseUrl}/consumers/${groupId}/instances/${consumerRef.current.name}`,
          ''
        )
      }
    }
    window.addEventListener('beforeunload', handleUnload)

    init()

    return () => {
      mounted = false
      window.removeEventListener('beforeunload', handleUnload)
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
      }
      deleteConsumer()
    }
  }, [createConsumer, pollMessages, deleteConsumer, pollInterval, baseUrl, groupId])

  return {
    messages,
    isConnected,
    error,
    stats,
  }
}

/**
 * Hook for consuming vessel positions with spatial indexing.
 */
export function useVesselPositions(options = {}) {
  const [vessels, setVessels] = useState(new Map())
  const [vesselList, setVesselList] = useState([])

  const handleMessage = useCallback((msg) => {
    if (!msg.value) return

    const position = msg.value
    const mmsi = position.mmsi

    setVessels(prev => {
      const updated = new Map(prev)
      updated.set(mmsi, {
        ...position,
        lastUpdate: Date.now(),
      })

      // Remove stale vessels (no update in 10 minutes)
      const staleThreshold = Date.now() - 10 * 60 * 1000
      for (const [key, vessel] of updated) {
        if (vessel.lastUpdate < staleThreshold) {
          updated.delete(key)
        }
      }

      return updated
    })
  }, [])

  const stream = useKafkaStream('ais-raw', {
    ...options,
    onMessage: handleMessage,
  })

  // Convert Map to array for rendering
  useEffect(() => {
    setVesselList(Array.from(vessels.values()))
  }, [vessels])

  return {
    vessels: vesselList,
    vesselMap: vessels,
    ...stream,
  }
}

/**
 * Hook for consuming alerts.
 */
export function useAlerts(options = {}) {
  const [alerts, setAlerts] = useState([])

  const handleMessage = useCallback((msg) => {
    if (!msg.value) return

    const alert = {
      ...msg.value,
      receivedAt: Date.now(),
    }

    setAlerts(prev => [alert, ...prev].slice(0, 100))
  }, [])

  const stream = useKafkaStream('alerts', {
    ...options,
    onMessage: handleMessage,
  })

  // Get alerts by severity
  const alertsBySeverity = {
    critical: alerts.filter(a => a.severity === 'CRITICAL'),
    high: alerts.filter(a => a.severity === 'HIGH'),
    medium: alerts.filter(a => a.severity === 'MEDIUM'),
    low: alerts.filter(a => a.severity === 'LOW'),
  }

  return {
    alerts,
    alertsBySeverity,
    ...stream,
  }
}

export default useKafkaStream
