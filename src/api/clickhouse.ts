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
} from '../types'

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
    WHERE database = '${database.replace(/'/g, "\\'")}' AND table = '${table.replace(/'/g, "\\'")}'
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
     WHERE path = '${path.replace(/'/g, "\\'")}'`
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
