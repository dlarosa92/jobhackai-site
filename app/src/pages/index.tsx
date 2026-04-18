import { useEffect } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '../lib/firebase'

export default function Home() {
  const router = useRouter()

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      router.replace(user ? '/dashboard' : '/login')
    })

    return () => unsubscribe()
  }, [router])

  return (
    <>
      <Head>
        <title>Redirecting | JobHackAI</title>
        <meta name="description" content="Redirecting to the JobHackAI app" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex, nofollow" />
        <link rel="icon" type="image/png" href="/assets/jobhackai_icon_Favicon_128.png" />
        <link rel="apple-touch-icon" href="/assets/jobhackai_icon_Favicon_128.png" />
      </Head>
      <main
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          color: '#1f2937',
          background: '#f8fafc'
        }}
      >
        <p>Redirecting to the app...</p>
      </main>
    </>
  )
}
