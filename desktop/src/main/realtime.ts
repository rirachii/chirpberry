import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { z } from 'zod';
import type { Segment } from '../shared/meeting';
import { targets } from '../shared/meeting';

const eventSchema = z.object({
  type: z.string().max(80), text: z.string().max(250_000).optional(), rawText: z.string().max(250_000).optional(),
  event_id: z.string().max(500).optional(), timestampMs: z.number().finite().nonnegative().optional(),
  translated: z.boolean().optional(), sourceLanguage: z.string().max(80).optional(), targetLanguage: z.string().max(80).optional(),
  code: z.string().max(200).optional(), utterances: z.array(z.object({
    speaker: z.number().int().nonnegative().optional(), transcript: z.string().max(250_000),
    start: z.number().finite().nonnegative().optional(), end: z.number().finite().nonnegative().optional()
  })).max(1000).optional()
});
export type TranscriptEvent = z.infer<typeof eventSchema>;

export class TranscriptReducer {
  readonly partials: Record<string, string> = {};
  private seen = new Set<string>();
  apply(input: unknown, channel: string, offset: number, scope: string): Segment | undefined {
    const event = eventSchema.parse(input);
    if (event.type === 'transcript.partial') { this.partials[channel] = event.text ?? ''; return; }
    if (event.type !== 'transcript.final') return;
    delete this.partials[channel];
    const text = event.text?.trim(); if (!text) return;
    const identity = event.event_id ?? (event.timestampMs === undefined ? undefined : `${event.timestampMs}|${event.rawText ?? text}|${text}`);
    if (identity !== undefined) {
      const key = `${channel}|${identity}`;
      if (this.seen.has(key)) return;
      this.seen.add(key);
    }
    return { id: randomUUID().toUpperCase(), timestamp: offset + (event.timestampMs ?? 0) / 1000, channel,
      original: event.translated ? event.rawText ?? '' : text,
      ...(event.translated ? { translation: text } : {}),
      ...(event.sourceLanguage ? { sourceLanguage: event.sourceLanguage } : {}),
      ...(event.targetLanguage ? { targetLanguage: event.targetLanguage } : {}),
      utterances: event.utterances ?? [], speakerScope: scope };
  }
}

export interface SpeechStream {
  connect(): Promise<void>;
  sendAudio(audio: Buffer): boolean;
  finish(): Promise<void>;
  close(): void;
}
export type RealtimeOptions = {
  key: string; language: string; targetLanguage?: string; diarize: boolean; vocabulary?: string; hints?: string[];
  onEvent(event: TranscriptEvent): void; onFailure(message: string): void;
  endpoint?: string; readyTimeoutMs?: number; finishTimeoutMs?: number;
};

export class RealtimeSession implements SpeechStream {
  private socket?: WebSocket;
  private ready = false;
  private closed = false;
  private finishing = false;
  private configured = false;
  private readyTimer?: NodeJS.Timeout;
  private finishTimer?: NodeJS.Timeout;
  private readyResolve?: () => void;
  private readyReject?: (error: Error) => void;
  private finishResolve?: () => void;
  private finishReject?: (error: Error) => void;
  constructor(private options: RealtimeOptions) {}

  connect(): Promise<void> {
    if (this.socket || this.closed) return Promise.reject(new Error('This transcription session has already been used.'));
    if (!this.options.key.trim() || /[\r\n]/.test(this.options.key)) return Promise.reject(new Error('Add a valid Valsea API key in Settings.'));
    if (this.options.targetLanguage && !targets.includes(this.options.targetLanguage)) return Promise.reject(new Error('Choose a supported translation target.'));
    return new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve; this.readyReject = reject;
      this.readyTimer = setTimeout(() => this.fail('Valsea did not become ready. Check your key, credits, and connection.'), this.options.readyTimeoutMs ?? 25_000);
      try {
        this.socket = new WebSocket(this.options.endpoint ?? 'wss://api.valsea.ai/v1/realtime/notetaker', {
          headers: { Authorization: `Bearer ${this.options.key.trim()}` }, maxPayload: 1024 * 1024,
          handshakeTimeout: this.options.readyTimeoutMs ?? 25_000, perMessageDeflate: false, followRedirects: false
        });
      } catch { this.fail('The Valsea connection could not be opened.'); return; }
      this.socket.on('message', data => {
        if (this.closed) return;
        try {
          const event = eventSchema.parse(JSON.parse(data.toString()));
          if (event.type === 'session.created' && !this.configured) {
            this.configured = true;
            const hints = [...new Set((this.options.hints ?? []).map(value => value.trim().toLowerCase()).filter(value => /^[a-z]{2,3}$/.test(value)))].slice(0, 20);
            this.send({ type: 'session.start', model: 'valsea-rtt', language: this.options.language,
              language_hints: hints, hint_text: (this.options.vocabulary ?? '').slice(0, 4000), diarize: this.options.diarize,
              diarization_min_speakers: 2, diarization_max_speakers: 6,
              ...(this.options.targetLanguage ? { target_language: this.options.targetLanguage } : {}) });
          } else if (event.type === 'session.ready') {
            if (!this.configured) { this.fail('Valsea returned an unexpected session state.'); return; }
            this.ready = true; clearTimeout(this.readyTimer); this.readyResolve?.(); this.readyResolve = undefined; this.readyReject = undefined;
          } else if (event.type === 'error') {
            const messages: Record<string, string> = {
              AUTH_REQUIRED: 'Valsea requires an API key.', AUTH_FAILED: 'Valsea rejected the API key. Check Settings.',
              INSUFFICIENT_CREDITS: 'Your Valsea account needs credits.', RATE_LIMITED: 'Valsea is rate limiting this account. Wait before trying again.',
              UNSUPPORTED_DIARIZATION_LANGUAGE: 'Speaker detection is unavailable for this language. Turn it off before retrying.'
            };
            this.fail(messages[event.code ?? ''] ?? 'Valsea could not continue transcription. Check your connection and language settings.');
          } else if (event.type === 'session.stopped' || event.type === 'session.ended') {
            if (this.finishing) this.complete(); else this.fail('Valsea ended the session. Saved final segments are retained.');
          } else if (this.ready) this.options.onEvent(event);
        } catch { this.fail('Valsea returned an unreadable transcript event. Saved final segments are retained.'); }
      });
      this.socket.on('error', () => this.fail('Unable to maintain the Valsea connection. Check your key, credits, and network.'));
      this.socket.on('close', code => {
        if (this.closed) return;
        if (this.finishing && code === 1000) this.complete();
        else this.fail('The Valsea connection closed unexpectedly. Saved final segments are retained.');
      });
    });
  }

  sendAudio(audio: Buffer) {
    if (!this.ready || this.closed || this.finishing || this.socket?.readyState !== WebSocket.OPEN) return false;
    if (!audio.length || audio.length % 2 || audio.length > 32_000) { this.fail('Audio capture produced an invalid PCM frame.'); return false; }
    if (this.socket.bufferedAmount + audio.length > 64_000) { this.fail('The network could not keep up with audio. Recording stopped to protect your transcript.'); return false; }
    this.socket.send(audio, { binary: true }, error => { if (error) this.fail('Audio could not reach Valsea. Saved final segments are retained.'); });
    return true;
  }
  finish(): Promise<void> {
    if (this.closed || !this.ready) return Promise.reject(new Error('The transcription connection is no longer ready.'));
    if (this.finishing) return Promise.reject(new Error('This transcription session is already finishing.'));
    this.finishing = true;
    return new Promise<void>((resolve, reject) => {
      this.finishResolve = resolve; this.finishReject = reject;
      this.finishTimer = setTimeout(() => this.fail('Valsea did not finish in time. Saved final segments remain in your notebook; the clipboard is unchanged.'), this.options.finishTimeoutMs ?? 8000);
      this.send({ type: 'audio.commit' }); this.send({ type: 'session.stop' });
    });
  }
  private send(value: unknown) {
    if (this.socket?.readyState !== WebSocket.OPEN || this.closed) return;
    this.socket.send(JSON.stringify(value), error => { if (error) this.fail('The Valsea session could not be updated.'); });
  }
  private complete() { this.finishResolve?.(); this.finishResolve = undefined; this.finishReject = undefined; this.close(); }
  private fail(message: string) {
    if (this.closed) return;
    this.readyReject?.(new Error(message)); this.readyReject = undefined;
    this.finishReject?.(new Error(message)); this.finishReject = undefined;
    this.close(); this.options.onFailure(message);
  }
  close() {
    if (this.closed) return;
    this.closed = true; this.ready = false;
    clearTimeout(this.readyTimer); clearTimeout(this.finishTimer);
    this.readyReject?.(new Error('Transcription was cancelled before it was ready.')); this.readyReject = undefined; this.readyResolve = undefined;
    this.finishReject?.(new Error('Transcription finalization was cancelled.')); this.finishReject = undefined; this.finishResolve = undefined;
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.close(1000);
    else if (this.socket?.readyState === WebSocket.CONNECTING) this.socket.terminate();
  }
}
