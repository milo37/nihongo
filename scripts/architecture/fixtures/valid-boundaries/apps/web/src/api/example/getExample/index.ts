import { safeGet } from '@api/http'
import { responseSchema } from '@api/example/getExample/schema'

const get = () => 'local helper'
export const localValue = get()
export const getExample = safeGet(responseSchema)
