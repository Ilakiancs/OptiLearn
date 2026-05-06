import { useEffect, useRef, useState } from 'react'

/**
 * useLiveQuizSocket — connects to /api/live-quiz/ws/{gameId} and returns
 * the latest broadcast game state. Re-connects automatically on disconnect.
 *
 * @param {string} gameId
 * @returns {{ state: object|null, connected: boolean }}
 */
export function useLiveQuizSocket(gameId) {
  const [state, setState] = useState(null)
  const [connected, setConnected] = useState(false)
  const wsRef = useRef(null)
  const retryRef = useRef(null)
  const unmountedRef = useRef(false)

  useEffect(() => {
    unmountedRef.current = false

    function connect() {
      if (unmountedRef.current) return
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
      const ws = new WebSocket(`${protocol}://${window.location.host}/api/live-quiz/ws/${gameId}`)
      wsRef.current = ws

      ws.onopen = () => {
        if (!unmountedRef.current) setConnected(true)
      }

      ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data)
          if (!unmountedRef.current) setState(data)
        } catch (_) {}
      }

      ws.onclose = () => {
        if (!unmountedRef.current) {
          setConnected(false)
          // Auto-reconnect after 2 seconds
          retryRef.current = setTimeout(connect, 2000)
        }
      }

      ws.onerror = () => {
        ws.close()
      }
    }

    connect()

    return () => {
      unmountedRef.current = true
      clearTimeout(retryRef.current)
      wsRef.current?.close()
    }
  }, [gameId])

  return { state, connected }
}
