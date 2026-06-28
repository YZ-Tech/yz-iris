import { createContext, useContext, useEffect, useRef, useState } from 'react'

export interface WSApi {
  isConnected: boolean
  subscribe<T>(event: string, cb: (data: T) => void): () => void
}

export const WSContext = createContext<WSApi>({
  isConnected: false,
  subscribe: () => () => {},
})

export function useSubscription<T>(event: string, cb: (data: T) => void): void {
  const ws = useContext(WSContext)
  const cbRef = useRef(cb)
  cbRef.current = cb
  useEffect(() => {
    return ws.subscribe<T>(event, (data) => cbRef.current(data))
  }, [ws, event])
}

/** Connect to the iris satellite WebSocket.
 *  Pass an absolute `wsUrl` when the IIFE is embedded in another host
 *  (e.g. "ws://127.0.0.1:9007/events"). Omit for standalone mode — the
 *  URL is derived from window.location. */
export function useStandaloneWs(wsUrl?: string): WSApi {
  const [isConnected, setIsConnected] = useState(false)
  const subsRef = useRef<Map<string, Set<(d: unknown) => void>>>(new Map())
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    let cancelled = false
    let backoff = 0.5

    function open() {
      if (cancelled) return
      const url = wsUrl ?? (() => {
        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
        return `${proto}//${location.host}/events`
      })()
      const ws = new WebSocket(url)
      wsRef.current = ws
      ws.onopen = () => { backoff = 0.5; setIsConnected(true) }
      ws.onclose = () => {
        setIsConnected(false)
        if (cancelled) return
        backoff = Math.min(backoff * 2, 8)
        setTimeout(open, backoff * 1000)
      }
      ws.onerror = () => { /* triggers onclose */ }
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data as string)
          const event = msg.event
          if (!event) return
          const { event: _drop, ts: _ts, data, ...rest } = msg
          const payload = data ?? rest
          const subs = subsRef.current.get(event)
          if (!subs) return
          for (const cb of subs) {
            try { cb(payload) } catch { /* per-sub isolation */ }
          }
        } catch { /* malformed */ }
      }
    }
    open()
    return () => {
      cancelled = true
      try { wsRef.current?.close() } catch { /* ignore */ }
    }
  }, [wsUrl])

  return {
    isConnected,
    subscribe: (event, cb) => {
      let set = subsRef.current.get(event)
      if (!set) { set = new Set(); subsRef.current.set(event, set) }
      const typed = cb as (d: unknown) => void
      set.add(typed)
      return () => { set!.delete(typed) }
    },
  }
}
