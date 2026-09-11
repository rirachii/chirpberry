import { expect, type Page } from '@playwright/test';

export async function noteAction(page: Page, name: string) {
  await page.getByRole('button', { name: 'Note actions', exact: true }).click();
  await page.getByRole('menuitem', { name, exact: true }).click();
}

export async function libraryAction(page: Page, name: string) {
  await page.getByRole('button', { name: 'Library options', exact: true }).click();
  await page.getByRole('menuitem', { name, exact: true }).click();
}

// Existing feature scenarios enter the notebook through the real skip action.
// Dedicated onboarding acceptance exercises every first-run step separately.
export async function skipOnboarding(page: Page) {
  await page.waitForFunction(() => !!window.chirpberry);
  const runtime = await page.evaluate(() => window.chirpberry.runtime());
  if (runtime.settings.onboardingStep !== 'complete') {
    await page.getByRole('button', { name: 'Set up later', exact: true }).click();
    await expect(page.locator('.onboarding-dialog')).toHaveCount(0);
  }
}
