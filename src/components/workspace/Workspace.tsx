import { Search } from 'lucide-react';
import type { InputHTMLAttributes, ReactNode } from 'react';
import styles from './workspace.module.css';

export function WorkspaceHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return <header className={styles.header}>
    <div><h1>{title}</h1>{description && <p>{description}</p>}</div>
    {actions && <div className={styles.headerActions}>{actions}</div>}
  </header>;
}

export function WorkspaceToolbar({ children, label }: { children: ReactNode; label: string }) {
  return <div className={styles.toolbar} role="group" aria-label={label}>{children}</div>;
}

export function WorkspaceSearch({ label, action, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; action?: ReactNode }) {
  return <div className={styles.search}>
    <Search aria-hidden="true" />
    <input {...props} type="search" aria-label={label} />
    {action}
  </div>;
}
