import { useEffect } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '../lib/firebase'

export default function Home() {
  const router = useRouter()

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        // User is signed in, redirect to dashboard
        router.push('/dashboard')
      }
      // If user is not signed in, stay on landing page
    })

    return () => unsubscribe()
  }, [router])

  return (
    <>
      <Head>
        <title>JobHackAI</title>
        <meta name="description" content="Optimize your resume for ATS systems and land more interviews" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" type="image/png" sizes="32x32" href="/assets/JobHackAI_Logo_favicon-32x32.png" />
        <link rel="icon" type="image/png" sizes="512x512" href="/assets/JobHackAI_Logo_favicon-512x512.png" />
        <link rel="apple-touch-icon" sizes="512x512" href="/assets/JobHackAI_Logo_favicon-512x512.png" />
      </Head>
      
      <main className="container">
        <div className="hero">
          <h1>Welcome to JobHackAI</h1>
          <p>Your ATS-optimized resume starts here</p>
          
          <div className="auth-section">
            <button 
              className="btn-primary"
              onClick={() => router.push('/dashboard')}
            >
              Get Started
            </button>
            <button 
              className="btn-secondary"
              onClick={() => router.push('/dashboard')}
            >
              Sign In
            </button>
          </div>

          <div className="features">
            <div className="feature-card">
              <h3>ATS Resume Scoring</h3>
              <p>Get your resume scored for ATS compatibility and receive detailed feedback on how to improve.</p>
            </div>
            <div className="feature-card">
              <h3>Resume Feedback</h3>
              <p>AI-powered feedback system that helps you optimize your resume for maximum impact.</p>
            </div>
            <div className="feature-card">
              <h3>Cover Letter Generator</h3>
              <p>Create personalized cover letters for any job posting with our AI-powered generator.</p>
            </div>
            <div className="feature-card">
              <h3>Interview Questions</h3>
              <p>Practice with AI-generated interview questions tailored to your target role.</p>
            </div>
          </div>
        </div>
      </main>
    </>
  )
}
