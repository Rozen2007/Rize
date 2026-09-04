import { useEffect, useState } from 'react';

interface MetricCardProps {
  title: string;
  value: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  subtitle?: string;
  gradient?: 'primary' | 'success';
}

function useCountUp(end: number, duration: number = 1000) {
  const [value, setValue] = useState(0);

  useEffect(() => {
    let startTime: number | null = null;
    let startValue = value;
    
    // Initialize to 'end' immediately on first render if we want, but animating from 0 is nice for rolling text
    if (startValue === end) return;

    const animate = (currentTime: number) => {
      if (!startTime) startTime = currentTime;
      const progress = Math.min((currentTime - startTime) / duration, 1);
      
      const easeOutExpo = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
      setValue(startValue + (end - startValue) * easeOutExpo);

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        setValue(end);
      }
    };

    const frameId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [end, duration]);

  return value;
}

export function MetricCard({ title, value, prefix = '', suffix = '', decimals = 0, subtitle, gradient = 'primary' }: MetricCardProps) {
  const animatedValue = useCountUp(value, 1500);
  
  const displayValue = animatedValue.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });

  return (
    <div className="glass-panel animate-fade-in">
      <h3 style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>
        {title}
      </h3>
      <div className={`text-gradient-${gradient}`} style={{ fontSize: '2.5rem', fontWeight: 700, lineHeight: 1.2 }}>
        {prefix}{displayValue}{suffix}
      </div>
      {subtitle && (
        <div style={{ marginTop: '12px', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
          {subtitle}
        </div>
      )}
    </div>
  );
}
