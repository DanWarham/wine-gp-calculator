'use client'

import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

export default function WelcomePage() {
  const router = useRouter()

  return (
    <main className="flex flex-col justify-center items-center min-h-screen p-6">
      <Card className="shadow-md max-w-md w-full">
        <CardContent className="py-10 space-y-6">
          <h1 className="text-3xl font-bold text-center text-gray-800">Welcome to Wine GP Calculator</h1>
          <p className="text-center text-gray-600">Please log in or register to continue.</p>
          
          <div className="flex flex-col space-y-4">
            <Button className="w-full" onClick={() => router.push("/login")}>
              Login
            </Button>
            <Button variant="outline" className="w-full" onClick={() => router.push("/signup")}>
              Register
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  )
}
