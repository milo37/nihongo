import * as leaky from '@app/example/queries/leakyQueries'

export const NamespaceIndirectPage = () => (
  <p>
    {String(leaky.getBroken)}
    {String(leaky.useQuery)}
  </p>
)
