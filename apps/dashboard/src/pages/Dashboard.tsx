import { useEffect, useState } from 'react';
import { MetricCard } from '../components/MetricCard';
import { CohortComparison } from '../components/CohortComparison';
import { IncidentFeed } from '../components/IncidentFeed';
import { ApprovalQueue } from '../components/ApprovalQueue';
import { CalibrationChart } from '../components/CalibrationChart';
import '../index.css';

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

export default function Dashboard() {
  const [cohorts, setCohorts] = useState<string[]>([]);
  const [data, setData] = useState<Record<string, MetricsData>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchAllMetrics = async () => {
      try {
        const cohortRes = await fetch('/api/metrics/cohorts');
        if (!cohortRes.ok) throw new Error('Failed to fetch cohorts list');
        const cohortJson = await cohortRes.json();
        const availableCohorts: string[] = cohortJson.cohorts || [];
        setCohorts(availableCohorts);

        const results: Record<string, MetricsData> = {};
        for (const cohort of availableCohorts) {
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
    const interval = setInterval(fetchAllMetrics, 5000);
    return () => clearInterval(interval);
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
  let totalRecoveries = 0;

  Object.values(data).forEach((cohortData) => {
    totalGmv += cohortData.estimated_incremental_gmv;
    avgIncrementalRate += cohortData.incremental_recovery_rate;
    totalRecoveries += cohortData.treatment.recoveries;
    count++;
  });
  
  if (count > 0) avgIncrementalRate /= count;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Top Navbar */}
      <nav style={{
        padding: '16px 32px',
        background: 'rgba(0,0,0,0.5)',
        borderBottom: '1px solid #222',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        background: 'rgba(14, 14, 14, 0.8)',
        backdropFilter: 'blur(12px)',
        position: 'sticky',
        top: 0,
        zIndex: 100
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ 
            width: '28px', height: '28px', 
            background: '#fff', 
            borderRadius: '6px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 'bold', fontSize: '0.9rem', color: '#000'
          }}>R</div>
          <span style={{ fontSize: '1.1rem', fontWeight: 600, letterSpacing: '-0.02em', color: '#fff' }}>Result</span>
        </div>
      </nav>

      <div className="container" style={{ flex: 1, padding: '48px 24px' }}>
        {/* Glowing Hero Background Effect - subtle white glow */}
        <div style={{
          position: 'absolute',
          top: '0',
          left: '50%',
          transform: 'translateX(-50%)',
          width: '100%',
          height: '500px',
          background: 'radial-gradient(ellipse at top, rgba(255,255,255,0.05) 0%, transparent 60%)',
          zIndex: -1,
          pointerEvents: 'none'
        }} />

        <header style={{ marginBottom: '64px', textAlign: 'center' }} className="animate-fade-in">
          <h1 style={{ fontSize: 'clamp(2rem, 5vw, 4rem)', marginBottom: '16px', lineHeight: 1.1, letterSpacing: '-0.04em', color: '#fff', fontWeight: 600 }}>
            Command Center
          </h1>
          <p style={{ color: '#888', fontSize: '1.125rem', maxWidth: '600px', margin: '0 auto', lineHeight: 1.6 }}>
            Monitor real-time incremental GMV lift, cohort performance, and automated AI interventions across your payment flows.
          </p>
        </header>

        <div className="grid grid-cols-3" style={{ marginBottom: '64px', gap: '24px' }}>
          <MetricCard 
            title="Total Incremental Lift" 
            value={avgIncrementalRate * 100} 
            prefix="+"
            suffix="%"
            decimals={1}
            subtitle="Avg. recovery rate vs control"
            gradient="primary"
          />
          <MetricCard 
            title="Estimated GMV Recovered" 
            value={totalGmv} 
            prefix="₹"
            decimals={0}
            subtitle="Revenue saved automatically"
            gradient="success"
          />
          <MetricCard 
            title="Active Interventions" 
            value={totalRecoveries} 
            decimals={0}
            subtitle="Incidents resolved today"
            gradient="primary"
          />
        </div>

        <div className="grid grid-cols-2 gap-6 mb-16">
          <CalibrationChart />
          <ApprovalQueue />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
          <h2 className="text-gradient animate-fade-in" style={{ fontSize: '2rem', margin: 0 }}>
            Cohort Performance
          </h2>
          <div style={{ fontSize: '0.875rem', color: '#9ca3af' }}>Live Bayesian Updates</div>
        </div>
        
        <div 
          style={{ 
            display: 'flex', 
            gap: '24px', 
            overflowX: 'auto', 
            paddingBottom: '24px',
            marginBottom: '40px',
            scrollSnapType: 'x mandatory',
            // Hide scrollbar but keep functionality
            scrollbarWidth: 'thin',
            scrollbarColor: 'rgba(255,255,255,0.2) rgba(255,255,255,0.05)'
          }}
          className="custom-scrollbar"
        >
          {cohorts.map((cohort) => {
            const cohortData = data[cohort];
            if (!cohortData) return null;
            return (
              <div 
                key={cohort} 
                style={{ 
                  minWidth: '400px', 
                  flex: '0 0 auto',
                  scrollSnapAlign: 'start'
                }}
              >
                <CohortComparison 
                  cohortKey={cohortData.cohortKey}
                  control={cohortData.control}
                  treatment={cohortData.treatment}
                />
              </div>
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
        .custom-scrollbar::-webkit-scrollbar {
          height: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(255, 255, 255, 0.05);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.2);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.3);
        }
      `}</style>
    </div>
  );
}

