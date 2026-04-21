import { useQuery } from '@tanstack/react-query'
import { fetchQueryLog } from '../api/clickhouse'
import type { ConnectionConfig } from '../types'

export function useQueryLog(
  config: ConnectionConfig | null,
  intervalMinutes: number,
  limit: number,
  excludePatterns: string[] = [],
  databases: string[] = [],
  tables: string[] = [],
  search: string = '',
  autoRefreshMs: number | false = false,
  queryIdFilter: string = ''
) {
  return useQuery({
    queryKey: ['query_log', config, intervalMinutes, limit, excludePatterns, databases, tables, search, queryIdFilter],
    queryFn: () => fetchQueryLog(config!, intervalMinutes, limit, excludePatterns, databases, tables, search, queryIdFilter),
    enabled: !!config,
    staleTime: 30_000,
    refetchInterval: autoRefreshMs,
  })
}
