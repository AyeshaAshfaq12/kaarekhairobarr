import type { Metadata } from 'next'
import { requireActiveViewer } from '@/lib/portal/rbac'
import { getSettings } from '@/lib/portal/settings'
import Checklist, { loadChecklist } from '@/components/portal/Checklist'
import NewMembersWidget from '@/components/portal/NewMembersWidget'
import { Card, PageHeader } from '@/components/portal/ui'

export const metadata: Metadata = { title: 'Onboarding | KKB Portal' }

export default async function OnboardingPage() {
  const viewer = await requireActiveViewer()
  const [rows, settings] = await Promise.all([loadChecklist(viewer.memberId), getSettings()])

  return (
    <>
      <PageHeader title="Onboarding" description="Your first steps as a KKB member." />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="My checklist">
          {settings.handbookUrl ? (
            <p className="mb-4 text-sm">
              <a href={settings.handbookUrl} target="_blank" rel="noreferrer" className="font-medium text-forest-700 underline">
                Open the KKB handbook
              </a>
            </p>
          ) : null}
          <Checklist viewer={viewer} memberId={viewer.memberId} rows={rows} />
        </Card>
        <NewMembersWidget viewer={viewer} />
      </div>
    </>
  )
}
