'use client'

import React, { useState } from 'react'
import { ActionForm, Field, FieldError, SubmitButton } from '@/components/portal/ActionForm'
import type { ActionState } from '@/lib/portal/validation'

type Option = { id: string; label: string }

export type DonationDefaults = {
  id?: string
  donorId?: string
  caseId?: string
  amount?: number
  receivedAt?: string
  method?: string
  transactionRef?: string | null
  cashReceivedNote?: string | null
  coCreditIds?: string[]
  hasProof?: boolean
}

const METHODS = [
  ['EASYPAISA', 'Easypaisa'],
  ['JAZZCASH', 'JazzCash'],
  ['BANK', 'Bank transfer'],
  ['CASH', 'Cash'],
  ['OTHER', 'Other'],
] as const

export default function DonationForm({
  action,
  donors,
  cases,
  members,
  coCredit,
  selfId,
  defaults = {},
  submitLabel,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>
  donors: Option[]
  cases: Option[]
  /** Members the viewer may log for (self, or their subtree). */
  members: Option[]
  /** Co-credit candidates; the server checks they approached the donor. */
  coCredit: Option[]
  selfId: string
  defaults?: DonationDefaults
  submitLabel: string
}) {
  const [method, setMethod] = useState(defaults.method ?? 'EASYPAISA')
  const [newDonor, setNewDonor] = useState(!defaults.id && donors.length === 0)
  const editing = !!defaults.id
  const cash = method === 'CASH'

  return (
    <ActionForm action={action} className="space-y-5">
      {editing ? <input type="hidden" name="donationId" value={defaults.id} /> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        {editing ? null : newDonor ? (
          <>
            <Field label="New donor name" name="newDonorName">
              <input id="newDonorName" name="newDonorName" required className="field" />
            </Field>
            <Field label="Donor phone" name="newDonorPhone" hint="Existing phone numbers link the existing donor.">
              <input id="newDonorPhone" name="newDonorPhone" type="tel" className="field" />
            </Field>
            {donors.length ? (
              <button type="button" onClick={() => setNewDonor(false)} className="text-left text-xs font-semibold text-forest-700 sm:col-span-2">
                ← Pick an existing donor
              </button>
            ) : null}
          </>
        ) : (
          <Field label="Donor" name="donorId" className="sm:col-span-2">
            <select id="donorId" name="donorId" defaultValue={defaults.donorId ?? ''} required className="field">
              <option value="" disabled>
                Choose a donor…
              </option>
              {donors.map((donor) => (
                <option key={donor.id} value={donor.id}>
                  {donor.label}
                </option>
              ))}
            </select>
            <button type="button" onClick={() => setNewDonor(true)} className="mt-2 text-xs font-semibold text-forest-700">
              + New donor
            </button>
          </Field>
        )}
        <Field label="Case" name="caseId">
          <select id="caseId" name="caseId" defaultValue={defaults.caseId ?? ''} required className="field">
            <option value="" disabled>
              Choose a case…
            </option>
            {cases.map((kase) => (
              <option key={kase.id} value={kase.id}>
                {kase.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Amount (PKR)" name="amount">
          <input id="amount" name="amount" type="number" inputMode="numeric" min={1} step={1} defaultValue={defaults.amount} required className="field" />
        </Field>
        <Field label="Received on" name="receivedAt">
          <input id="receivedAt" name="receivedAt" type="date" defaultValue={defaults.receivedAt} required className="field" />
        </Field>
        <Field label="Method" name="method">
          <select id="method" name="method" value={method} onChange={(event) => setMethod(event.target.value)} className="field">
            {METHODS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        {cash ? (
          <Field label="Who received the cash?" name="cashReceivedNote" className="sm:col-span-2" hint="Required for cash. Hand it over within 3 days.">
            <input id="cashReceivedNote" name="cashReceivedNote" defaultValue={defaults.cashReceivedNote ?? ''} required className="field" />
          </Field>
        ) : (
          <>
            <Field label="Transaction ref" name="transactionRef">
              <input id="transactionRef" name="transactionRef" defaultValue={defaults.transactionRef ?? ''} className="field" />
            </Field>
            <Field label="Payment screenshot" name="proof" hint={defaults.hasProof ? 'Leave empty to keep the current proof.' : 'Required. JPG, PNG or PDF up to 5 MB.'}>
              <input id="proof" name="proof" type="file" accept="image/jpeg,image/png,application/pdf" required={!defaults.hasProof} className="field" />
            </Field>
          </>
        )}
        {!editing && members.length > 1 ? (
          <Field label="Credited to" name="memberId">
            <select id="memberId" name="memberId" defaultValue={selfId} className="field">
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.label}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
      </div>

      <details className="rounded-2xl bg-cream-50/70 px-3 py-2" open={!!defaults.coCreditIds?.length}>
        <summary className="cursor-pointer text-sm font-medium text-ink-700">Co-credit another member who also approached this donor</summary>
        <div className="mt-3 max-h-48 space-y-1 overflow-y-auto">
          {coCredit
            .filter((member) => member.id !== selfId)
            .map((member) => (
              <label key={member.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="coCreditIds" value={member.id} defaultChecked={defaults.coCreditIds?.includes(member.id)} className="h-4 w-4 accent-forest-600" />
                {member.label}
              </label>
            ))}
        </div>
        <p className="mt-2 text-xs text-ink-500">Each credited member gets the full amount in their personal numbers; team totals count it once.</p>
      </details>

      <label className="flex items-center gap-2 text-sm text-ink-700">
        <input type="checkbox" name="confirmDuplicate" value="1" className="h-4 w-4 accent-clay-600" /> Log anyway if it looks like a duplicate
      </label>
      <FieldError name="confirmDuplicate" />

      <SubmitButton>{submitLabel}</SubmitButton>
    </ActionForm>
  )
}
