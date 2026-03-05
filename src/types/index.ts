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

export type ActiveTab = 'topology' | 'tables' | 'replication' | 'zookeeper' | 'metrics' | 'docs'
