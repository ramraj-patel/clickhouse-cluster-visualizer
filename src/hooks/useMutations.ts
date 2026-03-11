import { useQuery } from '@tanstack/react-query'
import { fetchMutations } from '../api/clickhouse'
import type { ConnectionConfig } from '../types'

const REFETCH_INTERVAL = 30_000

export function useMutations(config: ConnectionConfig | null) {
  return useQuery({
    queryKey: ['mutations', config],
    queryFn: () => fetchMutations(config!),
    enabled: !!config,
    refetchInterval: (q) => (q.state.status === 'error' ? false : REFETCH_INTERVAL),
    staleTime: 15_000,
  })
}
