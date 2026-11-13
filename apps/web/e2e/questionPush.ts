import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

/**
 * JLP-870: moving between questions slides the old one out and the new one in
 * (300ms). Until the slide ends the new question's controls are still off
 * screen, so act on them only after this. Pass the move (next, previous or a
 * sheet jump); it waits for the "N / total" position to change and for the
 * slide to end. With reduced motion nothing slides and it returns at once.
 */
export const moveQuestionAndSettle = async (
  page: Page,
  move: () => Promise<void>
): Promise<void> => {
  const position = page.getByRole('button', { name: /^문제 번호 /u })
  const before = await position.textContent()
  await move()
  await expect(position).not.toHaveText(before ?? '')
  await expect(
    page.locator('.study-push-leaving, .study-push[data-push]')
  ).toHaveCount(0)
}
