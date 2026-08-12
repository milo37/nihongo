import { getBroken, useQuery } from '@app/example/queries/leakyQueries'

export const IndirectPage = () => (
  <p>
    {String(getBroken)}
    {String(useQuery)}
  </p>
)
