import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Mic, Square, StickyNote, BookOpen, Circle } from 'lucide-react';
import type { CaptureSnapshot } from '../shared/capture';
import '../shared/api';
import './companion.css';
function Bar() {
  const [capture, setCapture] = useState<CaptureSnapshot>({ state: 'idle', elapsed: 0, partials: {}, levels: {} });
  const [error, setError] = useState('');
  useEffect(() => { void window.chirpberry.runtime().then(value => setCapture(value.capture)); return window.chirpberry.onCapture(setCapture); }, []);
  const active = capture.state !== 'idle';
  async function action(value: Parameters<typeof window.chirpberry.companion>[0]) {
    try { setError(''); await window.chirpberry.companion(value); } catch { setError('Open Chirpberry to continue'); }
  }
  return <div className={`capture-bar ${active ? 'active' : ''}`} onPointerEnter={() => void action('hover')} onPointerLeave={() => void action('leave')}>
    <div className="resting-pill" />
    <div className="bar-content"><div className="bar-buttons">
      <button aria-label={active ? 'Stop recording' : 'Dictate to clipboard'} title={active ? 'Stop recording' : 'Dictate to clipboard'} onClick={() => void action('dictation')}>{active ? <Square size={17} fill="currentColor" /> : <Mic size={18} />}</button>
      <button aria-label="Record meeting" title="Record meeting" disabled={active} onClick={() => void action('meeting')}><Circle size={17} /></button>
      <button aria-label="Open scratchpad" title="Scratchpad" onClick={() => void action('scratchpad')}><StickyNote size={18} /></button>
      <button aria-label="Open notebook" title="Open notebook" onClick={() => void action('notebook')}><BookOpen size={18} /></button>
    </div><span className="bar-status" role="status">{error || (capture.state === 'recording' ? `${capture.purpose === 'dictation' ? 'Dictating' : 'Recording'} · ${Math.floor(capture.elapsed / 60)}:${String(Math.floor(capture.elapsed % 60)).padStart(2, '0')}` : capture.state === 'idle' ? (capture.message?.startsWith('Copied to clipboard.') ? 'Copied to clipboard' : 'Dictate to clipboard') : capture.state === 'paused' ? 'Paused · open notebook' : capture.state === 'finishing' ? 'Finishing…' : 'Connecting…')}</span></div>
  </div>;
}
createRoot(document.getElementById('root')!).render(<Bar />);
