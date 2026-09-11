import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('captureHost', {
  frame: (channel: string, pcm: ArrayBuffer, level: number) => ipcRenderer.invoke('capture:frame', channel, pcm, level),
  failure: () => ipcRenderer.send('capture:failure')
});
