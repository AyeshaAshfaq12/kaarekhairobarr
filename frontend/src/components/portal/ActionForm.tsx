'use client'

import React, { createContext, useContext, useEffect, useRef, type ReactNode } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import type { ActionState } from '@/lib/portal/validation'

type ServerAction = (state: ActionState, formData: FormData) => Promise<ActionState>

const FormStateContext = createContext<ActionState>({})

export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess = false,
  confirm,
  onSuccess,
}: {
  action: ServerAction
  children: ReactNode
  className?: string
  resetOnSuccess?: boolean
  confirm?: string
  onSuccess?: () => void
}) {
  const [state, formAction] = useFormState(action, {})
  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    if (state.ok) {
      if (state.message) toast.success(state.message)
      if (resetOnSuccess) formRef.current?.reset()
      onSuccess?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  return (
    <FormStateContext.Provider value={state}>
      <form
        ref={formRef}
        action={formAction}
        className={className}
        onSubmit={(event) => {
          if (confirm && !window.confirm(confirm)) event.preventDefault()
        }}
      >
        {state.ok === false && state.message ? (
          <p role="alert" className="mb-4 rounded-2xl bg-clay-50 px-4 py-3 text-sm font-medium text-clay-700">
            {state.message}
          </p>
        ) : null}
        {children}
      </form>
    </FormStateContext.Provider>
  )
}

export function FieldError({ name }: { name: string }) {
  const state = useContext(FormStateContext)
  const errors = state.fieldErrors?.[name]
  if (!errors?.length) return null
  return <p className="mt-1.5 text-xs font-medium text-clay-600">{errors[0]}</p>
}

export function Field({
  label,
  name,
  hint,
  children,
  className,
  htmlFor,
}: {
  label: string
  name: string
  hint?: ReactNode
  children: ReactNode
  className?: string
  /** Element id when several forms on one page share field names. Defaults to `name`. */
  htmlFor?: string
}) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor ?? name} className="label">
        {label}
      </label>
      {children}
      {hint ? <p className="mt-1.5 text-xs text-ink-500">{hint}</p> : null}
      <FieldError name={name} />
    </div>
  )
}

export function SubmitButton({
  children,
  variant = 'primary',
  className,
  name,
  value,
}: {
  children: ReactNode
  variant?: 'primary' | 'secondary' | 'outline' | 'danger'
  className?: string
  name?: string
  value?: string
}) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={pending}
      className={clsx(
        variant === 'danger' ? 'btn bg-clay-600 text-white hover:bg-clay-700' : `btn-${variant}`,
        'disabled:cursor-wait disabled:opacity-60',
        className
      )}
    >
      {pending ? 'Working…' : children}
    </button>
  )
}
