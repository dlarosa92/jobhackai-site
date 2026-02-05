import React, { useState, useEffect } from 'react';
import { GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut } from 'firebase/auth';
import { auth } from '../lib/firebase';

const AuthTestPage: React.FC = () => {
  const [user, setUser] = useState<any>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [apiResponse, setApiResponse] = useState<any>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        setMessage(`User signed in: ${currentUser.email}`);
      } else {
        setMessage('User signed out');
      }
    });
    return () => unsubscribe();
  }, []);

  const handleGoogleSignIn = async () => {
    const provider = new GoogleAuthProvider();
    try {
      const result = await signInWithPopup(auth, provider);
      setMessage(`Google sign-in result: ${JSON.stringify(result.user)}`);
    } catch (error: any) {
      setMessage(`Google sign-in error: ${error.message}`);
      console.error('Google sign-in failed:', error);
    }
  };

  const handleEmailSignUp = async () => {
    try {
      const result = await createUserWithEmailAndPassword(auth, email, password);
      setMessage(`Email sign-up result: ${JSON.stringify(result.user)}`);
    } catch (error: any) {
      setMessage(`Email sign-up error: ${error.message}`);
      console.error('Email sign-up failed:', error);
    }
  };

  const handleEmailSignIn = async () => {
    try {
      const result = await signInWithEmailAndPassword(auth, email, password);
      setMessage(`Email sign-in result: ${JSON.stringify(result.user)}`);
    } catch (error: any) {
      setMessage(`Email sign-in error: ${error.message}`);
      console.error('Email sign-in failed:', error);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
      setMessage('User signed out');
      setApiResponse(null);
    } catch (error: any) {
      setMessage(`Sign out error: ${error.message}`);
      console.error('Sign out failed:', error);
    }
  };

  const testApiAuthentication = async () => {
    if (!user) {
      setMessage('Please sign in first to test API authentication.');
      return;
    }
    try {
      const idToken = await user.getIdToken();
      const response = await fetch('/api/auth', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ idToken }),
      });
      const data = await response.json();
      setApiResponse(data);
      setMessage(`API Test was a ${data.success ? 'success' : 'failure'}`);
    } catch (error: any) {
      setMessage(`API Test error: ${error.message}`);
      console.error('API Test failed:', error);
    }
  };

  return (
    <div style={{ fontFamily: 'Arial, sans-serif', maxWidth: '800px', margin: '20px auto', padding: '20px', border: '1px solid #ccc', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
      <h1 style={{ textAlign: 'center', color: '#333' }}>Firebase Authentication Test</h1>
      <p style={{ textAlign: 'center', color: '#666' }}>Current Status: {message}</p>

      <div style={{ marginBottom: '20px', padding: '15px', backgroundColor: '#f9f9f9', border: '1px solid #eee', borderRadius: '5px' }}>
        <h2 style={{ color: '#555' }}>User Info</h2>
        {user ? (
          <div>
            <p><strong>UID:</strong> {user.uid}</p>
            <p><strong>Email:</strong> {user.email}</p>
            <p><strong>Email Verified:</strong> {user.emailVerified ? 'Yes' : 'No'}</p>
            <p><strong>Display Name:</strong> {user.displayName || 'N/A'}</p>
            <button onClick={handleSignOut} style={{ backgroundColor: '#dc3545', color: 'white', padding: '10px 15px', border: 'none', borderRadius: '5px', cursor: 'pointer', fontSize: '16px' }}>Sign Out</button>
          </div>
        ) : (
          <p>No user signed in.</p>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-around', marginBottom: '30px' }}>
        <button onClick={handleGoogleSignIn} style={{ backgroundColor: '#4285F4', color: 'white', padding: '12px 20px', border: 'none', borderRadius: '5px', cursor: 'pointer', fontSize: '18px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google logo" style={{ width: '20px', height: '20px' }} />
          Sign in with Google
        </button>
        <button onClick={testApiAuthentication} disabled={!user} style={{ backgroundColor: user ? '#28a745' : '#cccccc', color: 'white', padding: '12px 20px', border: 'none', borderRadius: '5px', cursor: 'pointer', fontSize: '18px' }}>
          Test API Authentication
        </button>
      </div>

      <div style={{ marginBottom: '20px', padding: '15px', backgroundColor: '#f9f9f9', border: '1px solid #eee', borderRadius: '5px' }}>
        <h2 style={{ color: '#555' }}>Email/Password Authentication</h2>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{ width: 'calc(100% - 22px)', padding: '10px', margin: '5px 0', border: '1px solid #ddd', borderRadius: '4px' }}
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{ width: 'calc(100% - 22px)', padding: '10px', margin: '5px 0', border: '1px solid #ddd', borderRadius: '4px' }}
        />
        <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
          <button onClick={handleEmailSignUp} style={{ backgroundColor: '#007bff', color: 'white', padding: '10px 15px', border: 'none', borderRadius: '5px', cursor: 'pointer', fontSize: '16px' }}>Sign Up</button>
          <button onClick={handleEmailSignIn} style={{ backgroundColor: '#6c757d', color: 'white', padding: '10px 15px', border: 'none', borderRadius: '5px', cursor: 'pointer', fontSize: '16px' }}>Sign In</button>
        </div>
      </div>

      {apiResponse && (
        <div style={{ marginTop: '30px', padding: '15px', backgroundColor: '#e9ecef', border: '1px solid #dee2e6', borderRadius: '8px' }}>
          <h2 style={{ color: '#555' }}>API Response</h2>
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', backgroundColor: '#f8f9fa', padding: '10px', borderRadius: '5px', border: '1px solid #e2e6ea' }}>
            {JSON.stringify(apiResponse, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
};

export default AuthTestPage;
