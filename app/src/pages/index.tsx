import { useState, useEffect } from 'react'
import Head from 'next/head'

export default function Home() {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [userPlan, setUserPlan] = useState('free')

  useEffect(() => {
    // Check authentication status
    const checkAuth = async () => {
      // This will be implemented with Firebase Auth
      console.log('Checking authentication...')
    }
    
    checkAuth()
  }, [])

  return (
    <>
      <Head>
        <title>JobHackAI - ATS Resume Optimization</title>
        <meta name="description" content="Optimize your resume for ATS systems and land more interviews" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>
      
      <main className="container">
        <div className="hero">
          <h1>Welcome to JobHackAI</h1>
          <p>Your ATS-optimized resume starts here</p>
          
          {!isAuthenticated ? (
            <div className="auth-section">
              <button className="btn-primary">Start Free Trial</button>
              <button className="btn-secondary">Login</button>
            </div>
          ) : (
            <div className="dashboard-preview">
              <h2>Dashboard</h2>
              <p>Current Plan: {userPlan}</p>
              <div className="features">
                <div className="feature-card">
                  <h3>ATS Resume Scoring</h3>
                  <p>Get your resume scored for ATS compatibility</p>
                </div>
                <div className="feature-card">
                  <h3>Resume Feedback</h3>
                  <p>Detailed feedback on how to improve your resume</p>
                </div>
                <div className="feature-card">
                  <h3>Interview Questions</h3>
                  <p>Practice with AI-generated interview questions</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </>
  )
}
