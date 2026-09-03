import { useEffect, useState } from 'react';
import { MetricCard } from './components/MetricCard';
import { CohortComparison } from './components/CohortComparison';
import { IncidentFeed } from './components/IncidentFeed';
import './index.css';

interface MetricsData {
  cohortKey: string;
  control: {
    totalAttempts: number;
    recoveries: number;
    recoveryRate: number;
  };
  treatment: {
    totalAttempts: number;
    recoveries: number;
    recoveryRate: number;
  };
  incremental_recovery_rate: number;
  estimated_incremental_gmv: number;
}

const cohorts = ['desktop:PRICE_FRICTION:card', 'mobile:PRICE_FRICTION:upi'];

function App() {
  const [data, setData] = useState<Record<string, MetricsData>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchAllMetrics = async () => {
      try {
        const results: Record<string, MetricsData> = {};
        for (const cohort of cohorts) {
          const res = await fetch(`/api/metrics?cohortKey=${cohort}`);
          if (!res.ok) throw new Error(`Failed to fetch ${cohort}`);
          const json = await res.json();
          results[cohort] = json;
        }
        setData(results);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchAllMetrics();
  }, []);

  if (loading) {
    return (
      <div className="container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <h2 className="text-gradient animate-fade-in">Loading RIZE Engine Data...</h2>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <div className="glass-panel" style={{ borderColor: 'rgba(255,50,50,0.3)' }}>
          <h2 style={{ color: '#ff4444' }}>Error Fetching Data</h2>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  // Aggregate totals
  let totalGmv = 0;
  let avgIncrementalRate = 0;
  let count = 0;

  Object.values(data).forEach((cohortData) => {
    totalGmv += cohortData.estimated_incremental_gmv;
    avgIncrementalRate += cohortData.incremental_recovery_rate;
    count++;
  });
  
  if (count > 0) avgIncrementalRate /= count;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Top Navbar */}
      <nav style={{
        padding: '16px 32px',
        background: 'rgba(0,0,0,0.5)',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        backdropFilter: 'blur(10px)',
        position: 'sticky',
        top: 0,
        zIndex: 100
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ 
            width: '32px', height: '32px', 
            background: 'linear-gradient(135deg, #8A2BE2, #fa71cd)', 
            borderRadius: '8px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 'bold', fontSize: '1.2rem', color: 'white'
          }}>R</div>
          <span style={{ fontSize: '1.25rem', fontWeight: 700, letterSpacing: '0.05em' }}>RIZE</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(255,255,255,0.05)', padding: '6px 16px', borderRadius: '9999px', border: '1px solid rgba(255,255,255,0.1)' }}>
          <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10b981', boxShadow: '0 0 10px #10b981', animation: 'pulse 2s infinite' }} />
          <span style={{ fontSize: '0.875rem', color: '#d1d5db', fontWeight: 600 }}>Engine Active</span>
        </div>
      </nav>

      <div className="container" style={{ flex: 1, padding: '48px 24px' }}>
        {/* Glowing Hero Background Effect */}
        <div style={{
          position: 'absolute',
          top: '0',
          left: '50%',
          transform: 'translateX(-50%)',
          width: '100vw',
          height: '500px',
          background: 'radial-gradient(circle at center, rgba(138,43,226,0.15) 0%, transparent 60%)',
          zIndex: -1,
          pointerEvents: 'none'
        }} />

        <header style={{ marginBottom: '64px', textAlign: 'center' }} className="animate-fade-in">
          <div style={{
            display: 'inline-block',
            padding: '6px 16px',
            background: 'rgba(138,43,226,0.1)',
            border: '1px solid rgba(138,43,226,0.3)',
            borderRadius: '9999px',
            color: '#fa71cd',
            fontSize: '0.875rem',
            fontWeight: 600,
            marginBottom: '24px',
            letterSpacing: '0.05em'
          }}>
            AUTONOMOUS REVENUE RECOVERY
          </div>
          <h1 className="text-gradient" style={{ fontSize: '4rem', marginBottom: '24px', lineHeight: 1.1, letterSpacing: '-0.02em' }}>
            Command Center
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '1.25rem', maxWidth: '600px', margin: '0 auto', lineHeight: 1.6 }}>
            Monitor real-time incremental GMV lift, cohort performance, and automated AI interventions across your payment flows.
          </p>
        </header>

        <div className="grid grid-cols-3" style={{ marginBottom: '64px', gap: '24px' }}>
          <MetricCard 
            title="Total Incremental Lift" 
            value={`+${(avgIncrementalRate * 100).toFixed(1)}%`} 
            subtitle="Avg. recovery rate vs control"
            gradient="primary"
          />
          <MetricCard 
            title="Estimated GMV Recovered" 
            value={`$${totalGmv.toLocaleString()}`} 
            subtitle="Revenue saved automatically"
            gradient="success"
          />
          <MetricCard 
            title="Active Interventions" 
            value="60" 
            subtitle="Incidents resolved today"
            gradient="primary"
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
          <h2 className="text-gradient animate-fade-in" style={{ fontSize: '2rem', margin: 0 }}>
            Cohort Performance
          </h2>
          <div style={{ fontSize: '0.875rem', color: '#9ca3af' }}>Live Bayesian Updates</div>
        </div>
        
        <div className="grid grid-cols-2" style={{ marginBottom: '64px' }}>
          {cohorts.map((cohort) => {
            const cohortData = data[cohort];
            if (!cohortData) return null;
            return (
              <CohortComparison 
                key={cohort}
                cohortKey={cohortData.cohortKey}
                control={cohortData.control}
                treatment={cohortData.treatment}
              />
            );
          })}
        </div>
        
        <IncidentFeed />
      </div>

      <style>{`
        @keyframes pulse {
          0% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(1.2); }
          100% { opacity: 1; transform: scale(1); }
        }
        .grid-cols-3 {
          display: grid;
          grid-template-columns: repeat(1, minmax(0, 1fr));
        }
        @media (min-width: 1024px) {
          .grid-cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
        }
      `}</style>
    </div>
  );
}

export default App;
