import { useState, useMemo } from 'react'
import {
  AlertTriangle, CheckCircle, XCircle, Clock, Search,
  Pin, PinOff, ChevronDown, ChevronRight, Activity,
  GitBranch, Layers, Zap, AlertCircle, Info,
} from 'lucide-react'
import { usePinnedTables } from '../hooks/usePinnedTables'
import type { ReplicaInfo, ReplicationQueueItem } from '../types'

interface Props {
  replicas: ReplicaInfo[]
  queue: ReplicationQueueItem[]
}

// ── Helpers ────────────────────────────────────────────────────────────────

function DelayBadge({ delay }: { delay: number }) {
  if (delay === 0) return (
    <span className="flex items-center gap-1 text-green-400 text-xs" title="This replica is fully caught up with the replication log">
      <CheckCircle className="w-3 h-3" /> In sync
    </span>
  )
  if (delay < 60) return <span className="text-yellow-400 text-xs" title={`${delay}s behind the most up-to-date replica`}>{delay}s behind</span>
  if (delay < 300) return <span className="text-orange-400 text-xs" title={`${delay}s behind the most up-to-date replica`}>{Math.floor(delay / 60)}m behind</span>
  return <span className="text-red-400 text-xs font-semibold" title={`${delay}s behind — significantly lagging`}>{Math.floor(delay / 60)}m behind !</span>
}

const QUEUE_TYPE_LABELS: Record<string, { label: string; color: string; description: string }> = {
  GET_PART:     { label: 'Fetch',    color: 'text-blue-400',   description: 'Download a data part from another replica' },
  MERGE_PARTS:  { label: 'Merge',    color: 'text-purple-400', description: 'Merge multiple small parts into a larger one (background compaction)' },
  DROP_RANGE:   { label: 'Drop',     color: 'text-red-400',    description: 'Delete a range of parts (from TTL or DROP PARTITION)' },
  MUTATE_PART:  { label: 'Mutate',   color: 'text-orange-400', description: 'Apply an ALTER UPDATE/DELETE mutation to a part' },
  ATTACH_PART:  { label: 'Attach',   color: 'text-teal-400',   description: 'Attach a detached part back into the table' },
  MOVE_PART:    { label: 'Move',     color: 'text-cyan-400',   description: 'Move a part to a different disk tier' },
}

function QueueTypeBadge({ type }: { type: string }) {
  const meta = QUEUE_TYPE_LABELS[type]
  return (
    <span
      className={`text-[10px] font-mono font-semibold ${meta?.color ?? 'text-ch-muted'}`}
      title={meta?.description ?? type}
    >
      {meta?.label ?? type}
    </span>
  )
}

function Tooltip({ text }: { text: string }) {
  return (
    <span title={text} className="cursor-help">
      <Info className="w-3 h-3 text-ch-muted/50 hover:text-ch-muted transition-colors inline-block ml-1" />
    </span>
  )
}

// ── Stat cell ─────────────────────────────────────────────────────────────

function Stat({
  label, value, tooltip, warn, danger,
}: {
  label: string; value: React.ReactNode; tooltip: string; warn?: boolean; danger?: boolean
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wider text-ch-muted flex items-center gap-0.5 whitespace-nowrap">
        {label}<Tooltip text={tooltip} />
      </span>
      <span className={`text-sm font-mono font-semibold ${danger ? 'text-red-400' : warn ? 'text-yellow-400' : 'text-ch-text'}`}>
        {value}
      </span>
    </div>
  )
}

// ── Per-replica row ────────────────────────────────────────────────────────

function ReplicaRow({ r, queueItems }: { r: ReplicaInfo; queueItems: ReplicationQueueItem[] }) {
  const [open, setOpen] = useState(false)

  const logGap = r.log_max_index - r.log_pointer
  const isHealthy = r.is_readonly === 0 && r.is_session_expired === 0 && r.absolute_delay < 60 && !r.zookeeper_exception

  return (
    <div className="border-t border-ch-border">
      {/* Replica header */}
      <button
        className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-ch-bg/30 transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        {open ? <ChevronDown className="w-3.5 h-3.5 text-ch-muted flex-shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-ch-muted flex-shrink-0" />}

        {/* Health dot */}
        <span
          className={`w-2 h-2 rounded-full flex-shrink-0 ${isHealthy ? 'bg-green-400' : r.is_readonly === 1 ? 'bg-red-400' : 'bg-yellow-400'}`}
          title={isHealthy ? 'Healthy' : r.is_readonly === 1 ? 'Read-only — writes rejected' : 'Degraded'}
        />

        <span className="font-medium text-sm text-ch-text">{r.replica_name}</span>

        {/* Status badges */}
        <div className="flex items-center gap-1.5 ml-1">
          {r.is_leader === 1 && (
            <span className="text-[9px] bg-ch-accent/15 text-ch-accent border border-ch-accent/25 px-1.5 py-0.5 rounded font-semibold" title="This replica is currently the leader — it schedules merges for all replicas">
              LEADER
            </span>
          )}
          {r.is_readonly === 1 && (
            <span className="text-[9px] bg-red-500/15 text-red-400 border border-red-500/25 px-1.5 py-0.5 rounded" title="Read-only mode: this replica cannot accept INSERTs. Usually caused by a lost ZooKeeper session, full disk, or misconfiguration.">
              READONLY
            </span>
          )}
          {r.is_session_expired === 1 && (
            <span className="text-[9px] bg-orange-500/15 text-orange-400 border border-orange-500/25 px-1.5 py-0.5 rounded" title="ZooKeeper session expired: this replica has lost its coordination lease. It will try to reconnect.">
              ZK SESSION EXPIRED
            </span>
          )}
          {r.can_become_leader === 0 && (
            <span className="text-[9px] bg-ch-border text-ch-muted px-1.5 py-0.5 rounded" title="This replica is configured with prefer_not_to_merge=1 or similar, so it won't become the merge leader.">
              NO LEADER
            </span>
          )}
        </div>

        {/* Summary stats — always visible */}
        <div className="ml-auto flex items-center gap-5 flex-shrink-0">
          <span className={`text-xs ${r.queue_size > 0 ? 'text-yellow-400' : 'text-ch-muted'}`}
            title="Total tasks in this replica's replication queue (parts to fetch, merges to run, mutations to apply)">
            Q: {r.queue_size}
          </span>
          <span className="text-xs text-ch-muted" title="How many out of all configured replicas are currently active in ZooKeeper">
            {r.active_replicas}/{r.total_replicas} active
          </span>
          <DelayBadge delay={r.absolute_delay} />
          {r.zookeeper_exception && (
            <span className="text-red-400 text-xs" title={r.zookeeper_exception}>ZK err</span>
          )}
        </div>
      </button>

      {/* Expanded detail */}
      {open && (
        <div className="px-4 pb-4 pt-1 space-y-4 bg-ch-bg/20">
          {/* Queue breakdown */}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-ch-muted font-semibold mb-2">
              Replication Queue
              <Tooltip text="Tasks this replica must complete to stay in sync. These run as background operations and don't block reads." />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat
                label="Total Queue"
                value={r.queue_size}
                tooltip="Total pending replication tasks: fetches + merges + mutations. High values mean this replica is falling behind."
                warn={r.queue_size > 10}
                danger={r.queue_size > 100}
              />
              <Stat
                label="Inserts"
                value={r.inserts_in_queue}
                tooltip="Parts from INSERT operations that haven't been fetched from other replicas yet."
                warn={r.inserts_in_queue > 5}
              />
              <Stat
                label="Merges"
                value={r.merges_in_queue}
                tooltip="Pending background merge operations. Merges compact small parts into larger ones to keep query performance optimal."
                warn={r.merges_in_queue > 20}
              />
              <Stat
                label="Mutations"
                value={r.part_mutations_in_queue}
                tooltip="Pending ALTER UPDATE / ALTER DELETE mutations. These rewrite affected parts and can be slow on large tables."
                warn={r.part_mutations_in_queue > 0}
              />
            </div>

            {/* Queue age hints */}
            {(r.queue_oldest_time && r.queue_oldest_time !== '1970-01-01 00:00:00') && (
              <div className="mt-2 text-xs text-ch-muted">
                Oldest task since <span className="text-ch-text">{r.queue_oldest_time}</span>
                {(r.inserts_oldest_time && r.inserts_oldest_time !== '1970-01-01 00:00:00') &&
                  <> · oldest insert <span className="text-ch-text">{r.inserts_oldest_time}</span></>}
              </div>
            )}
          </div>

          {/* Replication log progress */}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-ch-muted font-semibold mb-2">
              Replication Log
              <Tooltip text="ClickHouse keeps a shared replication log in ZooKeeper. Each entry is an operation all replicas must apply. Log pointer = last entry this replica applied. Gap = how many entries are still pending." />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Stat
                label="Log Pointer"
                value={r.log_pointer}
                tooltip="The last replication log entry this replica has applied. Compared against log_max_index to measure lag."
              />
              <Stat
                label="Log Max Index"
                value={r.log_max_index}
                tooltip="The highest log entry index in ZooKeeper — i.e. the latest operation any replica has recorded."
              />
              <Stat
                label="Log Gap"
                value={logGap}
                tooltip="log_max_index − log_pointer = number of replication log entries this replica has not yet applied."
                warn={logGap > 10}
                danger={logGap > 100}
              />
            </div>
          </div>

          {/* Parts health */}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-ch-muted font-semibold mb-2">
              Parts Health
              <Tooltip text="ClickHouse stores data as immutable 'parts'. These counters reflect the state of parts on this replica." />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Stat
                label="Future Parts"
                value={r.future_parts}
                tooltip="Parts that will exist once all in-progress merges complete. High values = active merge work happening."
              />
              <Stat
                label="Parts to Check"
                value={r.parts_to_check}
                tooltip="Parts flagged for integrity verification (checksums, structure). Non-zero may indicate corruption or incomplete downloads."
                warn={r.parts_to_check > 0}
                danger={r.parts_to_check > 5}
              />
            </div>
          </div>

          {/* ZooKeeper paths */}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-ch-muted font-semibold mb-2">
              ZooKeeper Paths
              <Tooltip text="ClickHouse uses ZooKeeper (or Keeper) to coordinate replication. These are the paths used for this table and replica." />
            </div>
            <div className="space-y-1 text-xs font-mono">
              <div className="flex gap-2">
                <span className="text-ch-muted w-16 flex-shrink-0">Table</span>
                <span className="text-ch-text break-all">{r.zookeeper_path}</span>
              </div>
              <div className="flex gap-2">
                <span className="text-ch-muted w-16 flex-shrink-0">Replica</span>
                <span className="text-ch-text break-all">{r.replica_path}</span>
              </div>
            </div>
          </div>

          {/* Errors */}
          {(r.zookeeper_exception || r.last_queue_update_exception) && (
            <div className="space-y-1">
              {r.zookeeper_exception && (
                <div className="bg-red-500/8 border border-red-500/20 rounded-lg px-3 py-2 text-xs">
                  <span className="text-red-400 font-semibold">ZooKeeper error: </span>
                  <span className="text-ch-muted">{r.zookeeper_exception}</span>
                </div>
              )}
              {r.last_queue_update_exception && (
                <div className="bg-orange-500/8 border border-orange-500/20 rounded-lg px-3 py-2 text-xs">
                  <span className="text-orange-400 font-semibold">Queue update error: </span>
                  <span className="text-ch-muted">{r.last_queue_update_exception}</span>
                </div>
              )}
            </div>
          )}

          {/* Pending queue items for this replica's table */}
          {queueItems.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-ch-muted font-semibold mb-2">
                Pending Queue Tasks ({queueItems.length})
              </div>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {queueItems.map((item, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs bg-ch-bg/40 rounded px-2 py-1.5">
                    <QueueTypeBadge type={item.type} />
                    <span className="text-ch-text font-mono flex-1 truncate" title={item.new_part_name}>{item.new_part_name}</span>
                    {item.source_replica && (
                      <span className="text-ch-muted flex-shrink-0">from {item.source_replica}</span>
                    )}
                    {item.num_tries > 1 && (
                      <span className="text-orange-400 flex-shrink-0">{item.num_tries} tries</span>
                    )}
                    {item.is_currently_executing === 1 && (
                      <span className="text-yellow-400 flex-shrink-0 animate-pulse">running</span>
                    )}
                  </div>
                ))}
              </div>
              {queueItems.some(q => q.last_exception) && (
                <div className="mt-1 text-xs text-red-400 bg-red-500/8 border border-red-500/20 rounded px-2 py-1.5">
                  {queueItems.find(q => q.last_exception)?.last_exception}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Table card ─────────────────────────────────────────────────────────────

function TableCard({
  tableKey, tableReplicas, queueItems, pinned, onTogglePin,
}: {
  tableKey: string
  tableReplicas: ReplicaInfo[]
  queueItems: ReplicationQueueItem[]
  pinned: boolean
  onTogglePin: () => void
}) {
  const [open, setOpen] = useState(false)

  const hasErrors  = tableReplicas.some(r => r.is_readonly === 1 || r.is_session_expired === 1 || r.zookeeper_exception)
  const hasWarning = !hasErrors && tableReplicas.some(r => r.absolute_delay > 60 || r.queue_size > 50)
  const maxDelay   = Math.max(...tableReplicas.map(r => r.absolute_delay))
  const totalQueue = tableReplicas.reduce((s, r) => s + r.queue_size, 0)
  const activeReplicas  = tableReplicas[0]?.active_replicas ?? 0
  const totalReplicas   = tableReplicas[0]?.total_replicas ?? 0
  const hasLeader = tableReplicas.some(r => r.is_leader === 1)
  const executingCount = queueItems.filter(q => q.is_currently_executing === 1).length

  return (
    <div className={`bg-ch-surface border rounded-xl overflow-hidden transition-all ${
      pinned ? 'border-ch-accent/40' : hasErrors ? 'border-red-500/30' : hasWarning ? 'border-yellow-500/20' : 'border-ch-border'
    }`}>
      {/* Card header */}
      <button
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-ch-bg/30 transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        {open ? <ChevronDown className="w-4 h-4 text-ch-muted flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-ch-muted flex-shrink-0" />}

        {/* Overall health icon */}
        {hasErrors
          ? <XCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
          : hasWarning
            ? <AlertTriangle className="w-4 h-4 text-yellow-400 flex-shrink-0" />
            : <CheckCircle className="w-4 h-4 text-green-400 flex-shrink-0" />
        }

        <span className="font-semibold text-sm text-ch-text">{tableKey}</span>

        {/* Executing badge */}
        {executingCount > 0 && (
          <span className="flex items-center gap-1 text-[10px] bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 px-1.5 py-0.5 rounded" title="Replication tasks currently being executed">
            <Activity className="w-2.5 h-2.5 animate-pulse" />{executingCount} running
          </span>
        )}

        <div className="ml-auto flex items-center gap-5 flex-shrink-0 text-xs">
          <span className="text-ch-muted" title="Active replicas vs total configured replicas for this table">
            <span className={activeReplicas < totalReplicas ? 'text-yellow-400 font-medium' : 'text-ch-text'}>
              {activeReplicas}
            </span>/{totalReplicas} replicas
          </span>
          {totalQueue > 0 && (
            <span className={totalQueue > 100 ? 'text-red-400' : 'text-yellow-400'} title="Total replication queue depth across all replicas">
              Q: {totalQueue}
            </span>
          )}
          <DelayBadge delay={maxDelay} />
          {!hasLeader && (
            <span className="text-orange-400" title="No replica is currently acting as leader — merge scheduling may be paused">no leader</span>
          )}
          <button
            onClick={e => { e.stopPropagation(); onTogglePin() }}
            title={pinned ? 'Unpin' : 'Pin to top'}
            className={`p-1 rounded transition-colors ${pinned ? 'text-ch-accent hover:text-ch-accent/70' : 'text-ch-muted hover:text-ch-text'}`}
          >
            {pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
          </button>
        </div>
      </button>

      {/* Replica rows */}
      {open && tableReplicas.map(r => (
        <ReplicaRow
          key={r.replica_name}
          r={r}
          queueItems={queueItems.filter(q => q.replica_name === r.replica_name || !q.replica_name)}
        />
      ))}
    </div>
  )
}

// ── Active queue banner ────────────────────────────────────────────────────

function ActiveQueueBanner({ items }: { items: ReplicationQueueItem[] }) {
  if (items.length === 0) return null
  return (
    <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-xl p-3">
      <div className="flex items-center gap-2 mb-2">
        <Activity className="w-4 h-4 text-yellow-400 animate-pulse" />
        <span className="text-sm font-semibold text-yellow-400">{items.length} task{items.length > 1 ? 's' : ''} executing now</span>
      </div>
      <div className="space-y-1.5">
        {items.slice(0, 10).map((item, i) => (
          <div key={i} className="flex items-center gap-3 text-xs">
            <QueueTypeBadge type={item.type} />
            <span className="font-medium text-ch-text">{item.database}.{item.table}</span>
            <span className="text-ch-muted font-mono truncate">{item.new_part_name}</span>
            {item.source_replica && <span className="text-ch-muted flex-shrink-0">← {item.source_replica}</span>}
            {item.num_tries > 1 && <span className="text-orange-400 flex-shrink-0">{item.num_tries} tries</span>}
          </div>
        ))}
        {items.length > 10 && <div className="text-xs text-ch-muted">…and {items.length - 10} more</div>}
      </div>
    </div>
  )
}

// ── Main ───────────────────────────────────────────────────────────────────

export function ReplicationStatus({ replicas, queue }: Props) {
  const [search, setSearch] = useState('')
  const { isPinned, toggle } = usePinnedTables('ch-pinned-replicas')

  const groupedByTable = useMemo(() =>
    replicas.reduce<Record<string, ReplicaInfo[]>>((acc, r) => {
      const key = `${r.database}.${r.table}`
      if (!acc[key]) acc[key] = []
      acc[key].push(r)
      return acc
    }, {}),
    [replicas]
  )

  const allKeys = Object.keys(groupedByTable).sort()

  const filteredKeys = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return allKeys
    return allKeys.filter(k => k.toLowerCase().includes(q))
  }, [allKeys, search])

  const pinnedKeys = allKeys.filter(k => isPinned(k))
  const unpinnedKeys = filteredKeys.filter(k => !isPinned(k))

  const activeQueue = queue.filter(q => q.is_currently_executing === 1)

  if (replicas.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-ch-muted gap-2">
        <CheckCircle className="w-8 h-8 opacity-30" />
        <span className="text-sm">No replicated tables found</span>
      </div>
    )
  }

  // Summary stats bar
  const tablesWithIssues = allKeys.filter(k =>
    groupedByTable[k].some(r => r.is_readonly === 1 || r.is_session_expired === 1 || r.zookeeper_exception)
  ).length
  const tablesWithWarning = allKeys.filter(k =>
    !groupedByTable[k].some(r => r.is_readonly === 1) &&
    groupedByTable[k].some(r => r.absolute_delay > 60 || r.queue_size > 50)
  ).length
  const totalQueueDepth = replicas.reduce((s, r) => s + r.queue_size, 0)
  const maxDelay = Math.max(...replicas.map(r => r.absolute_delay))

  return (
    <div className="p-4 max-w-5xl mx-auto space-y-4">

      {/* Summary bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-ch-surface border border-ch-border rounded-xl px-4 py-3">
          <div className="text-[10px] uppercase tracking-wider text-ch-muted flex items-center gap-1">
            Tables <Tooltip text="Total replicated tables being tracked on this node" />
          </div>
          <div className="text-xl font-bold text-ch-text mt-0.5">{allKeys.length}</div>
        </div>
        <div className={`bg-ch-surface border rounded-xl px-4 py-3 ${tablesWithIssues > 0 ? 'border-red-500/30' : 'border-ch-border'}`}>
          <div className="text-[10px] uppercase tracking-wider text-ch-muted flex items-center gap-1">
            Issues <Tooltip text="Tables with read-only replicas, expired ZK sessions, or ZooKeeper errors" />
          </div>
          <div className={`text-xl font-bold mt-0.5 ${tablesWithIssues > 0 ? 'text-red-400' : 'text-green-400'}`}>
            {tablesWithIssues}
          </div>
        </div>
        <div className={`bg-ch-surface border rounded-xl px-4 py-3 ${totalQueueDepth > 100 ? 'border-yellow-500/30' : 'border-ch-border'}`}>
          <div className="text-[10px] uppercase tracking-wider text-ch-muted flex items-center gap-1">
            Queue Depth <Tooltip text="Total pending replication tasks across all tables and replicas on this node" />
          </div>
          <div className={`text-xl font-bold mt-0.5 ${totalQueueDepth > 100 ? 'text-yellow-400' : totalQueueDepth > 0 ? 'text-ch-text' : 'text-green-400'}`}>
            {totalQueueDepth}
          </div>
        </div>
        <div className={`bg-ch-surface border rounded-xl px-4 py-3 ${maxDelay > 300 ? 'border-red-500/30' : maxDelay > 60 ? 'border-yellow-500/30' : 'border-ch-border'}`}>
          <div className="text-[10px] uppercase tracking-wider text-ch-muted flex items-center gap-1">
            Max Delay <Tooltip text="Highest replication lag across all tables. This is how far behind the slowest replica is, in seconds." />
          </div>
          <div className={`text-xl font-bold mt-0.5 ${maxDelay > 300 ? 'text-red-400' : maxDelay > 60 ? 'text-yellow-400' : 'text-green-400'}`}>
            {maxDelay === 0 ? '0s' : maxDelay < 60 ? `${maxDelay}s` : `${Math.floor(maxDelay / 60)}m`}
          </div>
        </div>
      </div>

      {/* Active queue banner */}
      <ActiveQueueBanner items={activeQueue} />

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ch-muted pointer-events-none" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={`Search ${allKeys.length} tables…`}
          className="w-full bg-ch-surface border border-ch-border rounded-lg pl-9 pr-8 py-2 text-sm text-ch-text placeholder-ch-muted focus:outline-none focus:border-ch-accent/60 transition-colors"
        />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-ch-muted hover:text-ch-text text-xs">✕</button>
        )}
      </div>

      {/* Pinned tables */}
      {pinnedKeys.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Pin className="w-3.5 h-3.5 text-ch-accent" />
            <span className="text-xs font-semibold uppercase tracking-wider text-ch-accent">Pinned ({pinnedKeys.length})</span>
          </div>
          <div className="space-y-2">
            {pinnedKeys.map(k => (
              <TableCard
                key={k} tableKey={k}
                tableReplicas={groupedByTable[k]}
                queueItems={queue.filter(q => `${q.database}.${q.table}` === k)}
                pinned onTogglePin={() => toggle(k)}
              />
            ))}
          </div>
          <div className="border-t border-ch-border mt-4" />
        </div>
      )}

      {/* Filtered table list */}
      {filteredKeys.length === 0 && search ? (
        <div className="flex flex-col items-center justify-center h-32 text-ch-muted gap-2">
          <AlertCircle className="w-6 h-6 opacity-30" />
          <span className="text-sm">No tables match "<span className="text-ch-text">{search}</span>"</span>
        </div>
      ) : (
        <div className="space-y-2">
          {unpinnedKeys.map(k => (
            <TableCard
              key={k} tableKey={k}
              tableReplicas={groupedByTable[k]}
              queueItems={queue.filter(q => `${q.database}.${q.table}` === k)}
              pinned={false} onTogglePin={() => toggle(k)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
