import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, protocol, session, shell } from 'electron';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { markdown, patchSchema, uuid } from '../shared/meeting';
import { atomicWrite, MeetingStore } from './store';
import { DesktopRuntime } from './runtime';

app.setName('Chirpberry');
// A separate profile and store allow comparison without touching the native app's documents.
const profile = process.env.CHIRPBERRY_PROFILE_DIR ?? path.join(app.getPath('appData'), 'Chirpberry Desktop');
app.setPath('userData', profile);
protocol.registerSchemesAsPrivileged([{ scheme: 'chirpberry', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const locked = app.requestSingleInstanceLock();
if (!locked) app.quit();
let window: BrowserWindow | undefined;
let store: MeetingStore;
let runtime: DesktopRuntime;
let closing = false;
let quitting = false;
let shutdown: Promise<void> | undefined;
const rendererDirectory = path.join(__dirname, 'renderer');
const origin = 'chirpberry://app';

function trusted(event: Electron.IpcMainInvokeEvent, companion = false) {
  if (companion && runtime?.companion.owns(event)) return;
  if (!window || event.sender !== window.webContents || event.senderFrame !== event.sender.mainFrame ||
      event.senderFrame?.url !== `${origin}/index.html`) throw new Error('Unauthorized notebook request.');
}
function handler(name: string, callback: (...args: any[]) => unknown) {
  ipcMain.handle(name, (event, ...args) => { trusted(event, name === 'runtime:load' || name === 'companion:action'); return callback(...args); });
}
function closeAndQuit() {
  if (shutdown) return;
  shutdown = (async () => {
    try { await runtime?.shutdown(); await store?.flush(); closing = true; app.quit(); }
    catch {
      quitting = false; shutdown = undefined;
      if (window) void dialog.showMessageBox(window, { type: 'error', message: 'Keep Chirpberry open to protect your notes.', detail: 'Some edits could not be saved. Export a copy from the meeting toolbar before quitting.', buttons: ['Keep open'] });
    }
  })();
}

async function createWindow() {
  window = new BrowserWindow({
    width: 1280, height: 840, minWidth: 720, minHeight: 540,
    show: false, title: 'Chirpberry', backgroundColor: '#FAF8F3',
    icon: path.join(rendererDirectory, 'chirpberry.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, spellcheck: true }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.once('ready-to-show', () => window?.show());
  window.on('close', event => {
    if (closing) return;
    event.preventDefault();
    closeAndQuit();
  });
  window.on('closed', () => { window = undefined; });
  window.webContents.on('render-process-gone', () => { void runtime?.closeCapture(); });
  await window.loadURL(`${origin}/index.html`);
}

if (locked) void app.whenReady().then(async () => {
  protocol.handle('chirpberry', async request => {
    const url = new URL(request.url);
    if (url.hostname !== 'app' || request.method !== 'GET') return new Response(null, { status: 403 });
    let relative: string;
    try { relative = decodeURIComponent(url.pathname); } catch { return new Response(null, { status: 400 }); }
    const filename = path.resolve(rendererDirectory, `.${relative}`);
    if (!filename.startsWith(rendererDirectory + path.sep)) return new Response(null, { status: 403 });
    const contentTypes: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png' };
    const contentType = contentTypes[path.extname(filename)];
    if (!contentType) return new Response(null, { status: 404 });
    try { return new Response(new Uint8Array(await readFile(filename)), { headers: { 'Content-Type': contentType, 'X-Content-Type-Options': 'nosniff' } }); }
    catch { return new Response(null, { status: 404 }); }
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  // Renderer networking is denied; authenticated provider requests run only in main.
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !details.url.startsWith(`${origin}/`) && !details.url.startsWith('devtools://') });
  });
  store = new MeetingStore(process.env.CHIRPBERRY_DOCUMENTS_DIR ?? path.join(profile, 'Meetings'), status => {
    if (window && !window.webContents.isDestroyed()) window.webContents.send('notebook:save-status', status);
  });
  await store.load();
  runtime = new DesktopRuntime(store, profile, () => window);
  await runtime.initialize(); runtime.register(handler);
  handler('companion:action', action => runtime.action(action));
  handler('notebook:load', () => ({ ...store.snapshot(), platform: process.platform }));
  handler('notebook:create', kind => store.create(z.enum(['meeting', 'scratchpad']).parse(kind)));
  handler('notebook:update', (id, patch) => { const identifier = uuid.parse(id), changes = patchSchema.parse(patch); runtime.protectEdit(identifier, changes); store.update(identifier, changes); });
  handler('notebook:import', async () => {
    const result = await dialog.showOpenDialog(window!, { title: 'Import a copy', properties: ['openFile'], filters: [{ name: 'Chirpberry or text document', extensions: ['json', 'md', 'markdown', 'txt'] }] });
    if (result.canceled || !result.filePaths[0]) return null;
    const filename = result.filePaths[0];
    const extension = path.extname(filename).toLowerCase();
    if (!['.json', '.md', '.markdown', '.txt'].includes(extension)) throw new Error('Choose a Chirpberry JSON, Markdown, or text file.');
    const size = (await stat(filename)).size;
    if (size > (extension === '.json' ? 32 : 8) * 1024 * 1024) throw new Error('The selected file is too large.');
    let contents: string;
    try { contents = new TextDecoder('utf-8', { fatal: true }).decode(await readFile(filename)); }
    catch { throw new Error('Choose a readable UTF-8 document. The original file has been preserved.'); }
    return extension === '.json' ? store.importJSON(contents) : store.importText(contents, path.basename(filename, extension));
  });
  handler('notebook:export', async (id, kind) => {
    const meeting = store.get(uuid.parse(id));
    const format = z.enum(['json', 'markdown']).parse(kind);
    const extension = format === 'json' ? 'json' : 'md';
    const safeTitle = meeting.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').slice(0, 100).replace(/[. ]+$/, '') || 'Meeting';
    const result = await dialog.showSaveDialog(window!, { title: 'Export meeting', defaultPath: `${safeTitle}.${extension}`, filters: [{ name: format === 'json' ? 'Chirpberry document' : 'Markdown', extensions: [extension] }] });
    if (result.canceled || !result.filePath) return false;
    // Export uses in-memory edits even when the notebook's disk save has failed.
    await atomicWrite(result.filePath, format === 'json' ? JSON.stringify(meeting, null, 2) : markdown(meeting));
    return true;
  });
  handler('notebook:copy', id => clipboard.writeText(markdown(store.get(uuid.parse(id)))));
  handler('notebook:storage', async () => { const error = await shell.openPath(store.directory); if (error) throw new Error('The notebook folder could not be opened.'); });
  const command = (value: 'new' | 'import' | 'search') => () => window?.webContents.send('notebook:command', value);
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    { label: 'File', submenu: [
      { label: 'New note', accelerator: 'CmdOrCtrl+N', click: command('new') },
      { label: 'Import…', accelerator: 'CmdOrCtrl+O', click: command('import') },
      { type: 'separator' }, { role: process.platform === 'darwin' ? 'close' : 'quit' }
    ] },
    { role: 'editMenu' },
    { label: 'View', submenu: [{ label: 'Search notes', accelerator: 'CmdOrCtrl+F', click: command('search') }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' }
  ]));
  await createWindow();
  await runtime.configure();
  app.on('activate', () => { if (!window) void createWindow(); });
}).catch(() => {
  dialog.showErrorBox('Chirpberry could not open', 'The notebook could not be loaded. Check that its storage folder is readable and writable. Existing documents have been preserved.');
  app.exit(1);
});
app.on('second-instance', () => { if (window?.isMinimized()) window.restore(); window?.show(); window?.focus(); });
app.on('before-quit', event => { quitting = true; if (!closing) { event.preventDefault(); closeAndQuit(); } });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
