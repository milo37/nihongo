import fs from 'node:fs'
import { prismaAdapter } from '@better-auth/prisma-adapter'
import { apiValue } from '@nihongo/api/consumer'
import { domainValue } from '@nihongo/domain/internal-rule'
import { Hono } from 'hono'

export const contractValue = {
  apiValue,
  domainValue,
  framework: Hono,
  prismaAdapter,
  filesystem: fs,
  environment: process.env.SECRET
}
