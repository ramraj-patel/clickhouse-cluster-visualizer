import { useState } from 'react'
import { RefreshCw, ExternalLink, ChevronDown, ChevronRight, Loader2, AlertCircle, Pause, Play } from 'lucide-react'
import { useProcesses } from '../hooks/useProcesses'
import { fmtBytes, fmtElapsed, fmtRows } from '../utils/format'
import { safeNum } from '../api/clickhouse'
import type { ConnectionConfig, ProcessRow } from '../types'

interface Props {
  config: ConnectionConfig
  onViewInLog: (queryId: string) => void
}

const KIND_COLOR: Record<string, string> = {
  Select: 'bg-blue-500/15 text-blue-400 border-blue-500/25',
  Insert: 'bg-green-500/15 text-green-400 border-green-500/25',
  Alter:  'bg-orange-500/15 text-orange-400 border-orange-500/25',
}

function kindColor(kind: string) {
  return KIND_COLOR[kind] ?? 'bg-ch-border/40 text-ch-muted border-ch-border'
}

function elapsedColor(s: number) {
  if (s > 300) return 'text-red-400'
  if (s > 60)  return 'text-yellow-400'
  return 'text-ch-text'
}

function memColor(bytes: number) {
  if (bytes > 10 * 1024 ** 3) return 'text-red-400'
  if (bytes > 1  * 1024 ** 3) return 'text-yellow-400'
  return 'text-ch-text'
}

function borderColor(elapsed: number) {
  if (elapsed > 300) return 'border-red-500/30'
  if (elapsed > 60)  return 'border-yellow-500/30'
  return 'border-ch-border'
}

// ─── Process card ─────────────────────────────────────────────────────────────

function ProcessCard({ row, onViewInLog }: { row: ProcessRow; onViewInLog: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false)

  const mem     = safeNum(row.memory_usage)
  const peakMem = safeNum(row.peak_memory_usage)
  const readB   = safeNum(row.read_bytes)
  const pct     = safeNum(row.progress_fraction) * 100
  const knownTotal = safeNum(row.total_rows_approx) > 0

  return (
    <div className={`bg-ch-surface border ${borderColor(row.elapsed)} rounded-xl overflow-hidden`}>
      {/* Row 1: kind badge + user + elapsed + link */}
      <div className="flex items-center gap-2 px-4 py-2.5">
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${kindColor(row.query_kind || 'Select')}`}>
          {row.query_kind || 'SELECT'}
        </span>
        <span className="text-xs font-medium text-ch-text truncate flex-1">
          {row.user}
          {row.client_name && <span className="text-ch-muted font-normal"> @ {row.client_name}</span>}
        </span>
        {row.is_initial_query === 0 && (
          <span className="text-[10px] text-ch-muted border border-ch-border rounded px-1">sub-query</span>
        )}
        {row.is_cancelled === 1 && (
          <span className="text-[10px] text-yellow-400 border border-yellow-500/30 rounded px-1">cancelling…</span>
        )}
        <span className={`text-xs font-mono font-semibold ${elapsedColor(row.elapsed)}`}>
          {fmtElapsed(row.elapsed)}
        </span>
        <button
          onClick={() => onViewInLog(row.query_id)}
          title="View completed entry in Query Log"
          className="flex items-center gap-1 text-[11px] text-ch-muted hover:text-ch-accent transition-colors ml-1"
        >
          <ExternalLink className="w-3 h-3" />
          Log
        </button>
      </div>

      {/* Row 2: progress bar */}
      <div className="px-4 pb-2">
        <div className="w-full h-1.5 bg-ch-bg rounded-full overflow-hidden">
          {knownTotal ? (
            <div
              className="h-full bg-ch-accent rounded-full transition-all duration-500"
              style={{ width: `${Math.min(pct, 100)}%` }}
            />
          ) : (
            <div className="h-full w-1/3 bg-ch-accent/40 rounded-full animate-pulse" />
          )}
        </div>
        <div className="flex items-center justify-between mt-1 text-[10px] text-ch-muted">
          <span>
            {fmtRows(safeNum(row.read_rows))} rows read
            {knownTotal && ` / ${fmtRows(safeNum(row.total_rows_approx))} total (${pct.toFixed(0)}%)`}
          </span>
          {readB > 0 && <span>{fmtBytes(readB)} read</span>}
        </div>
      </div>

      {/* Row 3: memory + tables */}
      <div className="flex items-center gap-4 px-4 pb-2.5 text-[11px]">
        <span>
          <span className="text-ch-muted">mem </span>
          <span className={memColor(mem)}>{fmtBytes(mem)}</span>
          {peakMem > mem && <span className="text-ch-muted"> peak {fmtBytes(peakMem)}</span>}
        </span>
      </div>

      {/* Row 4: query text (collapsible) */}
      <div className="border-t border-ch-border/50">
        <button
          onClick={() => setExpanded(v => !v)}
          className="w-full flex items-center gap-2 px-4 py-1.5 text-left hover:bg-ch-bg/50 transition-colors"
        >
          {expanded
            ? <ChevronDown className="w-3 h-3 text-ch-muted flex-shrink-0" />
            : <ChevronRight className="w-3 h-3 text-ch-muted flex-shrink-0" />
          }
          <span className="text-[10px] text-ch-muted font-mono truncate">
            {row.query.slice(0, 150)}{row.query.length > 150 ? '…' : ''}
          </span>
        </button>
        {expanded && (
          <pre className="px-4 pb-3 text-[10px] font-mono text-ch-accent leading-relaxed whitespace-pre-wrap break-all bg-ch-bg/50 border-t border-ch-border/30">
            {row.query}
          </pre>
        )}
      </div>

      {/* query_id */}
      <div className="px-4 py-1.5 border-t border-ch-border/30 flex items-center justify-between">
        <span className="text-[9px] text-ch-muted font-mono truncate">{row.query_id}</span>
        {row.initial_query_id && row.initial_query_id !== row.query_id && (
          <span className="text-[9px] text-ch-muted truncate ml-2">
            parent: {row.initial_query_id}
          </span>
        )}
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ProcessMonitor({ config, onViewInLog }: Props) {
  const [paused, setPaused] = useState(false)
  const { data, isLoading, dataUpdatedAt, refetch, error } = useProcesses(config, paused)

  const processes = (data ?? []).filter(
    p => !p.query.toLowerCase().includes('from system.processes')
  )

  const lastUpdated = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString()
    : null

  return (
    <div className="flex flex-col h-full overflow-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-ch-border bg-ch-surface/50 flex-shrink-0">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-ch-text">Live Processes</h2>
          <span className="flex items-center gap-1.5 text-xs text-ch-muted">
            {paused ? (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-yellow-500/15 text-yellow-400 border border-yellow-500/30">
                PAUSED
              </span>
            ) : isLoading ? (
              <Loader2 className="w-3 h-3 animate-spin text-ch-accent" />
            ) : (
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            )}
            {paused ? 'snapshot frozen' : 'refreshing every 5s'}
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs text-ch-muted">
          {lastUpdated && (
            <span>{paused ? 'snapshot from' : 'last:'} {lastUpdated}</span>
          )}
          <button
            onClick={() => setPaused(v => !v)}
            className={`flex items-center gap-1.5 border rounded-lg px-2.5 py-1 transition-colors ${
              paused
                ? 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/20'
                : 'border-ch-border hover:text-ch-text hover:border-ch-accent/30'
            }`}
          >
            {paused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
            {paused ? 'Resume' : 'Pause'}
          </button>
          <button
            onClick={() => refetch()}
            className="flex items-center gap-1.5 border border-ch-border rounded-lg px-2.5 py-1 hover:text-ch-text hover:border-ch-accent/30 transition-colors"
          >
            <RefreshCw className="w-3 h-3" /> Refresh
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-start gap-2 px-6 py-3 bg-red-500/10 border-b border-red-500/20 text-red-400 text-xs flex-shrink-0">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div className="min-w-0">
            <span className="font-semibold">Query failed: </span>
            <span className="break-all">{(error as Error).message}</span>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto p-6">
        {processes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3">
            <div className="w-10 h-10 rounded-full bg-green-500/10 border border-green-500/20 flex items-center justify-center text-green-400 text-xl">
              ✓
            </div>
            <p className="text-sm text-ch-text font-medium">No active queries right now</p>
            <p className="text-xs text-ch-muted">{paused ? 'paused — click Resume to refresh' : 'auto-refreshing every 5s'}</p>
          </div>
        ) : (
          <div className="space-y-3 max-w-4xl">
            <p className="text-xs text-ch-muted mb-4">
              {processes.length} active {processes.length === 1 ? 'query' : 'queries'}
              {processes.filter(p => p.elapsed > 60).length > 0 && (
                <span className="text-yellow-400 ml-2">
                  · {processes.filter(p => p.elapsed > 60).length} slow (&gt;60s)
                </span>
              )}
            </p>
            {processes.map(p => (
              <ProcessCard key={p.query_id} row={p} onViewInLog={onViewInLog} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
