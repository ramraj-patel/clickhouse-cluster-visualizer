import { useQuery } from '@tanstack/react-query'
import { fetchPartsSummary, fetchActiveMerges } from '../api/clickhouse'
import type { ConnectionConfig } from '../types'

export function usePartsSummary(config: ConnectionConfig | null) {
  return useQuery({
    queryKey: ['parts_summary', config],
    queryFn: () => fetchPartsSummary(config!),
    enabled: !!config,
    refetchInterval: 60_000,
    staleTime: 30_000,
  })
}

export function useActiveMerges(config: ConnectionConfig | null) {
  return useQuery({
    queryKey: ['active_merges', config],
    queryFn: () => fetchActiveMerges(config!),
    enabled: !!config,
    refetchInterval: 15_000,
    staleTime: 10_000,
  })
}
