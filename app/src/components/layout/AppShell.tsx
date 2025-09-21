import { ReactNode } from 'react';
import NavBar from './NavBar';
import Footer from './Footer';
import styles from './AppShell.module.css';

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  return (
    <div className={styles.shell}>
      <a href="#main-content" className="sr-only">
        Skip to content
      </a>
      <NavBar />
      <main id="main-content" className={styles.main}>
        {children}
      </main>
      <Footer />
    </div>
  );
}

export default AppShell;
