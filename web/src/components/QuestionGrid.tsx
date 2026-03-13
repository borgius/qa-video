import { YamlCard } from '../types';

interface QuestionGridProps {
  questions: YamlCard[];
  cardOrder: number[];
  title: string;
  tileZoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onSelectCard: (orderIdx: number) => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}

const toolbarBtnStyle: React.CSSProperties = {
  background: 'rgba(255, 255, 255, 0.06)',
  border: '1px solid rgba(255, 255, 255, 0.1)',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  padding: '6px 10px',
  borderRadius: '6px',
  fontSize: '13px',
  lineHeight: 1,
  display: 'flex',
  alignItems: 'center',
  gap: '4px',
};

export function QuestionGrid({
  questions,
  cardOrder,
  title,
  tileZoom,
  onZoomIn,
  onZoomOut,
  onSelectCard,
  sidebarOpen,
  onToggleSidebar,
}: QuestionGridProps) {
  // Base tile width 180px scaled by zoom (range 0.5–3)
  const tileWidth = Math.round(180 * tileZoom);
  const fontSize = Math.round(12 * tileZoom);
  const numFontSize = Math.round(11 * tileZoom);

  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      background: 'var(--bg-primary)',
    }}>
      {/* Header bar */}
      <div style={{
        padding: '10px 16px',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        flexShrink: 0,
      }}>
        {!sidebarOpen && (
          <button type="button" onClick={onToggleSidebar} title="Show sidebar (B)" style={toolbarBtnStyle}>
            &#x203a;
          </button>
        )}
        <span style={{
          fontSize: '14px',
          fontWeight: 600,
          color: 'var(--text-primary)',
        }}>
          {title}
        </span>
        <span style={{
          fontSize: '12px',
          color: 'var(--text-secondary)',
        }}>
          — {cardOrder.length} questions
        </span>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: '6px', alignItems: 'center' }}>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginRight: '4px' }}>Zoom</span>
          <button
            type="button"
            onClick={onZoomOut}
            title="Smaller tiles"
            style={{ ...toolbarBtnStyle, fontWeight: 700, fontSize: '16px', padding: '4px 10px' }}
          >
            −
          </button>
          <button
            type="button"
            onClick={onZoomIn}
            title="Larger tiles"
            style={{ ...toolbarBtnStyle, fontWeight: 700, fontSize: '16px', padding: '4px 10px' }}
          >
            +
          </button>
        </div>
      </div>

      {/* Tile grid */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '16px',
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fill, minmax(${tileWidth}px, 1fr))`,
        gap: '10px',
        alignContent: 'start',
      }}>
        {cardOrder.map((realIdx, orderIdx) => {
          const q = questions[realIdx];
          if (!q) return null;

          return (
            <button
              key={`${orderIdx}-${realIdx}`}
              type="button"
              onClick={() => onSelectCard(orderIdx)}
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: '8px',
                padding: `${Math.round(10 * tileZoom)}px`,
                textAlign: 'left',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                transition: 'background 0.15s, border-color 0.15s',
                minHeight: `${Math.round(80 * tileZoom)}px`,
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = 'rgba(233, 69, 96, 0.12)';
                e.currentTarget.style.borderColor = 'rgba(233, 69, 96, 0.3)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)';
              }}
            >
              {/* Card number badge */}
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                minWidth: `${Math.round(20 * tileZoom)}px`,
                height: `${Math.round(20 * tileZoom)}px`,
                borderRadius: '4px',
                background: 'rgba(255,255,255,0.08)',
                color: 'var(--text-secondary)',
                fontSize: `${numFontSize}px`,
                fontWeight: 600,
                alignSelf: 'flex-start',
                padding: '0 4px',
              }}>
                {realIdx + 1}
              </span>
              {/* Question text */}
              <span style={{
                fontSize: `${fontSize}px`,
                lineHeight: '1.45',
                color: 'var(--text-primary)',
                overflow: 'hidden',
                display: '-webkit-box',
                WebkitLineClamp: Math.round(4 * tileZoom),
                WebkitBoxOrient: 'vertical',
              }}>
                {q.question}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
