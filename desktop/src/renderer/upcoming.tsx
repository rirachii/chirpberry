import React, { useEffect, useState } from 'react';
import { CalendarDays, ExternalLink, RefreshCw } from 'lucide-react';
import type { RuntimeSnapshot } from '../shared/api';
import type { Meeting } from '../shared/meeting';
import { eventTiming, type CalendarSnapshot } from '../shared/calendar';

export function Upcoming({ runtime, onOpen }: { runtime?: RuntimeSnapshot; onOpen(meeting: Meeting): void }) {
  const [snapshot, setSnapshot] = useState<CalendarSnapshot>({ connected: false, refreshing: false, events: [] });
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [now, setNow] = useState(Date.now());
  useEffect(() => {
    let live = true, revision = 0;
    const off = window.chirpberry.onCalendar(value => { revision++; if (live) setSnapshot(value); });
    void window.chirpberry.calendarSnapshot().then(value => { if (live && !revision) setSnapshot(value); }).catch(() => { if (live) setMessage('The calendar connection could not be loaded.'); });
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => { live = false; off(); clearInterval(timer); };
  }, []);
  async function perform(action: () => Promise<unknown>) {
    setBusy(true); setMessage('');
    try { await action(); } catch (error) { setMessage(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : 'This calendar action could not be completed.'); }
    finally { setBusy(false); }
  }
  const events = snapshot.events.filter(event => Date.parse(event.end) > now);
  return <section className="upcoming-view" aria-label="Upcoming meetings">
    <div className="upcoming-heading"><div><p className="eyebrow">YOUR WEEK</p><h1>Upcoming</h1></div>
      {snapshot.connected && <button className="secondary" disabled={busy || snapshot.refreshing} onClick={() => void perform(async () => setSnapshot(await window.chirpberry.refreshCalendar()))}><RefreshCw size={14} />{snapshot.refreshing ? 'Refreshing…' : 'Refresh'}</button>}
    </div>
    {!snapshot.connected ? <div className="calendar-connect"><CalendarDays size={30} strokeWidth={1.4} /><h2>A note for every meeting.</h2>
      <p>Connect calendars already added to this Mac to see the next seven days. Google, iCloud, and Exchange calendars can connect through macOS Calendar.</p>
      <p className="small muted">Chirpberry reads event details and refreshes them while open. Opening a note or a meeting link leaves recording off until you choose Record meeting.</p>
      <button className="primary" disabled={busy || snapshot.refreshing || !runtime?.capabilities.calendar} onClick={() => void perform(async () => setSnapshot(await window.chirpberry.connectCalendar()))}>{snapshot.refreshing ? 'Connecting…' : 'Connect calendars'}</button>
      {runtime && !runtime.capabilities.calendar && <p className="small">Calendar connection is unavailable in this build or on this platform. Notes and recording remain available.</p>}
    </div> : <>
      <p className="upcoming-description">Open a note to prepare. Join the call when you’re ready.</p>
      {snapshot.refreshedAt && <p className="small muted">Updated {new Date(snapshot.refreshedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}{snapshot.error ? ' · Showing the last available schedule' : ''}</p>}
      {events.length === 0 && !snapshot.refreshing && <div className="calendar-empty"><CalendarDays size={26} /><h2>Your next seven days are clear.</h2><p>New events will appear when your connected calendars refresh.</p></div>}
      <div className="upcoming-events">{events.map(event => <article className="upcoming-event" key={event.id}>
        <div className="event-date"><span>{new Date(event.start).toLocaleDateString(undefined, { month: 'short' })}</span><strong>{new Date(event.start).getDate()}</strong></div>
        <div className="event-description"><h2>{event.title}</h2><p>{new Date(event.start).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}–{new Date(event.end).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}{event.calendar && ` · ${event.calendar}`}</p><span className="event-timing">{eventTiming(event, now)}</span></div>
        <div className="event-actions"><button className="secondary" disabled={busy} onClick={() => void perform(async () => onOpen(await window.chirpberry.prepareEvent(event)))}>Open note</button>
          {event.joinURL && <button className="text-button" title={event.joinURL} disabled={busy} onClick={() => void perform(() => window.chirpberry.joinEvent(event.id))}><ExternalLink size={13} />Join</button>}</div>
      </article>)}</div>
      <button className="text-button disconnect-calendar" disabled={busy} onClick={() => void perform(async () => { await window.chirpberry.disconnectCalendar(); setSnapshot(await window.chirpberry.calendarSnapshot()); })}>Disconnect calendars</button>
    </>}
    {(snapshot.error || message) && <p className="inline-error" role="alert">{message || snapshot.error}</p>}
  </section>;
}
