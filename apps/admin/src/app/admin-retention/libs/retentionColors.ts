import type { AdminRetentionAudience } from '@nihongo/contracts/admin/retention'

/**
 * #1271 design values: member blue, guest orange. Checked for colour-vision
 * difference (CVD ΔE 24.7) and 3:1 contrast on the page. Colour marks only the
 * lines and dots; text stays ink or muted.
 */
export const RETENTION_COLORS: Record<AdminRetentionAudience, string> = {
  MEMBER: '#2a78d6',
  GUEST: '#eb6834'
}
