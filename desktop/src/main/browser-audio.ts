import { BrowserWindow, desktopCapturer, ipcMain, session } from 'electron';
import path from 'node:path';
import type { AudioInput } from './recording';

export class BrowserAudioInput implements AudioInput {
  private window?: BrowserWindow;
  async start(systemAudio: boolean, pcm: Parameters<AudioInput['start']>[1], failure: (message: string) => void, signal: AbortSignal) {
    if (signal.aborted) return;
    if (systemAudio && process.platform !== 'win32') throw new Error('System audio is supported on Mac and Windows. Use microphone capture on Linux.');
    const partition = `capture-${crypto.randomUUID()}`;
    const captureSession = session.fromPartition(partition);
    const window = new BrowserWindow({ show: false, width: 320, height: 160, title: 'Chirpberry audio capture',
      webPreferences: { partition, preload: path.join(__dirname, 'capture-preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    this.window = window;
    const url = 'chirpberry://app/capture.html';
    const trusted = (sender: Electron.WebContents | null) => !signal.aborted && sender === window.webContents && !window.isDestroyed();
    captureSession.setPermissionCheckHandler((sender, permission) => trusted(sender) && ['media', 'display-capture'].includes(permission));
    captureSession.setPermissionRequestHandler((sender, permission, callback, details) => callback(trusted(sender) &&
      (permission === 'display-capture' && systemAudio || permission === 'media' && 'mediaTypes' in details && !!details.mediaTypes?.length && details.mediaTypes.every(type => type === 'audio'))));
    captureSession.setDisplayMediaRequestHandler((request, callback) => {
      if (!systemAudio || signal.aborted || request.frame !== window.webContents.mainFrame) { callback({}); return; }
      void desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } }).then(sources => {
        if (signal.aborted || !sources[0]) callback({}); else callback({ video: sources[0], audio: 'loopback' });
      }).catch(() => callback({}));
    });
    // This ephemeral session serves exactly the capture page and its local worklet.
    captureSession.protocol.handle('chirpberry', request => session.defaultSession.fetch(request.url));
    captureSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !['capture.html', 'capture.js', 'worklet.js'].some(file => details.url === `chirpberry://app/${file}`) }));
    const frame = (event: Electron.IpcMainInvokeEvent, channel: unknown, data: unknown, level: unknown) => {
      if (!trusted(event.sender) || event.senderFrame !== window.webContents.mainFrame || event.senderFrame?.url !== url) throw new Error('Unauthorized capture frame.');
      if (!['Microphone', ...(systemAudio ? ['System audio'] : [])].includes(channel as string) || !(data instanceof ArrayBuffer) || data.byteLength > 32000 || data.byteLength % 2 || typeof level !== 'number' || !Number.isFinite(level)) throw new Error('Invalid audio frame.');
      pcm(channel as string, Buffer.from(data), level);
    };
    const failed = (event: Electron.IpcMainEvent) => { if (trusted(event.sender)) failure('The audio device stopped. Check microphone permissions and reconnect your device.'); };
    ipcMain.handle('capture:frame', frame); ipcMain.on('capture:failure', failed);
    const abort = () => { if (!window.isDestroyed()) window.destroy(); };
    signal.addEventListener('abort', abort, { once: true });
    window.once('closed', () => { ipcMain.removeHandler('capture:frame'); ipcMain.removeListener('capture:failure', failed); signal.removeEventListener('abort', abort); void captureSession.protocol.unhandle('chirpberry'); });
    window.webContents.on('render-process-gone', () => { if (!signal.aborted) failure('The audio process stopped. Saved transcripts are retained.'); });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.webContents.on('will-attach-webview', event => event.preventDefault());
    await window.loadURL(url);
    if (!signal.aborted) await window.webContents.executeJavaScript(`window.startCapture(${systemAudio ? 'true' : 'false'})`, true);
  }
  async stop() {
    const window = this.window; this.window = undefined;
    if (!window || window.isDestroyed()) return;
    let timer: NodeJS.Timeout | undefined;
    try {
      // Keep IPC alive until partial worklet frames and their acknowledgements drain.
      await Promise.race([window.webContents.executeJavaScript('window.stopCapture()'),
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Audio capture did not finish in time.')), 3000); })]);
    } finally {
      clearTimeout(timer);
      if (!window.isDestroyed()) window.destroy(); // Also releases pending permission requests on failure.
    }
  }
}
