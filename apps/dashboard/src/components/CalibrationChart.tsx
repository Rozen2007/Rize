import { useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { Target } from 'lucide-react';

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
  if (!data?.calibrationBuckets) return null;

  return (
    <Card className="border-blue-500/20">
      <CardHeader>
        <CardTitle className="text-blue-400 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Target className="w-5 h-5" />
            Model Calibration (Brier Score: {data.brierScore})
          </div>
          <span className="text-sm font-normal text-zinc-400">
            {data.interpretation}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[300px] w-full">
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
      </CardContent>
    </Card>
  );
}
