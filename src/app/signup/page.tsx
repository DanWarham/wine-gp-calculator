'use client'

import { useState } from "react"
import { supabase } from "@/lib/supabaseClient"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

export default function SignupPage() {
  const [email, setEmail] = useState<string>("")
  const [password, setPassword] = useState<string>("")
  const [loading, setLoading] = useState<boolean>(false)
  const [message, setMessage] = useState<string | null>(null)

  const handleSignup = async () => {
    setLoading(true)
    setMessage(null)

    const { error } = await supabase.auth.signUp({
      email,
      password
    })

    if (error) {
      setMessage(`❌ Error: ${error.message}`)
    } else {
      setMessage("✅ Sign up successful! You can now log in.")
    }

    setLoading(false)
  }

  return (
    <main className="p-6 max-w-md mx-auto flex flex-col justify-center min-h-screen">
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

          {message && (
            <div className="text-center text-sm pt-2">
              {message}
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
