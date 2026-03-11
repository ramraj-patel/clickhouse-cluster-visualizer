import { useQuery } from '@tanstack/react-query'
import { fetchShardMetrics } from '../api/clickhouse'
import type { ConnectionConfig, ShardMetricRow } from '../types'

const POLL_INTERVAL = 15_000

export function useShardMetrics(
  config: ConnectionConfig | null,
  clusterName: string | null,
  paused = false
) {
  return useQuery<ShardMetricRow[]>({
    queryKey: ['shard_metrics', config, clusterName],
    queryFn: () => fetchShardMetrics(config!, clusterName!),
    enabled: !!config && !!clusterName && !paused,
    refetchInterval: paused ? false : POLL_INTERVAL,
    staleTime: POLL_INTERVAL - 1000,
    retry: 1,
  })
}
