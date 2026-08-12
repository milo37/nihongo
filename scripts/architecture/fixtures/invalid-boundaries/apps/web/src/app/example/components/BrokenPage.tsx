import axios from 'axios'
import { useQuery } from '@tanstack/react-query'
import { getBroken } from '@api/example/getBroken'
import { database } from '@mocks/repository/database'
import { helper } from '../helper'

void fetch('/api/direct')
void axios.get('/api/direct')

export const BrokenPage = () => (
  <p>
    {String(useQuery)}
    {String(getBroken)}
    {database.value}
    {helper}
  </p>
)
