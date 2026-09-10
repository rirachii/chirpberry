import { BrowserWindow, screen } from 'electron';
import path from 'node:path';
import type { AppSettings, CaptureSnapshot } from '../shared/capture';

export class Companion {
  window?: BrowserWindow;
  private hovered = false;
  private active = false;
  private expanded = false;
  private leaveTimer?: NodeJS.Timeout;
  private settings?: AppSettings;
  constructor(private stopCapture: () => Promise<void>) {}
  async configure(settings: AppSettings) {
    this.settings = settings;
    if (!settings.barVisible) {
      if (!this.active) this.destroy();
      if (!this.window) return;
    }
    if (!this.window) {
      const window = new BrowserWindow({ width: 52, height: 10, show: false, frame: false, transparent: true, resizable: false, minimizable: false,
        maximizable: false, fullscreenable: false, skipTaskbar: true, alwaysOnTop: true, title: 'Chirpberry capture bar',
        webPreferences: { preload: path.join(__dirname, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false } });
      this.window = window;
      window.setAlwaysOnTop(true, 'floating'); window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', event => event.preventDefault());
      window.webContents.on('will-attach-webview', event => event.preventDefault());
      let closing: Promise<void> | undefined;
      const stopCapture = () => closing ??= this.stopCapture();
      window.on('close', event => {
        if (!this.active) return;
        event.preventDefault();
        void stopCapture().then(() => { if (!window.isDestroyed()) window.destroy(); }).catch(() => {});
      });
      window.on('closed', () => {
        if (this.window === window) this.window = undefined;
        if (this.active) void stopCapture().catch(() => {});
      });
      await window.loadURL('chirpberry://app/companion.html');
      if (window.isDestroyed()) return;
      this.position(); window.showInactive();
    } else this.position();
  }
  owns(event: Electron.IpcMainInvokeEvent) { return !!this.window && event.sender === this.window.webContents && event.senderFrame === event.sender.mainFrame && event.senderFrame?.url === 'chirpberry://app/companion.html'; }
  hover() { clearTimeout(this.leaveTimer); this.hovered = true; this.position(); }
  leave() { clearTimeout(this.leaveTimer); this.leaveTimer = setTimeout(() => { this.hovered = false; this.position(); }, 120); }
  capture(snapshot: CaptureSnapshot) {
    this.active = snapshot.state !== 'idle';
    if (!this.active && this.settings?.barVisible === false) { this.destroy(); return; }
    this.position();
  }
  private position() {
    const window = this.window; if (!window || window.isDestroyed() || !this.settings) return;
    const expanded = this.active || this.hovered;
    const width = expanded ? 200 : 52, height = expanded ? 60 : 10;
    const area = screen.getPrimaryDisplay().workArea;
    const dock = this.settings.dock;
    let x = area.x + Math.round((area.width - width) / 2), y = area.y + area.height - height - 18;
    if (dock === 'top') y = area.y + 18;
    if (dock === 'left' || dock === 'right') { x = dock === 'left' ? area.x + 18 : area.x + area.width - width - 18; y = area.y + Math.round((area.height - height) / 2); }
    window.setBounds({ x, y, width, height });
    this.expanded = expanded; window.webContents.send('companion:expanded', this.expanded);
  }
  destroy() { clearTimeout(this.leaveTimer); this.hovered = false; this.window?.destroy(); this.window = undefined; }
}
