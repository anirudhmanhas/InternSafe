import { useEffect, useState } from 'react';
import { api } from './api.js';

// Fill these in from docs/evaluation.md after your survey and before/after test.
const EVAL = {
  accuracy: '90.9% (20 of 22 test offers)',
  survey: '28 of 45 students reported receiving a suspicious offer. 15 personally knew someone who lost money or data.',
  beforeAfter: 'Manual check: ~12 mins (3/5 correct). InternSafe: < 10 secs (5/5 correct).',
};

function Bar({ label, value, max }) {
  return (
    <div className="bar"><span>{label}</span>
      <div><i style={{ width: (max ? (value / max) * 100 : 0) + '%' }} /></div><b>{value}</b></div>
  );
}

export default function Impact() {
  const [s, setS] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { api('/stats').then(setS).catch((e) => setErr(e.message)); }, []);

  if (err) return <p className="error" role="alert">{err}</p>;
  if (!s) return <p>Loading…</p>;
  const topMax = s.topFlags[0]?.count || 0;
  return (
    <>
      <h1>Impact</h1>
      <div className="grid stats">
        <div><b>{s.totalChecked}</b><span>offers checked</span></div>
        <div><b>{s.totalReported}</b><span>scams reported</span></div>
        <div><b>{Math.round(s.highRiskShare * 100)}%</b><span>rated high risk</span></div>
      </div>
      <h2>Most common red flags</h2>
      {s.topFlags.length ? s.topFlags.map((f) => <Bar key={f.id} label={f.name} value={f.count} max={topMax} />)
        : <p>No checks yet. Check an offer and it will show up here.</p>}
      <h2>Evaluation</h2>
      <dl>
        <dt>Detector accuracy on test offers</dt><dd>{EVAL.accuracy}</dd>
        <dt>Student survey</dt><dd>{EVAL.survey}</dd>
        <dt>Today's method vs InternSafe</dt><dd>{EVAL.beforeAfter}</dd>
      </dl>
    </>
  );
}
