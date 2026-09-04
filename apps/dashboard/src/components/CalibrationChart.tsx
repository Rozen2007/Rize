import { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';

export function CalibrationChart() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/metrics/calibration')
      .then(res => res.json())
      .then(d => {
        setData(d);
        setLoading(false);
      })
      .catch(console.error);
  }, []);

  if (loading) return <div>Loading calibration...</div>;
  if (!data?.calibrationBuckets) {
    return (
      <div style={{
        background: 'rgba(0, 0, 0, 0.3)',
        border: '1px solid rgba(59, 130, 246, 0.2)',
        borderRadius: '12px',
        overflow: 'hidden',
        boxShadow: '0 10px 15px -3px rgba(59, 130, 246, 0.1)',
        backdropFilter: 'blur(10px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '380px',
        color: '#71717a',
        padding: '24px',
        textAlign: 'center'
      }}>
        {data?.message || 'Need at least 10 incidents for calibration model to run'}
      </div>
    );
  }

  return (
    <div style={{
      background: 'rgba(0, 0, 0, 0.3)',
      border: '1px solid rgba(59, 130, 246, 0.2)',
      borderRadius: '12px',
      overflow: 'hidden',
      boxShadow: '0 10px 15px -3px rgba(59, 130, 246, 0.1)',
      backdropFilter: 'blur(10px)'
    }}>
      <div style={{
        background: 'rgba(59, 130, 246, 0.1)',
        padding: '16px',
        borderBottom: '1px solid rgba(59, 130, 246, 0.2)'
      }}>
        <h3 style={{
          color: '#60a5fa',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          margin: 0,
          fontSize: '1.125rem',
          fontWeight: 600
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="6"></circle><circle cx="12" cy="12" r="2"></circle></svg>
            Model Calibration (Brier Score: {data.brierScore})
          </div>
          <span style={{ fontSize: '0.875rem', fontWeight: 400, color: '#a1a1aa' }}>
            {data.interpretation}
          </span>
        </h3>
      </div>
      <div style={{ padding: '16px' }}>
        <div style={{ height: '300px', width: '100%' }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data.calibrationBuckets} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#333" />
              <XAxis 
                dataKey="predictedP" 
                stroke="#666" 
                label={{ value: 'Predicted Probability', position: 'insideBottom', offset: -5 }} 
              />
              <YAxis 
                stroke="#666" 
                label={{ value: 'Actual Recovery Rate', angle: -90, position: 'insideLeft' }} 
              />
              <Tooltip 
                contentStyle={{ backgroundColor: '#18181b', border: '1px solid #3f3f46' }}
              />
              {/* Perfect calibration line y = x */}
              <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 1, y: 1 }]} stroke="#666" strokeDasharray="3 3" />
              <Line 
                type="monotone" 
                dataKey="actualRate" 
                stroke="#3b82f6" 
                strokeWidth={3}
                dot={{ fill: '#3b82f6', r: 4 }}
                activeDot={{ r: 6 }} 
                name="Actual Rate"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
