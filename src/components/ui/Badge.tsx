import { cn } from '@/lib/utils'

type Variant = 'default' | 'green' | 'yellow' | 'red' | 'blue' | 'gray'

const variantClass: Record<Variant, string> = {
  default: 'bg-gray-100 text-gray-700',
  green:   'bg-green-100 text-green-800',
  yellow:  'bg-yellow-100 text-yellow-800',
  red:     'bg-red-100 text-red-800',
  blue:    'bg-blue-100 text-blue-800',
  gray:    'bg-gray-100 text-gray-500',
}

export default function Badge({
  children,
  variant = 'default',
  className,
}: {
  children: React.ReactNode
  variant?: Variant
  className?: string
}) {
  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 rounded text-xs font-medium', variantClass[variant], className)}>
      {children}
    </span>
  )
}
