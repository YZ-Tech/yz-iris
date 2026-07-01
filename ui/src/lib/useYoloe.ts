import { useCallback, useEffect, useState } from 'react'
import type { IrisApi } from './api'
import type { YoloeStatus } from '../types'

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

export interface UseYoloe {
  status: YoloeStatus | null
  available: boolean
  installing: boolean
  busy: boolean
  error: string | null
  install: () => Promise<void>
  refresh: () => Promise<void>
}

// Shared YOLOE engine state, lifted to the page so the Watch-tab scene tools and
// the Advanced install card never disagree about whether the engine is ready.
// Polls only while an install is in flight.
export function useYoloe(api: IrisApi): UseYoloe {
  const [status, setStatus] = useState<YoloeStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setStatus(await api.yoloeStatus())
    } catch (e) {
      setError(msg(e))
    }
  }, [api])

  useEffect(() => { void refresh() }, [refresh])

  useEffect(() => {
    if (!status?.installing) return
    const id = window.setInterval(() => { void refresh() }, 3000)
    return () => window.clearInterval(id)
  }, [status?.installing, refresh])

  const install = useCallback(async () => {
    setError(null)
    setBusy(true)
    try {
      const r = await api.yoloeInstall()
      if (!r.ok && r.error) setError(r.error)
      await refresh()
    } catch (e) {
      setError(msg(e))
    } finally {
      setBusy(false)
    }
  }, [api, refresh])

  return {
    status,
    available: !!status?.available,
    installing: !!status?.installing || busy,
    busy,
    error,
    install,
    refresh,
  }
}
