import { useState } from 'react'
import { X, ChevronDown, ChevronRight, Database, GitBranch, Activity, TreePine, BarChart3, BookOpen } from 'lucide-react'
import type { ActiveTab } from '../types'

interface Query {
  label: string
  sql: string
}

interface TabHelp {
  icon: React.ReactNode
  title: string
  description: string
  significance: string[]
  signals: { label: string; meaning: string; severity: 'info' | 'warn' | 'danger' }[]
  queries: Query[]
}

const HELP: Record<ActiveTab, TabHelp> = {
  topology: {
    icon: <GitBranch className="w-4 h-4" />,
    title: 'Cluster Topology',
    description:
      'A live visual map of your ClickHouse cluster hierarchy. Every cluster defined in your server config (or Keeper-managed definitions) is drawn as a group, with shards as containers and individual replica nodes inside each shard.',
    significance: [
      'Gives you an instant spatial understanding of how your data is distributed — how many shards exist, how many replicas back each shard, and which nodes are local vs remote.',
      'Health colours surface problems without needing to run any SQL — a red node means >5 connection errors, amber means read-only or >5 min replication lag.',
      'Leader crowns show which replica is coordinating merges for each shard.',
      'System clusters (test_*, all_groups, *_localhost) are visually separated from user clusters so you focus on what matters.',
    ],
    signals: [
      { label: 'Red replica node', meaning: 'errors_count > 5 — this replica is failing connections', severity: 'danger' },
      { label: 'Amber replica node', meaning: 'is_readonly = 1 or absolute_delay > 300s', severity: 'warn' },
      { label: 'READONLY badge', meaning: 'Replica is not accepting writes — usually ZK session issue', severity: 'danger' },
      { label: 'ZK EXPIRED badge', meaning: 'ZooKeeper session lost — replica is isolated from coordination', severity: 'danger' },
      { label: 'Lag badge (⏱)', meaning: 'Replication is behind the leader; >300s is critical', severity: 'warn' },
      { label: 'Shard active/total < total', meaning: 'One or more replicas in this shard are unreachable', severity: 'warn' },
      { label: '● replicating on shard', meaning: 'Active replication tasks queued — normal during heavy ingestion', severity: 'info' },
    ],
    queries: [
      {
        label: 'system.clusters — topology layout',
        sql: `SELECT
  cluster, shard_num, shard_weight, replica_num,
  host_name, host_address, port, is_local,
  errors_count, slowdowns_count, estimated_recovery_time
FROM system.clusters
ORDER BY cluster, shard_num, replica_num`,
      },
      {
        label: 'system.replicas — health overlay',
        sql: `SELECT
  database, table, engine, is_leader, is_readonly,
  is_session_expired, zookeeper_path, replica_name, replica_path,
  queue_size, absolute_delay, total_replicas, active_replicas,
  zookeeper_exception
FROM system.replicas
ORDER BY database, table`,
      },
    ],
  },

  tables: {
    icon: <Database className="w-4 h-4" />,
    title: 'Distributed & Replicated Tables',
    description:
      'Shows every table participating in distributed or replicated storage. Distributed tables (the logical entry point for queries) are primary cards; their underlying ReplicatedMergeTree tables are linked inside each card. Orphaned replicated tables with no matching Distributed table appear as secondary cards.',
    significance: [
      'Distributed tables are the query target — understanding their config (cluster, target table, shard key) tells you how writes are routed across shards.',
      'Shard key determines data distribution. A poor shard key (e.g. rand()) causes uneven shards; a business key (e.g. toYYYYMM(date)) may cause hotspots.',
      'Partition key and sort key are critical for query performance — queries that filter on the sort key use sparse index lookups instead of full scans.',
      'TTL expressions show when data ages out automatically — important for storage capacity planning.',
    ],
    signals: [
      { label: 'NULL rows / bytes', meaning: 'Distributed table — data lives on remote shards, not locally', severity: 'info' },
      { label: 'Large total_bytes', meaning: 'Consider whether TTL or tiered storage is configured', severity: 'info' },
      { label: 'No linked replicated table', meaning: 'Distributed table points to a table not visible on this node', severity: 'warn' },
      { label: 'Schema section empty', meaning: 'Columns query failed — check access permissions', severity: 'warn' },
    ],
    queries: [
      {
        label: 'system.tables — distributed & replicated tables',
        sql: `SELECT
  database, name, engine, engine_full,
  create_table_query, partition_key, sorting_key, primary_key,
  total_rows, total_bytes
FROM system.tables
WHERE engine IN (
  'Distributed', 'ReplicatedMergeTree',
  'ReplicatedReplacingMergeTree', 'ReplicatedAggregatingMergeTree',
  'ReplicatedCollapsingMergeTree', 'ReplicatedSummingMergeTree'
)
ORDER BY database, name`,
      },
      {
        label: 'system.columns — schema (lazy, per table)',
        sql: `SELECT database, table, name, type,
  default_kind, default_expression, comment, position
FROM system.columns
WHERE database = '<db>' AND table = '<table>'
ORDER BY position`,
      },
    ],
  },

  replication: {
    icon: <Activity className="w-4 h-4" />,
    title: 'Replication Status',
    description:
      'Per-table replication health on the node you are connected to. Shows the state of every ReplicatedMergeTree table — how far behind each replica is, what work is queued, and whether ZooKeeper coordination is healthy.',
    significance: [
      'Each row in system.replicas represents ONE table on THIS node. If you have 50 tables × 3 replicas you will see 50 rows (the current node\'s view).',
      'Replication is asynchronous — a lag of a few seconds is normal. Lags over 5 minutes indicate a backlog or network issue.',
      'The replication queue shows specific tasks: GET_PART (fetch a part from another replica), MERGE_PARTS (execute a merge), MUTATE_PART (apply an ALTER UPDATE/DELETE).',
      'is_leader = 1 means this replica is currently coordinating merges for this table shard.',
    ],
    signals: [
      { label: 'absolute_delay > 300s', meaning: 'Replica is >5 min behind — queries may return stale data', severity: 'danger' },
      { label: 'is_readonly = 1', meaning: 'Replica refusing writes — usually ZK session or disk issue', severity: 'danger' },
      { label: 'queue_size > 100', meaning: 'Large backlog of replication tasks — throughput may be degraded', severity: 'warn' },
      { label: 'last_exception not empty', meaning: 'Last replication task failed — check the error message', severity: 'danger' },
      { label: 'log gap (max_index - pointer) > 1000', meaning: 'This replica is far behind the replication log', severity: 'warn' },
      { label: 'active_replicas < total_replicas', meaning: 'One or more replicas not registered in ZooKeeper', severity: 'warn' },
    ],
    queries: [
      {
        label: 'system.replicas — replica health',
        sql: `SELECT
  database, table, engine, is_leader, can_become_leader,
  is_readonly, is_session_expired, future_parts, parts_to_check,
  zookeeper_path, replica_name, replica_path,
  queue_size, inserts_in_queue, merges_in_queue,
  part_mutations_in_queue, queue_oldest_time,
  log_max_index, log_pointer, absolute_delay,
  total_replicas, active_replicas,
  last_queue_update_exception, zookeeper_exception
FROM system.replicas
ORDER BY database, table`,
      },
      {
        label: 'system.replication_queue — in-flight tasks',
        sql: `SELECT
  database, table, replica_name, position, node_name, type,
  create_time, source_replica, new_part_name,
  is_currently_executing, num_tries, last_attempt_time,
  last_exception
FROM system.replication_queue
ORDER BY database, table, position
LIMIT 200`,
      },
    ],
  },

  zookeeper: {
    icon: <TreePine className="w-4 h-4" />,
    title: 'ZooKeeper / Keeper',
    description:
      'ZooKeeper (or ClickHouse Keeper) is the distributed coordination service that makes replication possible. This tab shows the live connection state of each ZK host, what tables are registered in ZK, and lets you browse the raw ZK namespace.',
    significance: [
      'Every ReplicatedMergeTree table stores its replication log, part checksums, block IDs (for deduplication), and quorum state in ZooKeeper.',
      'If the ZK session expires, the affected ClickHouse replica becomes read-only immediately — writes are rejected until the session is re-established.',
      'The /clickhouse/task_queue path is where ON CLUSTER DDL (ALTER, CREATE, DROP) commands are queued — stale entries here mean schema changes have not propagated to all nodes.',
      'ClickHouse Keeper is a drop-in replacement for Apache ZooKeeper — the system.zookeeper_connection table shows which one you are using.',
    ],
    signals: [
      { label: 'state = SessionExpired', meaning: 'This ZK host\'s session is gone — replica will be read-only', severity: 'danger' },
      { label: 'state = NotConnected', meaning: 'ClickHouse cannot reach this ZK host', severity: 'danger' },
      { label: 'outstanding_requests > 0', meaning: 'ZK is processing a backlog — may indicate ZK overload', severity: 'warn' },
      { label: 'zookeeper_exception on table', meaning: 'Last ZK operation for this table failed', severity: 'danger' },
      { label: 'log gap on table', meaning: 'Replica is behind on applying the replication log', severity: 'warn' },
    ],
    queries: [
      {
        label: 'system.zookeeper_connection — ensemble hosts',
        sql: `SELECT host, port, index, connected_time, session_id,
  is_expired, keeper_api_version, outstanding_requests, state
FROM system.zookeeper_connection
ORDER BY index`,
      },
      {
        label: 'system.zookeeper — path explorer (per level)',
        sql: `SELECT name, value, numChildren, path
FROM system.zookeeper
WHERE path = '<selected_path>'`,
      },
      {
        label: 'system.replicas — ZK path registry',
        sql: `SELECT
  database, table, is_readonly, is_session_expired,
  zookeeper_path, replica_name, replica_path,
  queue_size, log_max_index, log_pointer,
  absolute_delay, zookeeper_exception
FROM system.replicas
ORDER BY database, table`,
      },
    ],
  },

  metrics: {
    icon: <BarChart3 className="w-4 h-4" />,
    title: 'Live Metrics',
    description:
      'Real-time server health pulled from three system tables every 15 seconds. Gauge metrics are instantaneous readings (e.g. active queries right now). Event counters are cumulative since server start — the dashboard derives per-second rates by diffing consecutive snapshots. Async metrics are OS-level samples from a background thread.',
    significance: [
      'system.metrics: instantaneous gauges — active queries, connections, background threads, merge queue depth.',
      'system.events: monotonically increasing counters — total queries, inserts, failures. The dashboard shows these as per-second rates (delta / interval).',
      'system.asynchronous_metrics: OS-level data collected in background — CPU load, physical RAM usage, disk I/O, load averages. More expensive than the other two.',
      'Sparklines show 20 snapshots (~5 minutes of history). History resets if you reload the page.',
    ],
    signals: [
      { label: 'MemoryResident near OS limit', meaning: 'Risk of OOM kill — check max_memory_usage setting', severity: 'danger' },
      { label: 'MaxPartCountForPartition > 300', meaning: 'Too many parts — merges are falling behind ingestion rate', severity: 'danger' },
      { label: 'ReplicasMaxAbsoluteDelay > 300', meaning: 'Worst replication lag across all tables exceeds 5 min', severity: 'danger' },
      { label: 'OSLoadAverage15 > CPU count', meaning: 'Sustained CPU saturation — queries will be slow', severity: 'warn' },
      { label: 'FailedQuery rate > 0', meaning: 'Queries are failing — check query log for errors', severity: 'warn' },
      { label: 'TCPConnection spike', meaning: 'Sudden connection burst — possible client retry storm', severity: 'warn' },
    ],
    queries: [
      {
        label: 'system.metrics — instantaneous gauges',
        sql: `SELECT metric, value, description
FROM system.metrics
ORDER BY metric`,
      },
      {
        label: 'system.events — cumulative counters (rates derived by dashboard)',
        sql: `SELECT event, value, description
FROM system.events
ORDER BY event`,
      },
      {
        label: 'system.asynchronous_metrics — OS-level samples',
        sql: `SELECT metric, value, description
FROM system.asynchronous_metrics
ORDER BY metric`,
      },
    ],
  },

  docs: {
    icon: <BookOpen className="w-4 h-4" />,
    title: 'Query Docs',
    description:
      'A reference guide for every SQL query this dashboard executes. Rendered directly from QUERIES.md in the repository — always in sync with the actual code.',
    significance: [
      'All queries are read-only and target system.* tables — no data is modified.',
      'Every query is forwarded through the local Express proxy (port 3001) to avoid browser CORS restrictions.',
      'You can copy any query from this page and run it directly in your ClickHouse client for deeper exploration.',
    ],
    signals: [],
    queries: [],
  },
}

// ── Collapsible SQL block ─────────────────────────────────────────────────────

function SqlBlock({ query }: { query: Query }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border border-ch-border rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-ch-surface hover:bg-ch-bg transition-colors text-left"
      >
        {open
          ? <ChevronDown className="w-3.5 h-3.5 text-ch-muted flex-shrink-0" />
          : <ChevronRight className="w-3.5 h-3.5 text-ch-muted flex-shrink-0" />
        }
        <span className="text-xs text-ch-text font-mono truncate">{query.label}</span>
      </button>
      {open && (
        <pre className="text-[11px] text-ch-accent font-mono leading-relaxed px-3 py-2.5 bg-ch-bg overflow-x-auto whitespace-pre border-t border-ch-border">
          {query.sql}
        </pre>
      )}
    </div>
  )
}

// ── Severity dot ──────────────────────────────────────────────────────────────

const severityColor = {
  info:   'bg-blue-400',
  warn:   'bg-yellow-400',
  danger: 'bg-red-400',
}

// ── Drawer ────────────────────────────────────────────────────────────────────

interface Props {
  tab: ActiveTab
  onClose: () => void
}

export function HelpDrawer({ tab, onClose }: Props) {
  const help = HELP[tab]

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[1px]"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed right-0 top-0 h-full w-[420px] z-50 bg-ch-surface border-l border-ch-border flex flex-col shadow-2xl">

        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-ch-border flex-shrink-0">
          <div className="w-7 h-7 rounded-lg bg-ch-accent/10 border border-ch-accent/20 flex items-center justify-center text-ch-accent">
            {help.icon}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-ch-text">{help.title}</div>
            <div className="text-xs text-ch-muted">About this view</div>
          </div>
          <button
            onClick={onClose}
            className="text-ch-muted hover:text-ch-text transition-colors p-1 rounded hover:bg-ch-bg"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-5">

          {/* Description */}
          <section>
            <p className="text-sm text-ch-text leading-relaxed">{help.description}</p>
          </section>

          {/* Significance */}
          <section>
            <h3 className="text-xs font-semibold text-ch-muted uppercase tracking-wider mb-2">
              Why this matters
            </h3>
            <ul className="space-y-1.5">
              {help.significance.map((s, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-ch-text leading-relaxed">
                  <span className="w-1 h-1 rounded-full bg-ch-accent mt-1.5 flex-shrink-0" />
                  {s}
                </li>
              ))}
            </ul>
          </section>

          {/* Signals */}
          {help.signals.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold text-ch-muted uppercase tracking-wider mb-2">
                What to watch for
              </h3>
              <div className="space-y-1.5">
                {help.signals.map((sig, i) => (
                  <div key={i} className="flex items-start gap-2.5 text-xs">
                    <span className={`w-1.5 h-1.5 rounded-full mt-1 flex-shrink-0 ${severityColor[sig.severity]}`} />
                    <div className="min-w-0">
                      <span className="font-medium text-ch-text">{sig.label}</span>
                      <span className="text-ch-muted"> — {sig.meaning}</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Queries */}
          {help.queries.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold text-ch-muted uppercase tracking-wider mb-2">
                Queries running in background
              </h3>
              <div className="space-y-2">
                {help.queries.map((q, i) => (
                  <SqlBlock key={i} query={q} />
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </>
  )
}
