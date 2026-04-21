import axios from 'axios'
import type {
  ConnectionConfig,
  ClusterNode,
  ReplicaInfo,
  DistributedTable,
  ColumnInfo,
  ZookeeperNode,
  ZookeeperConnection,
  ReplicationQueueItem,
  MetricRow,
  EventRow,
  AsyncMetricRow,
  QueryLogRow,
  QueryThreadRow,
  TableHotspotRow,
  CrossShardRow,
  ShardMetricRow,
  PartSummaryRow,
  PartDetailRow,
  ActiveMergeRow,
  PartLogRow,
  ProcessRow,
  MutationRow,
  DiskRow,
  ServerErrorRow,
  HostInfoRow,
  HostDiskRow,
} from '../types'

/** Safely coerce unknown (possibly string) UInt64 from ClickHouse JSON to number */
export const safeNum = (v: unknown): number => {
  const n = Number(v)
  return isFinite(n) ? n : 0
}

/**
 * Escape a string for use inside a ClickHouse SQL single-quoted string literal.
 * Uses the ANSI-standard '' (double-quote) form — NOT backslash escaping.
 * Backslash escaping (\') is MySQL-ism and unreliable across ClickHouse configs.
 */
const esc = (s: string): string => s.replace(/'/g, "''")

interface ClickHouseResponse<T> {
  data: T[]
  rows: number
  statistics: { elapsed: number; rows_read: number; bytes_read: number }
}

async function runQuery<T>(config: ConnectionConfig, query: string): Promise<T[]> {
  const res = await axios.post<ClickHouseResponse<T>>('/api/query', {
    host: config.host,
    port: config.port,
    username: config.username,
    password: config.password,
    query: query + ' FORMAT JSON',
  })
  return res.data.data
}

export async function fetchClusters(config: ConnectionConfig): Promise<ClusterNode[]> {
  return runQuery<ClusterNode>(
    config,
    `SELECT
      cluster, shard_num, shard_weight, replica_num,
      host_name, host_address, port, is_local,
      user, default_database, errors_count,
      slowdowns_count, estimated_recovery_time
    FROM system.clusters
    ORDER BY cluster, shard_num, replica_num`
  )
}

export async function fetchReplicas(config: ConnectionConfig): Promise<ReplicaInfo[]> {
  return runQuery<ReplicaInfo>(
    config,
    `SELECT
      database, table, engine, is_leader, can_become_leader,
      is_readonly, is_session_expired, future_parts, parts_to_check,
      zookeeper_path, replica_name, replica_path,
      queue_size, inserts_in_queue, merges_in_queue, part_mutations_in_queue,
      queue_oldest_time, inserts_oldest_time, merges_oldest_time,
      log_max_index, log_pointer, absolute_delay,
      total_replicas, active_replicas,
      last_queue_update_exception, zookeeper_exception
    FROM system.replicas
    ORDER BY database, table`
  )
}

export async function fetchDistributedTables(config: ConnectionConfig): Promise<DistributedTable[]> {
  return runQuery<DistributedTable>(
    config,
    `SELECT
      database, name, engine, engine_full,
      create_table_query, partition_key, sorting_key, primary_key,
      total_rows, total_bytes
    FROM system.tables
    WHERE engine IN ('Distributed', 'ReplicatedMergeTree', 'ReplicatedReplacingMergeTree',
                     'ReplicatedAggregatingMergeTree', 'ReplicatedCollapsingMergeTree',
                     'ReplicatedVersionedCollapsingMergeTree', 'ReplicatedSummingMergeTree')
    ORDER BY database, name`
  )
}

export async function fetchTableColumns(
  config: ConnectionConfig,
  database: string,
  table: string
): Promise<ColumnInfo[]> {
  return runQuery<ColumnInfo>(
    config,
    `SELECT
      database, table, name, type,
      default_kind, default_expression, comment,
      position
    FROM system.columns
    WHERE database = '${esc(database)}' AND table = '${esc(table)}'
    ORDER BY position`
  )
}

export async function fetchZookeeperConnections(config: ConnectionConfig): Promise<ZookeeperConnection[]> {
  return runQuery<ZookeeperConnection>(
    config,
    `SELECT host, port, index, connected_time, session_id,
            is_expired, keeper_api_version, outstanding_requests, state
     FROM system.zookeeper_connection
     ORDER BY index`
  )
}

export async function fetchZookeeperNodes(
  config: ConnectionConfig,
  path: string = '/'
): Promise<ZookeeperNode[]> {
  return runQuery<ZookeeperNode>(
    config,
    `SELECT name, value, numChildren, path
     FROM system.zookeeper
     WHERE path = '${esc(path)}'`
  )
}

export async function fetchReplicationQueue(
  config: ConnectionConfig
): Promise<ReplicationQueueItem[]> {
  return runQuery<ReplicationQueueItem>(
    config,
    `SELECT
      database, table, replica_name, position, node_name, type,
      create_time, source_replica, new_part_name,
      is_currently_executing, num_tries, last_attempt_time,
      last_exception
    FROM system.replication_queue
    ORDER BY database, table, position
    LIMIT 200`
  )
}

export async function fetchMetrics(config: ConnectionConfig): Promise<MetricRow[]> {
  return runQuery<MetricRow>(
    config,
    `SELECT metric, value, description
     FROM system.metrics
     ORDER BY metric`
  )
}

export async function fetchEvents(config: ConnectionConfig): Promise<EventRow[]> {
  return runQuery<EventRow>(
    config,
    `SELECT event, value, description
     FROM system.events
     ORDER BY event`
  )
}

export async function fetchAsyncMetrics(config: ConnectionConfig): Promise<AsyncMetricRow[]> {
  return runQuery<AsyncMetricRow>(
    config,
    `SELECT metric, value, description
     FROM system.asynchronous_metrics
     ORDER BY metric`
  )
}

export async function testConnection(config: ConnectionConfig): Promise<string> {
  const rows = await runQuery<{ version: string }>(config, 'SELECT version() AS version')
  return rows[0]?.version ?? 'unknown'
}

// ── Query Log ────────────────────────────────────────────────────────────────

export async function fetchQueryLog(
  config: ConnectionConfig,
  intervalMinutes: number = 60,
  limit: number = 200,
  excludePatterns: string[] = [],
  databases: string[] = [],
  tables: string[] = [],
  search: string = ''
): Promise<QueryLogRow[]> {
  const excludeClauses = excludePatterns
    .map(p => `AND query NOT ILIKE '%${esc(p)}%'`)
    .join('\n      ')
  const dbList = databases.map(d => `'${esc(d)}'`).join(', ')
  const dbClause = databases.length > 0
    ? `AND (current_database IN (${dbList}) OR arrayExists(t -> splitByChar('.', t)[1] IN (${dbList}), tables))`
    : ''
  const tableClause = tables.length > 0
    ? `AND arrayExists(t -> t IN (${tables.map(t => `'${esc(t)}'`).join(', ')}), tables)`
    : ''
  const searchClause = search.trim()
    ? `AND query ILIKE '%${esc(search.trim())}%'`
    : ''

  return runQuery<QueryLogRow>(config, `
    SELECT
      query_id, initial_query_id, is_initial_query,
      event_time,
      query_duration_ms,
      query, user, current_database,
      read_rows, read_bytes, written_rows, result_rows, result_bytes,
      memory_usage,
      exception, exception_code, type, initial_user, interface, client_name,
      databases, tables,
      ProfileEvents['SelectedMarks']           AS marks_read,
      ProfileEvents['SelectedRanges']          AS ranges_selected,
      ProfileEvents['RealTimeMicroseconds']    AS real_time_us,
      ProfileEvents['UserTimeMicroseconds']    AS user_time_us,
      ProfileEvents['SystemTimeMicroseconds']  AS system_time_us,
      ProfileEvents['ReadCompressedBytes']     AS read_compressed_bytes,
      length(thread_ids)                       AS thread_count
    FROM system.query_log
    WHERE type IN ('QueryFinish', 'ExceptionBeforeStart', 'ExceptionWhileProcessing')
      AND is_initial_query = 1
      AND event_time >= now() - INTERVAL ${intervalMinutes} MINUTE
      AND query NOT ILIKE 'DESC %'
      AND query NOT ILIKE 'DESCRIBE %'
      ${excludeClauses}
      ${dbClause}
      ${tableClause}
      ${searchClause}
    ORDER BY event_time DESC
    LIMIT ${limit}
  `)
}

export async function fetchQueryLogFilterOptions(
  config: ConnectionConfig,
  intervalMinutes: number
): Promise<{ databases: string[]; tables: string[] }> {
  const tf = `event_time >= now() - INTERVAL ${intervalMinutes} MINUTE
    AND type IN ('QueryFinish', 'ExceptionBeforeStart', 'ExceptionWhileProcessing')
    AND is_initial_query = 1`
  const [dbRows, tableRows] = await Promise.all([
    // Combine current_database + database prefixes from the tables array so
    // queries like "SELECT … FROM system.foo" (where current_database='default')
    // still surface "system" as an option.
    runQuery<{ v: string }>(config, `
      SELECT DISTINCT v FROM (
        SELECT current_database AS v FROM system.query_log WHERE ${tf} AND current_database != ''
        UNION ALL
        SELECT arrayJoin(arrayMap(t -> splitByChar('.', t)[1], tables)) AS v
        FROM system.query_log WHERE ${tf} AND notEmpty(tables)
      ) WHERE v != ''
      ORDER BY v LIMIT 300`),
    runQuery<{ v: string }>(config,
      `SELECT DISTINCT arrayJoin(tables) AS v FROM system.query_log
       WHERE ${tf} AND notEmpty(tables) ORDER BY v LIMIT 500`),
  ])
  return { databases: dbRows.map(r => r.v), tables: tableRows.map(r => r.v) }
}

export async function fetchQueryById(
  config: ConnectionConfig,
  queryId: string
): Promise<QueryLogRow[]> {
  return runQuery<QueryLogRow>(config, `
    SELECT
      query_id, initial_query_id, is_initial_query,
      event_time,
      query_duration_ms,
      query, user, current_database,
      read_rows, read_bytes, written_rows, result_rows, result_bytes,
      memory_usage,
      exception, exception_code, type, initial_user, interface, client_name,
      databases, tables,
      ProfileEvents['SelectedMarks']           AS marks_read,
      ProfileEvents['SelectedRanges']          AS ranges_selected,
      ProfileEvents['RealTimeMicroseconds']    AS real_time_us,
      ProfileEvents['UserTimeMicroseconds']    AS user_time_us,
      ProfileEvents['SystemTimeMicroseconds']  AS system_time_us,
      ProfileEvents['ReadCompressedBytes']     AS read_compressed_bytes,
      length(thread_ids)                       AS thread_count
    FROM system.query_log
    WHERE query_id = '${esc(queryId)}'
      AND type IN ('QueryFinish', 'ExceptionBeforeStart', 'ExceptionWhileProcessing')
    ORDER BY event_time ASC
  `)
}

export async function fetchQuerySubQueries(
  config: ConnectionConfig,
  initialQueryId: string
): Promise<QueryLogRow[]> {
  return runQuery<QueryLogRow>(config, `
    SELECT
      query_id, initial_query_id, is_initial_query,
      event_time,
      query_duration_ms, query, user, current_database,
      read_rows, read_bytes, 0 AS written_rows, result_rows, 0 AS result_bytes,
      memory_usage, exception, 0 AS exception_code,
      type, '' AS initial_user, '' AS interface, '' AS client_name,
      ProfileEvents['SelectedMarks']           AS marks_read,
      0 AS ranges_selected,
      ProfileEvents['RealTimeMicroseconds']    AS real_time_us,
      ProfileEvents['UserTimeMicroseconds']    AS user_time_us,
      ProfileEvents['SystemTimeMicroseconds']  AS system_time_us,
      0 AS read_compressed_bytes,
      length(thread_ids)                       AS thread_count
    FROM system.query_log
    WHERE initial_query_id = '${esc(initialQueryId)}'
      AND is_initial_query = 0
    ORDER BY event_time ASC
  `)
}

export async function fetchQueryThreadDetail(
  config: ConnectionConfig,
  queryId: string
): Promise<QueryThreadRow[]> {
  return runQuery<QueryThreadRow>(config, `
    SELECT
      thread_name, thread_id,
      read_rows, read_bytes, memory_usage,
      ProfileEvents['RealTimeMicroseconds']   AS real_us,
      ProfileEvents['UserTimeMicroseconds']   AS user_us,
      ProfileEvents['SystemTimeMicroseconds'] AS sys_us,
      ProfileEvents['SelectedMarks']          AS marks_read
    FROM system.query_thread_log
    WHERE query_id = '${esc(queryId)}'
    ORDER BY ProfileEvents['RealTimeMicroseconds'] DESC
  `)
}

export async function fetchTableHotspots(
  config: ConnectionConfig
): Promise<TableHotspotRow[]> {
  return runQuery<TableHotspotRow>(config, `
    SELECT
      arrayJoin(tables)      AS table_name,
      count()                AS query_count,
      sum(query_duration_ms) AS total_duration_ms,
      sum(read_rows)         AS total_rows_read,
      sum(read_bytes)        AS total_bytes_read
    FROM system.query_log
    WHERE event_time >= now() - INTERVAL 1 HOUR
      AND is_initial_query = 1
      AND type = 'QueryFinish'
      AND notEmpty(tables)
    GROUP BY table_name
    ORDER BY query_count DESC
    LIMIT 20
  `)
}

export async function fetchCrossShardBreakdown(
  config: ConnectionConfig,
  clusterName: string,
  initialQueryId: string
): Promise<CrossShardRow[]> {
  return runQuery<CrossShardRow>(config, `
    SELECT
      _shard_num,
      hostname()                              AS host,
      query_id,
      query_duration_ms,
      read_rows, read_bytes, memory_usage,
      ProfileEvents['SelectedMarks']          AS marks_read,
      ProfileEvents['RealTimeMicroseconds']   AS real_us,
      ProfileEvents['UserTimeMicroseconds']   AS user_us,
      length(thread_ids)                      AS thread_count
    FROM clusterAllReplicas('${esc(clusterName)}', system.query_log)
    WHERE initial_query_id = '${esc(initialQueryId)}'
    ORDER BY _shard_num
  `)
}

// ── Parts ────────────────────────────────────────────────────────────────────

export async function fetchPartsSummary(config: ConnectionConfig): Promise<PartSummaryRow[]> {
  return runQuery<PartSummaryRow>(config, `
    SELECT
      database, table,
      count()                                                        AS part_count,
      countIf(level = 0)                                             AS unmerged_parts,
      sum(rows)                                                      AS total_rows,
      sum(bytes_on_disk)                                             AS total_bytes,
      sum(data_uncompressed_bytes)                                   AS total_uncompressed,
      if(sum(bytes_on_disk) > 0,
         sum(data_uncompressed_bytes) / sum(bytes_on_disk), 0)       AS compression_ratio,
      max(level)                                                     AS max_level,
      max(modification_time)                                         AS last_modified,
      uniqExact(partition_id)                                        AS partition_count,
      max(refcount)                                                  AS max_refcount,
      toUInt64(count() / greatest(uniqExact(partition_id), 1))       AS avg_parts_per_partition
    FROM system.parts
    WHERE active = 1
    GROUP BY database, table
    ORDER BY total_bytes DESC
  `)
}

export async function fetchPartsForTable(
  config: ConnectionConfig,
  database: string,
  table: string
): Promise<PartDetailRow[]> {
  return runQuery<PartDetailRow>(config, `
    SELECT
      partition, partition_id, name, part_type,
      rows, bytes_on_disk, data_uncompressed_bytes,
      marks_bytes, modification_time, level, disk_name,
      refcount, min_block_number, max_block_number
    FROM system.parts
    WHERE active = 1
      AND database = '${esc(database)}'
      AND table = '${esc(table)}'
    ORDER BY partition, bytes_on_disk DESC
    LIMIT 5000
  `)
}

export async function fetchActiveMerges(config: ConnectionConfig): Promise<ActiveMergeRow[]> {
  return runQuery<ActiveMergeRow>(config, `
    SELECT
      database, table, elapsed, progress, num_parts,
      rows_read, rows_written,
      bytes_read_uncompressed, bytes_written_uncompressed,
      memory_usage, is_mutation, merge_type, merge_algorithm
    FROM system.merges
    ORDER BY elapsed DESC
  `)
}

export async function fetchPartLog(
  config: ConnectionConfig,
  database: string,
  table: string
): Promise<PartLogRow[]> {
  return runQuery<PartLogRow>(config, `
    SELECT
      event_time,
      event_type, part_name, merged_from,
      duration_ms, rows, size_in_bytes, peak_memory_usage
    FROM system.part_log
    WHERE database = '${esc(database)}'
      AND table = '${esc(table)}'
      AND event_time >= now() - INTERVAL 1 DAY
    ORDER BY event_time DESC
    LIMIT 200
  `)
}

// ── Processes ────────────────────────────────────────────────────────────────

export async function fetchProcesses(config: ConnectionConfig): Promise<ProcessRow[]> {
  return runQuery<ProcessRow>(config, `
    SELECT
      query_id, initial_query_id, is_initial_query,
      user, client_name, elapsed,
      read_rows, read_bytes, written_rows,
      total_rows_approx, memory_usage, peak_memory_usage,
      query, is_cancelled,
      multiIf(
        query ILIKE 'SELECT%', 'Select',
        query ILIKE 'INSERT%', 'Insert',
        query ILIKE 'ALTER%',  'Alter',
        'Select'
      ) AS query_kind,
      if(total_rows_approx > 0, read_rows / total_rows_approx, 0) AS progress_fraction
    FROM system.processes
    ORDER BY elapsed DESC
  `)
}

// ── Mutations ────────────────────────────────────────────────────────────────

export async function fetchMutations(config: ConnectionConfig): Promise<MutationRow[]> {
  return runQuery<MutationRow>(config, `
    SELECT
      database, table, mutation_id, command, create_time,
      parts_to_do, parts_to_do_names, is_done,
      latest_failed_part, latest_fail_time, latest_fail_reason
    FROM system.mutations
    ORDER BY create_time DESC
    LIMIT 500
  `)
}

// ── Per-shard live metrics ────────────────────────────────────────────────────

export async function fetchShardMetrics(
  config: ConnectionConfig,
  clusterName: string
): Promise<ShardMetricRow[]> {
  return runQuery<ShardMetricRow>(config, `
    SELECT
      _shard_num,
      hostname()                                        AS host,
      sumIf(value, metric = 'Query')                   AS active_queries,
      sumIf(value, metric = 'Merge')                   AS active_merges,
      sumIf(value, metric = 'MemoryTracking')          AS query_memory,
      sumIf(value, metric = 'DelayedInserts')          AS delayed_inserts,
      sumIf(value, metric = 'TCPConnection')           AS tcp_conns
    FROM clusterAllReplicas('${esc(clusterName)}', system.metrics)
    WHERE metric IN ('Query','Merge','MemoryTracking','DelayedInserts','TCPConnection')
    GROUP BY _shard_num, host
    ORDER BY _shard_num, host
  `)
}

// ── Infrastructure ───────────────────────────────────────────────────────────

export async function fetchDiskHealth(config: ConnectionConfig): Promise<DiskRow[]> {
  return runQuery<DiskRow>(config, `
    SELECT
      name, path, type,
      free_space, total_space,
      (total_space - free_space) / total_space AS used_fraction,
      keep_free_space
    FROM system.disks
    ORDER BY used_fraction DESC
  `)
}

// ── Per-host info (cross-shard) ─────────────────────────────────────────────

export async function fetchHostInfo(
  config: ConnectionConfig,
  clusterName: string
): Promise<HostInfoRow[]> {
  return runQuery<HostInfoRow>(config, `
    SELECT
      a.host                  AS host,
      a.shard_num             AS shard_num,
      0                       AS replica_num,
      a.uptime                AS uptime,
      a.os_memory_total       AS os_memory_total,
      a.os_memory_available   AS os_memory_available,
      a.cpu_cores             AS cpu_cores,
      a.load_average_1m       AS load_average_1m,
      a.load_average_5m       AS load_average_5m,
      m.open_files            AS open_file_descriptors,
      0                       AS max_file_descriptors,
      0                       AS table_count
    FROM (
      SELECT
        hostname()                                             AS host,
        _shard_num                                             AS shard_num,
        maxIf(value, metric = 'Uptime')                        AS uptime,
        maxIf(value, metric = 'OSMemoryTotal')                 AS os_memory_total,
        maxIf(value, metric = 'OSMemoryAvailable')             AS os_memory_available,
        toUInt32(countIf(metric LIKE 'CPUFrequencyMHz_%'))     AS cpu_cores,
        maxIf(value, metric = 'LoadAverage1')                  AS load_average_1m,
        maxIf(value, metric = 'LoadAverage5')                  AS load_average_5m
      FROM clusterAllReplicas('${esc(clusterName)}', system.asynchronous_metrics)
      WHERE metric IN ('Uptime', 'OSMemoryTotal', 'OSMemoryAvailable', 'LoadAverage1', 'LoadAverage5')
         OR metric LIKE 'CPUFrequencyMHz_%'
      GROUP BY host, _shard_num
    ) a
    LEFT JOIN (
      SELECT
        hostname()                                             AS host,
        _shard_num                                             AS shard_num,
        sumIf(value, metric IN ('OpenFileForRead', 'OpenFileForWrite')) AS open_files
      FROM clusterAllReplicas('${esc(clusterName)}', system.metrics)
      WHERE metric IN ('OpenFileForRead', 'OpenFileForWrite')
      GROUP BY host, _shard_num
    ) m ON a.host = m.host AND a.shard_num = m.shard_num
    ORDER BY a.shard_num, a.host
  `)
}

export async function fetchHostDisks(
  config: ConnectionConfig,
  clusterName: string
): Promise<HostDiskRow[]> {
  return runQuery<HostDiskRow>(config, `
    SELECT
      hostname()                                     AS host,
      name                                           AS disk_name,
      path                                           AS disk_path,
      type                                           AS disk_type,
      free_space,
      total_space,
      if(total_space > 0, (total_space - free_space) / total_space, 0) AS used_fraction
    FROM clusterAllReplicas('${esc(clusterName)}', system.disks)
    ORDER BY host, disk_name
  `)
}

export async function fetchHostTableCounts(
  config: ConnectionConfig,
  clusterName: string
): Promise<{ host: string; table_count: number }[]> {
  return runQuery<{ host: string; table_count: number }>(config, `
    SELECT
      hostname()       AS host,
      count()          AS table_count
    FROM clusterAllReplicas('${esc(clusterName)}', system.tables)
    WHERE database NOT IN ('system', 'INFORMATION_SCHEMA', 'information_schema')
    GROUP BY host
    ORDER BY host
  `)
}

export async function fetchHostTables(
  config: ConnectionConfig,
  clusterName: string
): Promise<{ host: string; database: string; name: string; engine: string; total_rows: number; total_bytes: number }[]> {
  return runQuery(config, `
    SELECT
      hostname()     AS host,
      database,
      name,
      engine,
      total_rows,
      total_bytes
    FROM clusterAllReplicas('${esc(clusterName)}', system.tables)
    WHERE database NOT IN ('system', 'INFORMATION_SCHEMA', 'information_schema')
    ORDER BY host, database, name
  `)
}

export async function fetchServerErrors(config: ConnectionConfig): Promise<ServerErrorRow[]> {
  return runQuery<ServerErrorRow>(config, `
    SELECT code, name, value,
      last_error_time, last_error_message, remote
    FROM system.errors
    WHERE value > 0
    ORDER BY value DESC
    LIMIT 50
  `)
}
