import Link from 'next/link';
import styles from './Footer.module.css';

const footerLinks = [
  {
    title: 'Company',
    links: [
      { href: '/about', label: 'About' },
      { href: '/blog', label: 'Blog' },
      { href: '/contact', label: 'Contact' },
    ],
  },
  {
    title: 'Product',
    links: [
      { href: '/tools', label: 'Tools' },
      { href: '/pricing', label: 'Pricing' },
      { href: '/interview-prep', label: 'Interview Prep' },
    ],
  },
  {
    title: 'Resources',
    links: [
      { href: '/resume', label: 'Resume Resources' },
      { href: '/legal/privacy', label: 'Privacy Policy' },
      { href: '/support', label: 'Support' },
    ],
  },
];

export function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className={styles.footer} aria-label="Site footer">
      <div className="container stack-6">
        <div className={styles.footerTop}>
          <div className={styles.brand}>
            <strong>JobHackAI</strong>
            <p className="text-muted">AI-powered career acceleration for ambitious job seekers.</p>
          </div>
        </div>
        <div className={styles.sections}>
          {footerLinks.map((group) => (
            <div key={group.title} className="stack-3">
              <h3 className={styles.heading}>{group.title}</h3>
              <ul className={styles.linkList}>
                {group.links.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href}>{link.label}</Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className={styles.copyright}>© {currentYear} JobHackAI. All rights reserved.</p>
      </div>
    </footer>
  );
}

export default Footer;
