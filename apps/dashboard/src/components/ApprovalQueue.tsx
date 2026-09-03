import { useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, CheckCircle, XCircle } from 'lucide-react';

interface Incident {
  id: string;
  orderValue: number;
  winningENI: number;
  winningAction: string;
  createdAt: string;
}

export function ApprovalQueue() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState<Record<string, boolean>>({});

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
      fetchQueue();
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <Card className="border-red-500/50 shadow-lg shadow-red-500/10">
      <CardHeader className="bg-red-500/10 pb-4">
        <CardTitle className="text-red-400 flex items-center gap-2">
          <AlertCircle className="w-5 h-5" />
          High-ENI Approval Queue
          <Badge variant="destructive" className="ml-auto">
            {incidents.length} Pending
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <div className="p-6 text-center text-zinc-500">Loading queue...</div>
        ) : incidents.length === 0 ? (
          <div className="p-6 text-center text-zinc-500">No interventions require approval.</div>
        ) : (
          <div className="divide-y divide-zinc-800">
            {incidents.map((incident) => (
              <div key={incident.id} className="p-4 flex items-center justify-between hover:bg-zinc-800/50 transition-colors">
                <div>
                  <div className="font-mono text-sm text-zinc-400 mb-1">{incident.id}</div>
                  <div className="flex gap-4">
                    <span className="text-zinc-200">Value: ₹{incident.orderValue}</span>
                    <span className="text-red-400 font-bold">ENI: {incident.winningENI}</span>
                    <span className="text-blue-400">Action: {incident.winningAction}</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button 
                    variant="outline" 
                    size="sm"
                    className="border-red-500/50 hover:bg-red-500/20 text-red-400"
                    onClick={() => handleReject(incident.id)}
                  >
                    <XCircle className="w-4 h-4 mr-2" /> Reject
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm"
                    className="border-green-500/50 hover:bg-green-500/20 text-green-400"
                    onClick={() => handleApprove(incident.id)}
                    disabled={approving[incident.id] || false}
                  >
                    <CheckCircle className="w-4 h-4 mr-2" /> 
                    {approving[incident.id] ? 'Approving...' : 'Approve'}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
