'use client';

import {
  Building2,
  Check,
  Clipboard,
  Clock3,
  Mail,
  MapPin,
  ShieldCheck,
  UserMinus,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import {
  FormEvent,
  ReactNode,
  RefObject,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';

import { createSignInRedirect } from '@/lib/auth/callback-url';
import type { WorkspaceSettingsData as SettingsData } from '@/lib/account/workspace-settings';
import {
  workspaceFetch,
  workspaceMutationFetch,
} from '@/lib/client/workspace-prefetch';

import { WorkspaceHeader } from '../workspace/Workspace';
import styles from './settings-workspace.module.css';

export type WorkspaceSettingsData = SettingsData;

type WorkspaceForm = WorkspaceSettingsData['workspace'];
type Problem = { detail?: string; errors?: Record<string, string[]> };

export type SettingsWorkspaceError = {
  kind: 'load' | 'operation' | 'access-refresh';
  message: string;
};

export type SettingsLoadResult =
  | { ok: true }
  | { ok: false; message: string };

export async function runAccessChangeAndReload(
  change: () => Promise<void>,
  reload: () => Promise<SettingsLoadResult>,
): Promise<{ changed: boolean; error: SettingsWorkspaceError | null }> {
  try {
    await change();
  } catch (caught) {
    return {
      changed: false,
      error: {
        kind: 'operation',
        message: caught instanceof Error ? caught.message : 'We could not change this access.',
      },
    };
  }

  try {
    const result = await reload();
    if (result.ok) return { changed: true, error: null };
  } catch {
    // The access mutation already succeeded; only the follow-up read failed.
  }

  return {
    changed: true,
    error: {
      kind: 'access-refresh',
      message: 'Access changed, but the latest list could not be loaded.',
    },
  };
}

async function responseProblem(response: Response, fallback: string) {
  const body = (await response.json().catch(() => ({}))) as Problem;
  return { message: body.detail || fallback, errors: body.errors ?? {} };
}

function displayDate(value: string | null) {
  if (!value) return 'Not signed in yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date unavailable';
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  }).format(date);
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('') || '?';
}

function useAccessibleDialog(
  open: boolean,
  onClose: () => void,
  busy: boolean,
  returnFocusRef?: RefObject<HTMLElement | null>,
) {
  const dialog = useRef<HTMLElement>(null);
  const busyRef = useRef(busy);
  const closeRef = useRef(onClose);

  useEffect(() => {
    busyRef.current = busy;
    closeRef.current = onClose;
  }, [busy, onClose]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const returnFocus = returnFocusRef?.current ?? previous;
    const element = dialog.current;
    const focusable = () => [
      ...(element?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
      ) ?? []),
    ];
    focusable()[0]?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busyRef.current) {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const elements = focusable();
      if (!elements.length) return;
      const first = elements[0];
      const last = elements.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      returnFocus?.focus();
    };
  }, [open, returnFocusRef]);

  return dialog;
}

function DialogFrame({
  children,
  titleId,
  onClose,
  busy = false,
  returnFocusRef,
}: {
  children: ReactNode;
  titleId: string;
  onClose: () => void;
  busy?: boolean;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const dialog = useAccessibleDialog(true, onClose, busy, returnFocusRef);
  return (
    <div className={styles.dialogBackdrop}>
      <button
        aria-label="Close dialog"
        className={styles.dialogScrim}
        disabled={busy}
        onClick={onClose}
        type="button"
      />
      <section
        aria-labelledby={titleId}
        aria-modal="true"
        className={styles.dialog}
        ref={dialog}
        role="dialog"
      >
        {children}
      </section>
    </div>
  );
}

export async function copyInvitationLink(
  link: string,
  writeText: (value: string) => Promise<void>,
) {
  try {
    await writeText(link);
    return true;
  } catch {
    return false;
  }
}

export function InvitationReady({
  link,
  onClose,
}: {
  link: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');
  const success = useRef<HTMLDivElement>(null);

  useEffect(() => {
    success.current?.focus();
  }, []);

  async function copyLink() {
    const copiedNow = await copyInvitationLink(
      link,
      (value) => navigator.clipboard.writeText(value),
    );
    if (copiedNow) {
      setCopied(true);
      setCopyError('');
      return;
    }
    setCopied(false);
    setCopyError('Copy was blocked. Select the visible link and copy it manually.');
  }

  return (
    <div
      aria-label="Invitation ready"
      className={styles.inviteSuccess}
      ref={success}
      role="status"
      tabIndex={-1}
    >
      <span className={styles.successMark}><Check aria-hidden="true" /></span>
      <h3>Invitation ready</h3>
      <p>Share this private link with the person you invited. It is shown only now.</p>
      <label className={styles.inviteLink}>
        <span>Private join link</span>
        <textarea aria-label="Private join link" onFocus={(event) => event.currentTarget.select()} readOnly rows={3} value={link} />
      </label>
      {copyError && <p className={styles.dialogError} role="alert">{copyError}</p>}
      <button className={styles.primaryButton} onClick={copyLink} type="button">
        {copied ? <Check aria-hidden="true" /> : <Clipboard aria-hidden="true" />}
        {copied ? 'Copied' : 'Copy invite link'}
      </button>
      <button className={styles.textButton} onClick={onClose} type="button">Done</button>
    </div>
  );
}

export function InviteMemberDialog({
  onClose,
  onCreated,
  returnFocusRef,
}: {
  onClose: () => void;
  onCreated: () => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'MEMBER' | 'OWNER'>('MEMBER');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [link, setLink] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !email.trim()) return;
    setSaving(true);
    setError('');
    try {
      const response = await workspaceMutationFetch('/api/members/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'invite-member', email, role }),
      });
      if (!response.ok) {
        const problem = await responseProblem(response, 'We could not create this invitation.');
        throw new Error(problem.message);
      }
      const result = (await response.json()) as { invitation?: { link?: string } };
      if (!result.invitation?.link) throw new Error('The invitation link was not returned.');
      setLink(result.invitation.link);
      onCreated();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'We could not create this invitation.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <DialogFrame
      busy={saving}
      onClose={onClose}
      returnFocusRef={returnFocusRef}
      titleId="invite-member-title"
    >
      <header className={styles.dialogHeader}>
        <div>
          <p>People and access</p>
          <h2 id="invite-member-title">Invite a teammate</h2>
        </div>
        <button aria-label="Close invite dialog" disabled={saving} onClick={onClose} type="button">
          <X aria-hidden="true" />
        </button>
      </header>
      {link ? (
        <InvitationReady link={link} onClose={onClose} />
      ) : (
        <form onSubmit={submit}>
          <p className={styles.dialogIntro}>They will join this restaurant workspace and see its procurement records.</p>
          <label className={styles.field}>
            <span>Work email</span>
            <input
              autoComplete="email"
              autoFocus
              maxLength={320}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@restaurant.in"
              required
              type="email"
              value={email}
            />
          </label>
          <fieldset className={styles.roleChoices}>
            <legend>Access level</legend>
            <label>
              <input checked={role === 'MEMBER'} name="role" onChange={() => setRole('MEMBER')} type="radio" />
              <span><strong>Member</strong><small>Member can prepare requests, manage menus and work with suppliers.</small></span>
            </label>
            <label>
              <input checked={role === 'OWNER'} name="role" onChange={() => setRole('OWNER')} type="radio" />
              <span><strong>Owner</strong><small>Can also award requests, edit restaurant details and manage access.</small></span>
            </label>
          </fieldset>
          {error && <p className={styles.dialogError} role="alert">{error}</p>}
          <footer className={styles.dialogFooter}>
            <button className={styles.secondaryButton} disabled={saving} onClick={onClose} type="button">Cancel</button>
            <button className={styles.primaryButton} disabled={saving || !email.trim()} type="submit">
              <UserPlus aria-hidden="true" />{saving ? 'Creating invitation…' : 'Create invitation'}
            </button>
          </footer>
        </form>
      )}
    </DialogFrame>
  );
}

function ConfirmActionDialog({
  title,
  description,
  confirmLabel,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  busy: boolean;
  error: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const titleId = useId();
  return (
    <DialogFrame titleId={titleId} onClose={onClose} busy={busy}>
      <header className={styles.dialogHeader}>
        <div><p>Confirm access change</p><h2 id={titleId}>{title}</h2></div>
        <button aria-label="Close confirmation" disabled={busy} onClick={onClose} type="button"><X aria-hidden="true" /></button>
      </header>
      <div className={styles.confirmBody}>
        <p>{description}</p>
        {error && <p className={styles.dialogError} role="alert">{error}</p>}
        <footer className={styles.dialogFooter}>
          <button className={styles.secondaryButton} disabled={busy} onClick={onClose} type="button">Keep access</button>
          <button className={styles.dangerButton} disabled={busy} onClick={onConfirm} type="button">
            <UserMinus aria-hidden="true" />{busy ? 'Saving…' : confirmLabel}
          </button>
        </footer>
      </div>
    </DialogFrame>
  );
}

function LoadingState() {
  return (
    <main aria-label="Loading workspace settings" className={styles.page}>
      <div className={styles.loadingHeader}><span /><span /></div>
      <div className={styles.loadingGrid}><span /><span /></div>
    </main>
  );
}

export function SettingsErrorBanner({
  error,
  onDismiss,
  onReload,
  onAccessRefreshReload,
}: {
  error: SettingsWorkspaceError;
  onDismiss: () => void;
  onReload: () => void;
  onAccessRefreshReload: () => void;
}) {
  const reloadLabel = error.kind === 'access-refresh' ? 'Reload list' : 'Try again';
  return (
    <section className={styles.inlineError} role="alert">
      <span>{error.message}</span>
      {error.kind === 'load' && <span>Your saved restaurant records are unchanged.</span>}
      {error.kind === 'operation' ? (
        <button onClick={onDismiss} type="button">Dismiss</button>
      ) : (
        <button
          onClick={error.kind === 'access-refresh' ? onAccessRefreshReload : onReload}
          type="button"
        >
          {reloadLabel}
        </button>
      )}
    </section>
  );
}

export function SettingsWorkspace({ initialData }: { initialData?: WorkspaceSettingsData }) {
  const router = useRouter();
  const [data, setData] = useState(initialData ?? null);
  const [form, setForm] = useState<WorkspaceForm | null>(initialData?.workspace ?? null);
  const [loading, setLoading] = useState(!initialData);
  const [error, setError] = useState<SettingsWorkspaceError | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [action, setAction] = useState<
    | { type: 'member'; id: string; label: string }
    | { type: 'invitation'; id: string; label: string }
    | null
  >(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const inviteButton = useRef<HTMLButtonElement>(null);
  const started = useRef(false);

  const load = useCallback(async (
    usePrefetch = false,
    showError = true,
  ): Promise<SettingsLoadResult> => {
    setLoading(!data);
    setError(null);
    try {
      const response = await (usePrefetch
        ? workspaceFetch('/api/settings', { cache: 'no-store' })
        : fetch('/api/settings', { cache: 'no-store' }));
      if (response.status === 401) {
        router.replace(createSignInRedirect('/settings'));
        return { ok: false, message: 'Sign in is required to load settings.' };
      }
      if (!response.ok) {
        const problem = await responseProblem(response, 'We could not load workspace settings.');
        throw new Error(problem.message);
      }
      const next = (await response.json()) as WorkspaceSettingsData;
      setData(next);
      setForm(next.workspace);
      return { ok: true };
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'We could not load workspace settings.';
      if (showError) setError({ kind: 'load', message });
      return { ok: false, message };
    } finally {
      setLoading(false);
    }
  }, [data, router]);

  useEffect(() => {
    if (initialData || started.current) return;
    started.current = true;
    void load(true);
  }, [initialData, load]);

  function setField(field: keyof WorkspaceForm, value: string) {
    setSaved(false);
    setFieldErrors((current) => ({ ...current, [field]: [] }));
    setForm((current) => current ? { ...current, [field]: field === 'gstin' ? value.toUpperCase() : value } : current);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form || !data?.permissions.canManageWorkspace || saving) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    setFieldErrors({});
    try {
      const response = await workspaceMutationFetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ details: form }),
      });
      if (!response.ok) {
        const problem = await responseProblem(response, 'We could not save restaurant details.');
        setFieldErrors(problem.errors);
        throw new Error(problem.message);
      }
      const result = (await response.json()) as { workspace?: WorkspaceForm };
      if (!result.workspace) throw new Error('The saved restaurant details were not returned.');
      setForm(result.workspace);
      setData((current) => current ? { ...current, workspace: result.workspace! } : current);
      setSaved(true);
    } catch (caught) {
      setError({
        kind: 'operation',
        message: caught instanceof Error ? caught.message : 'We could not save restaurant details.',
      });
    } finally {
      setSaving(false);
    }
  }

  async function confirmAction() {
    if (!action || actionBusy) return;
    setActionBusy(true);
    setActionError('');
    const currentAction = action;
    const outcome = await runAccessChangeAndReload(
      async () => {
        const invitationAction = currentAction.type === 'invitation';
        const response = await workspaceMutationFetch(
          invitationAction ? '/api/members/invitations' : '/api/settings',
          {
            method: invitationAction ? 'DELETE' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(currentAction.type === 'member'
              ? { action: 'deactivate-member', userId: currentAction.id }
              : { invitationId: currentAction.id }),
          },
        );
        if (!response.ok) {
          const problem = await responseProblem(response, 'We could not change this access.');
          throw new Error(problem.message);
        }
      },
      () => load(false, false),
    );
    if (outcome.changed) setAction(null);
    if (outcome.error?.kind === 'operation') setActionError(outcome.error.message);
    else if (outcome.error) setError(outcome.error);
    setActionBusy(false);
  }

  async function reloadAfterAccessChange() {
    const outcome = await runAccessChangeAndReload(
      async () => undefined,
      () => load(false, false),
    );
    setError(outcome.error);
  }

  if (loading && !data) return <LoadingState />;
  if (!data || !form) {
    return (
      <main className={styles.page}>
        <section className={styles.loadError} role="alert">
          <Building2 aria-hidden="true" />
          <p>Workspace settings</p>
          <h1>We could not open settings</h1>
          <span>{error?.message || 'Try again in a moment.'}</span>
          <span>Your saved restaurant records are unchanged.</span>
          <button className={styles.primaryButton} onClick={() => void load()} type="button">Try again</button>
        </section>
      </main>
    );
  }

  const owner = data.permissions.canManageWorkspace;
  return (
    <main className={styles.page}>
      <WorkspaceHeader title="Restaurant settings" description="Manage your restaurant details and who can use this account." actions={
        <div className={styles.currentAccess}>
          <ShieldCheck aria-hidden="true" />
          <span>
            <small>Your access</small>
            <strong>{data.currentUser.role === 'OWNER' ? 'Owner' : 'Team member'}</strong>
            <em>Your account email belongs to you, not the shared restaurant profile.</em>
          </span>
        </div>
      } />

      {!owner && (
        <section className={styles.viewOnly} role="status">
          <ShieldCheck aria-hidden="true" />
          <div><strong>View access only</strong><span>Only workspace owners can change restaurant details or manage access.</span></div>
        </section>
      )}
      {error && data && (
        <SettingsErrorBanner
          error={error}
          onDismiss={() => setError(null)}
          onReload={() => void load()}
          onAccessRefreshReload={() => void reloadAfterAccessChange()}
        />
      )}

      <nav className={styles.sectionLinks} aria-label="Settings sections"><a href="#restaurant-details">Restaurant details</a><a href="#team-access">Team & access</a></nav>
      <div className={styles.settingsGrid}>
        <section className={styles.panel} id="restaurant-details">
          <header className={styles.panelHeader}>
            <span className={styles.panelIcon}><Building2 aria-hidden="true" /></span>
            <div><p>Restaurant profile</p><h2>Restaurant details</h2></div>
          </header>
          <form onSubmit={save}>
            <div className={styles.formGrid}>
              <label className={`${styles.field} ${styles.fullWidth}`}>
                <span>Restaurant or company name</span>
                <input aria-invalid={Boolean(fieldErrors.name?.length)} disabled={!owner} maxLength={200} onChange={(event) => setField('name', event.target.value)} required value={form.name} />
                {fieldErrors.name?.[0] && <small>{fieldErrors.name[0]}</small>}
              </label>
              <label className={`${styles.field} ${styles.fullWidth}`}>
                <span>Street address</span>
                <input aria-invalid={Boolean(fieldErrors.addressLine?.length)} autoComplete="street-address" disabled={!owner} maxLength={300} onChange={(event) => setField('addressLine', event.target.value)} required value={form.addressLine} />
                {fieldErrors.addressLine?.[0] && <small>{fieldErrors.addressLine[0]}</small>}
              </label>
              <label className={styles.field}>
                <span>City</span>
                <input aria-invalid={Boolean(fieldErrors.city?.length)} autoComplete="address-level2" disabled={!owner} maxLength={100} onChange={(event) => setField('city', event.target.value)} required value={form.city} />
                {fieldErrors.city?.[0] && <small>{fieldErrors.city[0]}</small>}
              </label>
              <label className={styles.field}>
                <span>State</span>
                <input aria-invalid={Boolean(fieldErrors.state?.length)} autoComplete="address-level1" disabled={!owner} maxLength={100} onChange={(event) => setField('state', event.target.value)} required value={form.state} />
                {fieldErrors.state?.[0] && <small>{fieldErrors.state[0]}</small>}
              </label>
              <label className={styles.field}>
                <span>PIN code</span>
                <input aria-invalid={Boolean(fieldErrors.pin?.length)} autoComplete="postal-code" disabled={!owner} inputMode="numeric" maxLength={6} onChange={(event) => setField('pin', event.target.value)} pattern="[0-9]{6}" required value={form.pin} />
                {fieldErrors.pin?.[0] && <small>{fieldErrors.pin[0]}</small>}
              </label>
              <label className={styles.field}>
                <span>Phone</span>
                <input aria-invalid={Boolean(fieldErrors.phone?.length)} autoComplete="tel" disabled={!owner} maxLength={20} onChange={(event) => setField('phone', event.target.value)} required type="tel" value={form.phone} />
                {fieldErrors.phone?.[0] && <small>{fieldErrors.phone[0]}</small>}
              </label>
              <label className={`${styles.field} ${styles.fullWidth}`}>
                <span>GSTIN <em>Optional</em></span>
                <input aria-invalid={Boolean(fieldErrors.gstin?.length)} disabled={!owner} maxLength={15} onChange={(event) => setField('gstin', event.target.value)} placeholder="27AAPFU0939F1ZV" value={form.gstin ?? ''} />
                {fieldErrors.gstin?.[0] ? <small>{fieldErrors.gstin[0]}</small> : <small className={styles.hint}>Shown on purchase orders when provided.</small>}
              </label>
            </div>
            {owner && (
              <footer className={styles.formFooter}>
                <span aria-live="polite">{saved ? <><Check aria-hidden="true" />Restaurant details saved</> : 'India time is used for request deadlines.'}</span>
                <button className={styles.primaryButton} disabled={saving} type="submit">{saving ? 'Saving…' : 'Save restaurant details'}</button>
              </footer>
            )}
          </form>
        </section>

        <section className={styles.panel} id="team-access">
          <header className={styles.panelHeader}>
            <span className={styles.panelIcon}><Users aria-hidden="true" /></span>
            <div><p>People and access</p><h2>{data.members.length} active {data.members.length === 1 ? 'person' : 'people'}</h2></div>
            {data.permissions.canManageMembers && <button className={styles.primaryButton} onClick={() => setInviteOpen(true)} ref={inviteButton} type="button"><UserPlus aria-hidden="true" />Invite someone</button>}
          </header>
          <div className={styles.peopleList}>
            {data.members.map((member) => (
              <article className={styles.person} key={member.id}>
                <span className={styles.avatar}>{initials(member.name)}</span>
                <div className={styles.personIdentity}>
                  <h3>{member.name}{member.isCurrentUser && <small>You</small>}</h3>
                  <p><Mail aria-hidden="true" />{member.email}</p>
                  <p><Clock3 aria-hidden="true" />{member.lastLoginAt ? `Last signed in ${displayDate(member.lastLoginAt)}` : 'Not signed in yet'}</p>
                </div>
                <span className={member.role === 'OWNER' ? styles.ownerBadge : styles.memberBadge}>{member.role === 'OWNER' ? 'Owner' : 'Member'}</span>
                {data.permissions.canManageMembers && !member.isCurrentUser && (
                  <button className={styles.deactivateButton} onClick={() => {
                    setActionError('');
                    setAction({ type: 'member', id: member.id, label: member.name });
                  }} type="button"><UserMinus aria-hidden="true" />Deactivate</button>
                )}
              </article>
            ))}
          </div>

          {data.pendingInvitations.length > 0 && (
            <div className={styles.pending} id="pending-invitations">
              <header><div><p>Pending invitations</p><h3>Waiting to join</h3></div><span>{data.pendingInvitations.length}</span></header>
              {data.pendingInvitations.map((invitation) => (
                <article key={invitation.id}>
                  <span className={styles.pendingIcon}><Mail aria-hidden="true" /></span>
                  <div><strong>{invitation.email}</strong><small>{invitation.role === 'OWNER' ? 'Owner' : 'Member'} · Expires {displayDate(invitation.expiresAt)}</small></div>
                  {data.permissions.canManageMembers && <button onClick={() => {
                    setActionError('');
                    setAction({ type: 'invitation', id: invitation.id, label: invitation.email });
                  }} type="button">Revoke</button>}
                </article>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className={styles.recordNote}>
        <MapPin aria-hidden="true" />
        <div><strong>One shared restaurant record</strong><span>These details appear consistently across requests, awards and purchase orders.</span></div>
      </section>

      {inviteOpen && (
        <InviteMemberDialog
          onClose={() => setInviteOpen(false)}
          onCreated={() => void reloadAfterAccessChange()}
          returnFocusRef={inviteButton}
        />
      )}
      {action && (
        <ConfirmActionDialog
          busy={actionBusy}
          confirmLabel={action.type === 'member' ? 'Deactivate access' : 'Revoke invitation'}
          description={action.type === 'member'
            ? `${action.label} will be signed out and will no longer be able to open this workspace. Existing records stay unchanged.`
            : `${action.label} will no longer be able to join using the current invitation.`}
          error={actionError}
          onClose={() => { if (!actionBusy) setAction(null); }}
          onConfirm={() => void confirmAction()}
          title={action.type === 'member' ? `Deactivate ${action.label}?` : 'Revoke this invitation?'}
        />
      )}
    </main>
  );
}
