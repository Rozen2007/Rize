import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import '../index.css';

interface SummaryData {
  totalIncrementalGmv: number;
  averageIncrementalRate: number;
  activeInterventions: number;
  cohortCount: number;
}

export default function Landing() {
  const [hoveredSegment, setHoveredSegment] = useState<number | null>(null);
  const [summary, setSummary] = useState<SummaryData | null>(null);

  useEffect(() => {
    const fetchSummary = async () => {
      try {
        const res = await fetch('/api/metrics/summary');
        if (!res.ok) return;
        const json = await res.json();
        setSummary(json);
      } catch (err) {
        console.error('Failed to fetch summary', err);
      }
    };

    fetchSummary();
    const interval = setInterval(fetchSummary, 5000);
    return () => clearInterval(interval);
  }, []);

  const totalGmv = summary?.totalIncrementalGmv ?? 0;
  const totalRecoveries = summary?.activeInterventions ?? 0;
  const avgIncrementalRate = summary?.averageIncrementalRate ?? 0;

  const segmentColors = ['#c77f4c', '#d76bed', '#f5b240', '#ed6486', '#5295f2', '#5ad664'];

  const segmentDescriptions = [
    { 
      title: 'Bayesian Engine', 
      text: 'Continuously learns from every transaction to calculate the true probability of recovery.',
      position: { top: '0', left: '50%', transform: 'translate(-50%, -110%)', textAlign: 'center' as const } 
    },
    { 
      title: 'AI Intervention', 
      text: 'Triggers personalized interventions precisely when a user is likely to abandon.',
      position: { top: '25%', left: '100%', transform: 'translate(10%, -50%)', textAlign: 'left' as const } 
    },
    { 
      title: 'Cohort Tracking', 
      text: 'Segments your audience by behavior, device, and payment method for granular insights.',
      position: { top: '75%', left: '100%', transform: 'translate(10%, -50%)', textAlign: 'left' as const } 
    },
    { 
      title: 'Live Dashboards', 
      text: 'Real-time visibility into interventions, recovery rates, and incremental GMV lift.',
      position: { bottom: '0', left: '50%', transform: 'translate(-50%, 110%)', textAlign: 'center' as const } 
    },
    { 
      title: 'Dynamic Pricing', 
      text: 'Automatically tests and applies the optimal discount required to save the sale.',
      position: { top: '75%', right: '100%', transform: 'translate(-10%, -50%)', textAlign: 'right' as const } 
    },
    { 
      title: 'Revenue Lift', 
      text: 'Measurably increases your bottom line with mathematically proven incremental revenue.',
      position: { top: '25%', right: '100%', transform: 'translate(-10%, -50%)', textAlign: 'right' as const } 
    },
  ];

  return (
    <div className="result-landing-surface" style={{ minHeight: '100vh', backgroundColor: '#0e0e0e', color: 'white', overflow: 'hidden', position: 'relative' }}>
      
      {/* Background Colors for Segments */}
      <div style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none' }}>
        {/* Color Tint for Background */}
        {segmentColors.map((color, i) => (
          <div
            key={`color-${i}`}
            style={{
              position: 'absolute',
              inset: 0,
              backgroundColor: color,
              opacity: hoveredSegment === i ? 0.1 : 0,
              transition: 'opacity 0.4s ease',
              mixBlendMode: 'color',
              maskImage: 'radial-gradient(circle at 50% 50%, transparent 25%, black 45%, transparent 75%)',
              WebkitMaskImage: 'radial-gradient(circle at 50% 50%, transparent 25%, black 45%, transparent 75%)',
            }}
          />
        ))}
      </div>

      {/* Responsive Styles */}
      <style>{`
        .wheel-container {
          position: absolute;
          width: 90vmin;
          height: 90vmin;
          max-width: 800px;
          max-height: 800px;
          z-index: 1;
          transition: all 0.3s ease;
        }
        .floating-tooltip {
          display: none;
        }
        
        .text-stack {
          display: grid;
          place-items: center;
        }
        .text-stack > * {
          grid-area: 1 / 1;
        }
        .mobile-hover-text {
          animation: fadeIn 0.3s ease forwards;
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .mobile-fade-on-hover {
          transition: opacity 0.3s ease;
        }

        @media (max-width: 1023px) {
          .mobile-fade-on-hover.is-hovered {
            opacity: 0;
            pointer-events: none;
          }
        }
        
        @media (min-width: 1024px) {
          .wheel-container {
            width: 65vmin;
            height: 65vmin;
            max-width: 700px;
            max-height: 700px;
          }
          .floating-tooltip {
            display: block !important;
          }
          .mobile-hover-text {
            display: none !important;
          }
        }
      `}</style>

      {/* Dimmed Background Grid/Dashboards (simulated fallback) */}
      <div style={{
        position: 'absolute', inset: 0, zIndex: 0, opacity: hoveredSegment !== null ? 0.05 : 0.15, pointerEvents: 'none',
        backgroundImage: 'radial-gradient(circle at 50% 50%, rgba(255,255,255,0.05) 1px, transparent 1px)',
        backgroundSize: '40px 40px',
        transition: 'opacity 0.4s ease'
      }} />

      <main>
        <section style={{
          position: 'relative',
          display: 'grid',
          placeItems: 'center',
          minHeight: '100vh',
          overflow: 'hidden'
        }}>
          {/* Circular Wheel UI */}
          <div className="wheel-container">
            <svg className="size-full" role="img" viewBox="0 0 240 240" style={{ width: '100%', height: '100%', overflow: 'visible' }}>
              <defs>
                <clipPath id="sector-0"><path d="M 120 120 L 50 -1.244 A 140 140 0 0 1 190 -1.244 Z" /></clipPath>
                <clipPath id="sector-1"><path d="M 120 120 L 190 -1.244 A 140 140 0 0 1 260 120 Z" /></clipPath>
                <clipPath id="sector-2"><path d="M 120 120 L 260 120 A 140 140 0 0 1 190 241.244 Z" /></clipPath>
                <clipPath id="sector-3"><path d="M 120 120 L 190 241.244 A 140 140 0 0 1 50 241.244 Z" /></clipPath>
                <clipPath id="sector-4"><path d="M 120 120 L 50 241.244 A 140 140 0 0 1 -20 120 Z" /></clipPath>
                <clipPath id="sector-5"><path d="M 120 120 L -20 120 A 140 140 0 0 1 50 -1.244 Z" /></clipPath>
              </defs>

              {/* Rings colored by sector with Hover Interaction */}
              {[0,1,2,3,4,5].map((i) => (
                <g 
                  key={i}
                  clipPath={`url(#sector-${i})`} 
                  stroke={segmentColors[i]}
                  onMouseEnter={() => setHoveredSegment(i)}
                  onMouseLeave={() => setHoveredSegment(null)}
                  style={{ cursor: 'pointer', transition: 'all 0.3s ease' }}
                >
                  <circle cx="120" cy="120" r="140" fill="transparent" pointerEvents="all" stroke="none" />
                  <circle cx="120" cy="120" fill="none" r="118" strokeWidth="1.5" opacity={hoveredSegment === i ? 1 : 0.25} style={{ transition: 'opacity 0.3s' }} />
                  <circle cx="120" cy="120" fill="none" r="107.5" strokeWidth="1.5" opacity={hoveredSegment === i ? 1 : 0.25} style={{ transition: 'opacity 0.3s' }} />
                  {hoveredSegment === i && (
                     <circle cx="120" cy="120" fill={segmentColors[i]} r="118" stroke="none" opacity="0.05" />
                  )}
                </g>
              ))}

              {/* Dividers */}
              <g stroke="#ffffff" strokeWidth="1" opacity="0.15" style={{ pointerEvents: 'none' }}>
                <line x1="72" x2="55" y1="36.86" y2="7.41"></line>
                <line x1="168" x2="185" y1="36.86" y2="7.41"></line>
                <line x1="216" x2="250" y1="120" y2="120"></line>
                <line x1="168" x2="185" y1="203.13" y2="232.58"></line>
                <line x1="72" x2="55" y1="203.13" y2="232.58"></line>
                <line x1="24" x2="-10" y1="120" y2="120"></line>
              </g>

              {/* Curved Text Paths */}
              <g fill="#ffffff" fontSize="5.5" fontWeight="600" letterSpacing="0.2em" style={{ textTransform: 'uppercase', pointerEvents: 'none' }}>
                <path d="M 63.625 22.356 A 112.75 112.75 0 0 1 176.375 22.356" fill="none" id="pillar-0"></path>
                <text textAnchor="middle" opacity={hoveredSegment === null || hoveredSegment === 0 ? 1 : 0.5} style={{ transition: 'opacity 0.3s' }}>
                  <textPath dominantBaseline="central" href="#pillar-0" startOffset="50%">BAYESIAN ENGINE</textPath>
                </text>

                <path d="M 176.375 22.356 A 112.75 112.75 0 0 1 232.750 120.000" fill="none" id="pillar-1"></path>
                <text textAnchor="middle" opacity={hoveredSegment === null || hoveredSegment === 1 ? 1 : 0.5} style={{ transition: 'opacity 0.3s' }}>
                  <textPath dominantBaseline="central" href="#pillar-1" startOffset="50%">AI INTERVENTION</textPath>
                </text>

                <path d="M 176.375 217.644 A 112.75 112.75 0 0 0 232.750 120.000" fill="none" id="pillar-2"></path>
                <text textAnchor="middle" opacity={hoveredSegment === null || hoveredSegment === 2 ? 1 : 0.5} style={{ transition: 'opacity 0.3s' }}>
                  <textPath dominantBaseline="central" href="#pillar-2" startOffset="50%">COHORT TRACKING</textPath>
                </text>

                <path d="M 63.625 217.644 A 112.75 112.75 0 0 0 176.375 217.644" fill="none" id="pillar-3"></path>
                <text textAnchor="middle" opacity={hoveredSegment === null || hoveredSegment === 3 ? 1 : 0.5} style={{ transition: 'opacity 0.3s' }}>
                  <textPath dominantBaseline="central" href="#pillar-3" startOffset="50%">LIVE DASHBOARDS</textPath>
                </text>

                <path d="M 7.250 120.000 A 112.75 112.75 0 0 0 63.625 217.644" fill="none" id="pillar-4"></path>
                <text textAnchor="middle" opacity={hoveredSegment === null || hoveredSegment === 4 ? 1 : 0.5} style={{ transition: 'opacity 0.3s' }}>
                  <textPath dominantBaseline="central" href="#pillar-4" startOffset="50%">DYNAMIC PRICING</textPath>
                </text>

                <path d="M 7.250 120.000 A 112.75 112.75 0 0 1 63.625 22.356" fill="none" id="pillar-5"></path>
                <text textAnchor="middle" opacity={hoveredSegment === null || hoveredSegment === 5 ? 1 : 0.5} style={{ transition: 'opacity 0.3s' }}>
                  <textPath dominantBaseline="central" href="#pillar-5" startOffset="50%">REVENUE LIFT</textPath>
                </text>
              </g>
            </svg>

            {/* Floating Descriptions */}
            {segmentDescriptions.map((desc, i) => (
              <div 
                className="floating-tooltip"
                key={`desc-${i}`}
                style={{
                  position: 'absolute',
                  ...desc.position,
                  width: '280px',
                  opacity: hoveredSegment === i ? 1 : 0,
                  transform: hoveredSegment === i ? desc.position.transform : `${desc.position.transform} scale(0.95)`,
                  transition: 'all 0.3s ease',
                  pointerEvents: 'none',
                  zIndex: 20
                }}
              >
                <h3 style={{ color: segmentColors[i], fontSize: '1.25rem', fontWeight: 600, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {desc.title}
                </h3>
                <p style={{ color: '#9ca3af', fontSize: '0.9rem', lineHeight: 1.5 }}>
                  {desc.text}
                </p>
              </div>
            ))}
          </div>

          {/* Inner Content */}
          <div style={{ position: 'relative', zIndex: 10, maxWidth: '420px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            
            <div className="text-stack" style={{ marginBottom: '32px' }}>
              <div className={`mobile-fade-on-hover ${hoveredSegment !== null ? 'is-hovered' : ''}`}>
                <h1 style={{
                  fontSize: 'clamp(1.75rem, 3.5vw, 2.5rem)',
                  lineHeight: 1.1,
                  fontWeight: 500,
                  letterSpacing: '-0.02em',
                  marginBottom: '16px',
                  color: '#ffffff',
                }}>
                  The autonomous<br/>revenue engine
                </h1>
                
                <p style={{
                  fontSize: 'clamp(0.875rem, 1.25vw, 1.05rem)',
                  color: '#9ca3af',
                  maxWidth: '360px',
                  margin: '0 auto',
                  lineHeight: 1.5,
                }}>
                  Recover lost revenue, optimize pricing, and intervene in real-time with our Bayesian AI engine.
                </p>
              </div>

              {/* Center Text for Mobile (Replaces default text on hover) */}
              {hoveredSegment !== null && (
                <div className="mobile-hover-text" style={{ width: '100%', pointerEvents: 'none' }}>
                  <h1 style={{
                    fontSize: 'clamp(1.5rem, 3vw, 2rem)',
                    lineHeight: 1.1,
                    fontWeight: 500,
                    letterSpacing: '-0.02em',
                    marginBottom: '16px',
                    color: segmentColors[hoveredSegment],
                    textTransform: 'uppercase'
                  }}>
                    {segmentDescriptions[hoveredSegment].title}
                  </h1>
                  
                  <p style={{
                    fontSize: 'clamp(0.875rem, 1.2vw, 1rem)',
                    color: '#9ca3af',
                    maxWidth: '320px',
                    margin: '0 auto',
                    lineHeight: 1.5,
                  }}>
                    {segmentDescriptions[hoveredSegment].text}
                  </p>
                </div>
              )}
            </div>

            <Link 
              to="/dashboard"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                padding: '0 32px',
                height: '48px',
                backgroundColor: 'white',
                color: 'black',
                fontWeight: 600,
                fontSize: '14px',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                textDecoration: 'none',
                transition: 'all 0.15s ease',
                width: '100%',
                maxWidth: '280px',
                borderRadius: '0px'
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.transform = 'scale(0.98)';
                e.currentTarget.style.backgroundColor = '#e5e7eb';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.transform = 'scale(1)';
                e.currentTarget.style.backgroundColor = 'white';
              }}
            >
              Enter Command Center <span style={{ marginLeft: '4px' }}>→</span>
            </Link>

            <div style={{ marginTop: '24px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#9ca3af' }}>
              <div style={{ 
                width: '18px', height: '18px', backgroundColor: '#FB651E', 
                color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', 
                fontWeight: 'bold', borderRadius: '4px', fontSize: '12px' 
              }}>R</div>
              Backed by <strong style={{ color: 'white' }}>RIZE</strong>
            </div>
          </div>
        </section>

        {/* Marquee Section (Bottom) */}
        <section style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          borderTop: '1px solid rgba(255,255,255,0.1)',
          padding: '16px 0',
          overflow: 'hidden',
          whiteSpace: 'nowrap',
          display: 'flex',
          backgroundColor: '#0e0e0e',
          zIndex: 20
        }}>
          <div className="marquee-content" style={{ display: 'flex', gap: '48px', animation: 'marquee 25s linear infinite' }}>
            {[...Array(4)].map((_, i) => (
              <div key={i} style={{ display: 'flex', gap: '48px' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '12px', color: '#888', fontSize: '14px' }}>
                  <div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#10b981', boxShadow: '0 0 10px #10b981' }} />
                  <span style={{ color: 'white', fontWeight: 600, fontFamily: 'monospace' }}>₹{totalGmv.toLocaleString()}</span> recovered today
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '12px', color: '#888', fontSize: '14px' }}>
                  <div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#10b981', boxShadow: '0 0 10px #10b981' }} />
                  <span style={{ color: 'white', fontWeight: 600, fontFamily: 'monospace' }}>{totalRecoveries}</span> successful interventions
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '12px', color: '#888', fontSize: '14px' }}>
                  <div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#10b981', boxShadow: '0 0 10px #10b981' }} />
                  <span style={{ color: 'white', fontWeight: 600, fontFamily: 'monospace' }}>{(avgIncrementalRate * 100).toFixed(1)}%</span> incremental lift
                </span>
              </div>
            ))}
          </div>
        </section>
      </main>

      <style>{`
        @keyframes marquee {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
      `}</style>
    </div>
  );
}

