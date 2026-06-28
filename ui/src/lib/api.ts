import type { CamerasResponse, IrisState, SourceInfo } from '../types'

export interface IrisApi {
  state(): Promise<IrisState>
  cameras(): Promise<CamerasResponse>
  rescanCameras(): Promise<CamerasResponse>
  selectCamera(index: number, label: string): Promise<{ ok: boolean; error?: string }>
  start(): Promise<{ ok: boolean; error?: string }>
  stop(): Promise<{ ok: boolean; error?: string }>
  sources(): Promise<{ sources: SourceInfo[] }>
  activateSource(sourceId: string): Promise<{ ok: boolean }>
  sourceWsUrl(sourceId: string): string
  mpWsUrl(): string
}

export function createIrisApi({ apiBase }: { apiBase: string }): IrisApi {
  const base = apiBase.replace(/\/$/, '')

  const getJson = async <T>(path: string): Promise<T> => {
    const r = await fetch(`${base}${path}`)
    if (!r.ok) throw new Error(`GET ${path} -> ${r.status}`)
    return r.json() as Promise<T>
  }

  const postJson = async <T>(path: string, body?: unknown): Promise<T> => {
    const r = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    if (!r.ok) {
      const d = await r.json().catch(() => ({})) as { detail?: string }
      throw new Error(d.detail ?? `POST ${path} -> ${r.status}`)
    }
    return r.json() as Promise<T>
  }

  return {
    state: () => getJson<IrisState>('/state'),
    cameras: () => getJson<CamerasResponse>('/cameras'),
    rescanCameras: () => postJson<CamerasResponse>('/cameras/rescan'),
    selectCamera: (index, label) =>
      postJson<{ ok: boolean; error?: string }>('/cameras/select', { index, label }),
    start: () => postJson<{ ok: boolean; error?: string }>('/start'),
    stop: () => postJson<{ ok: boolean; error?: string }>('/stop'),
    sources: () => getJson<{ sources: SourceInfo[] }>('/sources'),
    activateSource: (sourceId) =>
      postJson<{ ok: boolean }>(`/sources/${sourceId}/activate`),
    sourceWsUrl: (sourceId) => {
      if (base) {
        const wsBase = base.replace(/^http:\/\//, 'ws://').replace(/^https:\/\//, 'wss://')
        return `${wsBase}/sources/${sourceId}/ws`
      }
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
      return `${proto}//${location.host}/sources/${sourceId}/ws`
    },
    mpWsUrl: () => {
      if (base) {
        const wsBase = base.replace(/^http:\/\//, 'ws://').replace(/^https:\/\//, 'wss://')
        return `${wsBase}/sources/browser-mp/ws`
      }
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
      return `${proto}//${location.host}/sources/browser-mp/ws`
    },
  }
}
