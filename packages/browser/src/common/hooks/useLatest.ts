import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

export const useLatest = <Value>(value: Value): RefObject<Value> => {
  const valueRef = useRef(value)

  useEffect(() => {
    valueRef.current = value
  }, [value])

  return valueRef
}
