import { useState } from 'react'
import { Server, Lock, User, Hash } from 'lucide-react'
import type { ConnectionConfig } from '../types'

interface Props {
  onConnect: (config: ConnectionConfig) => void
  loading?: boolean
  error?: string | null
}

export function ConnectionForm({ onConnect, loading, error }: Props) {
  const [form, setForm] = useState<ConnectionConfig>({
    host: 'localhost',
    port: 8123,
    username: 'default',
    password: '',
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onConnect(form)
  }

  return (
    <div className="min-h-screen bg-ch-bg flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-ch-accent/10 border border-ch-accent/30 mb-4">
            <span className="text-3xl">🖱️</span>
          </div>
          <h1 className="text-2xl font-bold text-ch-text">ClickHouse Cluster Visualizer</h1>
          <p className="text-ch-muted mt-1">Connect to your ClickHouse cluster to explore its topology</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-ch-surface border border-ch-border rounded-2xl p-6 space-y-4"
        >
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 space-y-1">
              <label className="text-xs font-medium text-ch-muted uppercase tracking-wider">Host</label>
              <div className="relative">
                <Server className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ch-muted" />
                <input
                  type="text"
                  value={form.host}
                  onChange={e => setForm(f => ({ ...f, host: e.target.value }))}
                  placeholder="localhost"
                  className="w-full bg-ch-bg border border-ch-border rounded-lg pl-9 pr-3 py-2.5 text-sm text-ch-text placeholder-ch-muted focus:outline-none focus:border-ch-accent/60 transition-colors"
                  required
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-ch-muted uppercase tracking-wider">HTTP Port</label>
              <div className="relative">
                <Hash className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ch-muted" />
                <input
                  type="number"
                  value={form.port}
                  onChange={e => setForm(f => ({ ...f, port: parseInt(e.target.value) || 8123 }))}
                  className="w-full bg-ch-bg border border-ch-border rounded-lg pl-9 pr-3 py-2.5 text-sm text-ch-text focus:outline-none focus:border-ch-accent/60 transition-colors"
                />
              </div>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-ch-muted uppercase tracking-wider">Username</label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ch-muted" />
              <input
                type="text"
                value={form.username}
                onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                placeholder="default"
                className="w-full bg-ch-bg border border-ch-border rounded-lg pl-9 pr-3 py-2.5 text-sm text-ch-text placeholder-ch-muted focus:outline-none focus:border-ch-accent/60 transition-colors"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-ch-muted uppercase tracking-wider">Password</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ch-muted" />
              <input
                type="password"
                value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                placeholder="(empty)"
                className="w-full bg-ch-bg border border-ch-border rounded-lg pl-9 pr-3 py-2.5 text-sm text-ch-text placeholder-ch-muted focus:outline-none focus:border-ch-accent/60 transition-colors"
              />
            </div>
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-sm text-red-400">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-ch-accent hover:bg-ch-accent/90 disabled:opacity-50 disabled:cursor-not-allowed text-black font-semibold py-2.5 rounded-lg transition-colors text-sm"
          >
            {loading ? 'Connecting...' : 'Connect'}
          </button>
        </form>
      </div>
    </div>
  )
}
