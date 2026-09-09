import {defineConfig} from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: 'http://127.0.0.1:5182',
    launchOptions: process.env.CHIRPBERRY_BROWSER ? {executablePath: process.env.CHIRPBERRY_BROWSER} : {},
  },
  webServer: {command: 'npm run dev', url: 'http://127.0.0.1:5182', reuseExistingServer: !process.env.CI},
  reporter: 'list',
});
