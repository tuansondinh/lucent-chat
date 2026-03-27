import * as React from 'react'

import { cn } from '../../lib/utils'

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'file:text-text-primary placeholder:text-text-tertiary bg-bg-secondary border-border h-9 w-full min-w-0 rounded-md border px-3 py-1 text-base text-text-primary shadow-xs outline-none transition-colors file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
        'focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20',
        className,
      )}
      {...props}
    />
  )
}

export { Input }
