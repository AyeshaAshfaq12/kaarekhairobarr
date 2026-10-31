import React from 'react'
import { prisma } from '@/lib/portal/db'
import { ActionForm, Field, SubmitButton } from '@/components/portal/ActionForm'
import { saveEventAction } from './actions'

type EventValues = { id: string; name: string; description: string | null; startsAt: Date; venue: string | null; leadId: string; budget: number; collectionTarget: number }

function toLocalInput(date: Date) {
  // datetime-local in Asia/Karachi (UTC+5).
  return new Date(date.getTime() + 5 * 3_600_000).toISOString().slice(0, 16)
}

export default async function EventForm({ event, selfId, canChangeLead = true }: { event?: EventValues; selfId: string; canChangeLead?: boolean }) {
  const members = await prisma.member.findMany({ where: { status: 'ACTIVE' }, select: { id: true, fullName: true }, orderBy: { fullName: 'asc' } })
  return (
    <ActionForm action={saveEventAction} className="grid gap-4 sm:grid-cols-2">
      {event ? <input type="hidden" name="eventId" value={event.id} /> : null}
      <Field label="Name" name="name" className="sm:col-span-2">
        <input id="name" name="name" defaultValue={event?.name} required className="field" />
      </Field>
      <Field label="Date and time" name="startsAt">
        <input id="startsAt" name="startsAt" type="datetime-local" defaultValue={event ? toLocalInput(event.startsAt) : undefined} required className="field" />
      </Field>
      <Field label="Venue" name="venue">
        <input id="venue" name="venue" defaultValue={event?.venue ?? ''} className="field" />
      </Field>
      <Field label="Event lead" name="leadId" hint={canChangeLead ? undefined : 'Only an Admin can change the lead.'}>
        <select id="leadId" name="leadId" defaultValue={event?.leadId ?? selfId} required disabled={!canChangeLead} className="field">
          {members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.fullName}
            </option>
          ))}
        </select>
        {!canChangeLead && event ? <input type="hidden" name="leadId" value={event.leadId} /> : null}
      </Field>
      <div className="hidden sm:block" />
      <Field label="Budget — planned spend (PKR)" name="budget">
        <input id="budget" name="budget" type="number" min={0} inputMode="numeric" defaultValue={event?.budget} required className="field" />
      </Field>
      <Field label="Collection target (PKR)" name="collectionTarget" hint="Stored on the event's case; donations to it count as event collections.">
        <input id="collectionTarget" name="collectionTarget" type="number" min={0} inputMode="numeric" defaultValue={event?.collectionTarget} required className="field" />
      </Field>
      <Field label="Description" name="description" className="sm:col-span-2">
        <textarea id="description" name="description" rows={3} defaultValue={event?.description ?? ''} className="field" />
      </Field>
      <div className="sm:col-span-2">
        <SubmitButton>{event ? 'Save event' : 'Create event'}</SubmitButton>
      </div>
    </ActionForm>
  )
}
