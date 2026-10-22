import type { AxiosRequestConfig, AxiosResponse } from 'axios'
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

  return response.status === 204 ? (undefined as Response) : response.data
}

export interface HttpResponseHeaders {
  'cache-control': string | null
  'content-type': string | null
  'idempotency-replayed': string | null
  location: string | null
  'x-nihongo-practice-contract': string | null
}

export interface HttpResponseWithMetadata<Response> {
  data: Response
  headers: HttpResponseHeaders
  status: number
}

const readResponseHeader = (
  response: AxiosResponse<unknown>,
  name: string
): string | null => {
  const headers: unknown = response.headers
  let value: unknown

  if (
    headers &&
    typeof headers === 'object' &&
    'get' in headers &&
    typeof headers.get === 'function'
  ) {
    value = headers.get(name)
  } else if (headers && typeof headers === 'object' && name in headers) {
    value = headers[name as keyof typeof headers]
  }

  return typeof value === 'string' ? value : null
}

const toResponseWithMetadata = <Response>(
  response: AxiosResponse<Response>
): HttpResponseWithMetadata<Response> => ({
  data: response.status === 204 ? (undefined as Response) : response.data,
  headers: {
    'cache-control': readResponseHeader(response, 'cache-control'),
    'content-type': readResponseHeader(response, 'content-type'),
    'idempotency-replayed': readResponseHeader(
      response,
      'idempotency-replayed'
    ),
    location: readResponseHeader(response, 'location'),
    'x-nihongo-practice-contract': readResponseHeader(
      response,
      'x-nihongo-practice-contract'
    )
  },
  status: response.status
})

export const getWithMetadata = async <Response = unknown>(
  url: string,
  params?: unknown,
  config?: AxiosRequestConfig
): Promise<HttpResponseWithMetadata<Response>> => {
  const response = await apiClient.get<Response>(url, {
    ...config,
    params
  })

  return toResponseWithMetadata(response)
}

export const postWithMetadata = async <Response = unknown>(
  url: string,
  data?: unknown,
  config?: AxiosRequestConfig
): Promise<HttpResponseWithMetadata<Response>> => {
  const response = await apiClient.post<Response>(url, data, config)

  return toResponseWithMetadata(response)
}

export const putWithMetadata = async <Response = unknown>(
  url: string,
  data?: unknown,
  config?: AxiosRequestConfig
): Promise<HttpResponseWithMetadata<Response>> => {
  const response = await apiClient.put<Response>(url, data, config)

  return toResponseWithMetadata(response)
}

export const delWithMetadata = async <Response = unknown>(
  url: string,
  params?: unknown,
  config?: AxiosRequestConfig
): Promise<HttpResponseWithMetadata<Response>> => {
  const response = await apiClient.delete<Response>(url, {
    ...config,
    params
  })

  return toResponseWithMetadata(response)
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
const safeGetWithMetadataFactory = safeFactory(
  (url: string, params?: unknown, config?: AxiosRequestConfig) =>
    getWithMetadata(url, params, config)
)
const safePostWithMetadataFactory = safeFactory(
  (url: string, data?: unknown, config?: AxiosRequestConfig) =>
    postWithMetadata(url, data, config)
)
const safePutWithMetadataFactory = safeFactory(
  (url: string, data?: unknown, config?: AxiosRequestConfig) =>
    putWithMetadata(url, data, config)
)
const safeDelWithMetadataFactory = safeFactory(
  (url: string, params?: unknown, config?: AxiosRequestConfig) =>
    delWithMetadata(url, params, config)
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

export const safeGetWithMetadata = <Schema extends ZodType>(
  schema: Schema
): ((
  url: string,
  params?: unknown,
  config?: AxiosRequestConfig
) => Promise<z.output<Schema>>) => safeGetWithMetadataFactory(schema)

export const safePostWithMetadata = <Schema extends ZodType>(
  schema: Schema
): ((
  url: string,
  data?: unknown,
  config?: AxiosRequestConfig
) => Promise<z.output<Schema>>) => safePostWithMetadataFactory(schema)

export const safePutWithMetadata = <Schema extends ZodType>(
  schema: Schema
): ((
  url: string,
  data?: unknown,
  config?: AxiosRequestConfig
) => Promise<z.output<Schema>>) => safePutWithMetadataFactory(schema)

export const safeDelWithMetadata = <Schema extends ZodType>(
  schema: Schema
): ((
  url: string,
  params?: unknown,
  config?: AxiosRequestConfig
) => Promise<z.output<Schema>>) => safeDelWithMetadataFactory(schema)

export type SafeResponse<Schema extends ZodType> = z.output<Schema>
