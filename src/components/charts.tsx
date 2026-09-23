'use client';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { inr, inrC, monthShort } from '@/ui/format';

export const PALETTE = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#14b8a6', '#f97316', '#64748b', '#ec4899'];
const axis = { fontSize: 11, fill: '#6b7488' };
const tip = (label?: any) => (label && /^\d{4}-\d{2}-\d{2}$/.test(String(label)) ? monthShort(String(label)) : label);
const moneyTip = ({ active, payload, label }: any) => !active || !payload?.length ? null : (
  <div className="rounded-lg border border-ink-200 bg-white px-3 py-2 text-xs shadow-pop">
    <p className="mb-1 font-medium text-ink-900">{tip(label)}</p>
    {payload.map((p: any) => <p key={p.dataKey ?? p.name} className="flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ background: p.color ?? p.payload?.fill }} />{p.name}: <span className="font-medium tabular-nums">{inr(p.value)}</span></p>)}
  </div>
);

/** series values are integer paise */
export function MoneyLines({ data, x = 'month', lines, height = 260, area }: { data: any[]; x?: string; lines: { key: string; name: string; color?: string }[]; height?: number; area?: boolean }) {
  const Chart: any = area ? AreaChart : LineChart;
  return (
    <div style={{ height }} role="img" aria-label={`Chart of ${lines.map((l) => l.name).join(', ')}`}>
      <ResponsiveContainer width="100%" height="100%">
        <Chart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eef0f4" vertical={false} />
          <XAxis dataKey={x} tick={axis} tickFormatter={(v) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? monthShort(v) : v)} axisLine={false} tickLine={false} />
          <YAxis tick={axis} width={62} tickFormatter={(v) => inrC(v)} axisLine={false} tickLine={false} />
          <Tooltip content={moneyTip} />
          <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
          {lines.map((l, i) => area
            ? <Area key={l.key} type="monotone" dataKey={l.key} name={l.name} stroke={l.color ?? PALETTE[i]} fill={l.color ?? PALETTE[i]} fillOpacity={0.12} strokeWidth={2} dot={false} />
            : <Line key={l.key} type="monotone" dataKey={l.key} name={l.name} stroke={l.color ?? PALETTE[i]} strokeWidth={2} dot={false} />)}
        </Chart>
      </ResponsiveContainer>
    </div>
  );
}

export function MoneyBars({ data, x, bars, height = 260, stacked, layout = 'horizontal' }: { data: any[]; x: string; bars: { key: string; name: string; color?: string }[]; height?: number; stacked?: boolean; layout?: 'horizontal' | 'vertical' }) {
  const vertical = layout === 'vertical';
  return (
    <div style={{ height }} role="img" aria-label={`Bar chart of ${bars.map((l) => l.name).join(', ')}`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout={layout} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eef0f4" vertical={vertical} horizontal={!vertical} />
          {vertical ? <><XAxis type="number" tick={axis} tickFormatter={(v) => inrC(v)} axisLine={false} tickLine={false} /><YAxis type="category" dataKey={x} tick={axis} width={135} axisLine={false} tickLine={false} /></>
            : <><XAxis dataKey={x} tick={axis} tickFormatter={(v) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? monthShort(v) : v)} axisLine={false} tickLine={false} /><YAxis tick={axis} width={62} tickFormatter={(v) => inrC(v)} axisLine={false} tickLine={false} /></>}
          <Tooltip content={moneyTip} cursor={{ fill: '#f7f8fa' }} />
          {bars.length > 1 && <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />}
          {bars.map((b, i) => <Bar key={b.key} dataKey={b.key} name={b.name} fill={b.color ?? PALETTE[i]} stackId={stacked ? 's' : undefined} radius={stacked ? 0 : [3, 3, 0, 0]} maxBarSize={36} />)}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function MoneyDonut({ data, height = 240 }: { data: { name: string; value: number }[]; height?: number }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="shrink-0" style={{ height, width: Math.min(height, 190) }} role="img" aria-label="Distribution chart">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="92%" paddingAngle={1} stroke="none" isAnimationActive={false}>
              {data.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
            </Pie>
            <Tooltip content={moneyTip} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="min-w-[9rem] flex-1 space-y-1.5 text-xs">
        {data.slice(0, 8).map((d, i) => (
          <li key={d.name} className="flex items-center gap-2"><span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: PALETTE[i % PALETTE.length] }} /><span className="truncate text-ink-700">{d.name}</span><span className="ml-auto tabular-nums text-ink-500">{total ? Math.round((d.value / total) * 100) : 0}%</span></li>
        ))}
      </ul>
    </div>
  );
}
