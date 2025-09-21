'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  GoogleAuthProvider,
  User,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
} from 'firebase/auth';
import { FirebaseError } from 'firebase/app';
import { auth, firebaseConfig } from '@/lib/firebase';
import styles from './auth-test.module.css';

type StatusTone = 'idle' | 'info' | 'success' | 'error';

type StatusState = {
  message: string;
  tone: StatusTone;
};

export default function AuthTestPage() {
  const firebaseAuth = auth;
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [status, setStatus] = useState<StatusState>(() => ({
    message: firebaseAuth ? 'Awaiting interaction.' : 'Firebase configuration missing NEXT_PUBLIC_* values.',
    tone: firebaseAuth ? 'info' : 'error',
  }));

  const appendLog = useCallback((entry: string) => {
    setLogs((previous) => [...previous, `${new Date().toLocaleTimeString()} — ${entry}`]);
  }, []);

  useEffect(() => {
    appendLog('Authentication QA harness initialised.');
  }, [appendLog]);

  useEffect(() => {
    if (!firebaseAuth) {
      return undefined;
    }

    const unsubscribe = onAuthStateChanged(firebaseAuth, (nextUser) => {
      setUser(nextUser);
      if (nextUser) {
        setStatus({
          message: `Authenticated as ${nextUser.email ?? nextUser.uid}.`,
          tone: 'success',
        });
        appendLog(`Auth state: signed in as ${nextUser.email ?? nextUser.uid}`);
      } else {
        setStatus({
          message: 'No user signed in.',
          tone: 'info',
        });
        appendLog('Auth state: signed out');
      }
    });

    return () => {
      unsubscribe();
    };
  }, [appendLog, firebaseAuth]);

  const handleError = useCallback(
    (error: unknown, context: string) => {
      let message = 'Unexpected error occurred.';

      if (error instanceof FirebaseError) {
        message = error.message;
      } else if (error instanceof Error) {
        message = error.message;
      }

      setStatus({
        message: `${context}: ${message}`,
        tone: 'error',
      });
      appendLog(`${context} failed — ${message}`);
    },
    [appendLog]
  );

  const handleGoogleSignIn = async () => {
    if (!firebaseAuth) {
      setStatus({ message: 'Firebase is not configured for OAuth flows.', tone: 'error' });
      return;
    }

    setIsBusy(true);
    setStatus({ message: 'Opening Google sign-in…', tone: 'info' });

    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      const result = await signInWithPopup(firebaseAuth, provider);
      setStatus({
        message: `Signed in with Google as ${result.user.email ?? result.user.uid}.`,
        tone: 'success',
      });
      appendLog(`Google sign-in successful — ${result.user.uid}`);
    } catch (error) {
      handleError(error, 'Google sign-in');
    } finally {
      setIsBusy(false);
    }
  };

  const handleEmailSignIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!firebaseAuth) {
      setStatus({ message: 'Firebase is not configured for email sign-in.', tone: 'error' });
      return;
    }

    setIsBusy(true);
    setStatus({ message: 'Signing in with email…', tone: 'info' });

    try {
      const credentials = await signInWithEmailAndPassword(firebaseAuth, email.trim(), password);
      setStatus({
        message: `Signed in as ${credentials.user.email ?? credentials.user.uid}.`,
        tone: 'success',
      });
      appendLog(`Email sign-in successful — ${credentials.user.uid}`);
    } catch (error) {
      handleError(error, 'Email sign-in');
    } finally {
      setIsBusy(false);
    }
  };

  const handleCreateAccount = async () => {
    if (!firebaseAuth) {
      setStatus({ message: 'Firebase is not configured for email sign-up.', tone: 'error' });
      return;
    }

    setIsBusy(true);
    setStatus({ message: 'Creating QA account…', tone: 'info' });

    try {
      const credentials = await createUserWithEmailAndPassword(firebaseAuth, email.trim(), password);
      setStatus({
        message: `Created QA account ${credentials.user.email ?? credentials.user.uid}.`,
        tone: 'success',
      });
      appendLog(`Email sign-up successful — ${credentials.user.uid}`);
    } catch (error) {
      handleError(error, 'Email sign-up');
    } finally {
      setIsBusy(false);
    }
  };

  const handleSendReset = async () => {
    if (!firebaseAuth) {
      setStatus({ message: 'Firebase is not configured for password reset.', tone: 'error' });
      return;
    }

    setIsBusy(true);
    setStatus({ message: 'Sending password reset email…', tone: 'info' });

    try {
      await sendPasswordResetEmail(firebaseAuth, email.trim());
      setStatus({ message: `Reset email sent to ${email.trim()}.`, tone: 'success' });
      appendLog(`Password reset email sent — ${email.trim()}`);
    } catch (error) {
      handleError(error, 'Password reset');
    } finally {
      setIsBusy(false);
    }
  };

  const handleSignOut = async () => {
    if (!firebaseAuth) {
      return;
    }

    setIsBusy(true);
    setStatus({ message: 'Signing out…', tone: 'info' });

    try {
      await signOut(firebaseAuth);
      setStatus({ message: 'Signed out successfully.', tone: 'success' });
      appendLog('Manual sign-out complete');
    } catch (error) {
      handleError(error, 'Sign out');
    } finally {
      setIsBusy(false);
    }
  };

  const statusClassName = useMemo(() => {
    const toneClass =
      status.tone === 'success'
        ? styles.statusSuccess
        : status.tone === 'error'
        ? styles.statusError
        : undefined;

    return [styles.statusValue, toneClass].filter(Boolean).join(' ');
  }, [status.tone]);

  const logContent = logs.length ? logs.join('\n') : 'No events recorded yet.';

  const apiKeyPreview = (() => {
    const key = firebaseConfig.apiKey;
    if (!key) return 'Not provided';
    if (key.length <= 10) return key;
    return `${key.slice(0, 6)}…${key.slice(-4)}`;
  })();

  const isEmailActionDisabled = isBusy || !email.trim() || !password;
  const isResetDisabled = isBusy || !email.trim();

  return (
    <section className="section" aria-labelledby="auth-qa-heading">
      <div className="container">
        <div className="stack-6">
          <header className={styles.sectionHeader}>
            <div className="badge" aria-label="QA environment badge">
              QA Sandbox
            </div>
            <h1 id="auth-qa-heading">Authentication QA harness</h1>
            <p>
              Exercise Firebase authentication flows against the deployed QA environment variables. Use the
              controls below to validate Google OAuth, email/password credentials, and recovery paths before a release.
            </p>
          </header>

          <div className={styles.grid}>
            <div className="card stack-4" aria-live="polite">
              <div className={styles.statusBlock}>
                <span className={styles.statusLabel}>Current status</span>
                <span className={statusClassName}>{status.message}</span>
              </div>
              <div className={styles.statusBlock}>
                <span className={styles.statusLabel}>Active user</span>
                <span className={styles.statusValue}>
                  {user ? `${user.email ?? 'No email'} · ${user.uid}` : 'None'}
                </span>
              </div>
              <div className={styles.statusBlock}>
                <span className={styles.statusLabel}>API key</span>
                <span className={styles.statusValue}>{apiKeyPreview}</span>
              </div>
              <div className={styles.actionRow}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={handleSignOut}
                  disabled={isBusy || !user || !firebaseAuth}
                >
                  Sign out
                </button>
              </div>
            </div>

            <div className="card stack-4">
              <div className="stack-3">
                <h2>Google OAuth</h2>
                <p className="text-muted">
                  Opens the hosted Google pop-up and signs the tester into Firebase using the QA project credentials.
                </p>
              </div>
              <div className={styles.actionRow}>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleGoogleSignIn}
                  disabled={isBusy || !firebaseAuth}
                >
                  Sign in with Google
                </button>
              </div>
            </div>

            <div className="card stack-4">
              <div className="stack-3">
                <h2>Email QA credentials</h2>
                <p className="text-muted">
                  Use disposable inboxes for manual QA. Passwords must meet Firebase rules configured for the project.
                </p>
              </div>
              <form className={styles.form} onSubmit={handleEmailSignIn}>
                <label className="field" htmlFor="auth-email">
                  <span>Email address</span>
                  <input
                    id="auth-email"
                    type="email"
                    autoComplete="email"
                    className="input"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="qa.tester@example.com"
                    required
                  />
                </label>
                <label className="field" htmlFor="auth-password">
                  <span>Password</span>
                  <input
                    id="auth-password"
                    type="password"
                    autoComplete="current-password"
                    className="input"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="At least 6 characters"
                    required
                  />
                </label>
                <div className={styles.formActions}>
                  <button type="submit" className="btn btn-primary" disabled={isEmailActionDisabled}>
                    Sign in with email
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={handleCreateAccount}
                    disabled={isEmailActionDisabled}
                  >
                    Create QA account
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={handleSendReset}
                    disabled={isResetDisabled}
                  >
                    Send password reset
                  </button>
                </div>
              </form>
            </div>

            <div className="card stack-4">
              <h2>Event log</h2>
              <p className="text-muted">Timestamped trail for QA evidence.</p>
              <pre className={styles.log}>{logContent}</pre>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
