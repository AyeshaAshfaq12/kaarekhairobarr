import React from 'react'
import { ACTIONS, MODULES, SCOPES, scopeRank, type PermissionKey, type ScopeName, type Viewer } from '@/lib/portal/rbac'
import { ActionForm, Field, SubmitButton } from '@/components/portal/ActionForm'
import { humanize } from '@/components/portal/ui'
import { saveRoleAction } from './actions'

export default function RoleEditor({
  viewer,
  role,
  readOnly = false,
}: {
  viewer: Viewer
  role?: { id: string; name: string; description: string | null; permissions: { module: string; action: string; scope: string }[] }
  readOnly?: boolean
}) {
  const current = new Map(role?.permissions.map((permission) => [`${permission.module}.${permission.action}`, permission.scope]) ?? [])

  return (
    <ActionForm action={saveRoleAction} className="space-y-5">
      {role ? <input type="hidden" name="roleId" value={role.id} /> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" name="name">
          <input id="name" name="name" defaultValue={role?.name} required disabled={readOnly} className="field" />
        </Field>
        <Field label="Description" name="description">
          <input id="description" name="description" defaultValue={role?.description ?? ''} disabled={readOnly} className="field" />
        </Field>
      </div>

      <div>
        <p className="label">Permissions</p>
        <p className="mb-3 text-xs text-ink-500">
          Scope, narrow → wide: own, assigned, team, subtree, all. A wider scope includes the narrower ones. You can only grant scopes you hold yourself; 🔒 grants are wider than yours and stay as they are.
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          {MODULES.map((module) => (
            <fieldset key={module} className="rounded-2xl border border-ink-900/5 bg-white p-3">
              <legend className="px-1 text-sm font-semibold text-ink-900">{humanize(module)}</legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {ACTIONS.map((action) => {
                  const key = `${module}.${action}` as PermissionKey
                  const held = viewer.perms.get(key)
                  const value = current.get(key) ?? ''
                  // A grant wider than the editor holds is shown but locked; the server keeps it as is.
                  const locked = !!value && scopeRank(held) < scopeRank(value as ScopeName)
                  return (
                    <label key={action} className="text-xs text-ink-600" title={locked ? "Wider than your own access, so you can't change it" : undefined}>
                      {action}
                      {locked ? ' 🔒' : ''}
                      <select
                        name={`perm:${key}`}
                        defaultValue={value}
                        disabled={readOnly || locked}
                        className={`mt-1 w-full rounded-xl border border-ink-900/10 bg-white px-2 py-1.5 text-xs ${value ? 'font-semibold text-forest-700' : 'text-ink-400'}`}
                      >
                        <option value="">—</option>
                        {SCOPES.map((scope) => (
                          <option key={scope} value={scope} disabled={scopeRank(held) < scopeRank(scope as ScopeName)}>
                            {scope}
                          </option>
                        ))}
                      </select>
                    </label>
                  )
                })}
              </div>
            </fieldset>
          ))}
        </div>
      </div>
      {!readOnly ? <SubmitButton>{role ? 'Save role' : 'Create role'}</SubmitButton> : null}
    </ActionForm>
  )
}
