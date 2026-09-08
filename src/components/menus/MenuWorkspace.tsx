'use client';

import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Camera,
  CheckCircle2,
  Clock3,
  FileText,
  Globe2,
  LoaderCircle,
  Plus,
  ShieldCheck,
  Upload,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useWorkspaceIdOptional } from '@/components/WorkspaceContext';
import {
  workspaceFetch,
  workspaceMutationFetch,
} from '@/lib/client/workspace-prefetch';
import {
  buildReviewedOcrMenuInput,
  mergeMenuPhotoFiles,
  photoIntakeModeFromSearch,
  validateMenuPhotoSelection,
} from '@/lib/menu/photo-intake';
import { associateLocalPhotoBatches } from '@/lib/menu/local-menu-photos';
import { readBrowserImageDimensions } from '@/lib/menu/photo-transfer-client';

import {
  LocalMenuPhotoGallery,
  PhonePhotoTransfer,
} from './PhonePhotoTransfer';

import styles from './menu-workspace.module.css';

type MenuSummary = {
  id: string;
  name: string;
  status: 'DRAFT' | 'APPROVED';
  version: number;
  approvedAt: string | null;
  updatedAt: string;
};

async function responseMessage(response: Response, fallback: string) {
  const problem = (await response.json().catch(() => ({}))) as {
    detail?: string;
    error?: string;
  };
  return problem.detail || problem.error || fallback;
}

function formatUpdated(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Recently updated';
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

type IntakeMode = 'text' | 'photo' | 'url';

type PhotoPreview = {
  file: File;
  previewUrl: string;
  batchId?: string;
};

export function MenuIntakeDialog({
  initialMode,
  onClose,
  onCreated,
  onGalleryChanged = () => {},
  workspaceId = '',
}: {
  initialMode?: IntakeMode;
  onClose: () => void;
  onCreated: (menuId: string) => void;
  onGalleryChanged?: () => void;
  workspaceId?: string;
}) {
  const [mode, setMode] = useState<IntakeMode | null>(initialMode ?? null);
  const [menuText, setMenuText] = useState('');
  const [saving, setSaving] = useState(false);
  const [createError, setCreateError] = useState('');
  const [photos, setPhotos] = useState<PhotoPreview[]>([]);
  const [readingPhotos, setReadingPhotos] = useState(false);
  const [cancellingPhotos, setCancellingPhotos] = useState(false);
  const [photoReady, setPhotoReady] = useState(false);
  const [confidences, setConfidences] = useState<number[]>([]);
  const [photoProgress, setPhotoProgress] = useState({
    image: 0,
    total: 0,
    progress: 0,
    status: '',
  });
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [websitePermission, setWebsitePermission] = useState(false);
  const [importingWebsite, setImportingWebsite] = useState(false);
  const [canonicalWebsiteUrl, setCanonicalWebsiteUrl] = useState('');
  const dialog = useRef<HTMLElement>(null);
  const photoController = useRef<AbortController | null>(null);
  const photoUrls = useRef<string[]>([]);
  const busy = saving || readingPhotos || importingWebsite;
  const busyRef = useRef(busy);

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const focusable = () => [...(dialog.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), textarea:not(:disabled)',
    ) ?? [])];
    focusable()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busyRef.current) {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const elements = focusable();
      if (elements.length === 0) return;
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
      previous?.focus();
    };
  }, [onClose]);

  useEffect(() => () => {
    photoController.current?.abort();
    photoUrls.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  function replacePhotos(items: readonly { file: File; batchId?: string }[]) {
    photoUrls.current.forEach((url) => URL.revokeObjectURL(url));
    const next = items.map((item) => ({
      ...item,
      previewUrl: URL.createObjectURL(item.file),
    }));
    photoUrls.current = next.map((photo) => photo.previewUrl);
    setPhotos(next);
  }

  function clearPhotos() {
    photoUrls.current.forEach((url) => URL.revokeObjectURL(url));
    photoUrls.current = [];
    setPhotos([]);
  }

  async function selectPhotos(files: FileList | null) {
    if (!files) return;
    setCreateError('');
    setPhotoReady(false);
    setMenuText('');
    setConfidences([]);
    try {
      const checked = await validateMenuPhotoSelection(
        mergeMenuPhotoFiles(photos.map(({ file }) => file), [...files]),
        readBrowserImageDimensions,
      );
      replacePhotos(checked.map((file) => ({
        file,
        batchId: photos.find((photo) => photo.file === file)?.batchId,
      })));
    } catch (caught) {
      setCreateError(caught instanceof Error ? caught.message : 'These photos could not be used.');
    }
  }

  function removePhoto(index: number) {
    replacePhotos(photos.filter((_, current) => current !== index));
    setPhotoReady(false);
    setMenuText('');
    setConfidences([]);
  }

  async function readPhotos() {
    if (readingPhotos || photos.length === 0) return;
    setCreateError('');
    setPhotoReady(false);
    setReadingPhotos(true);
    setCancellingPhotos(false);
    const controller = new AbortController();
    photoController.current = controller;
    try {
      const { recognizeMenuPhotos } = await import('@/lib/menu/browser-ocr');
      const result = await recognizeMenuPhotos(
        photos.map((photo) => photo.file),
        {
          signal: controller.signal,
          onProgress: setPhotoProgress,
        },
      );
      if (!result.text.trim()) {
        throw new Error('No menu text was found. Try a clearer photo or type the dish names.');
      }
      setMenuText(result.text);
      setConfidences(result.confidences);
      setPhotoReady(true);
    } catch (caught) {
      if (!(caught instanceof DOMException && caught.name === 'AbortError')) {
        setCreateError(caught instanceof Error
          ? caught.message
          : 'The photos could not be read on this device.');
      }
    } finally {
      if (photoController.current === controller) photoController.current = null;
      setReadingPhotos(false);
      setCancellingPhotos(false);
    }
  }

  function cancelPhotoReading() {
    setCancellingPhotos(true);
    photoController.current?.abort();
  }

  async function importWebsiteText() {
    if (!websiteUrl.trim() || !websitePermission || importingWebsite) return;
    setImportingWebsite(true);
    setCreateError('');
    try {
      const response = await workspaceMutationFetch('/api/menu-import/url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: websiteUrl.trim(),
          permissionConfirmed: true,
        }),
      });
      if (!response.ok) {
        throw new Error(await responseMessage(response, 'We could not import this menu link.'));
      }
      const result = (await response.json()) as {
        menuText?: string;
        canonicalUrl?: string;
      };
      if (!result.menuText || !result.canonicalUrl) {
        throw new Error('The menu text was not returned.');
      }
      setMenuText(result.menuText);
      setCanonicalWebsiteUrl(result.canonicalUrl);
    } catch (caught) {
      setCreateError(caught instanceof Error
        ? caught.message
        : 'We could not import this menu link.');
    } finally {
      setImportingWebsite(false);
    }
  }

  async function saveMenu(input: unknown) {
    if (saving) return;
    setSaving(true);
    setCreateError('');
    try {
      const response = await workspaceMutationFetch('/api/parse-menu', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        throw new Error(await responseMessage(response, 'We could not save this menu draft.'));
      }
      const result = (await response.json()) as { menuId?: string };
      if (!result.menuId) throw new Error('The menu draft was not returned.');
      const localBatchIds = [...new Set(photos.flatMap(({ batchId }) =>
        batchId ? [batchId] : []))];
      if (workspaceId && localBatchIds.length > 0) {
        try {
          await associateLocalPhotoBatches(workspaceId, localBatchIds, result.menuId);
          onGalleryChanged();
        } catch {
          // The menu draft is already safely created; local-only link metadata
          // must never prevent the owner from opening and reviewing it.
        }
      }
      onCreated(result.menuId);
    } catch (caught) {
      setCreateError(caught instanceof Error
        ? caught.message
        : 'We could not save this menu draft.');
      setSaving(false);
    }
  }

  function backToChoices() {
    if (busy) return;
    setCreateError('');
    setMode(null);
  }

  const titles: Record<IntakeMode, string> = {
    text: 'Type or paste dish names',
    photo: 'Add menu photos',
    url: 'Import a permitted menu link',
  };

  return (
    <div className={styles.dialogBackdrop} role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target && !busy) onClose();
    }}>
      <section
        className={styles.dialog}
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-menu-title"
      >
        <header>
          <div>
            <p className={styles.eyebrow}>New menu</p>
            <h2 id="new-menu-title">{mode ? titles[mode] : 'How would you like to add it?'}</h2>
          </div>
          <button type="button" aria-label="Close menu form" disabled={busy} onClick={onClose}>
            <X />
          </button>
        </header>

        <div className={styles.dialogBody}>
          {createError && <div className={styles.dialogError} role="alert">{createError}</div>}

          {!mode && (
            <div className={styles.intakeChoices}>
              <button type="button" onClick={() => setMode('text')}>
                <FileText aria-hidden="true" />
                <span><strong>Type or paste</strong><small>Enter dish names as text</small></span>
                <ArrowRight aria-hidden="true" />
              </button>
              <button type="button" onClick={() => setMode('photo')}>
                <Camera aria-hidden="true" />
                <span><strong>Photos</strong><small>Use your camera or upload images</small></span>
                <ArrowRight aria-hidden="true" />
              </button>
              <button type="button" onClick={() => setMode('url')}>
                <Globe2 aria-hidden="true" />
                <span><strong>Permitted website link</strong><small>Import text from a menu page you can use</small></span>
                <ArrowRight aria-hidden="true" />
              </button>
            </div>
          )}

          {mode === 'text' && (
            <form onSubmit={(event) => {
              event.preventDefault();
              if (menuText.trim()) void saveMenu({ menuText });
            }}>
              <button className={styles.backButton} type="button" onClick={backToChoices}>
                <ArrowLeft aria-hidden="true" /> All options
              </button>
              <label htmlFor="menu-dishes">One dish per line</label>
              <textarea
                id="menu-dishes"
                rows={12}
                maxLength={100_000}
                value={menuText}
                onChange={(event) => setMenuText(event.target.value)}
                placeholder={'Paneer tikka\nDal makhani\nJeera rice\nTandoori roti'}
              />
              <p>We create dish names only. You will add and check ingredients on the next screen.</p>
              <footer>
                <button className={styles.secondaryButton} type="button" disabled={saving} onClick={onClose}>Cancel</button>
                <button className={styles.primaryButton} type="submit" disabled={saving || !menuText.trim()}>
                  {saving ? 'Saving draft…' : 'Save and review'}
                </button>
              </footer>
            </form>
          )}

          {mode === 'photo' && (
            <div className={styles.intakePanel}>
              <button className={styles.backButton} type="button" disabled={busy} onClick={backToChoices}>
                <ArrowLeft aria-hidden="true" /> All options
              </button>
              <div className={styles.privacyNote}>
                <ShieldCheck aria-hidden="true" />
                <p><strong>Photos chosen on this laptop stay here.</strong> They are read in your browser and are never uploaded or saved. Phone photos travel as encrypted temporary copies, then the originals are saved only in this browser after arrival.</p>
              </div>

              {!photoReady && !readingPhotos && (
                <>
                  <label className={styles.photoPicker} htmlFor="menu-photos">
                    <Upload aria-hidden="true" />
                    <strong>Take photos or choose images</strong>
                    <span>Choose up to 10 clear JPG, PNG, or WebP images</span>
                  </label>
                  <input
                    className={styles.hiddenInput}
                    id="menu-photos"
                    type="file"
                    accept="image/*"
                    capture="environment"
                    multiple
                    onChange={(event) => {
                      void selectPhotos(event.target.files);
                      event.currentTarget.value = '';
                    }}
                  />
                </>
              )}

              {photos.length > 0 && !photoReady && !readingPhotos && (
                <>
                  <div className={styles.photoStrip} aria-label="Selected menu photos">
                    {photos.map((photo, index) => (
                      <figure key={photo.previewUrl}>
                        {/* Browser object URLs are local previews and are revoked on replacement or close. */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={photo.previewUrl} alt={`Menu photo ${index + 1}`} />
                        <figcaption>{index + 1}</figcaption>
                        <button
                          type="button"
                          aria-label={`Remove menu photo ${index + 1}`}
                          onClick={() => removePhoto(index)}
                        >
                          <X aria-hidden="true" />
                        </button>
                      </figure>
                    ))}
                  </div>
                  <button className={styles.primaryButton} type="button" onClick={() => void readPhotos()}>
                    Read {photos.length === 1 ? 'photo' : `${photos.length} photos`}
                  </button>
                </>
              )}

              {readingPhotos && (
                <div className={styles.photoProgress} role="status" aria-live="polite">
                  <LoaderCircle aria-hidden="true" />
                  <div>
                    <strong>{cancellingPhotos ? 'Stopping photo reading' : photoProgress.status}</strong>
                    <span>{photoProgress.image > 0
                      ? `Photo ${photoProgress.image} of ${photoProgress.total}`
                      : 'Loading the local reader'}</span>
                    <progress max={1} value={photoProgress.progress} />
                  </div>
                  <button type="button" disabled={cancellingPhotos} onClick={cancelPhotoReading}>
                    {cancellingPhotos ? 'Stopping…' : 'Cancel'}
                  </button>
                </div>
              )}

              {photoReady && (
                <form onSubmit={(event) => {
                  event.preventDefault();
                  const input = buildReviewedOcrMenuInput(menuText, confidences);
                  if (input.menuText) void saveMenu(input);
                }}>
                  <label htmlFor="reviewed-photo-text">Check the text before saving</label>
                  <textarea
                    id="reviewed-photo-text"
                    rows={12}
                    maxLength={100_000}
                    value={menuText}
                    onChange={(event) => setMenuText(event.target.value)}
                  />
                  <p>Correct any missed words and keep one dish per line.</p>
                  <footer>
                    <button className={styles.secondaryButton} type="button" disabled={saving} onClick={() => {
                      clearPhotos();
                      setPhotoReady(false);
                      setMenuText('');
                      setConfidences([]);
                    }}>Choose again</button>
                    <button className={styles.primaryButton} type="submit" disabled={saving || !menuText.trim()}>
                      {saving ? 'Saving draft…' : 'Save and review'}
                    </button>
                  </footer>
                </form>
              )}

              <PhonePhotoTransfer
                workspaceId={workspaceId}
                currentPhotoCount={photos.length}
                onGalleryChanged={onGalleryChanged}
                onReceived={(batchId, files) => {
                  replacePhotos([
                    ...photos,
                    ...files.map((file) => ({ file, batchId })),
                  ]);
                  setCreateError('');
                  setPhotoReady(false);
                  setMenuText('');
                  setConfidences([]);
                }}
              />
            </div>
          )}

          {mode === 'url' && (
            <div className={styles.intakePanel}>
              <button className={styles.backButton} type="button" disabled={busy} onClick={backToChoices}>
                <ArrowLeft aria-hidden="true" /> All options
              </button>
              {!canonicalWebsiteUrl ? (
                <form onSubmit={(event) => {
                  event.preventDefault();
                  void importWebsiteText();
                }}>
                  <label htmlFor="menu-website">Menu website address</label>
                  <input
                    id="menu-website"
                    type="url"
                    inputMode="url"
                    maxLength={2_048}
                    value={websiteUrl}
                    onChange={(event) => setWebsiteUrl(event.target.value)}
                    placeholder="https://restaurant.example/menu"
                  />
                  <label className={styles.permissionCheck}>
                    <input
                      type="checkbox"
                      checked={websitePermission}
                      onChange={(event) => setWebsitePermission(event.target.checked)}
                    />
                    <span><strong>I have permission to use this menu</strong><small>Only import a page owned by your restaurant or one you are allowed to use.</small></span>
                  </label>
                  <footer>
                    <button className={styles.secondaryButton} type="button" disabled={importingWebsite} onClick={onClose}>Cancel</button>
                    <button className={styles.primaryButton} type="submit" disabled={importingWebsite || !websitePermission || !websiteUrl.trim()}>
                      {importingWebsite ? 'Importing text…' : 'Import menu text'}
                    </button>
                  </footer>
                </form>
              ) : (
                <form onSubmit={(event) => {
                  event.preventDefault();
                  if (!menuText.trim()) return;
                  void saveMenu({
                    menuText,
                    source: {
                      kind: 'PERMITTED_URL',
                      canonicalUrl: canonicalWebsiteUrl,
                      permissionConfirmed: true,
                    },
                  });
                }}>
                  <div className={styles.importedFrom}><CheckCircle2 aria-hidden="true" /> Text imported from the permitted page</div>
                  <label htmlFor="reviewed-website-text">Check the text before saving</label>
                  <textarea
                    id="reviewed-website-text"
                    rows={12}
                    maxLength={100_000}
                    value={menuText}
                    onChange={(event) => setMenuText(event.target.value)}
                  />
                  <p>Remove page headings and keep one dish per line.</p>
                  <footer>
                    <button className={styles.secondaryButton} type="button" disabled={saving} onClick={() => {
                      setCanonicalWebsiteUrl('');
                      setMenuText('');
                    }}>Use a different link</button>
                    <button className={styles.primaryButton} type="submit" disabled={saving || !menuText.trim()}>
                      {saving ? 'Saving draft…' : 'Save and review'}
                    </button>
                  </footer>
                </form>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

export function MenuWorkspace({
  initialMenus,
  initialError,
  initialNextCursor = null,
}: {
  initialMenus?: MenuSummary[];
  initialError?: string;
  initialNextCursor?: string | null;
}) {
  const router = useRouter();
  const workspaceId = useWorkspaceIdOptional() ?? '';
  const [menus, setMenus] = useState(initialMenus ?? []);
  const [loading, setLoading] = useState(initialMenus === undefined);
  const [error, setError] = useState(initialError ?? '');
  const [createOpen, setCreateOpen] = useState(false);
  const [initialCreateMode, setInitialCreateMode] = useState<IntakeMode | undefined>();
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [galleryRefresh, setGalleryRefresh] = useState(0);
  const initialLoadStarted = useRef(false);

  const loadMenus = useCallback(async (cursor?: string, usePrefetch = false) => {
    if (cursor) setLoadingMore(true);
    else setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ limit: '50' });
      if (cursor) params.set('cursor', cursor);
      const response = await (usePrefetch
        ? workspaceFetch('/api/menus?limit=50', { cache: 'no-store' })
        : fetch(`/api/menus?${params}`, { cache: 'no-store' }));
      if (!response.ok) throw new Error(await responseMessage(response, 'We could not load menus.'));
      const result = (await response.json()) as { menus?: MenuSummary[]; nextCursor?: string | null };
      const loaded = result.menus ?? [];
      setMenus((current) => cursor
        ? [...new Map([...current, ...loaded].map((menu) => [menu.id, menu])).values()]
        : loaded);
      setNextCursor(result.nextCursor ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'We could not load menus.');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    if (initialMenus !== undefined || initialLoadStarted.current) return;
    initialLoadStarted.current = true;
    void loadMenus(undefined, true);
  }, [initialMenus, loadMenus]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const queryMode = photoIntakeModeFromSearch(window.location.search);
      if (queryMode) {
        setInitialCreateMode(queryMode);
        setCreateOpen(true);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  function openCreate() {
    setInitialCreateMode(undefined);
    setCreateOpen(true);
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Prepare what you need</p>
          <h1>Menu</h1>
          <p className={styles.intro}>
            Add your menu, check ingredients, then approve it for planning.
          </p>
        </div>
        <div className={styles.headerActions}>
          {menus.some((menu) => menu.status === 'APPROVED') && (
            <Link className={styles.secondaryButton} href="/service-planning">Plan meals &amp; portions</Link>
          )}
          <button className={styles.primaryButton} type="button" onClick={openCreate}>
            <Plus aria-hidden="true" /> Add menu
          </button>
        </div>
      </header>

      <aside className={styles.explainer}>
        <span><strong>1</strong> Add menu</span>
        <ArrowRight aria-hidden="true" />
        <span><strong>2</strong> Check ingredients</span>
        <ArrowRight aria-hidden="true" />
        <span><strong>3</strong> Approve menu</span>
      </aside>
      <details className={styles.privacyReassurance}>
        <summary>Who can see your menu?</summary>
        <p>
          Your recipes and menus stay private to your restaurant. Other restaurants cannot see your records. Suppliers see requests you send, their own orders and delivery checks, and ingredient estimates you explicitly share. Other suppliers’ prices remain private.
        </p>
      </details>

      {error && (
        <div className={styles.error} role="alert">
          <span>{error}</span>
          <span>Your saved restaurant records are unchanged.</span>
          <button type="button" onClick={() => void loadMenus()}>Try again</button>
        </div>
      )}

      {loading ? (
        <section className={styles.loading} aria-label="Loading menus"><span /><span /><span /></section>
      ) : menus.length === 0 ? (
        <section className={styles.empty}>
          <div className={styles.emptyMark}><BookOpen aria-hidden="true" /></div>
          <p className={styles.eyebrow}>Your first step</p>
          <h2>Add your restaurant menu</h2>
          <p>Paste one dish per line, upload photos, or use your phone. Check ingredients before approval.</p>
          <button className={styles.primaryButton} type="button" onClick={openCreate}>
            <Plus aria-hidden="true" /> Add menu
          </button>
        </section>
      ) : (
        <section className={styles.menuGrid} aria-label="Restaurant menus">
          {menus.map((menu) => (
            <button
              className={styles.menuCard}
              type="button"
              key={menu.id}
              onClick={() => router.push(`/menus/${encodeURIComponent(menu.id)}`)}
            >
              <span className={styles.cardTop}>
                <span className={menu.status === 'APPROVED' ? styles.approved : styles.draft}>
                  {menu.status === 'APPROVED' ? <CheckCircle2 aria-hidden="true" /> : <Clock3 aria-hidden="true" />}
                  {menu.status === 'APPROVED' ? 'Approved' : 'Needs review'}
                </span>
                <span>Version {menu.version}</span>
              </span>
              <strong>{menu.name}</strong>
              <span className={styles.cardMeta}>
                {menu.status === 'APPROVED'
                  ? 'Approved · ready for meal planning'
                  : 'Open and check the ingredient list'}
              </span>
              <span className={styles.cardBottom}>
                Updated {formatUpdated(menu.updatedAt)}
                <ArrowRight aria-hidden="true" />
              </span>
            </button>
          ))}
        </section>
      )}

      {nextCursor && !loading && (
        <button
          className={styles.loadMore}
          type="button"
          disabled={loadingMore}
          onClick={() => void loadMenus(nextCursor)}
        >
          {loadingMore ? 'Loading more…' : 'Load more menus'}
        </button>
      )}

      {workspaceId && (
        <LocalMenuPhotoGallery
          workspaceId={workspaceId}
          refreshKey={galleryRefresh}
        />
      )}

      {createOpen && (
        <MenuIntakeDialog
          initialMode={initialCreateMode}
          workspaceId={workspaceId}
          onClose={() => setCreateOpen(false)}
          onCreated={(menuId) => router.push(`/menus/${encodeURIComponent(menuId)}`)}
          onGalleryChanged={() => setGalleryRefresh((value) => value + 1)}
        />
      )}
    </main>
  );
}
