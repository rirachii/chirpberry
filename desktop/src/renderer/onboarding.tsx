import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, CalendarDays, Check, FileText, Mic, Share2, Sparkles, X } from 'lucide-react';
import type { RuntimeSnapshot } from '../shared/api';
import type { CalendarSnapshot } from '../shared/calendar';
import type { OnboardingStep } from '../shared/onboarding';
import { DetectionSetting } from './meeting-detection';
import './onboarding.css';

const steps = ['welcome', 'speech', 'meetings', 'ready'] as const;
export function Onboarding({ runtime, replay, onChange, onClose, onCreate }: {
  runtime: RuntimeSnapshot; replay: boolean; onChange(value: RuntimeSnapshot): void; onClose(): void; onCreate(): Promise<void>
}) {
  const [step, setStep] = useState<Exclude<OnboardingStep, 'complete'>>(runtime.settings.onboardingStep === 'complete' ? 'welcome' : runtime.settings.onboardingStep);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [key, setKey] = useState('');
  const [accepted, setAccepted] = useState(runtime.settings.disclosureAccepted);
  const [calendar, setCalendar] = useState<CalendarSnapshot>({ connected: false, refreshing: false, events: [] });
  const [detectionChoice, setDetectionChoice] = useState<boolean>();
  const dialog = useRef<HTMLDialogElement>(null), heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  useEffect(() => { heading.current?.focus(); }, [step]);
  useEffect(() => {
    let live = true, changed = false;
    const off = window.chirpberry.onCalendar(value => { changed = true; if (live) setCalendar(value); });
    void window.chirpberry.calendarSnapshot().then(value => { if (live && !changed) setCalendar(value); }).catch(() => {});
    return () => { live = false; off(); };
  }, []);
  async function perform(action: () => Promise<unknown>) {
    setBusy(true); setMessage('');
    try { await action(); }
    catch (error) { setMessage(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : 'Setup could not be saved. Try again.'); }
    finally { setBusy(false); }
  }
  async function move(next: Exclude<OnboardingStep, 'complete'>, saveDisclosure = false) {
    if (!replay || saveDisclosure) onChange(await window.chirpberry.configureOnboarding({ ...(!replay ? { step: next } : {}), ...(saveDisclosure ? { disclosureAccepted: accepted } : {}) }));
    setKey(''); setStep(next);
  }
  async function finish(create = false) {
    if (!replay) onChange(await window.chirpberry.configureOnboarding({ step: 'complete' }));
    onClose(); if (create) await onCreate();
  }
  const index = steps.indexOf(step);
  const titles = { welcome: 'Welcome to Chirpberry.', speech: 'Give your notes a voice.', meetings: 'Make room for your meetings.', ready: 'Your first note starts here.' };
  return <dialog ref={dialog} className="onboarding-dialog" aria-labelledby="onboarding-title" onCancel={event => { event.preventDefault(); if (!busy) void perform(() => finish()); }}>
    <div className="onboarding-top"><span className="onboarding-brand"><img src="./chirpberry.png" alt="" />Chirpberry</span>
      <button className="icon-button" aria-label="Close quick start" disabled={busy} onClick={() => void perform(() => finish())}><X size={18} /></button></div>
    <div className="onboarding-body">
      <p className="onboarding-progress">{index + 1} of 4 · {['Your notebook', 'Speech, optional', 'Meetings, optional', 'Ready to write'][index]}</p>
      <h1 id="onboarding-title" ref={heading} tabIndex={-1}>{titles[step]}</h1>
      {step === 'welcome' && <>
        <p className="onboarding-lead">A place for your thoughts, the conversation, and what comes next.</p>
        <div className="onboarding-basics">
          <div><FileText /><section><h2>Start with your own words</h2><p>Write, organize, and search notes on this device. No account needed.</p></section></div>
          <div><Mic /><section><h2>Let speech join the page</h2><p>Add transcription and translation when you’re ready. You choose when to record.</p></section></div>
          <div><Sparkles /><section><h2>Keep the next steps</h2><p>Create a separate summary, then review what you share. Your original notes stay yours.</p></section></div>
        </div>
      </>}
      {step === 'speech' && <>
        <p className="onboarding-lead">Speech and summaries use your Valsea account and paid credits. You can keep using manual notes without one.</p>
        <form className="onboarding-key" onSubmit={event => { event.preventDefault(); void perform(async () => { await window.chirpberry.saveKey(key); setKey(''); onChange(await window.chirpberry.runtime()); setMessage('API key saved in protected storage.'); }); }}>
          {runtime.keySaved && <p className="onboarding-saved"><Check size={15} />An API key is saved in protected storage.</p>}
          <label>Valsea API key<input type="password" autoComplete="off" spellCheck={false} maxLength={4096} value={key} onChange={event => setKey(event.target.value)} placeholder={runtime.keySaved ? 'Enter a replacement key' : 'Paste your key here'} /></label>
          <button className="secondary" type="submit" disabled={busy || !key.trim() || !runtime.capabilities.protectedCredentials}>Save API key</button>
          {!runtime.capabilities.protectedCredentials && <p className="small muted">Protected key storage is unavailable here. Continue with notes and finish speech setup later.</p>}
        </form>
        <div className="onboarding-disclosure"><p>When you start recording, microphone audio—and system audio if selected—streams to Valsea. Summaries send that note and transcript; audio import sends the chosen file. Provider processing policies and usage costs apply.</p>
          <p>Tell participants before recording. Chirpberry saves final transcripts locally and does not save live audio. Stop, app close, or a capture failure ends recording.</p>
          <label className="check-label"><input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)} />I understand and agree to this cloud processing when I start these actions.</label>
        </div>
        <p className="small muted">Microphone permission is requested when you first record. System audio, translation, and shortcuts are configured in Settings. This guide never starts capture.</p>
      </>}
      {step === 'meetings' && <>
        <p className="onboarding-lead">See the next seven days from accounts already in Apple Calendar. No extra Google or Microsoft sign-in in Chirpberry.</p>
        <div className="onboarding-calendar"><CalendarDays size={22} />
          <div><h2>{calendar.connected ? 'Apple Calendar connected' : 'Connect Apple Calendar'}</h2><p>{calendar.connected ? 'Find your meetings in Upcoming. Open note and Join never start recording.' : 'Chirpberry only reads events. Allow Calendar access when macOS asks.'}</p>
            {!calendar.connected && <button className="secondary" disabled={busy || !runtime.capabilities.calendar} onClick={() => void perform(async () => { const value = await window.chirpberry.connectCalendar(); setCalendar(value); if (value.error) throw new Error(value.error); })}>Connect Apple Calendar</button>}
            {runtime.capabilities.platform === 'darwin' && <button className="text-button" disabled={busy} onClick={() => void perform(() => window.chirpberry.openCalendarApp())}>Open Calendar app</button>}
            {!runtime.capabilities.calendar && <p className="small muted">Calendar access is unavailable in this build or on this platform.</p>}
          </div>
        </div>
        <DetectionSetting checked={detectionChoice ?? runtime.settings.meetingDetectionEnabled} available={!!runtime.capabilities.meetingDetection} disabled={busy} error={runtime.detection.error} onChange={enabled => {
          setDetectionChoice(enabled); void perform(async () => { try { onChange(await window.chirpberry.setMeetingDetection(enabled)); } finally { setDetectionChoice(undefined); } });
        }} />
      </>}
      {step === 'ready' && <>
        <p className="onboarding-lead">Write a title and a few thoughts. Your edits save automatically.</p>
        <div className="onboarding-basics">
          <div><Mic /><section><h2>Record when you’re ready</h2><p>Choose Record meeting. Pause or Stop stays visible while you capture. The Transcript button shows the words as they arrive.</p></section></div>
          <div><Sparkles /><section><h2>Make sense of the conversation</h2><p>Use Summary for decisions and next steps. Ask meeting offers questions and response drafts with a separate OpenAI key and disclosure.</p></section></div>
          <div><Share2 /><section><h2>Review before sharing</h2><p>Share notes lets you choose the exact content to copy or export. Personal notes and transcript are opt-in.</p></section></div>
        </div>
        <p className="onboarding-tip">For quick dictation, hover the floating bar and choose its microphone. Enable Fn / Globe on Mac in Settings when you want a shortcut. It copies final words to your clipboard.</p>
        <p className="small muted">Revisit this guide from Settings → Quick start guide.</p>
      </>}
      {message && <p className="onboarding-message" role="status">{message}</p>}
    </div>
    <footer className="onboarding-footer"><div>{index > 0 && <button className="text-button" disabled={busy} onClick={() => void perform(() => move(steps[index - 1]))}><ArrowLeft size={14} />Back</button>}</div>
      <div><button className="text-button" disabled={busy} onClick={() => void perform(() => finish())}>{replay ? 'Back to notebook' : 'Set up later'}</button>
        <button className="primary" disabled={busy} onClick={() => void perform(() => step === 'ready' ? finish(true) : move(steps[index + 1], step === 'speech'))}>{step === 'welcome' ? 'Get started' : step === 'ready' ? 'Create a note' : 'Continue'}<ArrowRight size={15} /></button></div>
    </footer>
  </dialog>;
}
