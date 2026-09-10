import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { AudioInput } from './recording';

/** Stdio is private to the Electron main process; credentials never reach a renderer. */
export class NativeBridge extends EventEmitter {
  private child?: ChildProcessWithoutNullStreams;
  private buffer = '';
  private pending = new Map<string, { resolve(value: any): void; reject(error: Error): void; timer: NodeJS.Timeout }>();
  constructor(private executable: string) { super(); }
  private start() {
    if (this.child) return;
    const child = spawn(this.executable, [], { stdio: 'pipe', windowsHide: true }); this.child = child;
    child.stdout.setEncoding('utf8'); child.stderr.resume(); // Never forward native diagnostics or audio to logs.
    child.stdout.on('data', (data: string) => {
      this.buffer += data;
      if (this.buffer.length > 1024 * 1024) { this.destroy(); return; }
      let newline: number;
      while ((newline = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, newline); this.buffer = this.buffer.slice(newline + 1);
        try {
          const value = JSON.parse(line);
          if (typeof value.id === 'string') {
            const request = this.pending.get(value.id); if (!request) continue;
            clearTimeout(request.timer); this.pending.delete(value.id);
            if (typeof value.error === 'string') request.reject(new Error(value.error.slice(0, 500))); else request.resolve(value.result);
          } else if (['audio', 'failure', 'shortcut'].includes(value.event)) this.emit(value.event, value);
        } catch { this.destroy(); return; }
      }
    });
    child.on('error', () => this.disconnected(child));
    child.on('exit', () => this.disconnected(child));
  }
  request<T = any>(command: string, args: Record<string, unknown> = {}, timeout = 30000): Promise<T> {
    this.start(); const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('The Mac integration timed out. Check its permission prompts and try again.')); this.destroy(); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.child!.stdin.write(JSON.stringify({ id, command, arguments: args }) + '\n', error => { if (error) this.destroy(); });
    });
  }
  private disconnected(child: ChildProcessWithoutNullStreams) {
    if (this.child !== child) return;
    this.child = undefined; this.buffer = '';
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(new Error('The Mac integration stopped. Try the action again.')); }
    this.pending.clear(); this.emit('failure', { message: 'The Mac capture process stopped. Saved transcripts are retained.' });
  }
  destroy() {
    const child = this.child; if (!child) return;
    // Closing stdin asks the helper to stop; force termination bounds permission-dialog and stream hangs.
    child.stdin.end(); this.disconnected(child);
    const timer = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }, 1500); timer.unref();
  }
}

export class MacAudioInput implements AudioInput {
  private bridge?: NativeBridge;
  constructor(private executable: string) {}
  async start(systemAudio: boolean, pcm: Parameters<AudioInput['start']>[1], failure: (message: string) => void, signal: AbortSignal) {
    if (signal.aborted) return;
    const bridge = new NativeBridge(this.executable); this.bridge = bridge;
    const abort = () => { if (this.bridge === bridge) this.bridge = undefined; bridge.removeAllListeners(); bridge.destroy(); };
    signal.addEventListener('abort', abort, { once: true });
    bridge.once('failure', event => failure(event.message));
    bridge.on('audio', event => {
      if (signal.aborted || !['Microphone', 'System audio'].includes(event.channel) || typeof event.pcm !== 'string' || event.pcm.length > 44000) return;
      pcm(event.channel, Buffer.from(event.pcm, 'base64'), event.level);
    });
    try { await bridge.request('audio.start', { systemAudio }, 120000); }
    finally { signal.removeEventListener('abort', abort); if (signal.aborted) abort(); }
  }
  async stop() {
    const bridge = this.bridge; this.bridge = undefined; if (!bridge) return;
    bridge.removeAllListeners();
    try { await bridge.request('audio.stop', {}, 3000); } finally { bridge.destroy(); }
  }
}
