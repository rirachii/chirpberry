import { contextBridge, ipcRenderer } from 'electron';
import type { NotebookAPI, SaveStatus } from '../shared/api';

const api: NotebookAPI = {
  load: () => ipcRenderer.invoke('notebook:load'),
  create: kind => ipcRenderer.invoke('notebook:create', kind),
  update: (id, patch) => ipcRenderer.invoke('notebook:update', id, patch),
  import: () => ipcRenderer.invoke('notebook:import'),
  export: (id, format) => ipcRenderer.invoke('notebook:export', id, format),
  copy: id => ipcRenderer.invoke('notebook:copy', id),
  showStorage: () => ipcRenderer.invoke('notebook:storage'),
  runtime: () => ipcRenderer.invoke('runtime:load'),
  saveSettings: settings => ipcRenderer.invoke('runtime:settings', settings),
  saveKey: key => ipcRenderer.invoke('runtime:key', key),
  requestAccessibility: () => ipcRenderer.invoke('runtime:accessibility'),
  startCapture: (id, purpose) => ipcRenderer.invoke('runtime:start', id, purpose),
  stopCapture: () => ipcRenderer.invoke('runtime:stop'),
  pauseCapture: () => ipcRenderer.invoke('runtime:pause'),
  resumeCapture: () => ipcRenderer.invoke('runtime:resume'),
  companion: action => ipcRenderer.invoke('companion:action', action),
  summarize: id => ipcRenderer.invoke('runtime:summarize', id),
  importAudio: () => ipcRenderer.invoke('runtime:import-audio'),
  calendar: () => ipcRenderer.invoke('runtime:calendar'),
  prepareEvent: event => ipcRenderer.invoke('runtime:prepare-event', event),
  onCapture: callback => subscribe('runtime:capture', callback),
  onMeeting: callback => subscribe('runtime:meeting', callback),
  onRuntime: callback => subscribe('runtime:changed', callback),
  onSelect: callback => subscribe('runtime:select', callback),
  onSaveStatus: callback => {
    const listener = (_event: Electron.IpcRendererEvent, status: SaveStatus) => callback(status);
    ipcRenderer.on('notebook:save-status', listener);
    return () => ipcRenderer.removeListener('notebook:save-status', listener);
  },
  onCommand: callback => {
    const listener = (_event: Electron.IpcRendererEvent, command: 'new' | 'import' | 'search') => callback(command);
    ipcRenderer.on('notebook:command', listener);
    return () => ipcRenderer.removeListener('notebook:command', listener);
  }
};
function subscribe(channel: string, callback: (...args: any[]) => void) {
  const listener = (_event: Electron.IpcRendererEvent, ...args: any[]) => callback(...args);
  ipcRenderer.on(channel, listener); return () => { ipcRenderer.removeListener(channel, listener); };
}
contextBridge.exposeInMainWorld('chirpberry', api);
