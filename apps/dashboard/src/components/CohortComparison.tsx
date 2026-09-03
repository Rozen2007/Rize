
interface GroupData {
  totalAttempts: number;
  recoveries: number;
  recoveryRate: number;
}

interface CohortComparisonProps {
  cohortKey: string;
  control: GroupData;
  treatment: GroupData;
}

export function CohortComparison({ cohortKey, control, treatment }: CohortComparisonProps) {
  const formatRate = (rate: number) => `${(rate * 100).toFixed(1)}%`;
  
  const getBarColor = (isTreatment: boolean) => 
    isTreatment ? 'linear-gradient(90deg, #8A2BE2, #fa71cd)' : '#333';

  const formatCohortTags = (key: string) => key.split(':').map(p => p.replace(/_/g, ' ').toUpperCase());

  return (
    <div className="glass-panel animate-fade-in" style={{ animationDelay: '0.1s' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '24px' }}>
        <span style={{ fontSize: '1.25rem', fontWeight: 600, color: 'white' }}>Segment:</span>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {formatCohortTags(cohortKey).map((tag, i) => (
            <span key={i} style={{
              background: 'rgba(255,255,255,0.1)',
              padding: '4px 10px',
              borderRadius: '9999px',
              fontSize: '0.75rem',
              fontWeight: 600,
              color: '#d1d5db'
            }}>
              {tag}
            </span>
          ))}
        </div>
      </div>
      
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {/* Control Row */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Control (No AI)</span>
            <strong>{formatRate(control.recoveryRate)}</strong>
          </div>
          <div style={{ width: '100%', height: '12px', background: 'var(--glass-bg)', borderRadius: '6px', overflow: 'hidden' }}>
            <div 
              style={{ 
                width: `${Math.max(control.recoveryRate * 100, 2)}%`, 
                height: '100%', 
                background: getBarColor(false),
                transition: 'width 1s ease-out'
              }} 
            />
          </div>
          <div style={{ marginTop: '6px', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            {control.recoveries} / {control.totalAttempts} recovered
          </div>
        </div>

        {/* Treatment Row */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ color: '#fa71cd' }}>Treatment (RIZE Engine)</span>
            <strong className="text-gradient-primary">{formatRate(treatment.recoveryRate)}</strong>
          </div>
          <div style={{ width: '100%', height: '12px', background: 'var(--glass-bg)', borderRadius: '6px', overflow: 'hidden' }}>
            <div 
              style={{ 
                width: `${Math.max(treatment.recoveryRate * 100, 2)}%`, 
                height: '100%', 
                background: getBarColor(true),
                transition: 'width 1s ease-out',
                boxShadow: '0 0 10px var(--primary-glow)'
              }} 
            />
          </div>
          <div style={{ marginTop: '6px', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            {treatment.recoveries} / {treatment.totalAttempts} recovered
          </div>
        </div>
      </div>
    </div>
  );
}
