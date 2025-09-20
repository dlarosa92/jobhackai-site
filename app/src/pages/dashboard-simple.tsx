import Head from 'next/head';

export default function DashboardSimple() {
  return (
    <>
      <Head>
        <title>Dashboard - JobHackAI</title>
        <meta name="description" content="Manage your JobHackAI subscription and access all features" />
      </Head>

      <div style={{ padding: '40px', maxWidth: '800px', margin: '0 auto' }}>
        <h1>JobHackAI Dashboard</h1>
        <p>This is a simple test of the dashboard page routing.</p>
        
        <div style={{ marginTop: '40px' }}>
          <h2>Features</h2>
          <ul>
            <li>ATS Resume Scoring</li>
            <li>Resume Feedback</li>
            <li>Cover Letter Generator</li>
            <li>Interview Questions</li>
          </ul>
        </div>

        <div style={{ marginTop: '40px' }}>
          <h2>Current Plan</h2>
          <p>Free Plan</p>
        </div>
      </div>
    </>
  );
}
