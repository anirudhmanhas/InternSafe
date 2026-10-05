import { useState } from 'react';
import { api } from './api.js';

const LABEL = { High: 'High risk', Medium: 'Medium risk', Low: 'Low risk' };

// Cut the text into plain and highlighted pieces using the match positions.
function pieces(text, flags) {
  const ranges = [];
  flags.forEach((f) => f.matches.forEach((m) => m.start >= 0 && ranges.push({ s: m.start, e: m.end, name: f.name })));
  ranges.sort((a, b) => a.s - b.s);
  const out = [];
  let pos = 0;
  for (const r of ranges) {
    if (r.e <= pos) continue;
    const s = Math.max(r.s, pos);
    if (s > pos) out.push({ t: text.slice(pos, s) });
    out.push({ t: text.slice(s, r.e), name: r.name });
    pos = r.e;
  }
  if (pos < text.length) out.push({ t: text.slice(pos) });
  return out;
}

export default function Checker() {
  const [form, setForm] = useState({ text: '', link: '', company: '', sender: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [report, setReport] = useState('idle');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function check(e) {
    e.preventDefault();
    setBusy(true); setError(''); setReport('idle');
    try { setResult(await api('/analyze', form)); }
    catch (err) { setResult(null); setError(err.message); }
    setBusy(false);
  }

  async function sendReport() {
    setReport('sending');
    try {
      await api('/report', { snippet: result.analyzedText, flags: result.flags.map((f) => f.id), level: result.level });
      setReport('done');
    } catch (err) { setReport(err.message); }
  }

  return (
    <>
      <h1>Got an internship offer? Check it before you pay or reply.</h1>
      <p className="lead">Paste the message or email. You get a risk level, the exact phrases that look suspicious, and how to verify the offer.</p>

      <form onSubmit={check}>
        <label htmlFor="text">Offer text</label>
        <textarea id="text" rows="7" value={form.text} onChange={set('text')} maxLength="5000"
          placeholder="Paste the internship or job offer here" />
        <p className="note">Do not paste your own name, phone number, Aadhaar or bank details.</p>
        <div className="grid">
          <div><label htmlFor="company">Company name (optional)</label><input id="company" value={form.company} onChange={set('company')} /></div>
          <div><label htmlFor="sender">Sender email or phone (optional)</label><input id="sender" value={form.sender} onChange={set('sender')} /></div>
          <div><label htmlFor="link">Link in the offer (optional)</label><input id="link" value={form.link} onChange={set('link')} /></div>
        </div>
        <button type="submit" disabled={busy}>{busy ? 'Checking…' : 'Check this offer'}</button>
      </form>

      {error && <p className="error" role="alert">{error}</p>}

      {result && (
        <section className="result" aria-live="polite">
          <div className={'badge ' + result.level}>
            <strong>{LABEL[result.level]}</strong><span>Score {result.score} out of 100</span>
          </div>
          {result.warnings.map((w) => <p key={w} className="note">{w}</p>)}

          <h2>Your offer, with suspicious phrases marked</h2>
          <p className="text">{pieces(result.analyzedText, result.flags).map((p, i) =>
            p.name ? <mark key={i} title={p.name}>{p.t}</mark> : <span key={i}>{p.t}</span>)}</p>

          <h2>{result.flags.length ? 'Why it looks risky' : 'No red flags found'}</h2>
          {result.flags.map((f) => (
            <article key={f.id} className="flag">
              <h3>{f.name}</h3>
              <p>{f.explanation}</p>
              <p className="found">Found: {f.matches.map((m) => m.reason ? m.phrase + ' (' + m.reason + ')' : m.phrase).join(' | ')}</p>
            </article>
          ))}

          <h2>How to verify this offer</h2>
          <ul>{result.checklist.map((c) => <li key={c}>{c}</li>)}</ul>

          {report === 'done'
            ? <p className="ok">Report saved without personal details. Thank you.</p>
            : <button className="secondary" onClick={sendReport} disabled={report === 'sending'}>
                {report === 'sending' ? 'Sending…' : 'Report this scam'}</button>}
          {report !== 'idle' && report !== 'done' && report !== 'sending' && <p className="error" role="alert">{report}</p>}
        </section>
      )}
    </>
  );
}
