import {defineConfig} from '@playwright/test';

const port = Number(process.env.CHIRPBERRY_SITE_PORT ?? 5182);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL,
    launchOptions: process.env.CHIRPBERRY_BROWSER ? {executablePath: process.env.CHIRPBERRY_BROWSER} : {},
  },
  webServer: {command: `npm run dev -- --port ${port}`, url: baseURL, reuseExistingServer: !process.env.CI},
  reporter: 'list',
});
