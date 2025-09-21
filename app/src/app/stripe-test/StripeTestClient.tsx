'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import styles from './stripe-test.module.css';

type StripeAction = 'create-checkout-session' | 'create-customer-portal';

interface StripeTestClientProps {
  publishableKey: string;
}

export default function StripeTestClient({ publishableKey }: StripeTestClientProps) {
  const [priceId, setPriceId] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [userId, setUserId] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [logs, setLogs] = useState<string[]>([]);
  const [result, setResult] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const appendLog = useCallback((entry: string) => {
    setLogs((previous) => [...previous, `${new Date().toLocaleTimeString()} — ${entry}`]);
  }, []);

  useEffect(() => {
    appendLog('Stripe QA harness initialised.');
  }, [appendLog]);

  const publishableKeyPreview = useMemo(() => {
    if (!publishableKey) return 'Not provided';
    if (publishableKey.length <= 10) return publishableKey;
    return `${publishableKey.slice(0, 6)}…${publishableKey.slice(-4)}`;
  }, [publishableKey]);

  const isConfigured = Boolean(publishableKey);

  const handleError = useCallback(
    (error: unknown, context: string) => {
      const message = error instanceof Error ? error.message : 'Unknown error';
      appendLog(`${context} failed — ${message}`);
      setResult(`Error: ${message}`);
    },
    [appendLog]
  );

  const callStripeWorker = useCallback(
    async (action: StripeAction, payload: Record<string, unknown>) => {
      setIsBusy(true);
      setResult(null);
      appendLog(`Requesting ${action}…`);

      try {
        const response = await fetch('/api/stripe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, data: payload }),
        });

        const responseText = await response.text();

        if (!response.ok) {
          throw new Error(responseText || `Request failed with status ${response.status}`);
        }

        let parsed: unknown = responseText;
        try {
          parsed = responseText ? JSON.parse(responseText) : null;
        } catch (parseError) {
          // Leave parsed as raw text if JSON parsing fails
        }

        const formatted = typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2);
        appendLog(`${action} succeeded.`);
        setResult(formatted || 'Success — empty payload.');
      } catch (error) {
        handleError(error, action);
      } finally {
        setIsBusy(false);
      }
    },
    [appendLog, handleError]
  );

  const handleCheckout = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!isConfigured) {
      handleError(new Error('Publishable key is not configured.'), 'Checkout');
      return;
    }

    await callStripeWorker('create-checkout-session', {
      priceId: priceId.trim(),
      userEmail: userEmail.trim(),
      userId: userId.trim(),
    });
  };

  const handlePortal = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!isConfigured) {
      handleError(new Error('Publishable key is not configured.'), 'Customer portal');
      return;
    }

    await callStripeWorker('create-customer-portal', {
      customerId: customerId.trim(),
    });
  };

  const logContent = logs.length ? logs.join('\n') : 'No events recorded yet.';

  return (
    <div className="stack-5">
      <div className="card stack-4">
        <div className={styles.summaryCard}>
          <div className="stack-2">
            <span className={styles.keyHighlight}>Publishable key · {publishableKeyPreview}</span>
            <p className="text-muted">
              Ensure the Cloudflare Pages environment exposes <code>NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY</code>. The
              publishable key is safe for client-side usage.
            </p>
          </div>
          {!isConfigured && (
            <p className={styles.keyHighlight} role="alert">
              Missing publishable key — QA checkout calls are disabled.
            </p>
          )}
        </div>
      </div>

      <div className="card stack-4">
        <div className="stack-3">
          <h2>Mock subscription checkout</h2>
          <p className="text-muted">
            Calls the Cloudflare Worker at <code>/api/stripe</code> to create a subscription checkout session. Use
            sandbox prices from the Stripe dashboard.
          </p>
        </div>
        <form className={styles.testForm} onSubmit={handleCheckout}>
          <label className="field" htmlFor="price-id">
            <span>Stripe Price ID</span>
            <input
              id="price-id"
              name="price-id"
              className="input"
              value={priceId}
              onChange={(event) => setPriceId(event.target.value)}
              placeholder="price_12345QA"
              required
            />
          </label>
          <label className="field" htmlFor="user-email">
            <span>Customer email</span>
            <input
              id="user-email"
              name="user-email"
              type="email"
              className="input"
              value={userEmail}
              onChange={(event) => setUserEmail(event.target.value)}
              placeholder="qa.customer@example.com"
              required
            />
          </label>
          <label className="field" htmlFor="user-id">
            <span>Internal user ID (metadata)</span>
            <input
              id="user-id"
              name="user-id"
              className="input"
              value={userId}
              onChange={(event) => setUserId(event.target.value)}
              placeholder="user_qa_123"
              required
            />
          </label>
          <div className={styles.actionRow}>
            <button type="submit" className="btn btn-primary" disabled={isBusy || !isConfigured}>
              Create checkout session
            </button>
          </div>
        </form>
      </div>

      <div className="card stack-4">
        <div className="stack-3">
          <h2>Customer portal</h2>
          <p className="text-muted">
            Validate that existing subscribers can access the Stripe billing portal with the provided Customer ID.
          </p>
        </div>
        <form className={styles.testForm} onSubmit={handlePortal}>
          <label className="field" htmlFor="customer-id">
            <span>Customer ID</span>
            <input
              id="customer-id"
              className="input"
              value={customerId}
              onChange={(event) => setCustomerId(event.target.value)}
              placeholder="cus_123QA"
            />
          </label>
          <div className={styles.actionRow}>
            <button
              type="submit"
              className="btn btn-ghost"
              disabled={isBusy || !isConfigured || !customerId.trim()}
            >
              Create customer portal session
            </button>
          </div>
        </form>
      </div>

      <div className="card stack-4">
        <h2>Response payload</h2>
        <p className="text-muted">Raw JSON response from the worker endpoint.</p>
        <pre className={styles.log}>{result ?? 'Awaiting response.'}</pre>
      </div>

      <div className="card stack-4">
        <h2>Event log</h2>
        <p className="text-muted">Chronological trace of actions for QA evidence.</p>
        <pre className={styles.log}>{logContent}</pre>
      </div>
    </div>
  );
}
