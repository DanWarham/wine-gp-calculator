'use client'

import { useState } from "react"
import { supabase } from "@/lib/supabaseClient"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { useRouter } from "next/navigation"
import { useToast } from "@/components/toast-provider"

export default function LoginPage() {
  const router = useRouter()
  const { showToast } = useToast()

  const [email, setEmail] = useState<string>("")
  const [password, setPassword] = useState<string>("")
  const [loading, setLoading] = useState<boolean>(false)
  const [fadeOut, setFadeOut] = useState<boolean>(false)
  const [showPassword, setShowPassword] = useState<boolean>(false)

  const handleLogin = async () => {
    setLoading(true)

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password
    })

    if (error) {
      const { data, error: lookupError } = await supabase
        .from('users')
        .select('id')
        .eq('email', email)
        .single()

      if (lookupError || !data) {
        showToast("❌ Email not found", "error")
      } else {
        showToast("❌ Incorrect password. Please try again.", "error")
      }
    } else {
      showToast("✅ Logged in successfully!", "success")
      setTimeout(() => {
        router.push("/") // Redirect to home after login
      }, 1000)
    }

    setLoading(false)
  }

  const handleGoToSignup = () => {
    setFadeOut(true)
    setTimeout(() => {
      router.push('/signup')
    }, 300) // 300ms fade
  }

  return (
    <main className={`p-6 max-w-md mx-auto flex flex-col justify-center min-h-screen transition-opacity duration-300 ${fadeOut ? 'opacity-0' : 'opacity-100'}`}>
      <Card className="shadow-md">
        <CardContent className="space-y-6 py-8">
          <h1 className="text-2xl font-bold text-center">Log In</h1>

          <div className="space-y-2">
            <label className="text-sm font-semibold text-gray-700">Email</label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>

          <div className="space-y-2 relative">
            <label className="text-sm font-semibold text-gray-700">Password</label>
            <Input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
            />
            <button
              type="button"
              aria-label={showPassword ? "Hide password" : "Show password"}
              onClick={() => setShowPassword(v => !v)}
              className="absolute right-2 top-8 text-gray-500 hover:text-gray-700 focus:outline-none"
              tabIndex={0}
            >
              {showPassword ? '🙈' : '👁️'}
            </button>
          </div>

          <Button
            onClick={handleLogin}
            disabled={loading}
            className="w-full"
          >
            {loading ? "Logging in..." : "Log In"}
          </Button>

          <div className="text-center py-4 text-gray-500">— OR —</div>

          <Button
            variant="outline"
            onClick={handleGoToSignup}
            className="w-full"
          >
            Register
          </Button>
        </CardContent>
      </Card>
    </main>
  )
}
