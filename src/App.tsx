import { useState, useEffect } from 'react'
import { ConnectionForm } from './components/ConnectionForm'
import { Dashboard } from './components/Dashboard'
import { testConnection } from './api/clickhouse'
import type { ConnectionConfig } from './types'

const SESSION_KEY = 'ch-connection'

function loadSession(): { config: ConnectionConfig; version: string } | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed?.config?.host && parsed?.version) return parsed
    return null
  } catch {
    return null
  }
}

export default function App() {
  const saved = loadSession()
  const [config, setConfig] = useState<ConnectionConfig | null>(saved?.config ?? null)
  const [version, setVersion] = useState(saved?.version ?? '')
  const [connecting, setConnecting] = useState(false)
  const [connectError, setConnectError] = useState<string | null>(null)

  useEffect(() => {
    if (config && version) {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ config, version }))
    } else {
      sessionStorage.removeItem(SESSION_KEY)
    }
  }, [config, version])

  const handleConnect = async (cfg: ConnectionConfig) => {
    setConnecting(true)
    setConnectError(null)
    try {
      const v = await testConnection(cfg)
      setVersion(v)
      setConfig(cfg)
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : typeof err === 'object' && err !== null && 'response' in err
          ? String((err as { response?: { data?: unknown } }).response?.data)
          : 'Connection failed'
      setConnectError(msg)
    } finally {
      setConnecting(false)
    }
  }

  const handleDisconnect = () => {
    setConfig(null)
    setVersion('')
  }

  if (!config) {
    return (
      <ConnectionForm
        onConnect={handleConnect}
        loading={connecting}
        error={connectError}
      />
    )
  }

  return <Dashboard config={config} version={version} onDisconnect={handleDisconnect} />
}
