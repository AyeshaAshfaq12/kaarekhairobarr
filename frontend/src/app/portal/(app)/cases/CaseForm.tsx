import React from 'react'
import { ActionForm, Field, SubmitButton } from '@/components/portal/ActionForm'
import { toDateInput } from '@/lib/portal/time'
import { saveCaseAction } from './actions'

export const CASE_CATEGORIES = ['RATION', 'DIALYSIS', 'CANCER', 'DEBT', 'EDUCATION', 'OTHER'] as const

type CaseValues = {
  id: string
  title: string
  category: string
  description: string
  targetAmount: number
  startDate: Date
  endDate: Date | null
  beneficiary: { fullName: string; phone: string | null; city: string | null; condition: string | null; notes: string | null } | null
}

export default function CaseForm({ kase, showBeneficiary = true }: { kase?: CaseValues; showBeneficiary?: boolean }) {
  return (
    <ActionForm action={saveCaseAction} className="space-y-6">
      {kase ? <input type="hidden" name="caseId" value={kase.id} /> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Title" name="title" className="sm:col-span-2">
          <input id="title" name="title" defaultValue={kase?.title} required className="field" />
        </Field>
        <Field label="Category" name="category">
          <select id="category" name="category" defaultValue={kase?.category ?? ''} required className="field">
            <option value="" disabled>
              Choose…
            </option>
            {CASE_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {category.charAt(0) + category.slice(1).toLowerCase()}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Target (PKR)" name="targetAmount">
          <input id="targetAmount" name="targetAmount" type="number" inputMode="numeric" min={1} step={1} defaultValue={kase?.targetAmount} required className="field" />
        </Field>
        <Field label="Start date" name="startDate">
          <input id="startDate" name="startDate" type="date" defaultValue={toDateInput(kase?.startDate ?? new Date())} required className="field" />
        </Field>
        <Field label="End date (optional)" name="endDate">
          <input id="endDate" name="endDate" type="date" defaultValue={toDateInput(kase?.endDate)} className="field" />
        </Field>
        <Field label="Description" name="description" className="sm:col-span-2" hint="Shown to every active member. Keep identifying details in the beneficiary section.">
          <textarea id="description" name="description" rows={4} defaultValue={kase?.description} required className="field" />
        </Field>
        {!kase ? (
          <Field label="Start as" name="status">
            <select id="status" name="status" defaultValue="DRAFT" className="field">
              <option value="DRAFT">Draft (only you and Admins see it)</option>
              <option value="OPEN">Open (visible to all members)</option>
            </select>
          </Field>
        ) : null}
      </div>

      {showBeneficiary ? (
        <fieldset className="space-y-4 rounded-2xl border border-ink-900/5 bg-cream-50/60 p-4">
          <legend className="px-1 text-sm font-semibold text-ink-900">Beneficiary (optional, restricted)</legend>
          <p className="text-xs text-ink-500">Only assigned members, the case creator and Admins can see these details.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" name="beneficiaryName">
              <input id="beneficiaryName" name="beneficiaryName" defaultValue={kase?.beneficiary?.fullName} className="field" />
            </Field>
            <Field label="Phone" name="beneficiaryPhone">
              <input id="beneficiaryPhone" name="beneficiaryPhone" type="tel" defaultValue={kase?.beneficiary?.phone ?? ''} className="field" />
            </Field>
            <Field label="CNIC" name="beneficiaryCnic" hint={kase?.beneficiary ? 'Leave blank to keep the stored CNIC.' : 'Stored encrypted.'}>
              <input id="beneficiaryCnic" name="beneficiaryCnic" placeholder="35202-1234567-1" className="field" />
            </Field>
            <Field label="City" name="beneficiaryCity">
              <input id="beneficiaryCity" name="beneficiaryCity" defaultValue={kase?.beneficiary?.city ?? ''} className="field" />
            </Field>
            <Field label="Condition" name="beneficiaryCondition" className="sm:col-span-2">
              <input id="beneficiaryCondition" name="beneficiaryCondition" defaultValue={kase?.beneficiary?.condition ?? ''} className="field" />
            </Field>
            <Field label="Notes" name="beneficiaryNotes" className="sm:col-span-2">
              <textarea id="beneficiaryNotes" name="beneficiaryNotes" rows={2} defaultValue={kase?.beneficiary?.notes ?? ''} className="field" />
            </Field>
            <Field label="Documents" name="documents" hint="JPG, PNG or PDF, up to 5 MB each." className="sm:col-span-2">
              <input id="documents" name="documents" type="file" multiple accept="image/jpeg,image/png,application/pdf" className="field" />
            </Field>
          </div>
        </fieldset>
      ) : null}

      <SubmitButton>{kase ? 'Save case' : 'Create case'}</SubmitButton>
    </ActionForm>
  )
}
