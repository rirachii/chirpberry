import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { AudioInput } from './recording';

/** Stdio is private to the Electron main process; credentials never reach a renderer. */
export class NativeBridge extends EventEmitter {
  private child?: ChildProcessWithoutNullStreams;
  private exited?: Promise<void>;
  private termination?: Promise<void>;
  private destroyed = false;
  private launched = false;
  private buffer = '';
  private pending = new Map<string, { resolve(value: any): void; reject(error: Error): void; timer: NodeJS.Timeout }>();
  constructor(readonly executable: string, private args: string[] = [], private terminationGraceMS = 1500, private recoverAfterFailure = false) { super(); }
  get running() { return !this.destroyed && !this.termination && !!this.child && this.child.exitCode === null && this.child.signalCode === null; }
  get busy() { return this.pending.size > 0 || !!this.termination && !!this.child; }
  private start(command: string) {
    if (this.destroyed) throw new Error('The Mac integration was closed. Restart Chirpberry to reconnect it.');
    if (this.child) return;
    const child = spawn(this.executable, this.args, { stdio: 'pipe', windowsHide: true }); this.child = child;
    this.exited = new Promise(resolve => child.once('close', () => { this.disconnected(child); resolve(); }));
    child.stdout.setEncoding('utf8'); child.stderr.resume(); // Never forward native diagnostics or audio to logs.
    child.stdout.on('data', (data: string) => {
      if (this.destroyed || this.termination || this.child !== child) return;
      this.buffer += data;
      if (this.buffer.length > 1024 * 1024) { void this.fail(); return; }
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
        } catch { void this.fail(); return; }
      }
    });
    child.on('error', () => { if (this.child === child) void this.fail(); });
    child.stdin.on('error', () => { if (this.child === child) void this.fail(); });
    const restarted = this.launched; this.launched = true;
    if (restarted) this.emit('restarted', { command });
  }
  async request<T = any>(command: string, args: Record<string, unknown> = {}, timeout = 30000): Promise<T> {
    // A new request may recover the long-lived integration helper, never replay
    // the failed command. Capture bridges retain terminal cancellation semantics.
    const previous = this.termination;
    if (previous) {
      await previous;
      if (this.termination === previous && !this.destroyed) this.termination = undefined;
    }
    this.start(command); const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('The Mac integration timed out. Check its permission prompts and try again.')); void this.fail(); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      const child = this.child!;
      child.stdin.write(JSON.stringify({ id, command, arguments: args }) + '\n', error => { if (error && this.child === child) void this.fail(); });
    });
  }
  private rejectPending() {
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(new Error('The Mac integration stopped. Try the action again.')); }
    this.pending.clear(); this.buffer = '';
  }
  private disconnected(child: ChildProcessWithoutNullStreams) {
    if (this.child !== child) return;
    this.child = undefined; this.rejectPending();
    if (!this.destroyed) this.emit('failure', { message: 'The Mac capture process stopped. Saved transcripts are retained.' });
  }
  private fail(): Promise<void> {
    if (!this.recoverAfterFailure) this.destroyed = true;
    return this.terminate();
  }
  destroy(): Promise<void> {
    this.destroyed = true;
    return this.terminate();
  }
  private terminate(): Promise<void> {
    if (this.termination) return this.termination;
    const child = this.child;
    if (!child) return this.termination = Promise.resolve();
    const timer = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }, this.terminationGraceMS);
    this.termination = this.exited!.finally(() => { clearTimeout(timer); });
    this.rejectPending();
    child.stdin.end();
    this.emit('failure', { message: 'The Mac capture process stopped. Saved transcripts are retained.' });
    return this.termination;
  }
}

export class MacAudioInput implements AudioInput {
  private bridge?: NativeBridge;
  private teardown?: Promise<void>;
  private removeAbort?: () => void;
  constructor(private executable: string, private makeBridge: () => NativeBridge = () => new NativeBridge(executable)) {}
  async start(systemAudio: boolean, pcm: Parameters<AudioInput['start']>[1], failure: (message: string) => void, signal: AbortSignal) {
    if (signal.aborted) return;
    if (this.bridge || this.teardown) throw new Error('This capture input has already been used. Start a new recording phase.');
    const bridge = this.makeBridge(); this.bridge = bridge;
    const abort = () => { void this.end(bridge, false).catch(() => {}); };
    this.removeAbort = () => signal.removeEventListener('abort', abort);
    signal.addEventListener('abort', abort, { once: true });
    bridge.once('failure', event => failure(event.message));
    bridge.on('audio', event => {
      if (signal.aborted || !['Microphone', 'System audio'].includes(event.channel) || typeof event.pcm !== 'string' || event.pcm.length > 44000) return;
      pcm(event.channel, Buffer.from(event.pcm, 'base64'), event.level);
    });
    try { await bridge.request('audio.start', { systemAudio }, 120000); }
    catch (error) { await this.end(bridge, false); throw error; }
    finally { if (signal.aborted) await this.end(bridge, false); }
  }
  private end(bridge: NativeBridge, graceful: boolean): Promise<void> {
    // Cancellation can interrupt an in-flight drain; no more frames may escape.
    if (!graceful) { bridge.removeAllListeners(); void bridge.destroy(); }
    if (this.teardown) return this.teardown;
    this.bridge = undefined;
    this.teardown = (async () => {
      try { if (graceful && bridge.running) await bridge.request('audio.stop', {}, 3000); }
      finally { this.removeAbort?.(); this.removeAbort = undefined; bridge.removeAllListeners(); await bridge.destroy(); }
    })();
    return this.teardown;
  }
  stop(): Promise<void> {
    if (this.teardown) return this.teardown;
    return this.bridge ? this.end(this.bridge, true) : Promise.resolve();
  }
}
