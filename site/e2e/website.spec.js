import {test, expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const command = 'brew install --cask rirachii/tap/chirpberry';

test('accessible notebook and responsive language examples', async ({page}) => {
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);
  await expect(page.getByRole('heading', {level: 1})).toHaveText('Every voice.One notebook.');
  const audit = await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();
  expect(audit.violations).toEqual([]);
  await page.getByRole('button', {name: 'Chinese', exact: true}).click();
  await expect(page.locator('.example-original')).toHaveAttribute('lang', 'zh');
  await expect(page.getByRole('button', {name: 'Chinese', exact: true})).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('link', {name: 'Installation help', exact: true}).click();
  await expect(page.locator('#install')).toHaveAttribute('open', '');
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({width, height: 900});
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  }
});

test('both Homebrew controls copy the exact command', async ({page, context}) => {
  await context.grantPermissions(['clipboard-read','clipboard-write']);
  await page.goto('/');
  const buttons = page.getByRole('button', {name: 'Copy Homebrew install command'});
  await expect(buttons).toHaveCount(2);
  for (const button of await buttons.all()) {
    await button.click();
    await expect(button).toHaveText('Copied');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(command);
  }
});

test('blocked clipboard gives a manual fallback', async ({page}) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', {value: {writeText: () => Promise.reject(new Error('Blocked'))}}));
  await page.goto('/');
  await page.getByRole('button', {name: 'Copy Homebrew install command'}).first().click();
  await expect(page.locator('.copy-status').first()).toHaveText('Select the command and copy it manually.');
  await expect(page.locator('.brew-copy code').first()).toHaveText(command);
});

test('download and install help remain usable without JavaScript', async ({browser}) => {
  const context = await browser.newContext({javaScriptEnabled: false});
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:5182');
  await expect(page.getByRole('link', {name: 'Get Chirpberry for Mac'})).toHaveAttribute('href', /releases\/download\/v0\.1\.0\/Chirpberry-0\.1\.0-macOS-arm64\.dmg$/);
  await page.getByText('How do I install it?', {exact: true}).click();
  await expect(page.locator('#install')).toHaveAttribute('open', '');
  await context.close();
});
