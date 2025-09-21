'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import styles from './NavBar.module.css';

type NavItem = {
  href: string;
  label: string;
  requiresAuth?: boolean;
};

const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Home' },
  { href: '/dashboard', label: 'Dashboard', requiresAuth: true },
  { href: '/blog', label: 'Blog' },
  { href: '/resume', label: 'Resume' },
  { href: '/tools', label: 'Tools' },
  { href: '/interview-prep', label: 'Interview Prep' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/about', label: 'About' },
  { href: '/contact', label: 'Contact' },
];

export function NavBar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  useEffect(() => {
    if (!auth) return;

    const unsub = onAuthStateChanged(auth, (user) => {
      setUserEmail(user?.email ?? null);
    });

    return () => {
      unsub();
    };
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const filteredNavItems = useMemo(() => {
    return NAV_ITEMS.filter((item) => {
      if (item.requiresAuth && !userEmail) {
        return false;
      }
      return true;
    });
  }, [userEmail]);

  const navClassName = [styles.nav, mobileOpen ? styles.navOpen : ''].filter(Boolean).join(' ');

  async function handleSignOut() {
    if (!auth) return;
    try {
      await signOut(auth);
    } catch (error) {
      console.error('Failed to sign out', error);
    }
  }

  return (
    <header className={styles.header} aria-label="Primary navigation">
      <div className="container">
        <div className={styles.inner}>
          <Link href="/" className={styles.brand} aria-label="JobHackAI home">
            JobHackAI
          </Link>
          <button
            type="button"
            className={styles.navToggle}
            aria-label="Toggle navigation"
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((prev) => !prev)}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        </div>
        <nav className={navClassName} aria-label="Primary">
          <ul className={styles.navList}>
            {filteredNavItems.map((item) => {
              const isActive = pathname === item.href;
              const className = [styles.navLink, isActive ? styles.navLinkActive : '']
                .filter(Boolean)
                .join(' ');

              return (
                <li key={item.href}>
                  <Link href={item.href} className={className}>
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className={styles.ctaGroup}>
            {userEmail ? (
              <button type="button" className="btn btn-ghost" onClick={handleSignOut}>
                Sign out
              </button>
            ) : (
              <Link href="/login" className="btn btn-primary">
                Sign in
              </Link>
            )}
          </div>
        </nav>
      </div>
    </header>
  );
}

export default NavBar;
