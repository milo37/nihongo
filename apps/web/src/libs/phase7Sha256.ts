import type { Sha256TextPort } from '@nihongo/contracts/admin/phase7'

const toHex = (bytes: Uint8Array): string =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')

export const phase7Sha256TextPort: Sha256TextPort = {
  digestUtf8: async (value) =>
    toHex(
      new Uint8Array(
        await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
      )
    )
}
