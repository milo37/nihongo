import { useQuery } from '@tanstack/react-query'
import {
  adminTagQueries,
  type AdminTagSearch
} from '@app/admin-question/queries/adminTagQueries'

export const useListAdminTags = (search: AdminTagSearch, enabled: boolean) =>
  useQuery({ ...adminTagQueries.list(search), enabled })
