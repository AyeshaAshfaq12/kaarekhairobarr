'use client'

import React, { useMemo, useState } from 'react'
import clsx from 'clsx'
import { ActionForm, Field, FieldError, SubmitButton } from '@/components/portal/ActionForm'
import { logOutreachAction } from '../donors/actions'

type Option = { id: string; label: string; hint?: string }

const CHANNELS = [
  ['WHATSAPP', 'WhatsApp'],
  ['CALL', 'Call'],
  ['IN_PERSON', 'In person'],
  ['SOCIAL', 'Social'],
  ['OTHER', 'Other'],
] as const
const OUTCOMES = [
  ['CONTACTED', 'Contacted'],
  ['PROMISED', 'Promised'],
  ['DONATED', 'Donated'],
  ['DECLINED', 'Declined'],
  ['NO_RESPONSE', 'No reply'],
] as const

function Segmented({ name, options, value, onChange }: { name: string; options: readonly (readonly [string, string])[]; value: string; onChange: (value: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(([key, label]) => (
        <label key={key} className={clsx('cursor-pointer rounded-full border px-3 py-1.5 text-sm', value === key ? 'border-ink-900 bg-ink-900 text-cream-50' : 'border-ink-900/10 bg-white text-ink-700')}>
          <input type="radio" name={name} value={key} checked={value === key} onChange={() => onChange(key)} className="sr-only" />
          {label}
        </label>
      ))}
    </div>
  )
}

/** One-screen outreach logging for phones (§7.3, target ≤ 30 seconds). */
export default function QuickAdd({ donors, cases, members, selfId }: { donors: Option[]; cases: Option[]; members: Option[]; selfId: string }) {
  const [query, setQuery] = useState('')
  const [donorId, setDonorId] = useState('')
  const [isNew, setIsNew] = useState(false)
  const [channel, setChannel] = useState('WHATSAPP')
  const [outcome, setOutcome] = useState('CONTACTED')

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const digits = q.replace(/\D/g, '')
    return donors.filter((donor) => donor.label.toLowerCase().includes(q) || (digits.length >= 3 && donor.hint?.includes(digits))).slice(0, 6)
  }, [donors, query])
  const selected = donors.find((donor) => donor.id === donorId)

  const reset = () => {
    setQuery('')
    setDonorId('')
    setIsNew(false)
    setOutcome('CONTACTED')
  }

  return (
    <ActionForm action={logOutreachAction} className="space-y-4" resetOnSuccess onSuccess={reset}>
      <div>
        <label className="label" htmlFor="donor-search">
          Donor
        </label>
        {selected ? (
          <div className="flex items-center justify-between rounded-3xl border border-forest-200 bg-forest-50 px-4 py-3 text-sm">
            <span className="font-medium text-forest-800">{selected.label}</span>
            <button type="button" onClick={() => setDonorId('')} className="text-xs font-semibold text-forest-700">
              Change
            </button>
          </div>
        ) : isNew ? (
          <div className="grid gap-2 sm:grid-cols-2">
            <input name="newDonorName" defaultValue={query} placeholder="Donor name" required className="field" autoFocus />
            <input name="newDonorPhone" type="tel" placeholder="Phone (dedupes donors)" className="field" />
            <button type="button" onClick={() => setIsNew(false)} className="text-left text-xs font-semibold text-forest-700">
              ← Search existing donors instead
            </button>
          </div>
        ) : (
          <>
            <input id="donor-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name or phone" autoComplete="off" className="field" />
            {query ? (
              <ul className="mt-2 overflow-hidden rounded-2xl border border-ink-900/5 bg-white">
                {matches.map((donor) => (
                  <li key={donor.id}>
                    <button type="button" onClick={() => setDonorId(donor.id)} className="flex w-full justify-between px-4 py-2.5 text-left text-sm hover:bg-cream-50">
                      <span>{donor.label}</span>
                      {donor.hint ? <span className="text-xs text-ink-400">…{donor.hint.slice(-4)}</span> : null}
                    </button>
                  </li>
                ))}
                <li>
                  <button type="button" onClick={() => setIsNew(true)} className="w-full px-4 py-2.5 text-left text-sm font-semibold text-forest-700 hover:bg-cream-50">
                    + Add &quot;{query}&quot; as a new donor
                  </button>
                </li>
              </ul>
            ) : (
              <button type="button" onClick={() => setIsNew(true)} className="mt-2 text-xs font-semibold text-forest-700">
                + New donor
              </button>
            )}
          </>
        )}
        <input type="hidden" name="donorId" value={donorId} />
        <FieldError name="donorId" />
        <FieldError name="newDonorPhone" />
      </div>

      <div>
        <span className="label">Channel</span>
        <Segmented name="channel" options={CHANNELS} value={channel} onChange={setChannel} />
      </div>
      <div>
        <span className="label">Outcome</span>
        <Segmented name="outcome" options={OUTCOMES} value={outcome} onChange={setOutcome} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Promised (PKR)" name="promisedAmount">
          <input id="promisedAmount" name="promisedAmount" type="number" inputMode="numeric" min={1} required={outcome === 'PROMISED'} className="field" />
        </Field>
        <Field label="Follow up on" name="followUpAt">
          <input id="followUpAt" name="followUpAt" type="date" className="field" />
        </Field>
      </div>

      <details className="rounded-2xl bg-cream-50/70 px-3 py-2">
        <summary className="cursor-pointer text-sm font-medium text-ink-700">More: case, notes{members.length > 1 ? ', log for someone else' : ''}</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Case" name="caseId">
            <select id="caseId" name="caseId" defaultValue="" className="field">
              <option value="">No specific case</option>
              {cases.map((kase) => (
                <option key={kase.id} value={kase.id}>
                  {kase.label}
                </option>
              ))}
            </select>
          </Field>
          {members.length > 1 ? (
            <Field label="Logged for" name="memberId">
              <select id="memberId" name="memberId" defaultValue={selfId} className="field">
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.label}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          <Field label="Notes" name="notes" className="sm:col-span-2">
            <textarea id="notes" name="notes" rows={2} className="field" />
          </Field>
        </div>
      </details>

      <SubmitButton className="w-full sm:w-auto">Log outreach</SubmitButton>
    </ActionForm>
  )
}
