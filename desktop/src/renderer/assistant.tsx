import React, { useEffect, useRef, useState } from 'react';
import { ArrowUp, Copy, MessageCircle, Square, X } from 'lucide-react';
import type { RuntimeSnapshot } from '../shared/api';
import type { AskRequest, AssistantAnswer, MeetingSource } from '../shared/assistant';

export function AssistantPanel({ meetingId, runtime, onSettings, onClose }: { meetingId: string; runtime?: RuntimeSnapshot; onSettings(): void; onClose(): void }) {
  const [answers, setAnswers] = useState<AssistantAnswer[]>([]), [question, setQuestion] = useState('');
  const [message, setMessage] = useState(''), [submitting, setSubmitting] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [source, setSource] = useState<MeetingSource>(), input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    let live = true, revision = 0;
    const off = window.chirpberry.onAssistant(answer => {
      if (answer.meetingId !== meetingId) return;
      revision++;
      setAnswers(previous => previous.some(value => value.requestId === answer.requestId) ? previous.map(value => value.requestId === answer.requestId ? answer : value) : [...previous.slice(-7), answer]);
    });
    void window.chirpberry.assistantThread(meetingId).then(values => { if (live && !revision) setAnswers(values); }).catch(() => { if (live) setMessage('The meeting conversation could not be loaded.'); });
    input.current?.focus(); return () => { live = false; off(); };
  }, [meetingId]);
  const pending = answers.find(answer => answer.state === 'thinking' || answer.state === 'streaming');
  const configured = runtime?.assistantKeySaved && runtime.settings.assistantDisclosureAccepted;
  async function perform(action: () => Promise<unknown>, success = '') {
    setMessage(''); try { await action(); setMessage(success); } catch (error) { setMessage(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : 'This action could not be completed.'); }
  }
  async function ask(mode: AskRequest['mode']) {
    if (submitting || pending) return;
    setSubmitting(true); setSource(undefined);
    await perform(() => window.chirpberry.ask({ meetingId, requestId: crypto.randomUUID().toUpperCase(), mode, question }));
    setSubmitting(false);
  }
  function answerText(answer: AssistantAnswer) {
    return answer.text.split(/(\[[NTS]\d+\])/g).map((part, index) => {
      const found = answer.sources.find(source => `[${source.id}]` === part);
      return found ? <button className="source-link" key={index} title={found.label} aria-label={`View source ${found.id}`} onClick={() => setSource(found)}>{part}</button> : /^\[[NTS]\d+\]$/.test(part) ? '[source unavailable]' : part;
    });
  }
  return <aside className="assistant-panel" aria-label="Meeting assistant">
    <header><h2><MessageCircle size={16} />Ask meeting</h2><button className="icon-button" aria-label="Close meeting assistant" onClick={onClose}><X size={16} /></button></header>
    <div className="assistant-body">
      <p className="assistant-context">This meeting only · notes and saved speech</p>
      {!configured ? <div className="assistant-setup"><h3>A second pair of ears.</h3><p>Ask about this meeting or get a draft of what to say next. Connect your OpenAI account to begin.</p><button className="secondary" onClick={onSettings}>Set up meeting AI</button></div> : <div className="assistant-prompts">
        {([['catch-up', 'Catch me up'], ['questions', 'Suggest questions'], ['respond', 'Help me respond']] as const).map(([mode, label]) => <button key={mode} className="prompt-button" disabled={submitting || !!pending} onClick={() => void ask(mode)}>{label}</button>)}
      </div>}
      <div className="assistant-thread" role="log" aria-label="Meeting conversation" aria-live="polite" aria-relevant="additions">
        {answers.map(answer => <article className="assistant-answer" key={answer.requestId} aria-busy={answer.state === 'thinking' || answer.state === 'streaming'}>
          <h3>{answer.mode === 'ask' ? answer.question : answer.mode === 'respond' ? 'Help me respond' : answer.mode === 'questions' ? 'Suggest questions' : 'Catch me up'}</h3><p className="answer-label">{answer.mode === 'respond' ? 'Possible response' : answer.mode === 'questions' ? 'Suggested questions' : 'AI answer'}{answer.state === 'thinking' ? ' · Thinking…' : answer.state === 'streaming' ? ' · Writing…' : ''}</p>
          <div className="answer-text">{answerText(answer)}</div>
          {answer.message && <p className="small answer-notice" role={answer.state === 'error' ? 'alert' : undefined}>{answer.message}</p>}
          <p className="answer-time">Context as of {new Date(answer.contextAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' })}{answer.excerpted ? ' · Selected excerpts' : ''}</p>
          {drafts[answer.requestId] !== undefined && <label className="response-draft">Your response draft<textarea value={drafts[answer.requestId]} maxLength={16000} rows={4} onChange={event => setDrafts(previous => ({ ...previous, [answer.requestId]: event.target.value }))} /></label>}
          {answer.state === 'complete' && <div className="answer-actions"><button className="text-button" disabled={drafts[answer.requestId] !== undefined && !drafts[answer.requestId].trim()} onClick={() => void perform(() => window.chirpberry.copyAnswer(meetingId, answer.requestId, drafts[answer.requestId]), 'Answer copied.')}><Copy size={12} />{drafts[answer.requestId] === undefined ? 'Copy answer' : 'Copy draft'}</button>
            {answer.mode === 'respond' && drafts[answer.requestId] === undefined && <button className="text-button" onClick={() => setDrafts(previous => ({ ...previous, [answer.requestId]: answer.text }))}>Edit response</button>}</div>}
        </article>)}
      </div>
      {source && <section className="source-preview" aria-label="Source excerpt"><div><strong>{source.id} · {source.label}</strong><button className="icon-button" aria-label="Close source excerpt" onClick={() => setSource(undefined)}><X size={13} /></button></div><blockquote>{source.text}</blockquote><p>Excerpt captured when this question was asked.</p></section>}
      {message && <p className="inline-error" role="status">{message}</p>}
    </div>
    <form className="assistant-composer" onSubmit={event => { event.preventDefault(); void ask('ask'); }}>
      <label className="sr-only" htmlFor="meeting-question">Ask about this meeting</label>
      <textarea id="meeting-question" ref={input} value={question} maxLength={2000} rows={2} disabled={!configured} placeholder="Ask about this meeting…" onChange={event => setQuestion(event.target.value)} onKeyDown={event => {
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (question.trim() && configured) void ask('ask'); }
      }} />
      <div>{pending ? <button type="button" className="secondary" onClick={() => void perform(() => window.chirpberry.stopAnswer(pending.requestId))}><Square size={12} />Stop answer</button> :
        <button type="submit" className="primary" disabled={!configured || submitting || !question.trim()}><ArrowUp size={14} />Ask</button>}
        {answers.length > 0 && <button type="button" className="text-button" onClick={() => void perform(async () => { await window.chirpberry.clearAssistant(meetingId); setAnswers([]); setSource(undefined); })}>Clear chat</button>}
      </div><p>AI can make mistakes. Review sources and suggested wording. Chat clears when Chirpberry quits.</p>
    </form>
  </aside>;
}
