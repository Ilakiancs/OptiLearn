import { useQuery } from '@tanstack/react-query'
import { getDashboard } from '../api/client'

export function useDashboard() {
  return useQuery({
    queryKey: ['dashboard'],
    queryFn: getDashboard,
    refetchInterval: 10000,
    staleTime: 5000,
  })
}
