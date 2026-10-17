// Shared page header — consistent title / description / actions across pages.
import React from 'react'

export default function PageHeader({ title, subtitle, actions }: {
  title: string
  subtitle?: string
  actions?: React.ReactNode
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div className="min-w-[260px] flex-1">
        <h1 className="text-[20px] font-semibold tracking-[-0.02em]">{title}</h1>
        {subtitle && <p className="mt-1 max-w-[640px] text-[12.5px] text-fg-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center justify-end gap-2">{actions}</div>}
    </div>
  )
}
