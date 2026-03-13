import type { AppSettings } from '../types';

interface SettingsPanelProps {
  settings: AppSettings;
  onUpdate: (updates: Partial<AppSettings>) => void;
}

const fmtBtn = (active: boolean): React.CSSProperties => ({
  flex: 1,
  padding: '7px 10px',
  borderRadius: '6px',
  background: active ? 'var(--accent)' : 'rgba(255,255,255,0.06)',
  border: `1px solid ${active ? 'var(--accent)' : 'rgba(255,255,255,0.1)'}`,
  color: active ? '#fff' : 'var(--text-secondary)',
  fontSize: '12px',
  fontWeight: active ? 600 : 400,
  cursor: 'pointer',
  transition: 'all 0.15s',
});

export function SettingsPanel({ settings, onUpdate }: SettingsPanelProps) {
  return (
    <div style={{
      padding: '12px 16px 14px',
      borderTop: '1px solid var(--sidebar-border)',
      background: 'rgba(0,0,0,0.15)',
    }}>
      <div style={{
        fontSize: '10px',
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '1px',
        color: 'var(--text-muted)',
        marginBottom: '10px',
      }}>
        Video Format
      </div>

      {/* Format toggle */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: settings.format === 'shorts' ? '10px' : '0' }}>
        <button
          type="button"
          style={fmtBtn(settings.format === 'full')}
          onClick={() => onUpdate({ format: 'full' })}
        >
          📺 Full Video
        </button>
        <button
          type="button"
          style={fmtBtn(settings.format === 'shorts')}
          onClick={() => onUpdate({ format: 'shorts' })}
        >
          📱 Shorts
        </button>
      </div>

      {/* Questions per short — only for shorts mode */}
      {settings.format === 'shorts' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <label
              htmlFor="questions-per-short"
              style={{ fontSize: '12px', color: 'var(--text-secondary)', flex: 1 }}
            >
              Questions per short
            </label>
            <input
              id="questions-per-short"
              type="number"
              min={1}
              max={20}
              value={settings.questionsPerShort}
              onChange={e => {
                const v = Math.max(1, Math.min(20, parseInt(e.target.value, 10) || 1));
                onUpdate({ questionsPerShort: v });
              }}
              style={{
                width: '56px',
                padding: '4px 8px',
                borderRadius: '6px',
                background: 'rgba(255,255,255,0.07)',
                border: '1px solid rgba(255,255,255,0.15)',
                color: 'var(--text-primary)',
                fontSize: '13px',
                fontFamily: 'inherit',
                textAlign: 'center',
              }}
            />
          </div>
          <div style={{
            padding: '7px 10px',
            borderRadius: '6px',
            background: 'rgba(233,69,96,0.08)',
            border: '1px solid rgba(233,69,96,0.2)',
            fontSize: '11px',
            color: 'var(--text-secondary)',
            lineHeight: 1.55,
          }}>
            9:16 vertical · YouTube Shorts format<br />
            <span style={{ color: 'var(--text-muted)' }}>
              CLI: <code style={{ color: 'var(--accent)', fontFamily: 'monospace', fontSize: '10px' }}>
                --format shorts --questions-per-short {settings.questionsPerShort}
              </code>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
