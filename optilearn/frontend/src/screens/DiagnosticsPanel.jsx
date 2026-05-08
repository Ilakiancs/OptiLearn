import { useQuery } from '@tanstack/react-query'
import { getHealth, getPerformanceDiagnostics } from '../api/client'

export default function DiagnosticsPanel() {
  const { data: health } = useQuery({
    queryKey: ['system-health-diagnostics'],
    queryFn: getHealth,
    refetchInterval: 10000,
  })
  const { data: diagnostics } = useQuery({
    queryKey: ['performance-diagnostics'],
    queryFn: () => getPerformanceDiagnostics(80),
    refetchInterval: 5000,
  })

  const lanes = diagnostics?.scheduler?.lanes || health?.scheduler?.lanes || {}
  const recent = diagnostics?.recent || []
  const jobs = diagnostics?.jobs?.recent || health?.jobs?.recent || []
  const summary = diagnostics?.summary || {}
  const readiness = [
    ['Ollama', health?.ollama_ok],
    ['Database', health?.db_ok],
    ['ASR', health?.speech?.ready],
    ['TTS', health?.tts?.ready],
    ['Embeddings', health?.embedding?.ready],
  ]

  return (
    <main style={{ minHeight: '100vh', background: 'var(--bg)', padding: '24px 16px', boxSizing: 'border-box' }}>
      <div style={{ maxWidth: 1080, margin: '0 auto', display: 'grid', gap: 18 }}>
        <section style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '1.32rem', color: 'var(--color-text)' }}>System Diagnostics</h1>
            <p style={{ margin: '5px 0 0', color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>
              Live lanes, cached artifacts, and offline asset readiness.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {readiness.map(([label, ok]) => (
              <span key={label} style={{
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: '7px 10px',
                background: ok ? 'rgba(45,160,110,0.12)' : 'rgba(239,159,39,0.14)',
                color: 'var(--color-text)',
                fontSize: '0.82rem',
                fontWeight: 700,
              }}>
                {label}: {ok ? 'Ready' : 'Check'}
              </span>
            ))}
          </div>
        </section>

        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          <MetricTile label="Recent AI Calls" value={summary.recent_count ?? 0} />
          <MetricTile label="Active Calls" value={summary.active_count ?? 0} />
          <MetricTile label="P50 Latency" value={summary.p50_latency_ms ? `${summary.p50_latency_ms} ms` : '--'} />
          <MetricTile label="P95 Latency" value={summary.p95_latency_ms ? `${summary.p95_latency_ms} ms` : '--'} />
        </section>

        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
          {Object.entries(lanes).map(([lane, data]) => (
            <div key={lane} style={panelStyle}>
              <h2 style={titleStyle}>{lane.replaceAll('_', ' ')}</h2>
              <div style={rowStyle}><span>Active</span><strong>{data.active ?? 0}/{data.limit ?? 1}</strong></div>
              <div style={rowStyle}><span>Completed</span><strong>{data.completed ?? 0}</strong></div>
              <div style={rowStyle}><span>Timeouts</span><strong>{data.timed_out ?? 0}</strong></div>
              <div style={rowStyle}><span>Timeout policy</span><strong>{data.timeout_seconds ?? '--'}s</strong></div>
            </div>
          ))}
        </section>

        <section style={panelStyle}>
          <h2 style={titleStyle}>Recent AI Events</h2>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
              <thead>
                <tr>
                  {['Feature', 'Lane', 'Cache', 'TTFE', 'Latency', 'Input', 'Output', 'Status'].map(h => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recent.slice(0, 18).map(event => (
                  <tr key={event.trace_id}>
                    <td style={tdStyle}>{event.feature}</td>
                    <td style={tdStyle}>{event.lane}</td>
                    <td style={tdStyle}>{event.cache_status}</td>
                    <td style={tdStyle}>{event.time_to_first_event_ms ?? '--'}</td>
                    <td style={tdStyle}>{event.total_latency_ms ?? '--'}</td>
                    <td style={tdStyle}>{event.input_size}</td>
                    <td style={tdStyle}>{event.output_size}</td>
                    <td style={tdStyle}>{event.status}</td>
                  </tr>
                ))}
                {recent.length === 0 && (
                  <tr><td style={{ ...tdStyle, textAlign: 'center' }} colSpan={8}>No AI telemetry yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section style={panelStyle}>
          <h2 style={titleStyle}>Background Jobs</h2>
          <div style={{ display: 'grid', gap: 8 }}>
            {jobs.slice(0, 12).map(job => (
              <div key={job.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'center', borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                <span style={{ color: 'var(--color-text)', fontWeight: 700 }}>{job.name}</span>
                <span style={{ color: 'var(--color-text-muted)', fontSize: '0.82rem' }}>{job.status} | {job.progress}%</span>
              </div>
            ))}
            {jobs.length === 0 && <span style={{ color: 'var(--color-text-muted)' }}>No background jobs tracked yet.</span>}
          </div>
        </section>
      </div>
    </main>
  )
}

function MetricTile({ label, value }) {
  return (
    <div style={panelStyle}>
      <div style={{ color: 'var(--color-text-muted)', fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ marginTop: 6, color: 'var(--color-text)', fontSize: '1.35rem', fontWeight: 800 }}>{value}</div>
    </div>
  )
}

const panelStyle = {
  border: '1px solid var(--border)',
  borderRadius: 8,
  background: 'var(--surface)',
  padding: 14,
  boxShadow: 'var(--shadow-soft)',
}

const titleStyle = { margin: '0 0 10px', color: 'var(--color-text)', fontSize: '1rem' }
const rowStyle = { display: 'flex', justifyContent: 'space-between', gap: 12, color: 'var(--color-text-muted)', fontSize: '0.86rem', padding: '5px 0' }
const thStyle = { textAlign: 'left', padding: '9px 8px', borderBottom: '1px solid var(--border)', color: 'var(--color-text-muted)', fontSize: '0.78rem' }
const tdStyle = { padding: '9px 8px', borderBottom: '1px solid var(--border)', color: 'var(--color-text)', fontSize: '0.82rem', verticalAlign: 'top' }
