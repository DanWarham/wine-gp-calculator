'use client'

import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabaseClient'

export type AppNavActive = 'calculator' | 'pricing-configurations' | 'settings'

interface AppNavProps {
  active: AppNavActive
  showLogout?: boolean
}

export function AppNav({ active, showLogout = true }: AppNavProps) {
  const router = useRouter()

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
      )}
    </div>
  )
}
