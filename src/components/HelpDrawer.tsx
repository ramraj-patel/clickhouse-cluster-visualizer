import { useState } from 'react'
import { X, ChevronDown, ChevronRight, Database, GitBranch, Activity, TreePine, BarChart3, BookOpen, FileText, HardDrive, Terminal, Wrench, Server, Settings } from 'lucide-react'
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
      'Shows every table participating in distributed or replicated storage. Distributed tables (the logical entry point for queries) are primary cards; their underlying ReplicatedMergeTree tables are linked inside each card. Orphaned replicated tables with no matching Distributed table appear as secondary cards. Each Distributed table card includes a Shard Topology section showing which hosts and shards serve the table.',
    significance: [
      'Distributed tables are the query target — understanding their config (cluster, target table, shard key) tells you how writes are routed across shards.',
      'Shard Topology shows the exact hosts holding each shard — use this to identify which nodes to check when a specific table has issues.',
      'Shard key determines data distribution. A poor shard key (e.g. rand()) causes uneven shards; a business key (e.g. toYYYYMM(date)) may cause hotspots.',
      'Partition key and sort key are critical for query performance — queries that filter on the sort key use sparse index lookups instead of full scans.',
      'Storage policy shows which disk/volume configuration the table uses — e.g. a JBOD policy across 12 SSDs vs a single default disk.',
      'TTL expressions show when data ages out automatically — important for storage capacity planning.',
    ],
    signals: [
      { label: 'NULL rows / bytes', meaning: 'Distributed table — data lives on remote shards, not locally', severity: 'info' },
      { label: 'Large total_bytes', meaning: 'Consider whether TTL or tiered storage is configured', severity: 'info' },
      { label: 'Storage policy = default on large table', meaning: 'May benefit from a multi-disk JBOD policy for better I/O', severity: 'info' as const },
      { label: 'No linked replicated table', meaning: 'Distributed table points to a table not visible on this node', severity: 'warn' },
      { label: 'Schema section empty', meaning: 'Columns query failed — check access permissions', severity: 'warn' },
    ],
    queries: [
      {
        label: 'system.tables — distributed & replicated tables',
        sql: `SELECT
  database, name, engine, engine_full,
  create_table_query, partition_key, sorting_key, primary_key,
  total_rows, total_bytes, storage_policy
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

  health: {
    icon: <BarChart3 className="w-4 h-4" />,
    title: 'Health Dashboard',
    description:
      'A unified cluster health view combining live server metrics, replica state, disk usage, and per-shard traffic. Metrics are pulled from three system tables every 15 seconds. The status bar gives you an instant 6-axis health summary derived from live values — click any metric\'s ⓘ button for detailed meaning, impact, and when-to-act guidance.',
    significance: [
      'Status bar pills (Cluster, Query Load, Ingestion, Hardware, Replication, Storage) each aggregate multiple signals into a single colour — green/yellow/red. Saves you from scanning dozens of individual metrics.',
      'Alerts panel appears automatically when any threshold is breached — it includes direct navigation to the relevant detail tab.',
      'Cluster & Shard Health section derives from system.replicas and system.disks (no extra queries). Per-shard traffic uses clusterAllReplicas() for live cross-shard comparison.',
      'system.metrics: instantaneous gauges — active queries, connections, background threads.',
      'system.events: monotonically increasing counters — rates derived by diffing consecutive 15-second snapshots.',
      'system.asynchronous_metrics: OS-level data (CPU load, physical RAM, disk I/O). 40 snapshots retained (~10 minutes of sparkline history).',
      'Click ⓘ on any metric card to open a detail drawer: what it measures, operational impact, when to act, and navigation to the relevant tab.',
    ],
    signals: [
      { label: 'Cluster pill red', meaning: 'A replica is read-only or has an expired ZK session', severity: 'danger' },
      { label: 'Ingestion pill red', meaning: 'Max parts/partition ≥ 300 or ≥ 10 throttled inserts — inserts may be blocked', severity: 'danger' },
      { label: 'Replication pill red', meaning: 'Max replica lag ≥ 300s — replicas are serving stale data', severity: 'danger' },
      { label: 'Storage pill red', meaning: 'A disk is ≥ 95% full — data loss risk imminent', severity: 'danger' },
      { label: 'FailedQuery rate > 0.1/s', meaning: 'Clients are receiving errors — check Query Log for exceptions', severity: 'warn' },
      { label: 'Max Parts/Partition > 150', meaning: 'Insert throttling will start at 150 parts — merges are behind', severity: 'warn' },
      { label: 'OSLoadAverage1 > core count', meaning: 'CPU is saturated — query latency will increase', severity: 'warn' },
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
      {
        label: 'clusterAllReplicas — per-shard live metrics',
        sql: `SELECT
  _shard_num,
  hostname()                                AS host,
  sumIf(value, metric = 'Query')           AS active_queries,
  sumIf(value, metric = 'Merge')           AS active_merges,
  sumIf(value, metric = 'MemoryTracking')  AS query_memory,
  sumIf(value, metric = 'DelayedInserts')  AS delayed_inserts,
  sumIf(value, metric = 'TCPConnection')   AS tcp_conns
FROM clusterAllReplicas('{cluster}', system.metrics)
WHERE metric IN ('Query','Merge','MemoryTracking','DelayedInserts','TCPConnection')
GROUP BY _shard_num, host
ORDER BY _shard_num, host`,
      },
    ],
  },

  'query-log': {
    icon: <FileText className="w-4 h-4" />,
    title: 'Query Log',
    description:
      'Historical query analysis sourced from system.query_log — the append-only audit trail ClickHouse writes for every completed query. Choose a time window (5 min to 24 h), filter by database or table, search by query substring, and drill into distributed sub-queries, per-thread utilisation, and cross-shard breakdowns.',
    significance: [
      'query_log is written after a query completes (or fails) — it is not live. Use the Processes tab for in-flight queries.',
      'Only initial queries (is_initial_query = 1) are shown by default. Distributed sub-queries that run on remote shards are nested inside each top-level row — this avoids confusing duplicates in the list.',
      'Server-side filters (database, table, search) are applied in SQL before results reach the browser — useful for narrowing large clusters with thousands of queries per minute.',
      'Auto-refresh is disabled by default (Paused). Enable it to get a rolling live view at the selected time window.',
      'The Hotspots view aggregates by table to show which tables absorb the most query CPU/memory over the selected window — useful for schema or index tuning decisions.',
      'Thread detail (from system.query_thread_log) shows per-thread CPU and memory for a single query. Requires log_query_threads = 1 in server config — without it system.query_thread_log is not populated.',
      'Cross-shard view uses clusterAllReplicas() to gather query_log from all shards for a given query ID. It is slow and opt-in — select a cluster and click "Load all shards".',
    ],
    signals: [
      { label: 'type = ExceptionBeforeStart / ExceptionWhileProcessing', meaning: 'Query failed — see exception field for reason', severity: 'danger' },
      { label: 'memory_usage > 1 GB', meaning: 'Single query consuming significant RAM — OOM risk on constrained nodes', severity: 'warn' },
      { label: 'marks_read very high', meaning: 'Sparse index is not filtering effectively — consider adjusting ORDER BY or adding a skip index', severity: 'warn' },
      { label: 'Table hotspot showing repeated scans', meaning: 'A table is scanned by many queries — consider materialised views or pre-aggregation', severity: 'info' },
      { label: 'Thread detail empty', meaning: 'log_query_threads = 1 is not set — enable in config.xml or users.xml', severity: 'info' },
    ],
    queries: [
      {
        label: 'system.query_log — top-level queries (configurable window)',
        sql: `SELECT
  query_id, user, query, type,
  event_time, query_duration_ms,
  read_rows, read_bytes, memory_usage,
  ProfileEvents['SelectedMarks']         AS marks_read,
  ProfileEvents['FileOpen']              AS ranges_selected,
  ProfileEvents['RealTimeMicroseconds']  AS real_time_us,
  ProfileEvents['UserTimeMicroseconds']  AS user_time_us,
  ProfileEvents['SystemTimeMicroseconds'] AS system_time_us,
  ProfileEvents['CompressedReadBufferBytes'] AS read_compressed_bytes,
  ProfileEvents['NumberOfDedicatedLogFiles'] AS thread_count,
  exception, exception_code,
  initial_user, interface, client_name,
  databases, tables, current_database, is_initial_query
FROM system.query_log
WHERE type != 'QueryStart'
  AND is_initial_query = 1
  AND event_time >= now() - INTERVAL 60 MINUTE
ORDER BY event_time DESC
LIMIT 200`,
      },
      {
        label: 'system.query_log — sub-queries for a distributed query',
        sql: `SELECT
  query_id, initial_query_id,
  query_duration_ms, read_rows, read_bytes, memory_usage,
  ProfileEvents['SelectedMarks'] AS marks_read
FROM system.query_log
WHERE initial_query_id = '<query_id>'
  AND is_initial_query = 0
  AND type != 'QueryStart'
ORDER BY event_time`,
      },
      {
        label: 'system.query_thread_log — per-thread detail (requires log_query_threads = 1)',
        sql: `SELECT
  thread_name, thread_id,
  read_rows, read_bytes, memory_usage,
  ProfileEvents['RealTimeMicroseconds']  AS real_us,
  ProfileEvents['UserTimeMicroseconds']  AS user_us,
  ProfileEvents['SystemTimeMicroseconds'] AS sys_us,
  ProfileEvents['SelectedMarks']         AS marks_read
FROM system.query_thread_log
WHERE query_id = '<query_id>'
ORDER BY real_us DESC`,
      },
      {
        label: 'system.query_log — table hotspots (aggregated by window)',
        sql: `SELECT
  arrayJoin(tables)      AS table_name,
  count()                AS query_count,
  sum(query_duration_ms) AS total_duration_ms,
  sum(read_rows)         AS total_rows_read,
  sum(read_bytes)        AS total_bytes_read
FROM system.query_log
WHERE type = 'QueryFinish'
  AND is_initial_query = 1
  AND event_time >= now() - INTERVAL 60 MINUTE
GROUP BY table_name
ORDER BY total_bytes_read DESC
LIMIT 50`,
      },
      {
        label: 'clusterAllReplicas — cross-shard breakdown for a query ID',
        sql: `SELECT
  _shard_num, hostName() AS host, query_id,
  query_duration_ms, read_rows, read_bytes, memory_usage,
  ProfileEvents['SelectedMarks'] AS marks_read,
  ProfileEvents['RealTimeMicroseconds'] AS real_us,
  ProfileEvents['UserTimeMicroseconds'] AS user_us,
  length(thread_ids) AS thread_count
FROM clusterAllReplicas('<cluster_name>', system.query_log)
WHERE query_id = '<query_id>'
  AND type != 'QueryStart'
ORDER BY _shard_num`,
      },
      {
        label: 'system.query_log — filter options (databases & tables)',
        sql: `-- Databases (union current_database + DB extracted from tables array)
SELECT DISTINCT v FROM (
  SELECT current_database AS v FROM system.query_log
  WHERE event_time >= now() - INTERVAL 60 MINUTE AND current_database != ''
  UNION ALL
  SELECT arrayJoin(arrayMap(t -> splitByChar('.', t)[1], tables)) AS v
  FROM system.query_log
  WHERE event_time >= now() - INTERVAL 60 MINUTE AND notEmpty(tables)
) WHERE v != '' ORDER BY v LIMIT 300;

-- Tables
SELECT DISTINCT arrayJoin(tables) AS v
FROM system.query_log
WHERE event_time >= now() - INTERVAL 60 MINUTE
  AND notEmpty(tables)
ORDER BY v LIMIT 500`,
      },
    ],
  },

  parts: {
    icon: <HardDrive className="w-4 h-4" />,
    title: 'Parts Inspector',
    description:
      'Inspects the physical storage structure of your MergeTree tables. Every INSERT creates one or more "parts" — immutable columnar files on disk. ClickHouse merges small parts into larger ones in the background. This tab shows the health of that process: how many parts exist per partition, whether merges are keeping up, compression effectiveness, and active merge progress.',
    significance: [
      'Parts count directly impacts query performance — too many small parts means more files to open per query, more memory for index caching, and slower merges.',
      'The "too many parts" problem (MaxPartCountForPartition > 300 in system.metrics) is one of the most common ClickHouse performance issues. This tab shows which table and partition is causing it.',
      'Compression ratio (uncompressed / compressed) tells you how effectively ClickHouse is compressing a table. A ratio < 2 is low — consider changing the codec or sort order.',
      'Active merges banner shows which merges are currently running, their progress percentage, and estimated time to completion.',
      'Part history (from system.part_log) shows how a table\'s part count evolved — useful for diagnosing sudden ingestion bursts or merge failures.',
    ],
    signals: [
      { label: 'Parts per partition > 300', meaning: 'Critical: merges falling far behind ingestion — insert throttling may kick in', severity: 'danger' },
      { label: 'Parts per partition > 100', meaning: 'Warning: too many parts — background merges are lagging', severity: 'warn' },
      { label: 'Unmerged parts > 150', meaning: 'Large backlog of tiny parts — check insert rate and background_pool_size', severity: 'danger' },
      { label: 'Compression ratio < 2', meaning: 'Poor compression — consider LZ4HC/ZSTD codec or improving sort key locality', severity: 'warn' },
      { label: 'max_refcount > 1', meaning: 'A part is referenced by multiple snapshots — high memory use for mark cache', severity: 'info' },
      { label: 'Active merge on a large partition', meaning: 'Long-running merge may delay subsequent inserts', severity: 'info' },
    ],
    queries: [
      {
        label: 'system.parts — table summary (GROUP BY)',
        sql: `SELECT
  database, table,
  count()                                  AS total_parts,
  countIf(active)                          AS active_parts,
  sum(bytes_on_disk)                       AS compressed_bytes,
  sum(data_uncompressed_bytes)             AS uncompressed_bytes,
  sum(rows)                                AS total_rows,
  max(refcount)                            AS max_refcount,
  max(modification_time)                   AS last_modified,
  countIf(NOT active)                      AS inactive_parts
FROM system.parts
GROUP BY database, table
ORDER BY compressed_bytes DESC`,
      },
      {
        label: 'system.parts — partition + part detail (per table)',
        sql: `SELECT
  partition, name, active, rows,
  bytes_on_disk, data_uncompressed_bytes,
  refcount, modification_time, min_date, max_date,
  min_block_number, max_block_number, level
FROM system.parts
WHERE database = '<db>' AND table = '<table>'
ORDER BY partition, min_block_number
LIMIT 5000`,
      },
      {
        label: 'system.merges — active merges in progress',
        sql: `SELECT
  database, table, partition, result_part_name,
  elapsed, progress, num_parts,
  rows_read, rows_written,
  total_size_bytes_compressed, memory_usage
FROM system.merges
ORDER BY elapsed DESC`,
      },
      {
        label: 'system.part_log — part event history (per table)',
        sql: `SELECT
  event_type, event_time, database, table, partition_id,
  part_name, rows, size_in_bytes, duration_ms, error
FROM system.part_log
WHERE database = '<db>' AND table = '<table>'
ORDER BY event_time DESC
LIMIT 200`,
      },
    ],
  },

  processes: {
    icon: <Terminal className="w-4 h-4" />,
    title: 'Process Monitor',
    description:
      'A live view of all queries currently executing on this ClickHouse node, refreshed every 5 seconds. Shows memory consumption, elapsed time, rows processed, and the query text. Long-running queries can be cross-referenced in the Query Log tab via the "View in Log" button.',
    significance: [
      'system.processes is a real-time snapshot — every row is a query actively running right now. It resets completely between polls.',
      'The elapsed column shows wall-clock time since the query started. A query running for minutes is a strong signal of a missing index, a table scan, or a runaway cartesian join.',
      'Memory usage here is the live peak memory — useful for catching memory-heavy queries before they trigger OOM. Cross-check with max_memory_usage server setting.',
      'Progress bars show rows read vs rows total (when the query planner has an estimate). Progress stalling at 0% usually means the query is waiting for a lock or ZooKeeper.',
      'The query text is truncated in the card; click to expand the full query. Queries that include "system.processes" in their text are self-filtered from the list.',
    ],
    signals: [
      { label: 'elapsed > 300s (red border)', meaning: 'Query running over 5 minutes — likely scanning without a useful index', severity: 'danger' },
      { label: 'elapsed > 60s (yellow border)', meaning: 'Long-running query — investigate if not expected (e.g. bulk export)', severity: 'warn' },
      { label: 'memory_usage > 500 MB', meaning: 'Heavy memory consumption — check for missing PREWHERE or large IN() lists', severity: 'warn' },
      { label: 'total_rows_approx = 0', meaning: 'Query planner has no estimate — indeterminate progress bar is expected', severity: 'info' },
      { label: 'is_cancelled = 1', meaning: 'Query has received a cancel signal and is winding down', severity: 'info' },
    ],
    queries: [
      {
        label: 'system.processes — live query list (5s refresh)',
        sql: `SELECT
  query_id, user, client_hostname, elapsed,
  read_rows, read_bytes, total_rows_approx,
  written_rows, memory_usage, peak_memory_usage,
  query, is_cancelled, thread_ids,
  ProfileEvents, Settings
FROM system.processes
ORDER BY elapsed DESC`,
      },
    ],
  },

  mutations: {
    icon: <Wrench className="w-4 h-4" />,
    title: 'Mutations Tracker',
    description:
      'Tracks in-flight and recently completed ALTER mutations on ReplicatedMergeTree tables. Mutations (ALTER UPDATE, ALTER DELETE, MATERIALIZE INDEX, etc.) rewrite existing parts on disk — they are the most resource-intensive write operations in ClickHouse and can run for hours on large tables.',
    significance: [
      'Mutations are not transactional — they run part-by-part in the background. A mutation is "complete" only when parts_to_do reaches 0.',
      'Failed mutations (latest_fail_reason is not empty) stall all subsequent mutations on that table until resolved. The fail reason shown is the exact ClickHouse error.',
      'A stuck mutation (parts_to_do has not decreased for a long time) usually means: disk full, a detached/broken part, or the background mutation thread is saturated.',
      'parts_to_do_names shows exactly which parts still need to be rewritten — useful for diagnosing why a mutation is stuck on a specific partition.',
      'Mutations propagate to all replicas independently. A mutation may be complete on one replica and still in-flight on another — check all nodes.',
    ],
    signals: [
      { label: 'is_done = 0 with latest_fail_reason', meaning: 'Mutation failed and is stuck — unblock by investigating the error', severity: 'danger' },
      { label: 'parts_to_do unchanged across refreshes', meaning: 'Mutation is stalled — check disk space and background_pool_size', severity: 'warn' },
      { label: 'parts_to_do > 1000', meaning: 'Very large mutation backlog — may run for hours; avoid concurrent mutations', severity: 'warn' },
      { label: 'command = DELETE with no WHERE partition filter', meaning: 'Full table scan mutation — extremely slow on large tables; prefer TTL instead', severity: 'warn' },
      { label: 'Multiple concurrent mutations on same table', meaning: 'Mutations queue serially per table — they will all complete but latency multiplies', severity: 'info' },
    ],
    queries: [
      {
        label: 'system.mutations — all mutations (30s refresh)',
        sql: `SELECT
  database, table, mutation_id, command,
  create_time, block_numbers.partition_id,
  parts_to_do_names, parts_to_do,
  is_done, latest_failed_part,
  latest_fail_time, latest_fail_reason
FROM system.mutations
ORDER BY create_time DESC
LIMIT 200`,
      },
    ],
  },

  hosts: {
    icon: <Server className="w-4 h-4" />,
    title: 'Hosts',
    description:
      'Per-host view of every node in the cluster. Shows hardware resources (CPU cores, memory, load average), open file handles, disk partitions with usage bars, and a searchable table list per host. Storage Policies section shows cluster-wide disk/volume configuration. All cross-node data is fetched via clusterAllReplicas() queries.',
    significance: [
      'Memory and disk usage are the most common causes of ClickHouse instability — monitor both per host.',
      'Open file count (read + write handles) indicates I/O pressure — spikes may signal too many concurrent queries or merges.',
      'Uneven table counts across hosts may indicate replication lag or failed schema migrations.',
      'Storage policies define how data is spread across disks — JBOD with ROUND_ROBIN distributes I/O evenly across multiple SSDs.',
      'CPU core count and load average help identify CPU-bound hosts — load consistently above core count means queries are queuing.',
    ],
    signals: [
      { label: 'Memory > 95%', meaning: 'Host at risk of OOM — queries may be killed', severity: 'danger' as const },
      { label: 'Disk > 85%', meaning: 'Disk pressure — merges and inserts may slow down', severity: 'warn' as const },
      { label: 'Load average > CPU cores', meaning: 'Host is CPU-saturated — queries will queue', severity: 'warn' as const },
      { label: 'High open file count', meaning: 'I/O pressure — check concurrent merges and queries', severity: 'info' as const },
      { label: 'Table count mismatch across hosts', meaning: 'Schema may not have replicated — check DDL queue', severity: 'warn' as const },
    ],
    queries: [
      {
        label: 'clusterAllReplicas — host system metrics (async_metrics + metrics)',
        sql: `-- Memory, uptime, load from system.asynchronous_metrics
-- CPU cores derived from count of CPUFrequencyMHz_* metrics
-- Open files from system.metrics (OpenFileForRead + OpenFileForWrite)
SELECT hostname() AS host, _shard_num,
  maxIf(value, metric = 'OSMemoryTotal') AS os_memory_total,
  maxIf(value, metric = 'OSMemoryAvailable') AS os_memory_available,
  toUInt32(countIf(metric LIKE 'CPUFrequencyMHz_%')) AS cpu_cores,
  maxIf(value, metric = 'LoadAverage1') AS load_average_1m
FROM clusterAllReplicas('cluster', system.asynchronous_metrics)
GROUP BY host, _shard_num`,
      },
      {
        label: 'clusterAllReplicas — host disk usage',
        sql: `SELECT hostname() AS host, name, path, type,
  free_space, total_space
FROM clusterAllReplicas('cluster', system.disks)`,
      },
      {
        label: 'clusterAllReplicas — table list per host',
        sql: `SELECT hostname() AS host, database, name, engine,
  total_rows, total_bytes
FROM clusterAllReplicas('cluster', system.tables)
WHERE database NOT IN ('system','INFORMATION_SCHEMA','information_schema')`,
      },
      {
        label: 'system.storage_policies — cluster-wide storage configuration',
        sql: `SELECT policy_name, volume_name, volume_priority,
  disks, volume_type, load_balancing
FROM system.storage_policies
ORDER BY policy_name, volume_priority`,
      },
    ],
  },

  'cluster-config': {
    icon: <Settings className="w-4 h-4" />,
    title: 'Cluster Configuration',
    description:
      'A comprehensive view of your cluster\'s configuration across all nodes. Shows macros (node identity), keeper coordination, operational limits (memory, timeouts, ingestion, threads, replication), and storage/network setup. Uses clusterAllReplicas() to fetch config from every node through a single connection.',
    significance: [
      'Node macros ({cluster}, {shard}, {replica}) define how ReplicatedMergeTree tables route data — mismatched macros cause replication failures and data loss.',
      'Keeper/ZooKeeper coordination is the backbone of replication. If the keeper session expires, all replicated tables become read-only.',
      'The comparison table highlights settings that differ across nodes. Inconsistent limits (e.g., different max_memory_usage) cause unpredictable query failures on specific nodes.',
      'Operational limits like max_parts_in_total and max_execution_time are the most common causes of "mysterious" insert rejections and query timeouts.',
      'Storage policies control data tiering (hot/cold). Misconfigured policies can fill SSDs while HDDs sit empty.',
    ],
    signals: [
      { label: 'Yellow row in settings', meaning: 'This setting has different values across nodes — potential misconfiguration', severity: 'warn' },
      { label: 'Keeper status: Expired', meaning: 'ZooKeeper session lost — replicated tables are read-only until reconnected', severity: 'danger' },
      { label: 'Keeper status: Disconnected', meaning: 'Cannot reach keeper — replication and DDL will fail', severity: 'danger' },
      { label: 'No macros configured', meaning: 'ReplicatedMergeTree tables cannot work without {shard} and {replica} macros', severity: 'danger' },
      { label: 'TLS not configured', meaning: 'Client and inter-node traffic is unencrypted', severity: 'warn' },
      { label: 'Disk usage > 95%', meaning: 'Disk is nearly full — merges and inserts may fail', severity: 'danger' },
      { label: 'Disk usage > 85%', meaning: 'Disk filling up — plan capacity or adjust TTL/storage policies', severity: 'warn' },
      { label: 'max_parts_in_total near limit', meaning: 'Table is approaching the part count limit — inserts will be rejected when exceeded', severity: 'warn' },
    ],
    queries: [
      {
        label: 'system.macros — node identity (cross-node)',
        sql: `SELECT _shard_num, hostname() AS host, macro, substitution
FROM clusterAllReplicas('{cluster}', system.macros)
ORDER BY _shard_num, host, macro`,
      },
      {
        label: 'system.server_settings — server config (cross-node)',
        sql: `SELECT hostname() AS host, name, value, default, changed, description
FROM clusterAllReplicas('{cluster}', system.server_settings)
WHERE name IN ('interserver_http_port', 'listen_host', 'tcp_port', ...)
ORDER BY host, name`,
      },
      {
        label: 'system.settings — operational limits (cross-node)',
        sql: `SELECT hostname() AS host, name, value, changed, description
FROM clusterAllReplicas('{cluster}', system.settings)
WHERE name IN ('max_memory_usage', 'max_execution_time', 'max_parts_in_total', ...)
ORDER BY host, name`,
      },
      {
        label: 'system.merge_tree_settings — MergeTree engine config (cross-node)',
        sql: `SELECT hostname() AS host, name, value, changed, description
FROM clusterAllReplicas('{cluster}', system.merge_tree_settings)
WHERE name IN ('max_bytes_to_merge_at_max_space_in_pool', ...)
ORDER BY host, name`,
      },
      {
        label: 'system.zookeeper_connection — keeper status',
        sql: `SELECT host, port, state, session_id, connected_time, is_expired, outstanding_requests
FROM system.zookeeper_connection
ORDER BY index`,
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
  info:   'bg-ch-info',
  warn:   'bg-ch-warning',
  danger: 'bg-ch-danger',
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
