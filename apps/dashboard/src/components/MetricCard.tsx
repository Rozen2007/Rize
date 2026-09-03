
interface MetricCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  gradient?: 'primary' | 'success';
}

export function MetricCard({ title, value, subtitle, gradient = 'primary' }: MetricCardProps) {
  return (
    <div className="glass-panel animate-fade-in">
      <h3 style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>
        {title}
      </h3>
      <div className={`text-gradient-${gradient}`} style={{ fontSize: '2.5rem', fontWeight: 700, lineHeight: 1.2 }}>
        {value}
      </div>
      {subtitle && (
        <div style={{ marginTop: '12px', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
          {subtitle}
        </div>
      )}
    </div>
  );
}
