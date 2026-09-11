import React, { useEffect, useRef, useState } from 'react';
import { Copy, Download, X } from 'lucide-react';
import type { ShareOptions, SharePreview } from '../shared/share';

export function ShareDialog({ meetingId, onClose }: { meetingId: string; onClose(): void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [options, setOptions] = useState<ShareOptions>({ summary: true, actions: true, notes: false, transcript: false });
  const [preview, setPreview] = useState<SharePreview>(), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  useEffect(() => { const focus = document.activeElement as HTMLElement; dialog.current?.showModal(); return () => { dialog.current?.close(); focus?.focus(); }; }, []);
  useEffect(() => {
    let live = true; setLoading(true); setPreview(undefined); setMessage('');
    void window.chirpberry.previewShare(meetingId, options).then(value => { if (live) setPreview(value); }).catch(error => { if (live) setMessage(error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [meetingId, options]);
  async function deliver(method: 'copy' | 'export') {
    if (!preview || loading || busy) return;
    setBusy(true); setMessage('');
    try { if (await window.chirpberry.deliverShare(preview.token, method)) setMessage(method === 'copy' ? 'Reviewed notes copied. Ready to paste and send.' : 'Reviewed notes exported.'); }
    catch (error) { setMessage(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : 'Sharing could not be completed.'); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="share-dialog" aria-labelledby="share-title" onClose={onClose}>
    <div className="dialog-header"><h2 id="share-title">Share notes</h2><button className="icon-button" aria-label="Close sharing" onClick={onClose}><X size={18} /></button></div>
    <p>Choose what to include, then review the exact copy you’ll send.</p>
    <fieldset className="share-options"><legend>Include in this copy</legend>{([['summary', 'Summary'], ['actions', 'Action items'], ['notes', 'My notes'], ['transcript', 'Transcript']] as const).map(([field, label]) =>
      <label key={field}><input type="checkbox" checked={options[field]} disabled={busy} onChange={event => setOptions(previous => ({ ...previous, [field]: event.target.checked }))} />{label}</label>)}</fieldset>
    <div className="share-preview" aria-label="Share preview" aria-busy={loading}>{loading ? <p>Updating preview…</p> : preview?.content ? <pre>{preview.content}</pre> : <p>Select a section with content. Add a summary or include your notes.</p>}</div>
    <p className="small muted">This is a snapshot. AI chats stay private. Notes are sent only after you paste or attach this copy in your chosen app.</p>
    <div className="share-actions"><button className="primary" disabled={loading || busy || !preview?.content} onClick={() => void deliver('copy')}><Copy size={14} />Copy reviewed notes</button><button className="secondary" disabled={loading || busy || !preview?.content} onClick={() => void deliver('export')}><Download size={14} />Export Markdown</button><button className="text-button" disabled={loading || busy} onClick={() => setOptions({ ...options })}>Refresh preview</button></div>
    {message && <p role="status" className="share-result">{message}</p>}
  </dialog>;
}
