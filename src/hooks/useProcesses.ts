import { useQuery } from '@tanstack/react-query'
import { fetchProcesses } from '../api/clickhouse'
import type { ConnectionConfig } from '../types'

const REFETCH_INTERVAL = 5_000

export function useProcesses(config: ConnectionConfig | null, paused = false) {
  return useQuery({
    queryKey: ['processes', config],
    queryFn: () => fetchProcesses(config!),
    enabled: !!config,
    refetchInterval: (q) => {
      if (paused) return false
      if (q.state.status === 'error') return false
      return REFETCH_INTERVAL
    },
    staleTime: 4_000,
  })
}
