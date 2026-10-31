import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/portal/db'
import { can, requireActiveViewer } from '@/lib/portal/rbac'
import { getSettings } from '@/lib/portal/settings'
import { formatDate, formatDateTime } from '@/lib/portal/time'
import { isWhatsAppConfigured } from '@/lib/portal/whatsapp'
import { ActionForm, Field, SubmitButton } from '@/components/portal/ActionForm'
import { Badge, Card, PageHeader } from '@/components/portal/ui'
import {
  deleteChecklistItemAction,
  moveChecklistItemAction,
  publishNdaAction,
  saveChecklistItemAction,
  updateOrgSettingsAction,
} from '../actions'

export const metadata: Metadata = { title: 'Organisation settings | KKB Portal' }

function ItemFields({ item }: { item?: { title: string; description: string | null; completedBy: string; isActive: boolean } }) {
  const system = item?.completedBy === 'SYSTEM'
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Title" name="title">
        <input name="title" defaultValue={item?.title} required className="field" />
      </Field>
      <Field label="Description" name="description">
        <input name="description" defaultValue={item?.description ?? ''} className="field" />
      </Field>
      <Field label="Ticked by" name="completedBy">
        <select name="completedBy" defaultValue={system ? 'MEMBER' : item?.completedBy ?? 'MEMBER'} disabled={system} className="field">
          <option value="MEMBER">The member</option>
          <option value="LEAD">Their lead</option>
        </select>
        {system ? <input type="hidden" name="completedBy" value="MEMBER" /> : null}
      </Field>
      <label className="flex items-center gap-2 self-end pb-3 text-sm">
        <input type="checkbox" name="isActive" defaultChecked={item?.isActive ?? true} className="h-4 w-4 accent-forest-600" /> Active
      </label>
    </div>
  )
}

export default async function OrgSettingsPage() {
  const viewer = await requireActiveViewer()
  if (!can(viewer, 'settings', 'edit')) notFound()
  const [settings, nda, items, waMessages, waOptedIn] = await Promise.all([
    getSettings(),
    prisma.ndaVersion.findFirst({ where: { isActive: true }, orderBy: { version: 'desc' }, include: { _count: { select: { signatures: true } } } }),
    prisma.onboardingItem.findMany({ orderBy: { order: 'asc' } }),
    viewer.isAdmin ? prisma.whatsAppMessage.findMany({ orderBy: { createdAt: 'desc' }, take: 20 }) : Promise.resolve([]),
    prisma.user.count({ where: { whatsappOptIn: true, disabledAt: null } }),
  ])

  return (
    <>
      <PageHeader title="Organisation settings" />
      <div className="space-y-5">
        <Card title="General">
          <ActionForm action={updateOrgSettingsAction} className="grid gap-4 sm:grid-cols-2">
            <Field label="Minimum member age" name="minimumAge">
              <input id="minimumAge" name="minimumAge" type="number" min={10} max={80} defaultValue={settings.minimumAge} className="field" />
            </Field>
            <Field label="Handbook link" name="handbookUrl">
              <input id="handbookUrl" name="handbookUrl" type="url" defaultValue={settings.handbookUrl} placeholder="https://" className="field" />
            </Field>
            <Field label='"On track" at achievement ≥ (%)' name="bandOnTrack">
              <input id="bandOnTrack" name="bandOnTrack" type="number" defaultValue={settings.bandOnTrack} className="field" />
            </Field>
            <Field label='"Close" at achievement ≥ (%)' name="bandClose" hint="Below this is Behind.">
              <input id="bandClose" name="bandClose" type="number" defaultValue={settings.bandClose} className="field" />
            </Field>
            <div className="sm:col-span-2">
              <SubmitButton variant="secondary">Save</SubmitButton>
            </div>
          </ActionForm>
        </Card>

        {viewer.isAdmin ? (
          <Card title="Onboarding checklist template">
            <ul className="space-y-3">
              {items.map((item, index) => (
                <li key={item.id} className="rounded-2xl border border-ink-900/5 bg-cream-50/60 p-3">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <p className="flex items-center gap-2 text-sm font-semibold">
                      {index + 1}. {item.title}
                      {item.completedBy === 'SYSTEM' ? <Badge tone="blue">Automatic</Badge> : null}
                      {!item.isActive ? <Badge>Inactive</Badge> : null}
                    </p>
                    <div className="flex gap-1">
                      {(['up', 'down'] as const).map((direction) => (
                        <ActionForm key={direction} action={moveChecklistItemAction}>
                          <input type="hidden" name="itemId" value={item.id} />
                          <input type="hidden" name="direction" value={direction} />
                          <SubmitButton variant="outline" className="!px-3 !py-1 text-xs">
                            {direction === 'up' ? '↑' : '↓'}
                          </SubmitButton>
                        </ActionForm>
                      ))}
                      {!item.autoKey ? (
                        <ActionForm action={deleteChecklistItemAction} confirm={`Delete "${item.title}"?`}>
                          <input type="hidden" name="itemId" value={item.id} />
                          <SubmitButton variant="outline" className="!px-3 !py-1 text-xs">
                            Delete
                          </SubmitButton>
                        </ActionForm>
                      ) : null}
                    </div>
                  </div>
                  <details>
                    <summary className="cursor-pointer text-xs font-medium text-forest-700">Edit</summary>
                    <ActionForm action={saveChecklistItemAction} className="mt-3 space-y-3">
                      <input type="hidden" name="itemId" value={item.id} />
                      <ItemFields item={item} />
                      <SubmitButton variant="secondary">Save item</SubmitButton>
                    </ActionForm>
                  </details>
                </li>
              ))}
            </ul>
            <details className="mt-4">
              <summary className="cursor-pointer text-sm font-semibold text-forest-700">+ Add item</summary>
              <ActionForm action={saveChecklistItemAction} className="mt-3 space-y-3" resetOnSuccess>
                <ItemFields />
                <SubmitButton variant="secondary">Add item</SubmitButton>
              </ActionForm>
            </details>
          </Card>
        ) : null}

        {viewer.isAdmin ? (
          <Card title="WhatsApp (Cloud API)">
            <p className="text-sm text-ink-700">
              Status: <span className="font-semibold">{isWhatsAppConfigured() ? 'Connected' : 'Not configured'}</span> · {waOptedIn} member(s) opted in.
            </p>
            {!isWhatsAppConfigured() ? (
              <p className="mt-2 text-xs text-ink-500">
                Set WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_APP_SECRET, WHATSAPP_VERIFY_TOKEN and an approved template (WHATSAPP_TEMPLATE, two body
                parameters). Point the Meta webhook at /api/portal/whatsapp/webhook.
              </p>
            ) : null}
            {waMessages.length ? (
              <ul className="mt-4 divide-y divide-ink-900/5 text-xs">
                {waMessages.map((message) => (
                  <li key={message.id} className="flex flex-wrap justify-between gap-2 py-2">
                    <span className="min-w-0 truncate">
                      <span className="font-semibold">{message.direction === 'IN' ? '←' : '→'} {message.phone}</span> {message.body.slice(0, 80)}
                    </span>
                    <span className={message.status === 'failed' || message.status === 'rejected' ? 'text-clay-600' : 'text-ink-500'}>
                      {message.status} · {formatDateTime(message.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </Card>
        ) : null}

        <Card title="Member agreement (NDA)">
          {nda ? (
            <p className="mb-4 text-sm text-ink-600">
              Current: version {nda.version}, published {formatDate(nda.publishedAt)}, {nda._count.signatures} signatures.
            </p>
          ) : null}
          <p className="mb-4 rounded-2xl bg-cream-100 px-4 py-3 text-sm text-cream-800">
            Publishing creates a new version. Every active member must re-sign it before they can continue using the portal.
          </p>
          <ActionForm action={publishNdaAction} className="space-y-4" confirm="Publish a new version? All active members will be asked to re-sign.">
            <Field label="Title" name="title">
              <input id="title" name="title" defaultValue={nda?.title} required className="field" />
            </Field>
            <Field label="Text (Markdown headings with # and ##)" name="body">
              <textarea id="body" name="body" rows={16} defaultValue={nda?.body} required className="field font-mono text-xs" />
            </Field>
            <SubmitButton>Publish new version</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  )
}
