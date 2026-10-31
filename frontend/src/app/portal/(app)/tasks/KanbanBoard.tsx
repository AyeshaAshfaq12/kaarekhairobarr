'use client'

import Link from 'next/link'
import React, { useState, useTransition } from 'react'
import clsx from 'clsx'
import toast from 'react-hot-toast'
import { moveTaskAction } from './actions'

export type BoardTask = {
  id: string
  title: string
  status: string
  priority: string
  assignee: string | null
  due: string | null
  overdue: boolean
  canMove: boolean
}

const COLUMNS = [
  ['TODO', 'To do'],
  ['IN_PROGRESS', 'In progress'],
  ['IN_REVIEW', 'In review'],
  ['BLOCKED', 'Blocked'],
  ['DONE', 'Done'],
  ['CANCELLED', 'Cancelled'],
] as const

const PRIORITY_DOT: Record<string, string> = { LOW: 'bg-ink-200', MEDIUM: 'bg-sky-400', HIGH: 'bg-cream-500', URGENT: 'bg-clay-500' }

/** Kanban per team (§6.2): columns = statuses, drag to move. Phones use the status menu. */
export default function KanbanBoard({ tasks: initial }: { tasks: BoardTask[] }) {
  const [tasks, setTasks] = useState(initial)
  const [dragging, setDragging] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  const move = (id: string, status: string) => {
    const before = tasks
    const task = tasks.find((item) => item.id === id)
    if (!task || task.status === status) return
    setTasks((current) => current.map((item) => (item.id === id ? { ...item, status } : item)))
    startTransition(async () => {
      const result = await moveTaskAction(id, status)
      if (result.ok === false) {
        setTasks(before)
        toast.error(result.message ?? 'Could not move the task.')
      }
    })
  }

  return (
    <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-3 sm:mx-0 sm:px-0">
      {COLUMNS.map(([status, label]) => {
        const items = tasks.filter((task) => task.status === status)
        return (
          <div
            key={status}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => {
              if (dragging) move(dragging, status)
              setDragging(null)
            }}
            className="w-[78vw] max-w-[280px] shrink-0 snap-start rounded-3xl bg-cream-100/60 p-3 sm:w-64"
          >
            <p className="mb-2 flex justify-between px-1 text-xs font-semibold uppercase tracking-wide text-ink-500">
              {label} <span>{items.length}</span>
            </p>
            <ul className="min-h-[60px] space-y-2">
              {items.map((task) => (
                <li
                  key={task.id}
                  draggable={task.canMove}
                  onDragStart={() => setDragging(task.id)}
                  className={clsx('rounded-2xl bg-white p-3 text-sm shadow-soft', task.canMove && 'cursor-grab', dragging === task.id && 'opacity-50')}
                >
                  <Link href={`/portal/tasks/${task.id}`} className="flex items-start gap-2 font-medium text-ink-900 hover:text-forest-700">
                    <span className={clsx('mt-1.5 h-2 w-2 shrink-0 rounded-full', PRIORITY_DOT[task.priority])} title={task.priority.toLowerCase()} />
                    {task.title}
                  </Link>
                  <p className="mt-1 text-xs text-ink-500">
                    {task.assignee ?? 'Unassigned'}
                    {task.due ? <span className={task.overdue ? 'font-semibold text-clay-600' : ''}> · {task.due}</span> : null}
                  </p>
                  {task.canMove ? (
                    <select
                      value={task.status}
                      onChange={(event) => move(task.id, event.target.value)}
                      aria-label={`Move ${task.title}`}
                      className="mt-2 w-full rounded-xl border border-ink-900/10 bg-cream-50 px-2 py-1 text-xs sm:hidden"
                    >
                      {COLUMNS.map(([value, text]) => (
                        <option key={value} value={value}>
                          {text}
                        </option>
                      ))}
                    </select>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </div>
  )
}
