import { useQuery } from '@tanstack/react-query'
import {
  fetchClusters,
  fetchReplicas,
  fetchDistributedTables,
  fetchReplicationQueue,
  fetchDiskHealth,
  fetchServerErrors,
} from '../api/clickhouse'
import type { ConnectionConfig, ActiveTab } from '../types'

const REFETCH_INTERVAL = 30_000 // 30 seconds

/**
 * Fetches all cluster-level data with tab-aware enabled flags.
 *
 * Queries that power the header stats (clusters, replicas, disks, serverErrors)
 * always run. Queries only needed on specific tabs are disabled when those tabs
 * are not active, reducing unnecessary load on the ClickHouse server.
 *
 * Polling stops automatically after an error to avoid hammering a down server.
 * The user can still trigger a manual refresh via the Refresh button.
 */
export function useClusterData(config: ConnectionConfig | null, activeTab: ActiveTab = 'topology') {
  const enabled = !!config

  // Always-on: these power the header stats bar and HealthDashboard props
  const clusters = useQuery({
    queryKey: ['clusters', config],
    queryFn: () => fetchClusters(config!),
    enabled,
    refetchInterval: (q) => (q.state.status === 'error' ? false : REFETCH_INTERVAL),
    staleTime: 10_000,
  })

  const replicas = useQuery({
    queryKey: ['replicas', config],
    queryFn: () => fetchReplicas(config!),
    enabled,
    refetchInterval: (q) => (q.state.status === 'error' ? false : REFETCH_INTERVAL),
    staleTime: 10_000,
  })

  const disks = useQuery({
    queryKey: ['disks', config],
    queryFn: () => fetchDiskHealth(config!),
    enabled,
    refetchInterval: (q) => (q.state.status === 'error' ? false : REFETCH_INTERVAL),
    staleTime: 10_000,
  })

  const serverErrors = useQuery({
    queryKey: ['server_errors', config],
    queryFn: () => fetchServerErrors(config!),
    enabled,
    refetchInterval: (q) => (q.state.status === 'error' ? false : REFETCH_INTERVAL),
    staleTime: 10_000,
  })

  // Tab-scoped: only fetch when the tab that needs this data is active.
  // Once fetched, data stays in TanStack Query cache and is reused when the tab
  // becomes active again before staleTime expires.
  const tablesEnabled = enabled && (
    activeTab === 'topology' || activeTab === 'tables' || activeTab === 'health'
  )
  const tables = useQuery({
    queryKey: ['tables', config],
    queryFn: () => fetchDistributedTables(config!),
    enabled: tablesEnabled,
    refetchInterval: (q) => (q.state.status === 'error' ? false : REFETCH_INTERVAL),
    staleTime: 10_000,
  })

  const queueEnabled = enabled && activeTab === 'replication'
  const replicationQueue = useQuery({
    queryKey: ['replication_queue', config],
    queryFn: () => fetchReplicationQueue(config!),
    enabled: queueEnabled,
    refetchInterval: (q) => (q.state.status === 'error' ? false : REFETCH_INTERVAL),
    staleTime: 10_000,
  })

  const isLoading = clusters.isLoading || replicas.isLoading

  const error =
    clusters.error || replicas.error || tables.error ||
    replicationQueue.error || disks.error || serverErrors.error

  return {
    clusters: clusters.data ?? [],
    replicas: replicas.data ?? [],
    tables: tables.data ?? [],
    replicationQueue: replicationQueue.data ?? [],
    disks: disks.data ?? [],
    serverErrors: serverErrors.data ?? [],
    isLoading,
    error: error as Error | null,
    refetchAll: () => {
      clusters.refetch()
      replicas.refetch()
      tables.refetch()
      replicationQueue.refetch()
      disks.refetch()
      serverErrors.refetch()
    },
  }
}
