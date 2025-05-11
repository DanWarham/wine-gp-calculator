'use client'

import { useState, useRef } from "react"
import { supabase } from "@/lib/supabaseClient"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { useRouter } from "next/navigation"
import { useToast } from "@/components/toast-provider"

function validateEmail(email: string) {
  // Simple email regex for demonstration; you can use a stricter one if needed
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export default function SignupPage() {
  const router = useRouter()
  const { showToast } = useToast()

  const [email, setEmail] = useState<string>("")
  const [password, setPassword] = useState<string>("")
  const [loading, setLoading] = useState<boolean>(false)
  const [fadeOut, setFadeOut] = useState<boolean>(false)
  const [emailError, setEmailError] = useState<string | null>(null)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState<boolean>(false)
  const passwordInputRef = useRef<HTMLInputElement>(null)

  const passwordRequirements = [
    { test: (pw: string) => pw.length >= 8, label: 'At least 8 characters' },
    { test: (pw: string) => /[A-Z]/.test(pw), label: 'One uppercase letter' },
    { test: (pw: string) => /[a-z]/.test(pw), label: 'One lowercase letter' },
    { test: (pw: string) => /[0-9]/.test(pw), label: 'One number' },
  ]
  const validatePassword = (password: string) => {
    return passwordRequirements.every(req => req.test(password))
  }

  const handleSignup = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    let valid = true
    if (!validateEmail(email)) {
      setEmailError("Please enter a valid email address.")
      valid = false
    } else {
      setEmailError(null)
    }
    if (!validatePassword(password)) {
      setPasswordError("Password must meet the specified requirements.")
      valid = false
    } else {
      setPasswordError(null)
    }
    if (!valid) return
    setLoading(true)
    const { data, error } = await supabase.auth.signUp({
      email,
      password
    })
    if (error) {
      if (error.message.toLowerCase().includes('rate limit') || error.message.toLowerCase().includes('too many')) {
        showToast("❌ Too many attempts. Please try again later.", "error")
      } else if (error.message.includes('already registered') || error.message.includes('User already registered')) {
        showToast("❌ Account already exists. Would you like to login?", "error")
      } else {
        showToast(`❌ Error: ${error.message}`, "error")
      }
    } else if (data.session) {
      showToast("✅ Sign up successful! You are now logged in.", "success")
      setTimeout(() => {
        router.push("/")
      }, 1000)
    } else {
      showToast("✅ Sign up successful! Please check your email to verify your account.", "success")
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

          <form onSubmit={handleSignup} autoComplete="on">
            <div className="space-y-2">
              <label htmlFor="signup-email" className="text-sm font-semibold text-gray-700">Email</label>
              <Input
                id="signup-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                aria-invalid={!!emailError}
                aria-describedby={emailError ? 'signup-email-error' : undefined}
                autoComplete="email"
              />
              {emailError && <p id="signup-email-error" className="text-sm text-red-500 mt-1">{emailError}</p>}
            </div>

            <div className="space-y-2 relative">
              <label htmlFor="signup-password" className="text-sm font-semibold text-gray-700">Password</label>
              <Input
                id="signup-password"
                ref={passwordInputRef}
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                aria-invalid={!!passwordError}
                aria-describedby={passwordError ? 'signup-password-error' : 'signup-password-reqs'}
                autoComplete="new-password"
                onKeyDown={e => {
                  if (e.key === 'Enter') handleSignup(e)
                }}
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
              <ul id="signup-password-reqs" className="text-xs text-gray-600 mt-1 space-y-0.5">
                {passwordRequirements.map((req, i) => (
                  <li key={i} className={req.test(password) ? 'text-green-600' : 'text-gray-400'}>
                    {req.label}
                  </li>
                ))}
              </ul>
              {passwordError && <p id="signup-password-error" className="text-sm text-red-500 mt-1">{passwordError}</p>}
            </div>

            <Button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center"
              aria-busy={loading}
            >
              {loading ? <span className="animate-spin mr-2">⏳</span> : null}
              {loading ? "Signing Up..." : "Sign Up"}
            </Button>
          </form>

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
