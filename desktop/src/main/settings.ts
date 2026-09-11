import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { safeStorage } from 'electron';
import { settingsSchema, readStoredSettings, type AppSettings } from '../shared/capture';
import { atomicWrite } from './store';
import type { NativeBridge } from './native';

export class SettingsStore {
  private value = settingsSchema.parse({});
  private writes: Promise<void> = Promise.resolve();
  constructor(private directory: string) {}
  async load() {
    try {
      const filename = path.join(this.directory, 'settings.json');
      if ((await stat(filename)).size > 32768) throw new Error();
      this.value = readStoredSettings(JSON.parse(await readFile(filename, 'utf8')));
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Settings could not be read. The original settings file has been preserved.'); }
  }
  get(): AppSettings { return structuredClone(this.value); }
  async save(input: unknown) {
    const value = settingsSchema.parse(input);
    return this.enqueue(() => value);
  }
  async patch(input: Partial<AppSettings>) {
    return this.enqueue(() => settingsSchema.parse({ ...this.value, ...input }));
  }
  private async enqueue(next: () => AppSettings) {
    const write = this.writes.catch(() => {}).then(async () => {
      const value = next();
      await atomicWrite(path.join(this.directory, 'settings.json'), JSON.stringify(value, null, 2)); this.value = value;
    });
    this.writes = write; await write; return this.get();
  }
}

export class Credentials {
  constructor(private directory: string, private native?: NativeBridge, private disabled = false, private kind: 'valsea' | 'assistant' = 'valsea') {}
  private get command() { return this.kind === 'assistant' ? 'assistant-key' : 'credential'; }
  private get filename() { return this.kind === 'assistant' ? 'assistant-credential.enc' : 'credential.enc'; }
  available() { return !this.disabled && (!!this.native || safeStorage.isEncryptionAvailable() && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text')); }
  private requireProtection() { if (!this.available()) throw new Error('Protected credential storage is unavailable. Unlock or configure your system keyring, then restart Chirpberry.'); }
  async read(): Promise<string> {
    this.requireProtection();
    if (this.native) return this.native.request(`${this.command}.read`);
    try {
      const filename = path.join(this.directory, this.filename);
      if ((await stat(filename)).size > 32768) throw new Error();
      return safeStorage.decryptString(Buffer.from(await readFile(filename, 'utf8'), 'base64'));
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''; throw new Error('The protected API key could not be unlocked. Save it again in Settings.'); }
  }
  async status() { return !!(await this.read()).trim(); }
  async save(input: unknown) {
    this.requireProtection();
    if (typeof input !== 'string' || input.length > 4096 || /[\r\n]/.test(input)) throw new Error('Enter a valid API key.');
    const key = input.trim();
    if (this.native) await this.native.request(`${this.command}.save`, { key });
    else await atomicWrite(path.join(this.directory, this.filename), safeStorage.encryptString(key).toString('base64'));
    return !!key;
  }
}
