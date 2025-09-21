import type { Metadata } from 'next';
import StripeTestClient from './StripeTestClient';
import styles from './stripe-test.module.css';

export const metadata: Metadata = {
  title: 'Stripe QA harness – JobHackAI',
  description: 'Validate publishable key wiring and Cloudflare Stripe worker flows in QA.',
};

export default function StripeTestPage() {
  const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '';

  return (
    <section className="section" aria-labelledby="stripe-qa-heading">
      <div className="container">
        <div className="stack-6">
          <header className={styles.sectionHeader}>
            <div className="badge" aria-label="QA environment badge">
              QA Sandbox
            </div>
            <h1 id="stripe-qa-heading">Stripe QA harness</h1>
            <p>
              Confirm the Cloudflare Pages QA environment exposes the expected publishable key and that the
              Worker-backed subscription endpoints respond correctly before promoting a build.
            </p>
          </header>

          <div className={styles.layout}>
            <StripeTestClient publishableKey={publishableKey} />
          </div>
        </div>
      </div>
    </section>
  );
}
