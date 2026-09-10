import { test, expect, _electron as electron } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { noteAction } from './ui';

test('focused notebook keeps creation, menus, organization and search accessible', async ({}, info) => {
  const root = await mkdtemp(path.join(tmpdir(), 'chirpberry-focus-ui-'));
  const application = await electron.launch({ executablePath: process.env.CHIRPBERRY_EXECUTABLE,
    args: process.env.CHIRPBERRY_EXECUTABLE ? [] : [path.resolve('.')], env: { ...process.env,
      CHIRPBERRY_PROFILE_DIR: path.join(root, 'profile'), CHIRPBERRY_DOCUMENTS_DIR: path.join(root, 'documents'), CHIRPBERRY_DISABLE_OS_INTEGRATIONS: '1' } });
  try {
    const page = await application.firstWindow();
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1000, 740));
    await page.getByRole('button', { name: 'New note', exact: true }).first().click();
    await expect(page.getByRole('textbox', { name: 'My notes', exact: true })).toBeFocused();
    await expect(page.getByRole('complementary', { name: 'Transcript', exact: true })).not.toBeVisible();
    await page.getByRole('textbox', { name: 'Note title' }).fill('Friday planning');
    await page.getByRole('tab', { name: 'Summary', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Generate summary' })).toBeDisabled();
    await expect(page.getByText('Add notes or record a meeting to create a summary.')).toBeVisible();
    await page.getByRole('tab', { name: 'My notes', exact: true }).click();
    await page.getByRole('textbox', { name: 'My notes', exact: true }).fill('Keep the next release focused.');
    await page.getByRole('button', { name: 'Hide sidebar' }).click();
    await expect(page.getByRole('complementary', { name: 'Notebook navigation' })).not.toBeVisible();
    await expect(page.getByRole('textbox', { name: 'My notes', exact: true })).toHaveValue('Keep the next release focused.');
    await page.screenshot({ path: info.outputPath('focused-writing.png') });
    // The existing native Search command restores the sidebar before focusing search.
    // Playwright key injection stays in Chromium, so invoke the real native menu item.
    await application.evaluate(({ Menu, BrowserWindow }) => {
      const item = Menu.getApplicationMenu()!.items.find(item => item.label === 'View')!.submenu!.items.find(item => item.label === 'Search notes')!;
      item.click(item, BrowserWindow.getAllWindows()[0], { shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, triggeredByAccelerator: false });
    });
    await expect(page.getByRole('textbox', { name: 'Search notes' })).toBeFocused();
    await page.getByRole('button', { name: 'Note actions', exact: true }).focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitem', { name: 'Dictate to clipboard' })).toBeFocused();
    await page.keyboard.press('End');
    await expect(page.getByRole('menuitem', { name: 'Move note to trash' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu', { name: 'Note actions' })).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Note actions', exact: true })).toBeFocused();

    await page.getByRole('button', { name: 'New note', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Note title' })).toHaveValue('Untitled meeting');
    await expect(page.getByRole('textbox', { name: 'My notes', exact: true })).toBeFocused();
    await page.getByRole('textbox', { name: 'Note title' }).fill('Another thought');
    await page.getByRole('textbox', { name: 'My notes', exact: true }).fill('This note must stay untouched.');
    await page.getByRole('button', { name: /Friday planning/ }).click({ button: 'right' });
    await expect(page.getByRole('menu', { name: 'Note actions' })).toBeVisible();
    await page.screenshot({ path: info.outputPath('row-context-menu.png') });
    await page.getByRole('menuitem', { name: 'Pin note', exact: true }).click();
    await page.getByRole('button', { name: 'New note', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Note title' })).toHaveValue('Untitled meeting');
    await expect(page.getByRole('textbox', { name: 'My notes', exact: true })).toBeFocused();
    await expect(page.getByRole('menu', { name: 'Note actions' })).not.toBeVisible();
    await page.getByRole('combobox', { name: 'Filter notes' }).selectOption('pinned');
    await expect(page.getByRole('button', { name: /Friday planning/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Another thought/ })).not.toBeVisible();
    await page.getByRole('button', { name: /Friday planning/ }).click();
    await noteAction(page, 'Move to notebook…');
    await expect(page.getByRole('combobox', { name: 'Notebook', exact: true })).toBeFocused();
    await page.getByRole('combobox', { name: 'Notebook', exact: true }).fill('Work');
    await page.getByRole('combobox', { name: 'Filter notes' }).selectOption('notebook:Work');
    await page.getByRole('button', { name: /Friday planning/ }).click();
    await page.getByRole('combobox', { name: 'Filter notes' }).selectOption('all');
    await page.getByRole('button', { name: /Another thought/ }).click();
    await expect(page.getByRole('textbox', { name: 'My notes', exact: true })).toHaveValue('This note must stay untouched.');
    await page.getByRole('button', { name: 'Library options', exact: true }).click();
    const menu = page.getByRole('menu', { name: 'Library options' });
    const bounds = await menu.boundingBox();
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(740);
    expect((await new AxeBuilder({ page }).setLegacyMode().analyze()).violations).toEqual([]);
    await page.screenshot({ path: info.outputPath('library-menu.png') });
    await page.keyboard.press('Escape');
    expect(errors).toEqual([]);
  } finally {
    await application.close();
    await rm(root, { recursive: true, force: true });
  }
});
