'use client'

import React from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function label(month: string) {
  const [year, m] = month.split('-')
  return `${MONTHS[Number(m) - 1]} ${year.slice(2)}`
}

function compact(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`
  return String(value)
}

/** Monthly raised (verified) with pending stacked lighter on top. */
export default function TrendChart({ data }: { data: { month: string; raised: number; pending: number }[] }) {
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data.map((row) => ({ ...row, label: label(row.month) }))} margin={{ top: 8, right: 4, left: -12, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="#e9efee" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} stroke="#54706b" />
          <YAxis tickFormatter={compact} tickLine={false} axisLine={false} fontSize={11} stroke="#54706b" width={44} />
          <Tooltip
            formatter={(value: number, name: string) => [`PKR ${value.toLocaleString('en-PK')}`, name === 'raised' ? 'Verified' : 'Pending']}
            contentStyle={{ borderRadius: 12, border: '1px solid #e9efee', fontSize: 12 }}
          />
          <Bar dataKey="raised" stackId="a" fill="#2c8b51" radius={[0, 0, 0, 0]} />
          <Bar dataKey="pending" stackId="a" fill="#aad5ba" radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
