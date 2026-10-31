'use client'

import React, { useEffect, useRef, useState } from 'react'
import { ActionForm, Field, FieldError, SubmitButton } from '@/components/portal/ActionForm'
import { signNdaAction } from '../actions'

function renderBody(body: string) {
  return body.split('\n').map((line, index) => {
    if (line.startsWith('# ')) return <h2 key={index} className="mb-3 font-display text-xl font-semibold text-ink-900">{line.slice(2)}</h2>
    if (line.startsWith('## ')) return <h3 key={index} className="mb-1 mt-4 font-semibold text-ink-900">{line.slice(3)}</h3>
    if (!line.trim()) return <div key={index} className="h-2" />
    return <p key={index} className="mb-1">{line}</p>
  })
}

export default function NdaSignForm({
  ndaVersionId,
  bodySha256,
  body,
  fullName,
}: {
  ndaVersionId: string
  bodySha256: string
  body: string
  fullName: string
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [readToEnd, setReadToEnd] = useState(false)

  const handleScroll = () => {
    const el = scrollRef.current
    if (el && el.scrollTop + el.clientHeight >= el.scrollHeight - 24) setReadToEnd(true)
  }

  // On a tall screen the whole text may fit without scrolling.
  useEffect(handleScroll, [])

  return (
    <ActionForm action={signNdaAction} className="space-y-5">
      <input type="hidden" name="ndaVersionId" value={ndaVersionId} />
      <input type="hidden" name="bodySha256" value={bodySha256} />
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        tabIndex={0}
        aria-label="Agreement text"
        className="h-[55vh] overflow-y-auto rounded-2xl border border-ink-900/10 bg-white px-4 py-4 text-sm leading-relaxed text-ink-700 sm:h-[420px] sm:px-6"
      >
        {renderBody(body)}
      </div>
      {!readToEnd ? <p className="text-xs text-ink-500">Scroll to the end of the agreement to enable &quot;I agree&quot;.</p> : null}

      <label className={`flex items-start gap-3 text-sm ${readToEnd ? 'text-ink-900' : 'text-ink-300'}`}>
        <input type="checkbox" name="agree" disabled={!readToEnd} className="mt-0.5 h-5 w-5 accent-forest-600" />
        <span>I agree to the Member Confidentiality and Conduct Agreement.</span>
      </label>
      <FieldError name="agree" />

      <Field label="Type your full name to sign" name="typedName" hint={`Must match: ${fullName}`}>
        <input id="typedName" name="typedName" autoComplete="off" required disabled={!readToEnd} className="field" />
      </Field>

      <SubmitButton className="w-full sm:w-auto">Sign agreement</SubmitButton>
    </ActionForm>
  )
}
