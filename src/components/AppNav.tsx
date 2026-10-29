'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabaseClient'

export type AppNavActive =
  | 'calculator'
  | 'pricing-configurations'
  | 'pricing-data'
  | 'pricing-reviews'
  | 'settings'

interface AppNavProps {
  active: AppNavActive
  showLogout?: boolean
}

export function AppNav({ active, showLogout = true }: AppNavProps) {
  const router = useRouter()
  const [accountLabel, setAccountLabel] = useState<string | null>(null)

  useEffect(() => {
    if (!showLogout) return

    let cancelled = false

    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return
      const email = session?.user?.email?.trim()
      setAccountLabel(email || null)
    })

    return () => {
      cancelled = true
    }
  }, [showLogout])

  return (
    <div className="flex flex-wrap gap-2 justify-between">
      <div className="flex flex-wrap gap-2">
        <Button
          variant={active === 'calculator' ? 'secondary' : 'outline'}
          disabled={active === 'calculator'}
          onClick={() => router.push('/')}
        >
          Calculator
        </Button>
        <Button
          variant={active === 'pricing-configurations' ? 'secondary' : 'outline'}
          disabled={active === 'pricing-configurations'}
          className={
            active === 'pricing-configurations'
              ? undefined
              : 'border-blue-400 text-blue-600 hover:bg-blue-50'
          }
          onClick={() => router.push('/pricing-configurations')}
        >
          Pricing Configurations
        </Button>
        <Button
          variant={active === 'pricing-data' ? 'secondary' : 'outline'}
          disabled={active === 'pricing-data'}
          className={
            active === 'pricing-data' ? undefined : 'border-blue-400 text-blue-600 hover:bg-blue-50'
          }
          onClick={() => router.push('/pricing-data')}
        >
          Pricing Data
        </Button>
        <Button
          variant={active === 'pricing-reviews' ? 'secondary' : 'outline'}
          disabled={active === 'pricing-reviews'}
          className={
            active === 'pricing-reviews'
              ? undefined
              : 'border-blue-400 text-blue-600 hover:bg-blue-50'
          }
          onClick={() => router.push('/pricing-reviews')}
        >
          Pricing Reviews
        </Button>
        <Button
          variant={active === 'settings' ? 'secondary' : 'outline'}
          disabled={active === 'settings'}
          className={
            active === 'settings' ? undefined : 'border-blue-400 text-blue-600 hover:bg-blue-50'
          }
          onClick={() => router.push('/settings')}
        >
          Settings
        </Button>
      </div>
      {showLogout && (
        <div className="flex flex-wrap items-center gap-2">
          {accountLabel && (
            <span className="text-sm text-muted-foreground truncate max-w-[14rem]" title={accountLabel}>
              {accountLabel}
            </span>
          )}
          <Button
            variant="outline"
            className="text-red-600 border-red-400 hover:bg-red-50"
            onClick={async () => {
              await supabase.auth.signOut()
              router.push('/welcome')
            }}
          >
            Logout
          </Button>
        </div>
      )}
    </div>
  )
}
