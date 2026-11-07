import { useQuery } from '@tanstack/react-query'
import { operationsQueries } from '@app/operations/queries/operationsQueries'

export const useGetLegalSettings = (enabled = true) => {
  return useQuery({ ...operationsQueries.legalSettings(), enabled })
}
