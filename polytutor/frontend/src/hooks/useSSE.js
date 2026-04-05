import { useRef, useState } from 'react'

const BASE = window.location.origin

export function useSSE() {
  const abortRef = useRef(null)
  const [isConnected, setIsConnected] = useState(false)

  function disconnect() {
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
    }
    setIsConnected(false)
  }

  async function connect(payload, handlers) {
    disconnect()

    const controller = new AbortController()
    abortRef.current = controller
    setIsConnected(true)

    try {
      const res = await fetch(`${BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })

      if (!res.ok) {
        let message = `HTTP ${res.status}`
        try {
          const body = await res.json()
          message = body.detail || body.message || message
        } catch (_) {}
        handlers.onError?.(message)
        setIsConnected(false)
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() // keep incomplete last line

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data: ')) continue
          const raw = trimmed.slice(6)
          let event
          try {
            event = JSON.parse(raw)
          } catch (_) {
            continue
          }

          switch (event.type) {
            case 'token':
              handlers.onToken?.(event.content)
              break
            case 'tool_start':
              handlers.onToolStart?.(event.tool)
              break
            case 'tool_done':
              handlers.onToolDone?.(event.tool, event.result)
              break
            case 'done':
              handlers.onDone?.()
              break
            case 'error':
              handlers.onError?.(event.message)
              break
          }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        handlers.onError?.(err.message)
      }
    } finally {
      abortRef.current = null
      setIsConnected(false)
    }
  }

  return { connect, disconnect, isConnected }
}
