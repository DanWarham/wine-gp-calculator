'use client'

import { useState } from "react"
import { supabase } from "@/lib/supabaseClient"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { useRouter } from "next/navigation"
import { useToast } from "@/components/toast-provider"

export default function SignupPage() {
  const router = useRouter()
  const { showToast } = useToast()

  const [email, setEmail] = useState<string>("")
  const [password, setPassword] = useState<string>("")
  const [loading, setLoading] = useState<boolean>(false)
  const [fadeOut, setFadeOut] = useState<boolean>(false)

  const handleSignup = async () => {
    setLoading(true)

    const { error } = await supabase.auth.signUp({
      email,
      password
    })

    if (error) {
      if (error.message.includes('already registered') || error.message.includes('User already registered')) {
        showToast("❌ Account already exists. Would you like to login?", "error")
      } else {
        showToast(`❌ Error: ${error.message}`, "error")
      }
    } else {
      showToast("✅ Sign up successful! You can now log in.", "success")
      setTimeout(() => {
        router.push("/login")
      }, 1000)
    }

    setLoading(false)
  }

  const handleGoToLogin = () => {
    setFadeOut(true)
    setTimeout(() => {
      router.push('/login')
    }, 300) // 300ms fade
  }

  return (
    <main className={`p-6 max-w-md mx-auto flex flex-col justify-center min-h-screen transition-opacity duration-300 ${fadeOut ? 'opacity-0' : 'opacity-100'}`}>
      <Card className="shadow-md">
        <CardContent className="space-y-6 py-8">
          <h1 className="text-2xl font-bold text-center">Sign Up</h1>

          <div className="space-y-2">
            <label className="text-sm font-semibold text-gray-700">Email</label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold text-gray-700">Password</label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
            />
          </div>

          <Button
            onClick={handleSignup}
            disabled={loading}
            className="w-full"
          >
            {loading ? "Signing Up..." : "Sign Up"}
          </Button>

          <div className="text-center py-4 text-gray-500">— OR —</div>

          <Button
            variant="outline"
            onClick={handleGoToLogin}
            className="w-full"
          >
            Log In
          </Button>
        </CardContent>
      </Card>
    </main>
  )
}
