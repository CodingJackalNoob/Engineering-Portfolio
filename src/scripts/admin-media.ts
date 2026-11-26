type MediaUse = { owner_type: string; owner_id: string; field_key: string; position: number };
type MediaItem = {
  id: string;
  bucket: string;
  storage_path: string;
  original_name: string;
  content_type: string;
  size_bytes: number;
  alt: string;
  caption: string;
  folder: string;
  width: number | null;
  height: number | null;
  url: string | null;
  uses: MediaUse[];
  created_at: string;
  updated_at: string;
};
type AssignmentItem = {
  mediaId: string;
  alt: string;
  caption: string;
  focalX: number;
  focalY: number;
  displaySettings: Record<string, unknown>;
  media?: Pick<MediaItem, 'id' | 'original_name' | 'url' | 'width' | 'height' | 'content_type' | 'size_bytes' | 'bucket'>;
};

const assignmentState = new WeakMap<HTMLElement, AssignmentItem[]>();
const assignmentDirty = new WeakSet<HTMLElement>();

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;
const formatBytes = (bytes: number) => bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const formatDate = (value: string) => value ? new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'Date unavailable';
const MAX_SOURCE_BYTES = 12 * 1024 * 1024;
const MAX_FUNCTION_UPLOAD_BYTES = 4 * 1024 * 1024;
const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);

function showLibraryMessage(message: string, error = false) {
  const status = byId<HTMLElement>('media-message');
  if (!status) return;
  status.textContent = message;
  status.hidden = !message;
  status.classList.toggle('is-error', error);
}

async function readJson<T>(response: Response): Promise<T & { error?: string; warning?: string; diagnostic?: { code?: string; message?: string; details?: string; hint?: string } }> {
  let raw: unknown = {};
  if (response.status !== 204) {
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) raw = await response.json();
    else {
      const text = await response.text();
      if (response.status === 413 || text.includes('FUNCTION_PAYLOAD_TOO_LARGE')) {
        throw new Error('This image exceeded the hosting upload limit. Large PNG screenshots are optimized automatically; try a screenshot under 12 MB.');
      }
      throw new Error(`The media server returned an unexpected response (${response.status}).`);
    }
  }
  const body = raw as { error?: string; warning?: string; diagnostic?: { code?: string; message?: string; details?: string; hint?: string } } & Partial<T>;
  if (!response.ok) {
    const diagnostic = body.diagnostic;
    const context = diagnostic
      ? [diagnostic.code, diagnostic.message, diagnostic.details, diagnostic.hint].filter(Boolean).join(' · ')
      : '';
    throw new Error([body.warning ?? body.error ?? 'Media request failed.', context].filter(Boolean).join(' '));
  }
  return body as T & { error?: string; warning?: string; diagnostic?: { code?: string; message?: string; details?: string; hint?: string } };
}

async function prepareUploadFile(file: File) {
  if (!SUPPORTED_IMAGE_TYPES.has(file.type)) throw new Error(`${file.name} is not a supported JPEG, PNG, WebP, or AVIF image.`);
  if (file.size > MAX_SOURCE_BYTES) throw new Error(`${file.name} is ${formatBytes(file.size)}. The source image limit is 12 MB.`);
  if (file.size <= MAX_FUNCTION_UPLOAD_BYTES) return file;

  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file); }
  catch { throw new Error(`${file.name} could not be decoded by this browser. Try exporting it again as PNG.`); }
  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) throw new Error('This browser cannot optimize the selected screenshot.');
    const attempts = [
      { width: 2200, quality: .92 },
      { width: 2000, quality: .89 },
      { width: 1800, quality: .86 },
    ];
    for (const attempt of attempts) {
      const scale = Math.min(1, attempt.width / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', attempt.quality));
      if (blob?.type === 'image/webp' && blob.size <= MAX_FUNCTION_UPLOAD_BYTES) {
        return new File([blob], file.name, { type: 'image/webp', lastModified: file.lastModified });
      }
    }
  } finally {
    bitmap.close();
  }
  throw new Error(`${file.name} could not be reduced below the server upload limit. Try a smaller screenshot.`);
}

function renderLibrary(items: MediaItem[]) {
  const library = byId<HTMLElement>('media-library');
  if (!library) return;
  library.replaceChildren();
  library.classList.remove('is-error');
  if (!items.length) {
    const empty = document.createElement('p');
    empty.className = 'admin-empty-records';
    empty.textContent = 'No media matches these filters. Upload an image or clear a filter.';
    library.append(empty);
    return;
  }

  for (const item of items) {
    const card = document.createElement('article');
    card.className = 'media-card';
    card.dataset.mediaId = item.id;
    const image = document.createElement('img');
    image.src = item.url ?? '';
    image.alt = item.alt;
    image.loading = 'lazy';
    image.className = 'media-card-image';
    const fields = document.createElement('div');
    fields.className = 'media-card-fields';
    const detail = document.createElement('div');
    detail.className = 'media-card-details';
    const name = document.createElement('strong');
    name.textContent = item.original_name;
    const meta = document.createElement('small');
    meta.textContent = `${item.width ?? '—'} × ${item.height ?? '—'} · ${item.content_type.replace('image/', '').toUpperCase()} · ${formatBytes(item.size_bytes)} · ${formatDate(item.created_at)} · ${item.bucket === 'portfolio-media' ? 'public' : 'private'}`;
    const usage = document.createElement('small');
    usage.textContent = item.uses.length ? `Used in ${item.uses.map((use) => `${use.owner_type} / ${use.field_key}`).join(', ')}` : 'Unused';
    detail.append(name, meta, usage);

    const makeInput = (labelText: string, value: string, maxLength: number) => {
      const label = document.createElement('label');
      label.textContent = labelText;
      const input = document.createElement('input');
      input.value = value;
      input.maxLength = maxLength;
      label.append(input);
      return { label, input };
    };
    const alt = makeInput('Alt text', item.alt, 500);
    const caption = makeInput('Caption', item.caption, 1000);
    const folder = makeInput('Collection', item.folder, 80);
    const fileName = makeInput('Library name', item.original_name, 240);
    fields.append(alt.label, caption.label, folder.label, fileName.label);

    const actions = document.createElement('div');
    actions.className = 'media-card-actions';
    const save = document.createElement('button');
    save.type = 'button'; save.className = 'admin-quiet-button'; save.textContent = 'Save details';
    save.addEventListener('click', async () => {
      save.disabled = true;
      try {
        await readJson(await fetch('/api/admin/media/', {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: item.id, action: 'update', alt: alt.input.value, caption: caption.input.value, folder: folder.input.value }),
        }));
        await readJson(await fetch('/api/admin/media/', {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: item.id, action: 'rename', originalName: fileName.input.value }),
        }));
        showLibraryMessage('Media details saved.');
        await loadLibrary();
      } catch (error) { showLibraryMessage(error instanceof Error ? error.message : 'Could not save media details.', true); }
      finally { save.disabled = false; }
    });
    const replaceLabel = document.createElement('label');
    replaceLabel.className = 'admin-quiet-button media-replace-label';
    replaceLabel.textContent = 'Replace image';
    const replace = document.createElement('input');
    replace.type = 'file'; replace.accept = 'image/jpeg,image/png,image/webp,image/avif'; replace.className = 'visually-hidden-file';
    replace.addEventListener('change', async () => {
      const file = replace.files?.[0];
      if (!file) return;
      const payload = new FormData(); payload.set('id', item.id); payload.set('file', file);
      try {
        await readJson(await fetch('/api/admin/media/', { method: 'PUT', body: payload }));
        showLibraryMessage(`Replaced ${item.original_name}.`);
        await loadLibrary();
      } catch (error) { showLibraryMessage(error instanceof Error ? error.message : 'Could not replace this image.', true); }
    });
    replaceLabel.append(replace);
    actions.append(save, replaceLabel);
    if (item.bucket !== 'portfolio-media') {
      const publish = document.createElement('button');
      publish.type = 'button'; publish.className = 'admin-primary-button'; publish.textContent = 'Publish image';
      publish.addEventListener('click', async () => {
        publish.disabled = true;
        try { const result = await readJson<{ warning?: string }>(await fetch('/api/admin/media/', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: item.id, action: 'publish' }) })); showLibraryMessage(result.warning ?? 'Image published to the public library.'); await loadLibrary(); }
        catch (error) { showLibraryMessage(error instanceof Error ? error.message : 'Could not publish image.', true); }
        finally { publish.disabled = false; }
      });
      actions.append(publish);
    }
    const copy = document.createElement('button');
    copy.type = 'button'; copy.className = 'admin-quiet-button'; copy.textContent = 'Copy URL'; copy.disabled = !item.url;
    copy.addEventListener('click', async () => { if (item.url) { await navigator.clipboard.writeText(item.url); showLibraryMessage('Image URL copied.'); } });
    const remove = document.createElement('button');
    remove.type = 'button'; remove.className = 'admin-quiet-button danger'; remove.textContent = 'Delete';
    remove.addEventListener('click', async () => {
      if (!window.confirm(`Delete “${item.original_name}”? Images assigned to a page or content record cannot be deleted.`)) return;
      remove.disabled = true;
      try { const result = await readJson<{ warning?: string }>(await fetch(`/api/admin/media/?id=${encodeURIComponent(item.id)}`, { method: 'DELETE' })); showLibraryMessage(result.warning ?? 'Image deleted.'); await loadLibrary(); }
      catch (error) { showLibraryMessage(error instanceof Error ? error.message : 'Could not delete the image.', true); remove.disabled = false; }
    });
    actions.append(copy, remove);
    card.append(image, detail, fields, actions);
    library.append(card);
  }
}

let loadTimer = 0;
async function loadLibrary() {
  const library = byId<HTMLElement>('media-library');
  if (!library) return;
  library.replaceChildren();
  const loading = document.createElement('p'); loading.className = 'admin-loading'; loading.textContent = 'Loading media…'; library.append(loading);
  try {
    const params = new URLSearchParams({
      q: byId<HTMLInputElement>('media-search')?.value.trim() ?? '',
      folder: byId<HTMLSelectElement>('media-folder-filter')?.value ?? 'all',
      type: byId<HTMLSelectElement>('media-type-filter')?.value ?? 'all',
    });
    const usage = byId<HTMLSelectElement>('media-usage-filter')?.value ?? 'all';
    if (usage === 'used' || usage === 'unused') params.set('usage', usage);
    else if (usage !== 'all') params.set('usageType', usage);
    const result = await readJson<{ items: MediaItem[]; folders: string[]; warning?: string }>(await fetch(`/api/admin/media/?${params}`));
    const folders = byId<HTMLSelectElement>('media-folder-filter');
    const current = folders?.value ?? 'all';
    if (folders) {
      folders.replaceChildren(new Option('All collections', 'all'));
      result.folders.forEach((folder) => folders.add(new Option(folder, folder)));
      folders.value = result.folders.includes(current) ? current : 'all';
    }
    renderLibrary(result.items);
    if (result.warning) showLibraryMessage(result.warning);
  } catch (error) {
    library.textContent = error instanceof Error ? error.message : 'Could not load media.';
    library.classList.add('is-error');
  }
}

function initializeLibrary() {
  const form = byId<HTMLFormElement>('media-upload-form');
  const input = form?.querySelector<HTMLInputElement>('input[name="files"]');
  const dropzone = form?.querySelector<HTMLElement>('[data-media-dropzone]');
  const dropLabel = form?.querySelector<HTMLElement>('[data-drop-label]');
  const library = byId<HTMLElement>('media-library');
  if (!form || form.dataset.mediaReady) return;
  form.dataset.mediaReady = 'true';
  const updateLabel = () => {
    const files = [...(input?.files ?? [])];
    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    if (dropLabel) {
      dropLabel.textContent = files.length === 1
        ? `${files[0].name} · ${formatBytes(files[0].size)}`
        : files.length ? `${files.length} images · ${formatBytes(totalBytes)} total` : 'Drop images here or browse';
    }
    const tooLarge = files.find((file) => file.size > MAX_SOURCE_BYTES);
    const unsupported = files.find((file) => !SUPPORTED_IMAGE_TYPES.has(file.type));
    if (tooLarge) showLibraryMessage(`${tooLarge.name} is ${formatBytes(tooLarge.size)}. The per-image source limit is 12 MB.`, true);
    else if (unsupported) showLibraryMessage(`${unsupported.name} is not a supported JPEG, PNG, WebP, or AVIF image.`, true);
    else if (files.length) showLibraryMessage('Large PNG screenshots are converted to optimized WebP before upload so they fit the hosting request limit.');
  };
  input?.addEventListener('change', updateLabel);
  dropzone?.addEventListener('dragover', (event) => { event.preventDefault(); dropzone.classList.add('is-dragging'); });
  dropzone?.addEventListener('dragleave', (event) => { if (!dropzone.contains(event.relatedTarget as Node)) dropzone.classList.remove('is-dragging'); });
  dropzone?.addEventListener('drop', (event) => {
    event.preventDefault(); dropzone.classList.remove('is-dragging');
    const files = [...(event as DragEvent).dataTransfer?.files ?? []].filter((file) => file.type.startsWith('image/'));
    if (!input || !files.length) return;
    const transfer = new DataTransfer(); files.forEach((file) => transfer.items.add(file)); input.files = transfer.files; updateLabel();
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const files = [...(input?.files ?? [])];
    if (!files.length) return;
    const invalidFile = files.find((file) => file.size > MAX_SOURCE_BYTES || !SUPPORTED_IMAGE_TYPES.has(file.type));
    if (invalidFile) {
      updateLabel();
      return;
    }
    showLibraryMessage(`Uploading ${files.length} image${files.length === 1 ? '' : 's'}…`);
    const values = new FormData(form);
    try {
      for (const file of files) {
        showLibraryMessage(file.size > MAX_FUNCTION_UPLOAD_BYTES ? `Optimizing ${file.name} for upload…` : `Uploading ${file.name}…`);
        const uploadFile = await prepareUploadFile(file);
        const payload = new FormData();
        payload.set('file', uploadFile); payload.set('alt', String(values.get('alt') ?? '')); payload.set('caption', String(values.get('caption') ?? '')); payload.set('folder', String(values.get('folder') ?? ''));
        try {
          await readJson(await fetch('/api/admin/media/', { method: 'POST', body: payload }));
        } catch (error) {
          throw new Error(`${file.name}: ${error instanceof Error ? error.message : 'Upload failed.'}`);
        }
      }
      form.reset(); updateLabel(); showLibraryMessage(`Uploaded ${files.length} image${files.length === 1 ? '' : 's'}.`); await loadLibrary();
    } catch (error) { showLibraryMessage(error instanceof Error ? error.message : 'Image upload failed.', true); await loadLibrary(); }
  });
  byId<HTMLInputElement>('media-search')?.addEventListener('input', () => { window.clearTimeout(loadTimer); loadTimer = window.setTimeout(() => void loadLibrary(), 180); });
  ['media-folder-filter', 'media-type-filter', 'media-usage-filter'].forEach((id) => byId<HTMLSelectElement>(id)?.addEventListener('change', () => void loadLibrary()));
  document.querySelectorAll<HTMLButtonElement>('[data-media-view]').forEach((button) => button.addEventListener('click', () => {
    document.querySelectorAll<HTMLButtonElement>('[data-media-view]').forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
    library?.classList.toggle('is-list', button.dataset.mediaView === 'list');
  }));
  void loadLibrary();
}

function getOwnerId(field: HTMLElement) {
  if (field.dataset.ownerIdSource === 'content') return document.querySelector<HTMLInputElement>('#content-editor [name="id"]')?.value ?? '';
  return field.dataset.ownerId ?? '';
}

function setFieldStatus(field: HTMLElement, text: string, error = false) {
  const status = field.querySelector<HTMLElement>('[data-media-field-status]');
  if (status) { status.textContent = text; status.classList.toggle('is-error', error); }
}

function selectedItem(media: MediaItem): AssignmentItem {
  return { mediaId: media.id, alt: media.alt ?? '', caption: media.caption ?? '', focalX: 0.5, focalY: 0.5, displaySettings: {}, media };
}

async function saveAssignments(field: HTMLElement) {
  const ownerId = getOwnerId(field);
  if (!ownerId) { setFieldStatus(field, 'Save this content record first, then save its media assignment.', true); return false; }
  const items = assignmentState.get(field) ?? [];
  const response = await fetch('/api/admin/media-assignments/', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ownerType: field.dataset.ownerType, ownerId, fieldKey: field.dataset.fieldKey, items: items.map(({ mediaId, alt, caption, focalX, focalY, displaySettings }) => ({ mediaId, alt, caption, focalX, focalY, displaySettings })) }),
  });
  const result = await readJson<{ warning?: string }>(response);
  field.dataset.ownerId = ownerId;
  assignmentDirty.delete(field);
  setFieldStatus(field, result.warning ?? 'Media assignment saved.');
  return true;
}

async function loadAssignments(field: HTMLElement) {
  const ownerId = getOwnerId(field);
  if (!ownerId) { assignmentState.set(field, []); renderAssignmentItems(field); return; }
  try {
    const params = new URLSearchParams({ ownerType: field.dataset.ownerType ?? '', ownerId, fieldKey: field.dataset.fieldKey ?? '' });
    const result = await readJson<{ items: Array<Record<string, unknown>> }>(await fetch(`/api/admin/media-assignments/?${params}`));
    const items = result.items.map((item) => {
      const media = item.media as AssignmentItem['media'] & Record<string, unknown>;
      return {
        mediaId: String(item.media_id), alt: String(item.alt ?? ''), caption: String(item.caption ?? ''),
        focalX: Number(item.focal_x ?? 0.5), focalY: Number(item.focal_y ?? 0.5),
        displaySettings: (item.display_settings && typeof item.display_settings === 'object' ? item.display_settings : {}) as Record<string, unknown>,
        media: media ? { ...media, id: String(media.id), url: typeof media.url === 'string' ? media.url : null } as AssignmentItem['media'] : undefined,
      } satisfies AssignmentItem;
    });
    assignmentState.set(field, items);
    field.dataset.ownerId = ownerId;
    renderAssignmentItems(field);
    setFieldStatus(field, items.length ? `${items.length} image${items.length === 1 ? '' : 's'} assigned.` : 'No image assigned.');
  } catch (error) { setFieldStatus(field, error instanceof Error ? error.message : 'Could not load media assignment.', true); }
}

function renderAssignmentItems(field: HTMLElement) {
  const container = field.querySelector<HTMLElement>('[data-media-field-items]');
  if (!container) return;
  container.replaceChildren();
  const items = assignmentState.get(field) ?? [];
  if (!items.length) { const empty = document.createElement('p'); empty.className = 'media-assignment-empty'; empty.textContent = 'No image selected yet.'; container.append(empty); return; }
  items.forEach((item, index) => {
    const row = document.createElement('article'); row.className = 'media-assignment-item';
    if (field.dataset.multiple === 'true') {
      row.draggable = true;
      row.dataset.assignmentIndex = String(index);
      row.addEventListener('dragstart', (event) => {
        field.dataset.draggingAssignment = String(index);
        row.classList.add('is-dragging');
        event.dataTransfer?.setData('text/plain', String(index));
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
      });
      row.addEventListener('dragend', () => {
        delete field.dataset.draggingAssignment;
        row.classList.remove('is-dragging');
      });
      row.addEventListener('dragover', (event) => { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'; });
      row.addEventListener('drop', (event) => {
        event.preventDefault();
        const from = Number(field.dataset.draggingAssignment ?? event.dataTransfer?.getData('text/plain'));
        if (!Number.isInteger(from) || from === index || from < 0 || from >= items.length) return;
        const [moved] = items.splice(from, 1);
        items.splice(index, 0, moved);
        assignmentDirty.add(field);
        renderAssignmentItems(field);
      });
    }
    const image = document.createElement('img'); image.src = item.media?.url ?? ''; image.alt = item.alt; image.loading = 'lazy';
    const details = document.createElement('div'); details.className = 'media-assignment-details';
    const name = document.createElement('strong'); name.textContent = item.media?.original_name ?? item.mediaId;
    const dimensions = document.createElement('small'); dimensions.textContent = `${item.media?.width ?? '—'} × ${item.media?.height ?? '—'} · ${item.media?.bucket === 'portfolio-media' ? 'public' : 'private'}`;
    details.append(name, dimensions);
    const controls = document.createElement('div'); controls.className = 'media-assignment-controls';
    const addField = (labelText: string, value: string, onChange: (value: string) => void, type = 'text') => {
      const label = document.createElement('label'); label.textContent = labelText;
      const input = document.createElement('input'); input.type = type; input.value = value; input.addEventListener('input', () => onChange(input.value));
      label.append(input); controls.append(label);
    };
    addField('Alt text', item.alt, (value) => { item.alt = value; assignmentDirty.add(field); });
    addField('Caption', item.caption, (value) => { item.caption = value; assignmentDirty.add(field); });
    const focal = document.createElement('fieldset'); focal.className = 'focal-point-fields';
    const legend = document.createElement('legend'); legend.textContent = 'Focal point'; focal.append(legend);
    for (const axis of ['focalX', 'focalY'] as const) {
      const label = document.createElement('label'); label.textContent = axis === 'focalX' ? 'Horizontal' : 'Vertical';
      const input = document.createElement('input'); input.type = 'range'; input.min = '0'; input.max = '1'; input.step = '0.01'; input.value = String(item[axis]);
      input.addEventListener('input', () => { item[axis] = Number(input.value); assignmentDirty.add(field); });
      label.append(input); focal.append(label);
    }
    controls.append(focal);
    if (field.dataset.metadata === 'moment') {
      const settings = item.displaySettings;
      addField('Moment title', String(settings.title ?? ''), (value) => { settings.title = value; assignmentDirty.add(field); });
      addField('Date (optional)', String(settings.date ?? ''), (value) => { settings.date = value; assignmentDirty.add(field); }, 'text');
      const visibleLabel = document.createElement('label'); visibleLabel.className = 'media-visible-toggle';
      const visible = document.createElement('input'); visible.type = 'checkbox'; visible.checked = settings.visible !== false;
      visible.addEventListener('change', () => { settings.visible = visible.checked; assignmentDirty.add(field); });
      visibleLabel.append(visible, document.createTextNode('Show on homepage')); controls.append(visibleLabel);
    }
    const actions = document.createElement('div'); actions.className = 'media-assignment-actions';
    const orderButton = (label: string, offset: number, disabled: boolean) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'admin-quiet-button'; button.textContent = label; button.disabled = disabled;
      button.addEventListener('click', () => { const moved = items.splice(index, 1)[0]; items.splice(index + offset, 0, moved); assignmentDirty.add(field); renderAssignmentItems(field); });
      return button;
    };
    if (field.dataset.multiple === 'true') { actions.append(orderButton('Move up', -1, index === 0), orderButton('Move down', 1, index === items.length - 1)); }
    if (field.dataset.insertMarkdown === 'true') {
      const insert = document.createElement('button'); insert.type = 'button'; insert.className = 'admin-quiet-button'; insert.textContent = 'Insert in article';
      insert.addEventListener('click', async () => {
        try {
          if (assignmentDirty.has(field) && !await saveAssignments(field)) return;
          const textarea = document.querySelector<HTMLTextAreaElement>('#markdown-body');
          if (!textarea) return;
          const markdown = `![${item.alt.replace(/[\]]/g, '')}](cms-media:${item.mediaId})\n\n`;
          textarea.setRangeText(markdown, textarea.selectionStart, textarea.selectionEnd, 'end');
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
          setFieldStatus(field, 'Image assignment saved and inserted into the article.');
        } catch (error) { setFieldStatus(field, error instanceof Error ? error.message : 'Could not insert this image.', true); }
      });
      actions.append(insert);
    }
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'admin-quiet-button danger'; remove.textContent = 'Remove';
    remove.addEventListener('click', () => { items.splice(index, 1); assignmentDirty.add(field); renderAssignmentItems(field); }); actions.append(remove);
    row.append(image, details, controls, actions); container.append(row);
  });
}

async function openPicker(field: HTMLElement) {
  const dialog = field.querySelector<HTMLDialogElement>('[data-media-picker-dialog]');
  const results = field.querySelector<HTMLElement>('[data-media-picker-results]');
  if (!dialog || !results) return;
  dialog.showModal();
  const renderResults = async () => {
    results.replaceChildren();
    const loading = document.createElement('p'); loading.className = 'admin-loading'; loading.textContent = 'Loading library…'; results.append(loading);
    try {
      const q = field.querySelector<HTMLInputElement>('[data-media-picker-search]')?.value ?? '';
      const response = await readJson<{ items: MediaItem[] }>(await fetch(`/api/admin/media/?${new URLSearchParams({ q })}`));
      results.replaceChildren();
      if (!response.items.length) { const empty = document.createElement('p'); empty.className = 'admin-empty-records'; empty.textContent = 'No images found. Upload one from the Media Library first.'; results.append(empty); return; }
      response.items.forEach((media) => {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'media-picker-option';
        const image = document.createElement('img'); image.src = media.url ?? ''; image.alt = '';
        const text = document.createElement('span'); text.innerHTML = '';
        const name = document.createElement('strong'); name.textContent = media.original_name;
        const detail = document.createElement('small'); detail.textContent = `${media.width ?? '—'} × ${media.height ?? '—'} · ${media.bucket === 'portfolio-media' ? 'public' : 'private'}`;
        text.append(name, detail); button.append(image, text);
        button.addEventListener('click', () => {
          const items = assignmentState.get(field) ?? [];
          if (field.dataset.multiple === 'true') items.push(selectedItem(media));
          else items.splice(0, items.length, selectedItem(media));
          assignmentState.set(field, items); assignmentDirty.add(field); renderAssignmentItems(field); dialog.close();
          setFieldStatus(field, 'Selection changed. Save the assignment to apply it.');
        });
        results.append(button);
      });
    } catch (error) { results.textContent = error instanceof Error ? error.message : 'Could not load images.'; }
  };
  await renderResults();
  const search = field.querySelector<HTMLInputElement>('[data-media-picker-search]');
  if (search && !search.dataset.searchReady) {
    search.dataset.searchReady = 'true';
    search.addEventListener('input', () => { window.clearTimeout(loadTimer); loadTimer = window.setTimeout(() => void renderResults(), 180); });
  }
}

function initializeAssignmentFields() {
  document.querySelectorAll<HTMLElement>('[data-media-field]:not([data-media-ready])').forEach((field) => {
    field.dataset.mediaReady = 'true'; assignmentState.set(field, []);
    field.querySelector('[data-media-field-open]')?.addEventListener('click', () => void openPicker(field));
    field.querySelector('[data-media-field-save]')?.addEventListener('click', async () => {
      const button = field.querySelector<HTMLButtonElement>('[data-media-field-save]'); if (button) button.disabled = true;
      try { await saveAssignments(field); } catch (error) { setFieldStatus(field, error instanceof Error ? error.message : 'Could not save assignment.', true); }
      finally { if (button) button.disabled = false; }
    });
    field.querySelector('[data-media-picker-close]')?.addEventListener('click', () => field.querySelector<HTMLDialogElement>('[data-media-picker-dialog]')?.close());
    if (field.dataset.ownerId && field.dataset.ownerIdSource !== 'content') void loadAssignments(field);
  });
}

document.addEventListener('admin-content-opened', () => {
  document.querySelectorAll<HTMLElement>('[data-media-field][data-owner-id-source="content"]').forEach((field) => { assignmentDirty.delete(field); void loadAssignments(field); });
});
document.addEventListener('admin-content-reset', () => {
  document.querySelectorAll<HTMLElement>('[data-media-field][data-owner-id-source="content"]').forEach((field) => { assignmentState.set(field, []); assignmentDirty.delete(field); field.dataset.ownerId = ''; renderAssignmentItems(field); setFieldStatus(field, 'Save the content record before assigning images.'); });
});
document.addEventListener('admin-content-saved', () => {
  document.querySelectorAll<HTMLElement>('[data-media-field][data-owner-id-source="content"]').forEach((field) => { if (!assignmentDirty.has(field)) void loadAssignments(field); });
});

function initializeAdminMedia() { initializeLibrary(); initializeAssignmentFields(); }
initializeAdminMedia();
document.addEventListener('astro:page-load', initializeAdminMedia);
