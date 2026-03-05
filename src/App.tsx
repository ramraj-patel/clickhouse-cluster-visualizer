import { useState } from 'react'
import { ConnectionForm } from './components/ConnectionForm'
import { Dashboard } from './components/Dashboard'
import { testConnection } from './api/clickhouse'
import type { ConnectionConfig } from './types'

export default function App() {
  const [config, setConfig] = useState<ConnectionConfig | null>(null)
  const [version, setVersion] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [connectError, setConnectError] = useState<string | null>(null)

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
