import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ChevronRight, ChevronDown, Folder, FileText, RefreshCw,
  Server, Wifi, WifiOff, AlertCircle, Database, GitBranch,
  ArrowRight, Shield, Clock, Hash, Info, Pin, Search, X
} from 'lucide-react'
import { fetchZookeeperConnections, fetchZookeeperNodes } from '../api/clickhouse'
import { usePinnedTables } from '../hooks/usePinnedTables'
import type { ConnectionConfig, ReplicaInfo, ZookeeperConnection, ZookeeperNode } from '../types'

interface Props {
  config: ConnectionConfig
  replicas: ReplicaInfo[]
}

// ─── ZK Connection Cards ────────────────────────────────────────────────────

function ConnectionCard({ conn }: { conn: ZookeeperConnection }) {
  const isConnected = conn.state === 'Connected'
  const isStandby   = conn.state === 'Standby'
  const isExpired   = conn.is_expired === 1 || conn.state === 'SessionExpired'

  const stateColor = isConnected
    ? 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30'
    : isStandby
    ? 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30'
    : 'text-red-400 bg-red-400/10 border-red-400/30'

  return (
    <div className="bg-ch-surface border border-ch-border rounded-xl p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isConnected ? (
            <Wifi className="w-4 h-4 text-emerald-400" />
          ) : (
            <WifiOff className="w-4 h-4 text-red-400" />
          )}
          <span className="font-semibold text-ch-text text-sm">{conn.host}</span>
          <span className="text-ch-muted text-xs">:{conn.port}</span>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${stateColor}`}>
          {conn.state}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        <div className="text-ch-muted">Index</div>
        <div className="text-ch-text font-mono">#{conn.index}</div>

        <div className="text-ch-muted">API Version</div>
        <div className="text-ch-text font-mono">v{conn.keeper_api_version}</div>

        <div className="text-ch-muted">Outstanding</div>
        <div className={`font-mono ${conn.outstanding_requests > 0 ? 'text-yellow-400' : 'text-ch-text'}`}>
          {conn.outstanding_requests} requests
        </div>

        {isExpired && (
          <>
            <div className="text-ch-muted">Session</div>
            <div className="text-red-400 font-mono">Expired</div>
          </>
        )}

        <div className="text-ch-muted">Connected</div>
        <div className="text-ch-text font-mono">
          {conn.connected_time ? new Date(conn.connected_time).toLocaleString() : '—'}
        </div>
      </div>

      {conn.session_id && (
        <div className="pt-2 border-t border-ch-border">
          <div className="text-xs text-ch-muted mb-0.5">Session ID</div>
          <div className="text-xs text-ch-text font-mono truncate" title={conn.session_id}>
            {conn.session_id}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Communication Flow Diagram ─────────────────────────────────────────────

function FlowBox({ icon, title, desc, color }: {
  icon: React.ReactNode; title: string; desc: string; color: string
}) {
  return (
    <div className={`flex-1 min-w-[160px] rounded-xl border p-3 ${color}`}>
      <div className="flex items-center gap-2 mb-1.5">
        {icon}
        <span className="text-sm font-semibold">{title}</span>
      </div>
      <p className="text-xs opacity-80 leading-relaxed">{desc}</p>
    </div>
  )
}

function CommunicationFlow() {
  const flows = [
    {
      title: 'Leader Election',
      icon: <Shield className="w-4 h-4 text-purple-400" />,
      desc: 'ZooKeeper coordinates which replica becomes the replication leader for each table shard.',
      color: 'bg-purple-400/5 border-purple-400/20 text-purple-200',
    },
    {
      title: 'Replication Log',
      icon: <GitBranch className="w-4 h-4 text-blue-400" />,
      desc: 'Each INSERT/MERGE is written to the ZK replication log. Replicas watch and pull entries to stay in sync.',
      color: 'bg-blue-400/5 border-blue-400/20 text-blue-200',
    },
    {
      title: 'Part Registry',
      icon: <Database className="w-4 h-4 text-emerald-400" />,
      desc: 'The set of data parts each replica holds is registered in ZK so other replicas know what to fetch.',
      color: 'bg-emerald-400/5 border-emerald-400/20 text-emerald-200',
    },
    {
      title: 'Distributed DDL',
      icon: <Server className="w-4 h-4 text-yellow-400" />,
      desc: 'ON CLUSTER DDL statements are queued in ZK under /clickhouse/task_queue so all nodes execute them.',
      color: 'bg-yellow-400/5 border-yellow-400/20 text-yellow-200',
    },
  ]

  return (
    <div className="bg-ch-surface border border-ch-border rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <Info className="w-4 h-4 text-ch-accent" />
        <h3 className="text-sm font-semibold text-ch-text">How ZooKeeper Coordinates ClickHouse</h3>
      </div>
      <div className="flex flex-wrap gap-3">
        {flows.map((f, i) => (
          <FlowBox key={i} {...f} />
        ))}
      </div>
      <div className="mt-3 text-xs text-ch-muted leading-relaxed">
        Every <span className="text-ch-text font-medium">ReplicatedMergeTree</span> table maintains its own ZK path
        (typically <span className="font-mono text-ch-accent">/clickhouse/tables/&#123;shard&#125;/&#123;db&#125;.&#123;table&#125;</span>).
        Under that path ClickHouse stores the replication log, part checksums, block IDs (deduplication),
        quorum state, and per-replica status. The ZK session must stay alive — an expired session
        makes the replica read-only until reconnection.
      </div>
    </div>
  )
}

// ─── Table ZK Registry ──────────────────────────────────────────────────────

function TableZkRow({ replica, pinned, onPin }: {
  replica: ReplicaInfo
  pinned: boolean
  onPin: () => void
}) {
  const [open, setOpen] = useState(false)
  const hasError = !!replica.zookeeper_exception || !!replica.last_queue_update_exception
  const isReadonly = replica.is_readonly === 1
  const isSessionExpired = replica.is_session_expired === 1

  const health = hasError || isReadonly || isSessionExpired ? 'problem' : 'ok'

  return (
    <div className={`border rounded-lg overflow-hidden ${
      health === 'problem' ? 'border-red-500/30' : 'border-ch-border'
    }`}>
      <div className="flex items-center">
        <button
          onClick={() => setOpen(!open)}
          className="flex-1 flex items-center gap-3 px-4 py-2.5 hover:bg-ch-surface/60 transition-colors text-left min-w-0"
        >
          {open ? (
            <ChevronDown className="w-3.5 h-3.5 text-ch-muted flex-shrink-0" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-ch-muted flex-shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <span className="text-sm font-medium text-ch-text">{replica.database}</span>
            <span className="text-ch-muted text-sm">.</span>
            <span className="text-sm font-medium text-ch-accent">{replica.table}</span>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {isReadonly && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-red-400/10 text-red-400 border border-red-400/20">readonly</span>
            )}
            {isSessionExpired && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-orange-400/10 text-orange-400 border border-orange-400/20">session expired</span>
            )}
            {hasError && (
              <AlertCircle className="w-3.5 h-3.5 text-red-400" />
            )}
            <span className="text-xs text-ch-muted font-mono">{replica.replica_name}</span>
          </div>
        </button>
        <button
          onClick={e => { e.stopPropagation(); onPin() }}
          title={pinned ? 'Unpin' : 'Pin to top'}
          className={`px-3 py-2.5 border-l border-ch-border hover:bg-ch-surface/60 transition-colors flex-shrink-0 ${
            pinned ? 'text-ch-accent' : 'text-ch-muted hover:text-ch-text'
          }`}
        >
          <Pin className="w-3.5 h-3.5" />
        </button>
      </div>

      {open && (
        <div className="px-4 py-3 bg-ch-bg/50 border-t border-ch-border space-y-3 text-xs">
          <div>
            <div className="text-ch-muted mb-1 font-medium">Table ZooKeeper Path</div>
            <div className="font-mono text-ch-accent bg-ch-surface px-2 py-1 rounded text-xs break-all">
              {replica.zookeeper_path || '—'}
            </div>
          </div>
          <div>
            <div className="text-ch-muted mb-1 font-medium">Replica ZooKeeper Path</div>
            <div className="font-mono text-ch-text bg-ch-surface px-2 py-1 rounded text-xs break-all">
              {replica.replica_path || '—'}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <div className="text-ch-muted mb-0.5">Log gap</div>
              <div className={`font-mono font-semibold ${
                replica.log_max_index - replica.log_pointer > 100 ? 'text-red-400'
                : replica.log_max_index - replica.log_pointer > 10 ? 'text-yellow-400'
                : 'text-emerald-400'
              }`}>
                {Math.max(0, replica.log_max_index - replica.log_pointer)}
              </div>
              <div className="text-ch-muted opacity-70">entries behind</div>
            </div>
            <div>
              <div className="text-ch-muted mb-0.5">Queue size</div>
              <div className={`font-mono font-semibold ${replica.queue_size > 50 ? 'text-yellow-400' : 'text-ch-text'}`}>
                {replica.queue_size}
              </div>
            </div>
            <div>
              <div className="text-ch-muted mb-0.5">Absolute delay</div>
              <div className={`font-mono font-semibold ${replica.absolute_delay > 300 ? 'text-red-400' : replica.absolute_delay > 60 ? 'text-yellow-400' : 'text-ch-text'}`}>
                {replica.absolute_delay}s
              </div>
            </div>
          </div>

          {replica.zookeeper_exception && (
            <div className="bg-red-500/10 border border-red-500/20 rounded p-2 text-red-400">
              <div className="font-medium mb-0.5">ZooKeeper Exception</div>
              <div className="font-mono">{replica.zookeeper_exception}</div>
            </div>
          )}
          {replica.last_queue_update_exception && (
            <div className="bg-orange-500/10 border border-orange-500/20 rounded p-2 text-orange-400">
              <div className="font-medium mb-0.5">Queue Update Exception</div>
              <div className="font-mono">{replica.last_queue_update_exception}</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── ZK Path Explorer ───────────────────────────────────────────────────────

const PATH_DESCRIPTIONS: Record<string, string> = {
  clickhouse: 'Root namespace for all ClickHouse ZooKeeper data',
  tables: 'Replication metadata for every ReplicatedMergeTree table (one subtree per shard/table)',
  task_queue: 'Distributed DDL queue — ON CLUSTER ALTER/CREATE/DROP statements land here',
  zero_copy: 'Zero-copy replication metadata for S3/HDFS-backed tables',
  keeper: 'Keeper (ClickHouse built-in ZK replacement) internal state',
  'replicated_ddl_log': 'Log of replicated DDL operations across the cluster',
}

function pathDescription(name: string, path: string): string {
  if (PATH_DESCRIPTIONS[name]) return PATH_DESCRIPTIONS[name]
  if (path.startsWith('/clickhouse/tables')) return 'Per-shard replication log, parts, quorum, and block IDs'
  if (path.startsWith('/clickhouse/task_queue')) return 'Pending distributed DDL task'
  return ''
}

interface TreeNodeProps {
  node: ZookeeperNode
  config: ConnectionConfig
  depth: number
}

function TreeNode({ node, config, depth }: TreeNodeProps) {
  const [open, setOpen] = useState(false)
  const hasChildren = node.numChildren > 0
  const childPath = node.path === '/' ? `/${node.name}` : `${node.path}/${node.name}`
  const desc = pathDescription(node.name, node.path)

  const children = useQuery({
    queryKey: ['zk', config, childPath],
    queryFn: () => fetchZookeeperNodes(config, childPath),
    enabled: open && hasChildren,
    staleTime: 30_000,
  })

  return (
    <div>
      <div
        className="flex items-start gap-1.5 py-1.5 rounded cursor-pointer hover:bg-ch-surface/60 transition-colors text-sm group"
        style={{ paddingLeft: depth * 18 + 8 }}
        onClick={() => hasChildren && setOpen(!open)}
      >
        <div className="flex items-center gap-1.5 flex-shrink-0 mt-0.5">
          {hasChildren ? (
            open ? (
              <ChevronDown className="w-3.5 h-3.5 text-ch-muted" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-ch-muted" />
            )
          ) : (
            <span className="w-3.5 h-3.5" />
          )}
          {hasChildren ? (
            <Folder className="w-3.5 h-3.5 text-ch-accent flex-shrink-0" />
          ) : (
            <FileText className="w-3.5 h-3.5 text-ch-muted flex-shrink-0" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`font-mono font-medium ${hasChildren ? 'text-ch-text' : 'text-ch-muted'}`}>
              {node.name}
            </span>
            {hasChildren && (
              <span className="text-xs text-ch-muted opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                <Hash className="w-3 h-3" />{node.numChildren}
              </span>
            )}
            {node.value && !hasChildren && (
              <span className="text-xs text-ch-muted font-mono truncate max-w-xs" title={node.value}>
                = {node.value.length > 50 ? node.value.slice(0, 50) + '…' : node.value}
              </span>
            )}
          </div>
          {desc && depth <= 1 && (
            <div className="text-xs text-ch-muted mt-0.5">{desc}</div>
          )}
        </div>
      </div>

      {open && children.isLoading && (
        <div style={{ paddingLeft: (depth + 1) * 18 + 28 }} className="py-1 text-xs text-ch-muted italic">
          Loading…
        </div>
      )}

      {open && children.data?.map(child => (
        <TreeNode
          key={`${childPath}/${child.name}`}
          node={child}
          config={config}
          depth={depth + 1}
        />
      ))}
    </div>
  )
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function ZookeeperNodes({ config, replicas }: Props) {
  const [search, setSearch] = useState('')
  const { isPinned, toggle } = usePinnedTables('ch-pinned-zk')

  const connections = useQuery({
    queryKey: ['zk_connections', config],
    queryFn: () => fetchZookeeperConnections(config),
    staleTime: 15_000,
    retry: false,
    refetchInterval: (query) => query.state.status === 'error' ? false : 30_000,
  })

  const root = useQuery({
    queryKey: ['zk', config, '/'],
    queryFn: () => fetchZookeeperNodes(config, '/'),
    staleTime: 30_000,
    retry: false,
  })

  // Group replicas by table for the ZK registry
  const tableMap = new Map<string, ReplicaInfo>()
  replicas.forEach(r => {
    const key = `${r.database}.${r.table}`
    if (!tableMap.has(key)) tableMap.set(key, r)
  })
  const tableList = [...tableMap.values()].sort((a, b) =>
    `${a.database}.${a.table}`.localeCompare(`${b.database}.${b.table}`)
  )

  const q = search.toLowerCase()
  const filtered = q
    ? tableList.filter(r =>
        r.table.toLowerCase().includes(q) || r.database.toLowerCase().includes(q)
      )
    : tableList

  const pinnedRows   = filtered.filter(r => isPinned(`${r.database}.${r.table}`))
  const unpinnedRows = filtered.filter(r => !isPinned(`${r.database}.${r.table}`))

  const connCount  = connections.data?.length ?? 0
  const liveCount  = connections.data?.filter(c => c.state === 'Connected').length ?? 0
  const problemCount = tableList.filter(r =>
    r.is_readonly === 1 || r.is_session_expired === 1 || !!r.zookeeper_exception
  ).length

  return (
    <div className="p-4 space-y-5 max-w-5xl mx-auto">

      {/* ── Section 1: ZK Ensemble Connections ── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-sm font-semibold text-ch-text flex items-center gap-2">
              <Server className="w-4 h-4 text-ch-accent" />
              ZooKeeper / Keeper Ensemble
            </h2>
            <p className="text-xs text-ch-muted mt-0.5">
              Hosts that ClickHouse is connected to for distributed coordination
            </p>
          </div>
          <button
            onClick={() => connections.refetch()}
            className="flex items-center gap-1.5 text-xs text-ch-muted hover:text-ch-text transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${connections.isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {connections.isLoading ? (
          <div className="text-sm text-ch-muted">Loading ZooKeeper connections…</div>
        ) : connections.isError ? (
          <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <div>
              <div className="font-medium">system.zookeeper_connection unavailable</div>
              <div className="text-red-300/70 mt-0.5">{(connections.error as Error)?.message}</div>
              <div className="text-red-300/50 mt-1">Requires ClickHouse 22.6+ with ZooKeeper/Keeper configured.</div>
            </div>
          </div>
        ) : connCount === 0 ? (
          <div className="text-sm text-ch-muted p-3 bg-ch-surface border border-ch-border rounded-xl">
            No ZooKeeper connections found. This cluster may not use replication.
          </div>
        ) : (
          <>
            <div className="flex items-center gap-4 mb-3 text-xs text-ch-muted">
              <span>
                <span className="text-emerald-400 font-semibold">{liveCount}</span> connected
              </span>
              <span>
                <span className="text-ch-text font-semibold">{connCount}</span> total hosts
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {connections.data?.map((conn, i) => (
                <ConnectionCard key={i} conn={conn} />
              ))}
            </div>
          </>
        )}
      </section>

      {/* ── Section 2: How ZK Works ── */}
      <CommunicationFlow />

      {/* ── Section 3: Table ZK Registry ── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-sm font-semibold text-ch-text flex items-center gap-2">
              <Database className="w-4 h-4 text-ch-accent" />
              Table ZooKeeper Registry
            </h2>
            <p className="text-xs text-ch-muted mt-0.5">
              ZK paths and sync state for each replicated table on this node
            </p>
          </div>
          {problemCount > 0 && (
            <span className="flex items-center gap-1.5 text-xs text-red-400">
              <AlertCircle className="w-3.5 h-3.5" />
              {problemCount} with issues
            </span>
          )}
        </div>

        {/* Search bar */}
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ch-muted pointer-events-none" />
          <input
            type="text"
            placeholder="Search tables…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-ch-bg border border-ch-border rounded-lg pl-8 pr-8 py-1.5 text-sm text-ch-text placeholder:text-ch-muted focus:outline-none focus:border-ch-accent/60 transition-colors"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ch-muted hover:text-ch-text"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {tableList.length === 0 ? (
          <div className="text-sm text-ch-muted p-3 bg-ch-surface border border-ch-border rounded-xl">
            No replicated tables found for the selected database filter.
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-sm text-ch-muted p-3 bg-ch-surface border border-ch-border rounded-xl">
            No tables match <span className="text-ch-text font-mono">"{search}"</span>
          </div>
        ) : (
          <div className="space-y-1.5">
            {pinnedRows.length > 0 && (
              <>
                <div className="flex items-center gap-2 text-xs text-ch-muted px-1 pb-0.5">
                  <Pin className="w-3 h-3 text-ch-accent" />
                  Pinned
                </div>
                {pinnedRows.map(r => (
                  <TableZkRow
                    key={`${r.database}.${r.table}`}
                    replica={r}
                    pinned
                    onPin={() => toggle(`${r.database}.${r.table}`)}
                  />
                ))}
                {unpinnedRows.length > 0 && (
                  <div className="border-t border-ch-border my-1" />
                )}
              </>
            )}
            {unpinnedRows.map(r => (
              <TableZkRow
                key={`${r.database}.${r.table}`}
                replica={r}
                pinned={false}
                onPin={() => toggle(`${r.database}.${r.table}`)}
              />
            ))}
          </div>
        )}
      </section>

      {/* ── Section 4: ZK Path Explorer ── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-sm font-semibold text-ch-text flex items-center gap-2">
              <Folder className="w-4 h-4 text-ch-accent" />
              ZooKeeper Path Explorer
            </h2>
            <p className="text-xs text-ch-muted mt-0.5">
              Browse the raw ZK namespace — expand nodes to see children and values
            </p>
          </div>
          <button
            onClick={() => root.refetch()}
            className="flex items-center gap-1.5 text-xs text-ch-muted hover:text-ch-text transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${root.isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        <div className="bg-ch-surface border border-ch-border rounded-xl overflow-auto max-h-[500px]">
          {root.isLoading ? (
            <div className="p-4 text-sm text-ch-muted">Loading ZooKeeper tree…</div>
          ) : root.isError ? (
            <div className="flex items-start gap-2 p-3 text-red-400 text-xs">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <div>
                <div className="font-medium">system.zookeeper unavailable</div>
                <div className="text-red-300/70 mt-0.5">{(root.error as Error)?.message}</div>
              </div>
            </div>
          ) : root.data?.length === 0 ? (
            <div className="p-4 text-sm text-ch-muted">No nodes found at ZooKeeper root.</div>
          ) : (
            <div className="py-2">
              {root.data?.map(node => (
                <TreeNode key={node.name} node={node} config={config} depth={0} />
              ))}
            </div>
          )}
        </div>

        <div className="mt-2 flex flex-wrap gap-4 text-xs text-ch-muted">
          <span className="flex items-center gap-1.5">
            <Folder className="w-3.5 h-3.5 text-ch-accent" /> Directory node (expandable)
          </span>
          <span className="flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5 text-ch-muted" /> Leaf node (shows value)
          </span>
          <span className="flex items-center gap-1.5">
            <ArrowRight className="w-3.5 h-3.5" /> Click to expand
          </span>
          <span className="flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" /> Cached 30s
          </span>
        </div>
      </section>
    </div>
  )
}
