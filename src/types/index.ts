export interface ConnectionConfig {
  host: string
  port: number
  username: string
  password: string
}

// system.clusters
export interface ClusterNode {
  cluster: string
  shard_num: number
  shard_weight: number
  replica_num: number
  host_name: string
  host_address: string
  port: number
  is_local: number
  user: string
  default_database: string
  errors_count: number
  slowdowns_count: number
  estimated_recovery_time: number
}

// system.replicas
export interface ReplicaInfo {
  database: string
  table: string
  engine: string
  is_leader: number
  can_become_leader: number
  is_readonly: number
  is_session_expired: number
  future_parts: number
  parts_to_check: number
  zookeeper_path: string
  replica_name: string
  replica_path: string
  columns_version: number
  queue_size: number
  inserts_in_queue: number
  merges_in_queue: number
  part_mutations_in_queue: number
  queue_oldest_time: string
  inserts_oldest_time: string
  merges_oldest_time: string
  log_max_index: number
  log_pointer: number
  last_queue_update: string
  absolute_delay: number
  total_replicas: number
  active_replicas: number
  last_queue_update_exception: string
  zookeeper_exception: string
  replica_is_active: Record<string, number>
}

// system.tables (Distributed + Replicated)
export interface DistributedTable {
  database: string
  name: string
  engine: string
  engine_full: string
  create_table_query: string
  partition_key: string
  sorting_key: string
  primary_key: string
  total_rows: number | null
  total_bytes: number | null
}

// system.columns
export interface ColumnInfo {
  database: string
  table: string
  name: string
  type: string
  default_kind: string
  default_expression: string
  comment: string
  position: number
}

// system.zookeeper_connection (ClickHouse 22.6+)
export interface ZookeeperConnection {
  host: string
  port: number
  index: number
  connected_time: string
  session_id: string
  is_expired: number
  keeper_api_version: number
  outstanding_requests: number
  state: string   // 'Connected' | 'Standby' | 'SessionExpired' | 'NotConnected'
}

// system.zookeeper
export interface ZookeeperNode {
  name: string
  value: string
  czxid: number
  mzxid: number
  ctime: string
  mtime: string
  version: number
  cversion: number
  aversion: number
  ephemeralOwner: number
  dataLength: number
  numChildren: number
  pzxid: number
  path: string
}

// system.replication_queue
export interface ReplicationQueueItem {
  database: string
  table: string
  replica_name: string
  position: number
  node_name: string
  type: string
  create_time: string
  required_quorum: number
  source_replica: string
  new_part_name: string
  parts_to_merge: string[]
  is_detach: number
  is_currently_executing: number
  num_tries: number
  last_attempt_time: string
  last_exception: string
  num_postponed: number
  postpone_reason: string
  last_postpone_time: string
  merge_type: string
}

// system.metrics
export interface MetricRow {
  metric: string
  value: number
  description: string
}

// system.events
export interface EventRow {
  event: string
  value: number
  description: string
}

// system.asynchronous_metrics
export interface AsyncMetricRow {
  metric: string
  value: number
  description: string
}

// Derived view types
export interface ShardView {
  shardNum: number
  replicas: ReplicaView[]
}

export interface ReplicaView {
  hostName: string
  hostAddress: string
  port: number
  replicaNum: number
  isLocal: boolean
  errorsCount: number
  health: 'healthy' | 'degraded' | 'down'
  replicaInfo?: ReplicaInfo[]
}

export type ActiveTab =
  | 'topology' | 'tables' | 'replication' | 'zookeeper' | 'health'
  | 'query-log' | 'parts' | 'processes' | 'mutations'
  | 'docs'

// ── system.query_log ─────────────────────────────────────────────────────────

export interface QueryLogRow {
  query_id: string
  initial_query_id: string
  is_initial_query: number
  event_time: string
  query_duration_ms: number
  query: string
  user: string
  current_database: string
  read_rows: number
  read_bytes: number
  written_rows: number
  result_rows: number
  result_bytes: number
  memory_usage: number          // peak memory at query completion (no separate peak_memory_usage in query_log)
  exception: string
  exception_code: number
  type: string
  initial_user: string
  interface: string
  client_name: string
  databases: string[]
  tables: string[]
  // ProfileEvents columns
  marks_read: number
  ranges_selected: number
  real_time_us: number
  user_time_us: number
  system_time_us: number
  read_compressed_bytes: number
  thread_count: number
}

// system.query_thread_log
export interface QueryThreadRow {
  thread_name: string
  thread_id: number
  read_rows: number
  read_bytes: number
  memory_usage: number
  real_us: number
  user_us: number
  sys_us: number
  marks_read: number
}

// system.query_log — arrayJoin(tables) hotspot aggregation
export interface TableHotspotRow {
  table_name: string
  query_count: number
  total_duration_ms: number
  total_rows_read: number
  total_bytes_read: number
}

// clusterAllReplicas cross-shard breakdown
export interface CrossShardRow {
  _shard_num: number
  host: string
  query_id: string
  query_duration_ms: number
  read_rows: number
  read_bytes: number
  memory_usage: number
  marks_read: number
  real_us: number
  user_us: number
  thread_count: number
}

// ── system.parts ──────────────────────────────────────────────────────────────

export interface PartSummaryRow {
  database: string
  table: string
  part_count: number
  unmerged_parts: number
  total_rows: number
  total_bytes: number
  total_uncompressed: number
  compression_ratio: number
  max_level: number
  last_modified: string
  partition_count: number
  max_refcount: number
  avg_parts_per_partition: number
}

export interface PartDetailRow {
  partition: string
  partition_id: string
  name: string
  part_type: string
  rows: number
  bytes_on_disk: number
  data_uncompressed_bytes: number
  marks_bytes: number
  modification_time: string
  level: number
  disk_name: string
  refcount: number
  min_block_number: number
  max_block_number: number
}

// system.merges
export interface ActiveMergeRow {
  database: string
  table: string
  elapsed: number
  progress: number
  num_parts: number
  rows_read: number
  rows_written: number
  bytes_read_uncompressed: number
  bytes_written_uncompressed: number
  memory_usage: number
  is_mutation: number
  merge_type: string
  merge_algorithm: string
}

// system.part_log
export interface PartLogRow {
  event_time: string
  event_type: string
  part_name: string
  merged_from: string[]
  duration_ms: number
  rows: number
  size_in_bytes: number
  peak_memory_usage: number
}

// ── system.processes ──────────────────────────────────────────────────────────

export interface ProcessRow {
  query_id: string
  initial_query_id: string
  is_initial_query: number
  user: string
  client_name: string
  elapsed: number
  read_rows: number
  read_bytes: number
  written_rows: number
  total_rows_approx: number
  memory_usage: number
  peak_memory_usage: number
  query: string
  is_cancelled: number
  query_kind: string
  progress_fraction: number
}

// ── system.mutations ──────────────────────────────────────────────────────────

export interface MutationRow {
  database: string
  table: string
  mutation_id: string
  command: string
  create_time: string
  parts_to_do: number
  parts_to_do_names: string[]
  is_done: number
  latest_failed_part: string
  latest_fail_time: string
  latest_fail_reason: string
}

// ── system.disks ──────────────────────────────────────────────────────────────

export interface DiskRow {
  name: string
  path: string
  type: string
  free_space: number
  total_space: number
  used_fraction: number
  keep_free_space: number
}

// ── clusterAllReplicas per-shard live metrics ─────────────────────────────────

export interface ShardMetricRow {
  _shard_num: number
  host: string
  active_queries: number
  active_merges: number
  query_memory: number
  delayed_inserts: number
  tcp_conns: number
}

// ── system.errors ─────────────────────────────────────────────────────────────

export interface ServerErrorRow {
  code: number
  name: string
  value: number
  last_error_time: string
  last_error_message: string
  remote: number
}
