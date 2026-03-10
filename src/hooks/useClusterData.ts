import { useQuery } from '@tanstack/react-query'
import {
  fetchClusters,
  fetchReplicas,
  fetchDistributedTables,
  fetchReplicationQueue,
  fetchMetrics,
  fetchDiskHealth,
  fetchServerErrors,
} from '../api/clickhouse'
import type { ConnectionConfig } from '../types'

const REFETCH_INTERVAL = 30_000 // 30 seconds

export function useClusterData(config: ConnectionConfig | null) {
  const enabled = !!config

  const clusters = useQuery({
    queryKey: ['clusters', config],
    queryFn: () => fetchClusters(config!),
    enabled,
    refetchInterval: REFETCH_INTERVAL,
    staleTime: 10_000,
  })

  const replicas = useQuery({
    queryKey: ['replicas', config],
    queryFn: () => fetchReplicas(config!),
    enabled,
    refetchInterval: REFETCH_INTERVAL,
    staleTime: 10_000,
  })

  const tables = useQuery({
    queryKey: ['tables', config],
    queryFn: () => fetchDistributedTables(config!),
    enabled,
    refetchInterval: REFETCH_INTERVAL,
    staleTime: 10_000,
  })

  const replicationQueue = useQuery({
    queryKey: ['replication_queue', config],
    queryFn: () => fetchReplicationQueue(config!),
    enabled,
    refetchInterval: REFETCH_INTERVAL,
    staleTime: 10_000,
  })

  const metrics = useQuery({
    queryKey: ['metrics', config],
    queryFn: () => fetchMetrics(config!),
    enabled,
    refetchInterval: REFETCH_INTERVAL,
    staleTime: 10_000,
  })

  const disks = useQuery({
    queryKey: ['disks', config],
    queryFn: () => fetchDiskHealth(config!),
    enabled,
    refetchInterval: REFETCH_INTERVAL,
    staleTime: 10_000,
  })

  const serverErrors = useQuery({
    queryKey: ['server_errors', config],
    queryFn: () => fetchServerErrors(config!),
    enabled,
    refetchInterval: REFETCH_INTERVAL,
    staleTime: 10_000,
  })

  const isLoading =
    clusters.isLoading || replicas.isLoading || tables.isLoading

  const error =
    clusters.error || replicas.error || tables.error ||
    replicationQueue.error || metrics.error

  return {
    clusters: clusters.data ?? [],
    replicas: replicas.data ?? [],
    tables: tables.data ?? [],
    replicationQueue: replicationQueue.data ?? [],
    metrics: metrics.data ?? [],
    disks: disks.data ?? [],
    serverErrors: serverErrors.data ?? [],
    isLoading,
    error: error as Error | null,
    refetchAll: () => {
      clusters.refetch()
      replicas.refetch()
      tables.refetch()
      replicationQueue.refetch()
      metrics.refetch()
      disks.refetch()
      serverErrors.refetch()
    },
  }
}
