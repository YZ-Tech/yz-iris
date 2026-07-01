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

/** Host-injected WS API — JarvYZ's core `/ws` bus (`websocket/context.ts`).
 *  Structurally a superset of what iris needs (it also has `send`). When the
 *  IIFE is embedded in JarvYZ the host passes this; iris rides the single core
 *  bus instead of opening its own socket to the satellite port. */
export interface HostWSApi {
  isConnected: boolean
  subscribe(eventType: string, cb: (msg: unknown) => void): () => void
}

/** Adapt the host core-`/ws` API to iris's `WSApi`. The core bus delivers the
 *  full envelope `{ event_type, ts, data: {…} }` (the satellite's `data` block
 *  survives the generic event bridge intact), but iris components expect the
 *  UNWRAPPED payload — the same `{ present, position, … }` / `{ target }` they
 *  get from the satellite's own `/events` after ws.ts peels `data`. So we peel
 *  `data` here at the boundary, keeping every component untouched. */
export function adaptHostWs(host: HostWSApi): WSApi {
  return {
    isConnected: host.isConnected,
    subscribe<T>(event: string, cb: (data: T) => void) {
      return host.subscribe(event, (msg) => {
        const payload =
          msg && typeof msg === 'object' && 'data' in msg
            ? (msg as { data: unknown }).data
            : msg
        cb(payload as T)
      })
    },
  }
}

/** Connect to the iris satellite WebSocket (STANDALONE mode only).
 *  Omit `wsUrl` for the standalone SPA — the URL is derived from
 *  window.location (`/events` on the satellite's own origin). Pass
 *  `enabled: false` when a host `wsApi` is injected, so the hook stays dormant
 *  (no socket) while still obeying the rules-of-hooks call-order. */
export function useStandaloneWs(wsUrl?: string, enabled: boolean = true): WSApi {
  const [isConnected, setIsConnected] = useState(false)
  const subsRef = useRef<Map<string, Set<(d: unknown) => void>>>(new Map())
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    if (!enabled) return
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
  }, [wsUrl, enabled])

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
