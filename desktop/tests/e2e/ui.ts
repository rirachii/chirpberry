import type { Page } from '@playwright/test';

export async function noteAction(page: Page, name: string) {
  await page.getByRole('button', { name: 'Note actions', exact: true }).click();
  await page.getByRole('menuitem', { name, exact: true }).click();
}

export async function libraryAction(page: Page, name: string) {
  await page.getByRole('button', { name: 'Library options', exact: true }).click();
  await page.getByRole('menuitem', { name, exact: true }).click();
}
