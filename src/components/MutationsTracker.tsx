import { useState, useMemo } from 'react'
import { RefreshCw, ChevronDown, ChevronRight } from 'lucide-react'
import { useMutations } from '../hooks/useMutations'
import { fmtAge } from '../utils/format'
import type { ConnectionConfig, MutationRow } from '../types'

interface Props {
  config: ConnectionConfig
}

// ─── Command type extraction ──────────────────────────────────────────────────

const CMD_PATTERNS: [RegExp, string][] = [
  [/\bUPDATE\b/i,               'UPDATE'],
  [/\bDELETE\s+WHERE\b/i,       'DELETE'],
  [/\bMATERIALIZE\s+INDEX\b/i,  'MAT INDEX'],
  [/\bMATERIALIZE\s+PROJ/i,     'MAT PROJ'],
  [/\bDROP\s+COLUMN\b/i,        'DROP COL'],
  [/\bADD\s+COLUMN\b/i,         'ADD COL'],
  [/\bMODIFY\s+COLUMN\b/i,      'MOD COL'],
  [/\bCLEAR\s+COLUMN\b/i,       'CLEAR COL'],
]

function cmdType(command: string): string {
  for (const [re, label] of CMD_PATTERNS) {
    if (re.test(command)) return label
  }
  return 'ALTER'
}

const CMD_COLOR: Record<string, string> = {
  'UPDATE':    'bg-orange-500/15 text-ch-orange border-orange-500/25',
  'DELETE':    'bg-ch-danger/15 text-ch-danger border-red-500/25',
  'MAT INDEX': 'bg-purple-500/15 text-ch-purple border-purple-500/25',
  'MAT PROJ':  'bg-purple-500/15 text-ch-purple border-purple-500/25',
  'ALTER':     'bg-ch-border/40 text-ch-muted border-ch-border',
}

function cmdColor(type: string) {
  return CMD_COLOR[type] ?? 'bg-ch-border/40 text-ch-muted border-ch-border'
}

function isFailed(row: MutationRow) {
  return row.latest_fail_reason !== '' && row.latest_fail_reason != null
}

// ─── Mutation card ────────────────────────────────────────────────────────────

function MutationCard({ row }: { row: MutationRow }) {
  const [expanded, setExpanded] = useState(false)
  const [showParts, setShowParts] = useState(false)

  const failed   = isFailed(row)
  const type     = cmdType(row.command)
  const age      = fmtAge(row.create_time)

  const statusBadge = () => {
    if (failed) return (
      <span className="flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border bg-ch-danger/15 text-ch-danger border-red-500/25">
        <span className="w-1.5 h-1.5 rounded-full bg-ch-danger" />Failed
      </span>
    )
    if (row.is_done) return (
      <span className="flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border bg-ch-success/15 text-ch-success border-green-500/25">
        <span className="w-1.5 h-1.5 rounded-full bg-ch-success" />Done
      </span>
    )
    return (
      <span className="flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border bg-ch-warning/15 text-ch-warning border-yellow-500/25">
        <span className="w-1.5 h-1.5 rounded-full bg-ch-warning animate-pulse" />Running
      </span>
    )
  }

  const borderCls = failed
    ? 'border-red-500/30'
    : row.is_done ? 'border-ch-border' : 'border-yellow-500/20'

  return (
    <div className={`bg-ch-surface border ${borderCls} rounded-xl overflow-hidden`}>
      {/* Header row */}
      <div className="flex items-center gap-2 px-4 py-2.5 flex-wrap">
        {statusBadge()}
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${cmdColor(type)}`}>
          {type}
        </span>
        <span className="text-xs font-semibold text-ch-text">{row.database}.{row.table}</span>
        <span className="text-[10px] font-mono text-ch-muted">{row.mutation_id}</span>
        <span className="text-[10px] text-ch-muted ml-auto">{age}</span>
      </div>

      {/* Command text */}
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
            {row.command.slice(0, 160)}{row.command.length > 160 ? '…' : ''}
          </span>
        </button>
        {expanded && (
          <pre className="px-4 pb-3 text-[10px] font-mono text-ch-accent leading-relaxed whitespace-pre-wrap break-all bg-ch-bg/50 border-t border-ch-border/30">
            {row.command}
          </pre>
        )}
      </div>

      {/* Progress / remaining parts */}
      {!row.is_done && (
        <div className="flex items-center gap-3 px-4 py-2 border-t border-ch-border/50 text-xs">
          <span className="text-ch-muted">Remaining:</span>
          <span className={`font-semibold ${row.parts_to_do > 500 ? 'text-ch-warning' : 'text-ch-text'}`}>
            {row.parts_to_do} parts
          </span>
          {row.parts_to_do_names?.length > 0 && (
            <button
              onClick={() => setShowParts(v => !v)}
              className="text-[10px] text-ch-muted hover:text-ch-text transition-colors ml-auto"
            >
              {showParts ? 'hide parts' : `show part names (${row.parts_to_do_names.length})`}
            </button>
          )}
        </div>
      )}

      {showParts && row.parts_to_do_names?.length > 0 && (
        <div className="px-4 pb-3 border-t border-ch-border/30 bg-ch-bg/30 max-h-40 overflow-y-auto">
          {row.parts_to_do_names.map(p => (
            <div key={p} className="text-[10px] font-mono text-ch-muted py-0.5">{p}</div>
          ))}
        </div>
      )}

      {/* Error section */}
      {failed && (
        <div className="mx-4 mb-3 mt-1 p-3 bg-ch-danger/8 border border-red-500/20 rounded-lg">
          <div className="text-[10px] font-semibold text-ch-danger mb-1">Last failure</div>
          {row.latest_failed_part && (
            <div className="text-[10px] text-ch-muted font-mono mb-0.5">
              Part: <span className="text-ch-danger">{row.latest_failed_part}</span>
            </div>
          )}
          {row.latest_fail_time && (
            <div className="text-[10px] text-ch-muted mb-0.5">At: {row.latest_fail_time}</div>
          )}
          <div className="text-[10px] text-ch-danger leading-relaxed">{row.latest_fail_reason}</div>
        </div>
      )}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function MutationsTracker({ config }: Props) {
  const [showCompleted, setShowCompleted] = useState(false)
  const { data, isLoading, refetch } = useMutations(config)

  const mutations = data ?? []

  const today = useMemo(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0); return d
  }, [])

  const inFlight   = mutations.filter(m => !m.is_done && !isFailed(m))
  const failed     = mutations.filter(m => isFailed(m))
  const doneToday  = mutations.filter(m => m.is_done && new Date(m.create_time.replace(' ', 'T') + 'Z') >= today)
  const completed  = mutations.filter(m => m.is_done)

  const visible = showCompleted
    ? mutations
    : mutations.filter(m => !m.is_done || isFailed(m))

  return (
    <div className="flex flex-col h-full overflow-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-ch-border bg-ch-surface/50 flex-shrink-0">
        <h2 className="text-sm font-semibold text-ch-text">Mutations Tracker</h2>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-1.5 text-xs text-ch-muted border border-ch-border rounded-lg px-2.5 py-1 hover:text-ch-text hover:border-ch-accent/30 transition-colors"
        >
          <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {/* Summary cards */}
        <div className="grid grid-cols-3 gap-3 mb-5">
          {[
            { label: 'In-flight',      value: inFlight.length,  color: inFlight.length > 0 ? 'text-ch-warning' : 'text-ch-text' },
            { label: 'Failed',         value: failed.length,    color: failed.length > 0 ? 'text-ch-danger' : 'text-ch-text' },
            { label: 'Done today',     value: doneToday.length, color: 'text-ch-success' },
          ].map(s => (
            <div key={s.label} className="bg-ch-surface border border-ch-border rounded-xl px-4 py-3">
              <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
              <div className="text-xs text-ch-muted mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Toggle */}
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs text-ch-muted">
            {visible.length} mutation{visible.length !== 1 ? 's' : ''} shown
          </p>
          {completed.length > 0 && (
            <button
              onClick={() => setShowCompleted(v => !v)}
              className="text-xs text-ch-muted hover:text-ch-text border border-ch-border rounded-lg px-2.5 py-1 transition-colors"
            >
              {showCompleted ? 'Hide completed' : `Show completed (${completed.length})`}
            </button>
          )}
        </div>

        {/* List */}
        {isLoading ? (
          <div className="space-y-3">
            {[1,2,3].map(i => (
              <div key={i} className="h-20 bg-ch-surface rounded-xl animate-pulse" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 gap-3">
            <div className="w-10 h-10 rounded-full bg-ch-success/10 border border-green-500/20 flex items-center justify-center text-ch-success text-xl">
              ✓
            </div>
            <p className="text-sm text-ch-text font-medium">No active mutations</p>
            {completed.length > 0 && (
              <button
                onClick={() => setShowCompleted(true)}
                className="text-xs text-ch-muted hover:text-ch-accent transition-colors"
              >
                Show {completed.length} completed
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3 max-w-4xl">
            {visible.map(m => (
              <MutationCard key={`${m.database}.${m.table}.${m.mutation_id}`} row={m} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
