import { useState, useEffect } from 'react';

interface Incident {
  id: string;
  orderValue: number;
  failureReason: string;
  affectedCohort: string;
  winningAction: string;
  discountOffered: number;
  status: string;
  createdAt: string;
}

export function IncidentFeed() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [explanations, setExplanations] = useState<Record<string, string>>({});
  const [loadingExpl, setLoadingExpl] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetch('/api/incidents')
      .then((res) => res.json())
      .then((data) => setIncidents(data))
      .catch(console.error);
  }, []);

  const formatCohortTags = (key: string) => key.split(':').map(p => p.replace(/_/g, ' ').toUpperCase());

  const currentIncident = incidents[currentIndex];

  useEffect(() => {
    if (currentIncident && !explanations[currentIncident.id] && !loadingExpl[currentIncident.id]) {
      setLoadingExpl((prev) => ({ ...prev, [currentIncident.id]: true }));
      fetch(`/api/incidents/${currentIncident.id}/explain`)
        .then((res) => res.json())
        .then((data) => {
          setExplanations((prev) => ({ ...prev, [currentIncident.id]: data.explanation }));
        })
        .catch(() => {
          setExplanations((prev) => ({ ...prev, [currentIncident.id]: 'Failed to load explanation.' }));
        })
        .finally(() => {
          setLoadingExpl((prev) => ({ ...prev, [currentIncident.id]: false }));
        });
    }
  }, [currentIncident, explanations, loadingExpl]);

  const handleNext = () => {
    if (currentIndex < incidents.length - 1) {
      setCurrentIndex((prev) => prev + 1);
    }
  };

  const handlePrev = () => {
    if (currentIndex > 0) {
      setCurrentIndex((prev) => prev - 1);
    }
  };

  if (incidents.length === 0) {
    return (
      <div className="glass-panel" style={{ padding: '24px', marginTop: '24px', textAlign: 'center', color: '#9ca3af' }}>
        No incidents recorded yet.
      </div>
    );
  }

  return (
    <div className="glass-panel" style={{ padding: '32px', marginTop: '24px', position: 'relative' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h2 className="text-gradient" style={{ fontSize: '1.5rem', margin: 0 }}>
          Live Incident Feed
        </h2>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span style={{ color: '#9ca3af', fontSize: '0.875rem', marginRight: '8px' }}>
            {currentIndex + 1} of {incidents.length}
          </span>
          <button 
            onClick={handlePrev}
            disabled={currentIndex === 0}
            style={{
              background: 'rgba(255,255,255,0.1)',
              border: 'none',
              color: currentIndex === 0 ? '#4b5563' : 'white',
              padding: '8px 12px',
              borderRadius: '6px',
              cursor: currentIndex === 0 ? 'not-allowed' : 'pointer',
              transition: 'background 0.2s'
            }}
          >
            ←
          </button>
          <button 
            onClick={handleNext}
            disabled={currentIndex === incidents.length - 1}
            style={{
              background: 'rgba(255,255,255,0.1)',
              border: 'none',
              color: currentIndex === incidents.length - 1 ? '#4b5563' : 'white',
              padding: '8px 12px',
              borderRadius: '6px',
              cursor: currentIndex === incidents.length - 1 ? 'not-allowed' : 'pointer',
              transition: 'background 0.2s'
            }}
          >
            →
          </button>
        </div>
      </div>

      <div className="animate-fade-in" key={currentIncident.id} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        
        {/* Incident Details Card */}
        <div style={{
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: '12px',
          padding: '24px',
          display: 'grid',
          gridTemplateColumns: '1fr auto',
          alignItems: 'center',
          gap: '16px'
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
              <span style={{ fontSize: '1.25rem', fontWeight: '600', color: 'white' }}>
                Checkout {currentIncident.id.slice(-6)}
              </span>
              <span style={{
                background: 'rgba(138, 43, 226, 0.2)',
                color: '#8A2BE2',
                padding: '4px 10px',
                borderRadius: '9999px',
                fontSize: '0.75rem',
                fontWeight: '600',
                border: '1px solid rgba(138, 43, 226, 0.3)'
              }}>
                ${currentIncident.orderValue}
              </span>
            </div>
            <div style={{ display: 'flex', gap: '16px', color: '#9ca3af', fontSize: '0.875rem', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#4b5563' }} />
                <div style={{ display: 'flex', gap: '4px' }}>
                  {formatCohortTags(currentIncident.affectedCohort).map((tag, i) => (
                    <span key={i} style={{
                      background: 'rgba(255,255,255,0.05)',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      fontSize: '0.7rem',
                      fontWeight: 600,
                      color: '#9ca3af'
                    }}>
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#4b5563' }} />
                {new Date(currentIncident.createdAt).toLocaleString()}
              </span>
            </div>
          </div>

          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '0.875rem', color: '#9ca3af', marginBottom: '4px' }}>Intervention</div>
            <div style={{ fontSize: '1.125rem', fontWeight: '600', color: 'white' }}>
              {currentIncident.discountOffered > 0 
                ? `${(currentIncident.discountOffered * 100).toFixed(0)}% Discount` 
                : 'Payment Link'}
            </div>
          </div>
        </div>

        {/* AI Explainer Chat UI */}
        <div style={{
          background: 'linear-gradient(145deg, rgba(138, 43, 226, 0.1) 0%, rgba(0,0,0,0.4) 100%)',
          border: '1px solid rgba(138, 43, 226, 0.3)',
          borderRadius: '12px',
          padding: '24px',
          position: 'relative',
          overflow: 'hidden'
        }}>
          {/* Subtle glow effect */}
          <div style={{
            position: 'absolute',
            top: 0,
            left: '20%',
            right: '20%',
            height: '1px',
            background: 'linear-gradient(90deg, transparent, rgba(138,43,226,0.8), transparent)',
            boxShadow: '0 0 10px rgba(138,43,226,0.5)'
          }} />

          <div style={{ display: 'flex', gap: '16px' }}>
            <div style={{
              width: '40px',
              height: '40px',
              borderRadius: '50%',
              background: 'rgba(138, 43, 226, 0.2)',
              border: '1px solid rgba(138, 43, 226, 0.4)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1.25rem',
              flexShrink: 0
            }}>
              ✨
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '0.875rem', color: '#8A2BE2', fontWeight: '600', marginBottom: '8px' }}>
                RIZE Nemotron AI
              </div>
              <div style={{ 
                color: '#d1d5db', 
                fontSize: '1rem', 
                lineHeight: '1.6',
                fontFamily: 'system-ui, -apple-system, sans-serif'
              }}>
                {loadingExpl[currentIncident.id] ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', opacity: 0.7 }}>
                    <span className="spinner" style={{ width: '16px', height: '16px', border: '2px solid rgba(138,43,226,0.3)', borderTopColor: '#8A2BE2', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                    Analyzing tournament outcomes...
                  </div>
                ) : (
                  <div style={{ animation: 'fadeIn 0.5s ease-out' }}>
                    {explanations[currentIncident.id] || 'Explanation not available.'}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

      </div>

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(5px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
