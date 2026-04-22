import { useState, useMemo } from 'react'
import {
  ChevronDown, ChevronRight, Info, Gauge,
  CheckCircle2, AlertTriangle,
} from 'lucide-react'
import { useClusterConfig } from '../hooks/useClusterConfig'
import type { ConnectionConfig, ClusterNode, SettingRow, MergeTreeSettingRow, ServerSettingRow } from '../types'

// ── Plain-English explanations ──────────────────────────────────────────────

const SETTING_EXPLANATIONS: Record<string, string> = {
  max_memory_usage: 'Maximum RAM a single query can use before it gets killed',
  max_memory_usage_for_user: 'Maximum RAM all queries from one user can use combined (0 = unlimited)',
  max_bytes_before_external_sort: 'When ORDER BY exceeds this, ClickHouse spills to disk instead of failing',
  max_bytes_before_external_group_by: 'When GROUP BY exceeds this, ClickHouse spills to disk instead of failing',
  max_execution_time: 'Maximum seconds a query can run before auto-cancellation (0 = unlimited)',
  receive_timeout: 'How long to wait for data from a remote server before timing out',
  send_timeout: 'How long to wait for a remote server to accept data before timing out',
  connect_timeout: 'How long to wait when establishing a connection to another server',
  http_receive_timeout: 'Timeout for receiving data via the HTTP interface',
  max_insert_block_size: 'Maximum number of rows per insert block — larger blocks = fewer parts but more memory',
  max_partition_size_to_drop: 'Safety limit: prevents dropping partitions larger than this (bytes) without SETTINGS check',
  max_parts_in_total: 'If a table exceeds this many parts, new inserts are REJECTED — increase if you see "too many parts" errors',
  max_insert_threads: 'Number of threads used to process a single INSERT — higher = faster ingestion but more CPU',
  min_insert_block_size_rows: 'Minimum rows to accumulate before flushing an insert block',
  min_insert_block_size_bytes: 'Minimum bytes to accumulate before flushing an insert block',
  max_threads: 'Maximum threads per query — controls query parallelism',
  background_pool_size: 'Thread pool for background merges and mutations — too low causes merge lag',
  background_fetches_pool_size: 'Thread pool for fetching parts from other replicas during replication',
  background_schedule_pool_size: 'Thread pool for scheduled background tasks (e.g., cleanup, moves)',
  background_move_pool_size: 'Thread pool for moving data between disks (hot → cold storage)',
  max_replicated_fetches_network_bandwidth: 'Bandwidth limit for replication fetches (bytes/sec, 0 = unlimited)',
  max_replicated_merges_in_queue: 'Max merge tasks in the replication queue — prevents merge storms',
  max_replicated_mutations_in_queue: 'Max mutation tasks in the replication queue',
  max_replicated_sends_in_queue: 'Max outbound part-send tasks in the replication queue',
  replicated_deduplication_window: 'Number of recent blocks to check for deduplication (prevents duplicate inserts)',
  replicated_deduplication_window_seconds: 'Time window for deduplication checks (seconds)',
  max_distributed_connections: 'Max simultaneous connections to remote shards for distributed queries',
  distributed_connections_pool_size: 'Connection pool size for distributed queries',
  max_concurrent_queries: 'Server-wide limit on simultaneously running queries',
  max_connections: 'Maximum simultaneous client connections the server accepts',
  keep_alive_timeout: 'How long to keep idle connections alive before closing',
  max_server_memory_usage: 'Total RAM ClickHouse server can use (0 = auto-calculated from system RAM)',
  max_server_memory_usage_to_ram_ratio: 'Fraction of system RAM the server can use (e.g., 0.9 = 90%)',
  mark_cache_size: 'Cache for mark files — larger cache = fewer disk reads for primary key lookups',
  uncompressed_cache_size: 'Cache for uncompressed data blocks — speeds up repeated reads of same data',
  interserver_http_port: 'Port used for data replication between cluster nodes',
  interserver_http_host: 'Hostname/IP used for inter-node replication traffic',
  interserver_http_credentials: 'Whether authentication is enabled for inter-node replication',
  listen_host: 'Network interface(s) the server listens on — 0.0.0.0 = all interfaces',
  tcp_port: 'Native TCP protocol port for client connections',
  http_port: 'HTTP interface port for REST API and web UI',
  tcp_port_secure: 'TLS-encrypted native TCP port (0 = disabled)',
  https_port: 'TLS-encrypted HTTP port (0 = disabled)',
  max_bytes_to_merge_at_max_space_in_pool: 'Largest merge allowed when pool has plenty of space',
  max_bytes_to_merge_at_min_space_in_pool: 'Largest merge allowed when pool is nearly full',
  merge_max_block_size: 'Block size used during merge operations',
  max_parts_to_merge_at_once: 'Maximum parts combined in a single merge',
  number_of_free_entries_in_pool_to_execute_mutation: 'Free pool slots needed before a mutation can start',
}

// ── Setting categories ──────────────────────────────────────────────────────

interface SettingCategory {
  label: string
  keys: string[]
}

const SETTING_CATEGORIES: SettingCategory[] = [
  { label: 'Memory Limits', keys: ['max_memory_usage', 'max_memory_usage_for_user', 'max_bytes_before_external_sort', 'max_bytes_before_external_group_by'] },
  { label: 'Query Timeouts', keys: ['max_execution_time', 'receive_timeout', 'send_timeout', 'connect_timeout', 'http_receive_timeout'] },
  { label: 'Ingestion & Insert Limits', keys: ['max_insert_block_size', 'max_partition_size_to_drop', 'max_parts_in_total', 'max_insert_threads', 'min_insert_block_size_rows', 'min_insert_block_size_bytes'] },
  { label: 'Thread Pools & Concurrency', keys: ['max_threads', 'background_pool_size', 'background_fetches_pool_size', 'background_schedule_pool_size', 'background_move_pool_size', 'max_replicated_fetches_network_bandwidth'] },
  { label: 'Replication Limits', keys: ['max_replicated_merges_in_queue', 'max_replicated_mutations_in_queue', 'max_replicated_sends_in_queue', 'replicated_deduplication_window', 'replicated_deduplication_window_seconds'] },
  { label: 'Network & Connections', keys: ['max_concurrent_queries', 'max_connections', 'keep_alive_timeout', 'max_distributed_connections', 'distributed_connections_pool_size'] },
  { label: 'MergeTree Engine', keys: ['max_bytes_to_merge_at_max_space_in_pool', 'max_bytes_to_merge_at_min_space_in_pool', 'merge_max_block_size', 'max_parts_to_merge_at_once', 'number_of_free_entries_in_pool_to_execute_mutation'] },
]

// ── Helpers ──────────────────────────────────────────────────────────────────

// ── Tooltip ─────────────────────────────────────────────────────────────────

function Tooltip({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <span className="relative group/tip inline-flex items-center">
      {children}
      <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2.5 py-1.5 bg-ch-surface border border-ch-border text-ch-text text-[11px] rounded-md shadow-lg opacity-0 group-hover/tip:opacity-100 pointer-events-none transition-opacity whitespace-normal max-w-xs z-50 leading-relaxed">
        {text}
      </span>
    </span>
  )
}

// ── Collapsible section ─────────────────────────────────────────────────────

function Section({ title, icon, defaultOpen = true, badge, children }: {
  title: string
  icon: React.ReactNode
  defaultOpen?: boolean
  badge?: React.ReactNode
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border border-ch-border rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 px-4 py-3 bg-ch-surface hover:bg-ch-bg transition-colors text-left"
      >
        {open ? <ChevronDown className="w-4 h-4 text-ch-muted" /> : <ChevronRight className="w-4 h-4 text-ch-muted" />}
        {icon}
        <span className="text-sm font-medium text-ch-text flex-1">{title}</span>
        {badge}
      </button>
      {open && <div className="p-4 border-t border-ch-border bg-ch-bg">{children}</div>}
    </div>
  )
}

// ── Props ───────────────────────────────────────────────────────────────────

interface Props {
  config: ConnectionConfig
  clusters: ClusterNode[]
}

const SYSTEM_CLUSTER_RE = /^test_|_localhost$|^all_groups$|^all_replicas$/

export function ClusterConfig({ config, clusters }: Props) {
  const [showDiffs, setShowDiffs] = useState(false)
  const userClusters = useMemo(() => clusters.filter(c => !SYSTEM_CLUSTER_RE.test(c.cluster)), [clusters])
  const clusterName = userClusters[0]?.cluster ?? clusters[0]?.cluster ?? null
  const {
    serverSettings, settings, mergeTreeSettings, isLoading,
  } = useClusterConfig(config, clusterName)

  // ── Derived data ────────────────────────────────────────────────────────

  // Pivot settings into name → host → value for comparison
  type SettingLike = SettingRow | MergeTreeSettingRow | ServerSettingRow
  const allSettings = useMemo(() => [...settings, ...mergeTreeSettings, ...serverSettings], [settings, mergeTreeSettings, serverSettings])
  const settingMap = useMemo(() => {
    const m = new Map<string, Map<string, string>>()
    for (const s of allSettings) {
      if (!m.has(s.name)) m.set(s.name, new Map())
      m.get(s.name)!.set(s.host, s.value)
    }
    return m
  }, [allSettings])

  const settingDescMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const s of allSettings) {
      if (s.description && !m.has(s.name)) m.set(s.name, s.description)
    }
    return m
  }, [allSettings])

  const settingsHosts = useMemo(() => {
    const h = new Set<string>()
    for (const s of allSettings) h.add(s.host)
    return [...h].sort()
  }, [allSettings])

  const diffDetails = useMemo(() => {
    const diffs: { name: string; values: { host: string; value: string }[] }[] = []
    for (const [name, hostMap] of settingMap) {
      const vals = [...hostMap.entries()]
      if (new Set(vals.map(([, v]) => v)).size > 1) {
        diffs.push({ name, values: vals.map(([host, value]) => ({ host, value })) })
      }
    }
    return diffs
  }, [settingMap])

  const diffCount = diffDetails.length

  // ── Render ──────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-ch-muted text-sm">
        Loading cluster configuration...
      </div>
    )
  }

  return (
    <div className="p-4 space-y-4">
      {/* Limits & Resources */}
      <Section
        title="Limits & Resources"
        icon={<Gauge className="w-4 h-4 text-yellow-400" />}
        badge={
          diffCount > 0 ? (
            <span className="text-xs text-yellow-400 flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5" /> {diffCount} differ{diffCount === 1 ? 's' : ''}
            </span>
          ) : settingsHosts.length > 1 ? (
            <span className="text-xs text-emerald-400 flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" /> All consistent
            </span>
          ) : null
        }
      >
        <p className="text-xs text-ch-muted mb-3">
          Operational limits that determine when queries get killed, inserts get rejected, or replication stalls.
          {settingsHosts.length > 1 && ' Yellow-highlighted columns indicate values that differ across nodes — potential misconfiguration.'}
        </p>

        {diffDetails.length > 0 && (
          <div className="mb-4">
            <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showDiffs}
                onChange={(e) => setShowDiffs(e.target.checked)}
                className="rounded border-ch-border bg-ch-surface text-yellow-500 focus:ring-yellow-500/30 w-3.5 h-3.5 cursor-pointer"
              />
              <span className="text-yellow-400 flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" />
                Show {diffDetails.length} setting{diffDetails.length !== 1 ? 's' : ''} that differ across nodes
              </span>
            </label>
            {showDiffs && (
              <div className="mt-2 border border-yellow-500/30 rounded-lg bg-yellow-900/10 p-3">
                <div className="space-y-2">
                  {diffDetails.map(d => (
                    <div key={d.name} className="text-xs">
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className="font-mono text-yellow-300 font-medium">{d.name}</span>
                        {SETTING_EXPLANATIONS[d.name] && (
                          <Tooltip text={SETTING_EXPLANATIONS[d.name]}>
                            <Info className="w-3 h-3 text-ch-muted/60" />
                          </Tooltip>
                        )}
                      </div>
                      <div className="ml-3 space-y-0.5">
                        {d.values.map(v => (
                          <div key={v.host} className="flex items-center gap-2 text-[11px]">
                            <span className="font-mono text-ch-muted truncate min-w-[120px]">{v.host}</span>
                            <span className="font-mono text-yellow-300">{v.value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {SETTING_CATEGORIES.map(cat => {
          const catSettings = cat.keys.filter(k => settingMap.has(k))
          if (catSettings.length === 0) return null

          const catDiffNames = new Set(catSettings.filter(name => {
            const vals = [...(settingMap.get(name)?.values() ?? [])]
            return new Set(vals).size > 1
          }))

          return (
            <div key={cat.label} className="mb-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="text-xs font-medium text-ch-muted uppercase tracking-wider">{cat.label}</div>
                {catDiffNames.size > 0 && (
                  <span className="text-[10px] text-yellow-400 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> {catDiffNames.size} differ{catDiffNames.size === 1 ? 's' : ''} across nodes
                  </span>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-ch-border text-ch-muted">
                      <th className="text-left py-1.5 pr-3 sticky left-0 bg-ch-bg z-10 min-w-[140px]">Host</th>
                      {catSettings.map(name => {
                        const differs = catDiffNames.has(name)
                        const explanation = SETTING_EXPLANATIONS[name] || settingDescMap.get(name) || ''
                        return (
                          <th key={name} className={`text-right py-1.5 px-2 font-normal whitespace-nowrap ${differs ? 'bg-yellow-900/10' : ''}`}>
                            <span className="flex items-center justify-end gap-1">
                              {differs && <AlertTriangle className="w-3 h-3 text-yellow-400 flex-shrink-0" />}
                              <span className="font-mono">{name}</span>
                              {explanation && (
                                <Tooltip text={explanation}>
                                  <Info className="w-3 h-3 text-ch-muted/60 flex-shrink-0" />
                                </Tooltip>
                              )}
                            </span>
                          </th>
                        )
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {settingsHosts.map(host => (
                      <tr key={host} className="border-b border-ch-border/50">
                        <td className="py-1.5 pr-3 font-mono text-ch-text sticky left-0 bg-ch-bg z-10">{host}</td>
                        {catSettings.map(name => {
                          const hostMap = settingMap.get(name)!
                          const differs = catDiffNames.has(name)
                          return (
                            <td
                              key={name}
                              className={`py-1.5 px-2 text-right font-mono ${differs ? 'text-yellow-300 bg-yellow-900/10' : 'text-ch-accent'}`}
                            >
                              {hostMap.get(host) ?? '—'}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )
        })}

        {allSettings.length === 0 && (
          <div className="text-xs text-ch-muted text-center py-4">
            No settings data available.
          </div>
        )}
      </Section>
    </div>
  )
}
