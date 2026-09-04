import { useEffect, useState } from 'react';

interface Incident {
  id: string;
  orderValue: number;
  winningENI: number;
  winningAction: string;
  createdAt: string;
  smsCopy?: string;
}

export function ApprovalQueue() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState<Record<string, boolean>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [explanations, setExplanations] = useState<Record<string, string>>({});
  const [loadingExpl, setLoadingExpl] = useState<Record<string, boolean>>({});

  const fetchQueue = async () => {
    try {
      const res = await fetch('/api/incidents?status=PENDING_APPROVAL');
      const data = await res.json();
      setIncidents(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchQueue();
    const interval = setInterval(fetchQueue, 5000);
    return () => clearInterval(interval);
  }, []);

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

  const handleApprove = async (id: string) => {
    setApproving(prev => ({ ...prev, [id]: true }));
    try {
      const res = await fetch(`/api/incidents/${id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approvedBy: 'Admin' })
      });
      
      if (!res.ok) {
        const error = await res.json();
        alert(`Approval failed: ${error.error}`);
        return;
      }
      
      setIncidents(prev => prev.filter(inc => inc.id !== id));
      if (currentIndex >= incidents.length - 1) {
        setCurrentIndex(Math.max(0, incidents.length - 2));
      }
      alert('✅ Incident approved and payment link sent!');
    } catch (e) {
      console.error(e);
      alert('Network error during approval');
    } finally {
      setApproving(prev => ({ ...prev, [id]: false }));
    }
  };

  const handleReject = async (id: string) => {
    try {
      await fetch(`/api/incidents/${id}/reject`, { method: 'POST' });
      setIncidents(prev => prev.filter(inc => inc.id !== id));
      if (currentIndex >= incidents.length - 1) {
        setCurrentIndex(Math.max(0, incidents.length - 2));
      }
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="glass-panel" style={{ border: '1px solid rgba(239, 68, 68, 0.3)', boxShadow: '0 10px 15px -3px rgba(239, 68, 68, 0.1)', padding: 0, overflow: 'hidden' }}>
      <div style={{ backgroundColor: 'rgba(239, 68, 68, 0.05)', padding: '16px 24px', borderBottom: '1px solid rgba(239, 68, 68, 0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ color: '#ef4444', display: 'flex', alignItems: 'center', gap: '8px', margin: 0, fontSize: '1.125rem', fontWeight: 600 }}>
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
          High-ENI Approval Queue
          <span style={{ marginLeft: '12px', backgroundColor: '#ef4444', color: 'white', fontSize: '0.75rem', padding: '4px 10px', borderRadius: '9999px', fontWeight: 'bold' }}>
            {incidents.length} Pending
          </span>
        </h3>
        
        {incidents.length > 0 && (
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <span style={{ color: '#ef4444', fontSize: '0.875rem', marginRight: '8px', opacity: 0.8 }}>
              {currentIndex + 1} of {incidents.length}
            </span>
            <button 
              onClick={handlePrev}
              disabled={currentIndex === 0}
              style={{
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.2)',
                color: currentIndex === 0 ? 'rgba(239, 68, 68, 0.4)' : '#ef4444',
                padding: '6px 10px',
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
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.2)',
                color: currentIndex === incidents.length - 1 ? 'rgba(239, 68, 68, 0.4)' : '#ef4444',
                padding: '6px 10px',
                borderRadius: '6px',
                cursor: currentIndex === incidents.length - 1 ? 'not-allowed' : 'pointer',
                transition: 'background 0.2s'
              }}
            >
              →
            </button>
          </div>
        )}
      </div>

      <div>
        {loading && incidents.length === 0 ? (
          <div style={{ padding: '24px', textAlign: 'center', color: '#71717a' }}>Loading queue...</div>
        ) : incidents.length === 0 ? (
          <div style={{ padding: '24px', textAlign: 'center', color: '#71717a' }}>No interventions require approval.</div>
        ) : currentIncident ? (
          <div className="animate-fade-in" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <div style={{ flex: 1, minWidth: 0, paddingRight: '16px' }}>
                <div style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: '#71717a', marginBottom: '8px' }}>
                  Incident #{currentIncident.id.split('-')[0]} • {new Date(currentIncident.createdAt).toLocaleString()}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'auto auto', gap: '8px 16px', fontSize: '0.875rem', alignItems: 'center' }}>
                  <span style={{ color: '#e4e4e7', fontSize: '1.1rem' }}>Value: <strong style={{color:'white'}}>₹{currentIncident.orderValue}</strong></span>
                  <span style={{ color: '#ef4444', fontSize: '1.1rem' }}>ENI: <strong>₹{currentIncident.winningENI.toFixed(2)}</strong></span>
                  <span style={{ color: '#ef4444', gridColumn: '1 / -1', fontSize: '0.75rem', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239,68,68,0.2)', padding: '6px 12px', borderRadius: '6px', width: 'fit-content', fontWeight: 'bold' }}>
                    ACTION: {currentIncident.winningAction.replace(/_/g, ' ')}
                  </span>
                </div>
              </div>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flexShrink: 0 }}>
                <button 
                  className="skiper-btn skiper-btn-approve"
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.875rem', padding: '10px 16px', borderRadius: '6px', border: '1px solid rgba(34, 197, 94, 0.4)', backgroundColor: 'rgba(34,197,94,0.1)', color: '#4ade80', cursor: approving[currentIncident.id] ? 'not-allowed' : 'pointer', opacity: approving[currentIncident.id] ? 0.5 : 1, fontWeight: 'bold' }}
                  onClick={() => handleApprove(currentIncident.id)}
                  disabled={approving[currentIncident.id] || false}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" style={{ marginRight: '8px' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                  {approving[currentIncident.id] ? 'Approving...' : 'Approve & Send'}
                </button>
                <button 
                  className="skiper-btn skiper-btn-reject"
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.875rem', padding: '10px 16px', borderRadius: '6px', border: '1px solid rgba(239, 68, 68, 0.3)', backgroundColor: 'transparent', color: '#ef4444', cursor: 'pointer' }}
                  onClick={() => handleReject(currentIncident.id)}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" style={{ marginRight: '8px' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>
                  Reject
                </button>
              </div>
            </div>

            {/* AI Explainer Chat UI */}
            <div style={{
              background: 'linear-gradient(145deg, rgba(239, 68, 68, 0.05) 0%, rgba(0,0,0,0.2) 100%)',
              border: '1px solid rgba(239, 68, 68, 0.2)',
              borderRadius: '8px',
              padding: '16px',
              position: 'relative',
              marginTop: '8px'
            }}>
              <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
                <div style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  background: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '1rem',
                  flexShrink: 0
                }}>
                  💬
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '0.8rem', color: '#60a5fa', fontWeight: '600', marginBottom: '6px' }}>
                    AI Copy Generation
                  </div>
                  <div style={{ 
                    color: '#d1d5db', 
                    fontSize: '0.9rem', 
                    lineHeight: '1.5',
                    fontStyle: 'italic',
                    background: 'rgba(96, 165, 250, 0.05)',
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: '1px solid rgba(96, 165, 250, 0.2)'
                  }}>
                    {currentIncident.smsCopy ? `"${currentIncident.smsCopy}"` : 'Generating copy...'}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '12px' }}>
                <div style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  background: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '1rem',
                  flexShrink: 0
                }}>
                  🤖
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '0.8rem', color: '#ef4444', fontWeight: '600', marginBottom: '6px' }}>
                    AI Justification ("Why Not")
                  </div>
                  <div style={{ 
                    color: '#d1d5db', 
                    fontSize: '0.9rem', 
                    lineHeight: '1.5',
                  }}>
                    {loadingExpl[currentIncident.id] ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', opacity: 0.7 }}>
                        <span className="spinner" style={{ width: '14px', height: '14px', border: '2px solid rgba(239,68,68,0.3)', borderTopColor: '#ef4444', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                        Analyzing decision...
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
        ) : null}
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
