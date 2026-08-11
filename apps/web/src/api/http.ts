import type { AxiosRequestConfig } from 'axios'
import { apiClient, safeFactory } from '@api/config'
import type { ZodType, z } from 'zod'

export const get = async <Response = unknown>(
  url: string,
  params?: unknown,
  config?: AxiosRequestConfig
): Promise<Response> => {
  const response = await apiClient.get<Response>(url, {
    ...config,
    params
  })

  return response.data
}

export const post = async <Response = unknown>(
  url: string,
  data?: unknown,
  config?: AxiosRequestConfig
): Promise<Response> => {
  const response = await apiClient.post<Response>(url, data, config)

  return response.data
}

export const put = async <Response = unknown>(
  url: string,
  data?: unknown,
  config?: AxiosRequestConfig
): Promise<Response> => {
  const response = await apiClient.put<Response>(url, data, config)

  return response.data
}

export const del = async <Response = unknown>(
  url: string,
  params?: unknown,
  config?: AxiosRequestConfig
): Promise<Response> => {
  const response = await apiClient.delete<Response>(url, {
    ...config,
    params
  })

  return response.data
}

const safeGetFactory = safeFactory(
  (url: string, params?: unknown, config?: AxiosRequestConfig) =>
    get(url, params, config)
)
const safePostFactory = safeFactory(
  (url: string, data?: unknown, config?: AxiosRequestConfig) =>
    post(url, data, config)
)
const safePutFactory = safeFactory(
  (url: string, data?: unknown, config?: AxiosRequestConfig) =>
    put(url, data, config)
)
const safeDelFactory = safeFactory(
  (url: string, params?: unknown, config?: AxiosRequestConfig) =>
    del(url, params, config)
)

export const safeGet = <Schema extends ZodType>(
  schema: Schema
): ((
  url: string,
  params?: unknown,
  config?: AxiosRequestConfig
) => Promise<z.output<Schema>>) => safeGetFactory(schema)

export const safePost = <Schema extends ZodType>(
  schema: Schema
): ((
  url: string,
  data?: unknown,
  config?: AxiosRequestConfig
) => Promise<z.output<Schema>>) => safePostFactory(schema)

export const safePut = <Schema extends ZodType>(
  schema: Schema
): ((
  url: string,
  data?: unknown,
  config?: AxiosRequestConfig
) => Promise<z.output<Schema>>) => safePutFactory(schema)

export const safeDel = <Schema extends ZodType>(
  schema: Schema
): ((
  url: string,
  params?: unknown,
  config?: AxiosRequestConfig
) => Promise<z.output<Schema>>) => safeDelFactory(schema)

export type SafeResponse<Schema extends ZodType> = z.output<Schema>
