/**
 * LUMINA ARCHIVE — MODERN MATTE PHOTO GALLERY
 * S3 Storage & MySQL RDS Metadata Integration
 */

// Application State
const state = {
  photos: [],
  filteredPhotos: [],
  activeFilter: 'all',
  searchQuery: '',
  timelineFilter: 'all',
  selectedIds: new Set(),
  lightboxIndex: -1,
  densityCols: 3,
  infraStatus: null,
  selectedFile: null
};

// DOM Elements
const photoGrid = document.getElementById('photoGrid');
const photoCountEl = document.getElementById('photoCount');
const searchInput = document.getElementById('searchInput');
const searchClearBtn = document.getElementById('searchClearBtn');
const activeFilterBanner = document.getElementById('activeFilterBanner');
const filterNameEl = document.getElementById('filterName');
const resetFilterBtn = document.getElementById('resetFilterBtn');
const emptyState = document.getElementById('emptyState');
const selectionBar = document.getElementById('selectionBar');
const selectedCountEl = document.getElementById('selectedCount');
const deselectAllBtn = document.getElementById('deselectAllBtn');
const bulkDeleteBtn = document.getElementById('bulkDeleteBtn');
const bulkFavBtn = document.getElementById('bulkFavBtn');
const bulkDownloadBtn = document.getElementById('bulkDownloadBtn');

// Infrastructure UI
const infraStatusPill = document.getElementById('infraStatusPill');
const statusDot = document.getElementById('statusDot');
const infraSummaryText = document.getElementById('infraSummaryText');
const dropStatusBadge = document.getElementById('dropStatusBadge');
const dropS3Bucket = document.getElementById('dropS3Bucket');
const dropS3Tag = document.getElementById('dropS3Tag');
const dropCompressPrefix = document.getElementById('dropCompressPrefix');
const dropDbHost = document.getElementById('dropDbHost');
const dropDbTag = document.getElementById('dropDbTag');
const dropEc2Ip = document.getElementById('dropEc2Ip');
const syncS3Btn = document.getElementById('syncS3Btn');

// Upload Modal Elements
const uploadModal = document.getElementById('uploadModal');
const openUploadBtn = document.getElementById('openUploadBtn');
const closeUploadModalBtn = document.getElementById('closeUploadModalBtn');
const cancelUploadBtn = document.getElementById('cancelUploadBtn');
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const uploadFormBox = document.getElementById('uploadFormBox');
const uploadPreviewImg = document.getElementById('uploadPreviewImg');
const previewFormat = document.getElementById('previewFormat');
const previewFilename = document.getElementById('previewFilename');
const previewSpecs = document.getElementById('previewSpecs');
const metaTitle = document.getElementById('metaTitle');
const metaCamera = document.getElementById('metaCamera');
const metaLens = document.getElementById('metaLens');
const metaFocal = document.getElementById('metaFocal');
const metaAperture = document.getElementById('metaAperture');
const metaShutter = document.getElementById('metaShutter');
const metaIso = document.getElementById('metaIso');
const metaLocation = document.getElementById('metaLocation');
const metaTags = document.getElementById('metaTags');
const pipelineQueue = document.getElementById('pipelineQueue');
const progressBar = document.getElementById('progressBar');
const queueMetric = document.getElementById('queueMetric');
const step1 = document.getElementById('step1');
const step2 = document.getElementById('step2');
const step3 = document.getElementById('step3');
const startUploadBtn = document.getElementById('startUploadBtn');

// Lightbox Elements
const lightboxModal = document.getElementById('lightboxModal');
const closeLightboxBtn = document.getElementById('closeLightboxBtn');
const lightboxImage = document.getElementById('lightboxImage');
const capsuleIndex = document.getElementById('capsuleIndex');
const capsuleTitle = document.getElementById('capsuleTitle');
const scrimBadge = document.getElementById('scrimBadge');
const prevPhotoBtn = document.getElementById('prevPhotoBtn');
const nextPhotoBtn = document.getElementById('nextPhotoBtn');
const detailFavBtn = document.getElementById('detailFavBtn');
const detailFavIcon = document.getElementById('detailFavIcon');
const detailDownloadBtn = document.getElementById('detailDownloadBtn');
const detailDeleteBtn = document.getElementById('detailDeleteBtn');
const toggleDrawerBtn = document.getElementById('toggleDrawerBtn');
const metadataDrawer = document.getElementById('metadataDrawer');
const closeDrawerBtn = document.getElementById('closeDrawerBtn');
const ribbonStrip = document.getElementById('ribbonStrip');

// Drawer Elements
const drawerTitle = document.getElementById('drawerTitle');
const drawerDesc = document.getElementById('drawerDesc');
const drawerTags = document.getElementById('drawerTags');
const drawerDate = document.getElementById('drawerDate');
const drawerTime = document.getElementById('drawerTime');
const drawerCamera = document.getElementById('drawerCamera');
const drawerLens = document.getElementById('drawerLens');
const drawerFocal = document.getElementById('drawerFocal');
const drawerAperture = document.getElementById('drawerAperture');
const drawerShutter = document.getElementById('drawerShutter');
const drawerIso = document.getElementById('drawerIso');
const drawerS3Key = document.getElementById('drawerS3Key');
const drawerOriginalKey = document.getElementById('drawerOriginalKey');
const drawerSavings = document.getElementById('drawerSavings');
const drawerDbId = document.getElementById('drawerDbId');
const drawerDbJson = document.getElementById('drawerDbJson');
const drawerSwatches = document.getElementById('drawerSwatches');

const toastContainer = document.getElementById('toastContainer');

// ==========================================================================
// Initialization & Data Loading
// ==========================================================================

async function init() {
  bindEvents();
  await checkStatus();
  await loadPhotos();
}

// 1. Fetch Cloud Status (S3, MySQL RDS, EC2 IP)
async function checkStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    state.infraStatus = data;

    // S3
    if (data.s3.bucket) {
      dropS3Bucket.textContent = data.s3.bucket;
      dropS3Tag.textContent = data.s3.region;
    } else {
      dropS3Bucket.textContent = 'Set AWS_BUCKET_NAME in .env';
      dropS3Tag.textContent = 'Pending';
    }

    dropCompressPrefix.textContent = 'new-* -> compressed-*';

    // MySQL
    if (data.database && data.database.connected) {
      dropDbHost.textContent = `${data.database.host}:${data.database.port} (${data.database.database})`;
      dropDbTag.textContent = 'Active';
      dropDbTag.style.color = '#38bdf8';
    } else {
      dropDbHost.textContent = `${data.database?.host || 'localhost'}:${data.database?.port || 3306} (photogallery)`;
      dropDbTag.textContent = 'Check .env';
      dropDbTag.style.color = '#f87171';
    }

    // EC2
    dropEc2Ip.textContent = data.publicIp || 'localhost';

    if (data.s3.connected && data.database?.connected) {
      statusDot.className = 'status-dot online';
      infraSummaryText.textContent = 'S3 & MySQL Connected';
      dropStatusBadge.textContent = 'Cloud Active';
    } else if (data.s3.connected) {
      statusDot.className = 'status-dot standby';
      infraSummaryText.textContent = 'S3 Bucket Connected';
      dropStatusBadge.textContent = 'S3 Online';
    } else {
      statusDot.className = 'status-dot standby';
      infraSummaryText.textContent = 'S3 Archive Ready';
      dropStatusBadge.textContent = 'Standby';
    }
  } catch (err) {
    console.warn('Status check failed:', err);
    infraSummaryText.textContent = 'Local Mode';
  }
}

// 2. Fetch Photos Strictly From MySQL (representing S3 bucket)
async function loadPhotos() {
  try {
    const res = await fetch('/api/photos');
    const data = await res.json();
    if (data.success && Array.isArray(data.photos)) {
      state.photos = data.photos;
      applyFilters();
    }
  } catch (err) {
    console.error('Failed to load photos:', err);
    showToast('Failed to connect to gallery service', 'error');
  }
}

// ==========================================================================
// Filtering & Rendering
// ==========================================================================

function applyFilters() {
  let list = [...state.photos];

  // Active view filter
  if (state.activeFilter === 'favorites') {
    list = list.filter((p) => p.favorite);
  } else if (state.activeFilter !== 'all') {
    list = list.filter((p) => {
      const tags = Array.isArray(p.tags) ? p.tags : [];
      return tags.some((t) => t.toLowerCase() === state.activeFilter.toLowerCase());
    });
  }

  // Timeline scrubber filter
  if (state.timelineFilter === 'today') {
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    list = list.filter((p) => new Date(p.uploadedAt).getTime() >= oneDayAgo);
  } else if (state.timelineFilter === 'yesterday') {
    const twoDaysAgo = Date.now() - 48 * 60 * 60 * 1000;
    list = list.filter((p) => new Date(p.uploadedAt).getTime() >= twoDaysAgo);
  } else if (state.timelineFilter === 'month') {
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    list = list.filter((p) => new Date(p.uploadedAt).getTime() >= thirtyDaysAgo);
  }

  // Live Search Query
  if (state.searchQuery.trim()) {
    const q = state.searchQuery.toLowerCase().trim();
    list = list.filter((p) => {
      const matchTitle = (p.title || '').toLowerCase().includes(q);
      const matchFile = (p.filename || '').toLowerCase().includes(q);
      const matchCamera = (p.camera || '').toLowerCase().includes(q);
      const matchLoc = (p.location || '').toLowerCase().includes(q);
      const tags = Array.isArray(p.tags) ? p.tags : [];
      const matchTags = tags.some((t) => t.toLowerCase().includes(q));
      return matchTitle || matchFile || matchCamera || matchLoc || matchTags;
    });
  }

  state.filteredPhotos = list;
  renderGrid();
  renderRibbon();
}

function renderGrid() {
  photoGrid.innerHTML = '';
  photoCountEl.textContent = state.filteredPhotos.length;

  if (state.activeFilter !== 'all' || state.timelineFilter !== 'all') {
    activeFilterBanner.style.display = 'flex';
    filterNameEl.textContent = state.activeFilter !== 'all' ? state.activeFilter : state.timelineFilter;
  } else {
    activeFilterBanner.style.display = 'none';
  }

  if (state.filteredPhotos.length === 0) {
    emptyState.style.display = 'flex';
    return;
  }
  emptyState.style.display = 'none';

  state.filteredPhotos.forEach((photo, index) => {
    const card = document.createElement('article');
    card.className = 'photo-card';
    card.dataset.id = photo.id;
    card.dataset.index = index;

    // Display image streamed directly from S3 (compress/filename)
    const imgSrc = `/api/photos/${photo.id}/image`;
    const format = photo.format || 'JPEG';
    const isFav = Boolean(photo.favorite);
    const cameraShort = (photo.camera || 'S3 Camera').split(' ')[0];
    const focal = photo.focalLength || '35mm';
    const aperture = photo.aperture || 'ƒ/2.0';
    const shutter = photo.shutterSpeed || '1/250s';
    const location = photo.location || 'S3 Archive';

    card.innerHTML = `
      <div class="card-media-wrapper">
        <img class="card-img" src="${imgSrc}" alt="${photo.title}" loading="lazy" onerror="this.onerror=null; this.src='${photo.url || ''}'" />
        
        <div class="card-overlay-top">
          <span class="format-pill">${format}</span>
          <div class="card-actions-row">
            <button class="card-action-btn ${isFav ? 'favorited' : ''}" data-action="favorite" title="Favorite in MySQL">
              <span class="material-symbols-outlined">favorite</span>
            </button>
            <button class="card-action-btn" data-action="select" title="Select">
              <span class="material-symbols-outlined">${state.selectedIds.has(photo.id) ? 'check_circle' : 'radio_button_unchecked'}</span>
            </button>
          </div>
        </div>
      </div>

      <div class="card-details">
        <div class="card-header-row">
          <h3 class="card-title">${photo.title}</h3>
          <span class="card-location">${location}</span>
        </div>

        <div class="card-exif-row">
          <span class="exif-pill">${cameraShort}</span>
          <span>${focal}</span>
          <span>•</span>
          <span>${aperture}</span>
          <span>•</span>
          <span>${shutter}</span>
        </div>

        <div class="s3-compressed-tag">
          <span class="material-symbols-outlined">verified</span>
          <span>S3: ${photo.compressedKey || 'compressed-' + photo.filename}</span>
        </div>
      </div>
    `;

    card.addEventListener('click', (e) => {
      const actionBtn = e.target.closest('[data-action]');
      if (actionBtn) {
        const action = actionBtn.dataset.action;
        if (action === 'favorite') {
          e.stopPropagation();
          toggleFavorite(photo.id);
        } else if (action === 'select') {
          e.stopPropagation();
          toggleSelect(photo.id);
        }
        return;
      }
      openLightbox(index);
    });

    photoGrid.appendChild(card);
  });
}

function renderRibbon() {
  ribbonStrip.innerHTML = '';
  state.filteredPhotos.forEach((p, idx) => {
    const thumb = document.createElement('div');
    thumb.className = `ribbon-thumb ${idx === state.lightboxIndex ? 'active' : ''}`;
    thumb.innerHTML = `<img src="/api/photos/${p.id}/image" alt="${p.title}" onerror="this.src='${p.url || ''}'" />`;
    thumb.addEventListener('click', (e) => {
      e.stopPropagation();
      openLightbox(idx);
    });
    ribbonStrip.appendChild(thumb);
  });
}

// ==========================================================================
// Actions: Favorite, Selection, Delete
// ==========================================================================

async function toggleFavorite(id) {
  try {
    const res = await fetch(`/api/photos/${id}/favorite`, { method: 'PATCH' });
    const data = await res.json();
    if (data.success) {
      const idx = state.photos.findIndex((p) => p.id === id);
      if (idx >= 0) {
        state.photos[idx].favorite = data.photo.favorite;
        applyFilters();
        if (state.lightboxIndex >= 0 && state.filteredPhotos[state.lightboxIndex]?.id === id) {
          updateLightboxUI();
        }
      }
      showToast(data.photo.favorite ? 'Favorited in MySQL' : 'Removed from favorites');
    }
  } catch (err) {
    showToast('Failed to update favorite', 'error');
  }
}

function toggleSelect(id) {
  if (state.selectedIds.has(id)) {
    state.selectedIds.delete(id);
  } else {
    state.selectedIds.add(id);
  }
  updateSelectionBar();
  renderGrid();
}

function updateSelectionBar() {
  const count = state.selectedIds.size;
  selectedCountEl.textContent = count;
  if (count > 0) {
    selectionBar.classList.add('visible');
  } else {
    selectionBar.classList.remove('visible');
  }
}

function clearSelection() {
  state.selectedIds.clear();
  updateSelectionBar();
  renderGrid();
}

async function deleteSelected() {
  if (state.selectedIds.size === 0) return;
  const count = state.selectedIds.size;
  if (!confirm(`Are you sure you want to delete ${count} photo(s) from S3 and MySQL?`)) return;

  for (const id of state.selectedIds) {
    try {
      await fetch(`/api/photos/${id}`, { method: 'DELETE' });
    } catch (e) {
      console.error(e);
    }
  }

  showToast(`Deleted ${count} photograph(s) from S3 & MySQL`);
  clearSelection();
  await loadPhotos();
}

// ==========================================================================
// Lightbox Exhibition Stage
// ==========================================================================

function openLightbox(index) {
  if (index < 0 || index >= state.filteredPhotos.length) return;
  state.lightboxIndex = index;
  updateLightboxUI();
  lightboxModal.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeLightbox() {
  lightboxModal.classList.remove('active');
  state.lightboxIndex = -1;
  document.body.style.overflow = '';
}

function updateLightboxUI() {
  const photo = state.filteredPhotos[state.lightboxIndex];
  if (!photo) return;

  lightboxImage.src = `/api/photos/${photo.id}/image`;
  lightboxImage.onerror = () => {
    if (photo.url) lightboxImage.src = photo.url;
  };

  capsuleIndex.textContent = `${state.lightboxIndex + 1} of ${state.filteredPhotos.length}`;
  capsuleTitle.textContent = photo.title || photo.filename;
  scrimBadge.textContent = `1:1 COMPRESSED IN S3 • ${photo.compressedKey || 'compressed-' + photo.filename}`;

  // Favorite button
  if (photo.favorite) {
    detailFavBtn.classList.add('active-accent');
    detailFavIcon.style.fontVariationSettings = "'FILL' 1";
  } else {
    detailFavBtn.classList.remove('active-accent');
    detailFavIcon.style.fontVariationSettings = "'FILL' 0";
  }

  // Update Drawer
  drawerTitle.textContent = photo.title || photo.filename;
  drawerDesc.textContent = `Stored in Amazon S3 bucket. Processed by Lambda: 1:1 square crop, compressed, and renamed to compressed. Metadata indexed in MySQL RDS table.`;
  
  // Tags
  drawerTags.innerHTML = '';
  const tags = Array.isArray(photo.tags) ? photo.tags : [];
  tags.forEach((t) => {
    const pill = document.createElement('span');
    pill.className = 'drawer-tag';
    pill.textContent = t;
    drawerTags.appendChild(pill);
  });

  // Date
  const d = new Date(photo.uploadedAt);
  drawerDate.textContent = d.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'short', day: 'numeric' });
  drawerTime.textContent = `${d.toLocaleTimeString()} • S3 Bucket`;

  // Specs
  drawerCamera.textContent = photo.camera || 'Fine Art Camera';
  drawerLens.textContent = photo.lens || 'Prime Lens';
  drawerFocal.textContent = photo.focalLength || '35mm';
  drawerAperture.textContent = photo.aperture || 'ƒ/2.0';
  drawerShutter.textContent = photo.shutterSpeed || '1/250s';
  drawerIso.textContent = photo.iso || '100';

  // Storage
  drawerS3Key.textContent = photo.compressedKey || `compressed-${photo.filename}`;
  drawerOriginalKey.textContent = photo.originalKey || photo.filename;
  
  const origMB = (photo.size / (1024 * 1024)).toFixed(2);
  const compMB = ((photo.compressedSize || photo.size * 0.25) / (1024 * 1024)).toFixed(2);
  const savingsPct = Math.round((1 - (photo.compressedSize || photo.size * 0.25) / (photo.size || 1)) * 100);
  drawerSavings.textContent = `${savingsPct > 0 ? savingsPct : 50}% Saved (${compMB} MB vs ${origMB} MB)`;

  // MySQL Row Record
  drawerDbId.textContent = photo.id;
  drawerDbJson.textContent = JSON.stringify(photo, null, 2);

  // Swatches
  drawerSwatches.innerHTML = '';
  const swatches = Array.isArray(photo.colorPalette) ? photo.colorPalette : ['#131318', '#35343a', '#d4af37', '#1e4e4c'];
  swatches.forEach((c) => {
    const s = document.createElement('span');
    s.className = 'swatch';
    s.style.backgroundColor = c;
    drawerSwatches.appendChild(s);
  });

  renderRibbon();
}

function nextPhoto() {
  if (state.lightboxIndex < state.filteredPhotos.length - 1) {
    openLightbox(state.lightboxIndex + 1);
  } else {
    openLightbox(0);
  }
}

function prevPhoto() {
  if (state.lightboxIndex > 0) {
    openLightbox(state.lightboxIndex - 1);
  } else {
    openLightbox(state.filteredPhotos.length - 1);
  }
}

// ==========================================================================
// Upload Pipeline
// ==========================================================================

function openUploadModal() {
  resetUploadForm();
  uploadModal.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeUploadModal() {
  uploadModal.classList.remove('active');
  document.body.style.overflow = '';
}

function resetUploadForm() {
  state.selectedFile = null;
  fileInput.value = '';
  uploadFormBox.style.display = 'none';
  pipelineQueue.style.display = 'none';
  dropZone.style.display = 'flex';
  startUploadBtn.disabled = true;
  progressBar.style.width = '0%';
  step1.className = 'pipeline-step active';
  step2.className = 'pipeline-step';
  step3.className = 'pipeline-step';
}

function handleFileSelection(file) {
  if (!file) return;
  state.selectedFile = file;

  const reader = new FileReader();
  reader.onload = (e) => {
    uploadPreviewImg.src = e.target.result;
    dropZone.style.display = 'none';
    uploadFormBox.style.display = 'flex';
    startUploadBtn.disabled = false;

    const ext = file.name.split('.').pop().toUpperCase();
    previewFormat.textContent = ext;
    previewFilename.textContent = file.name;

    const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
    const estCompMB = (file.size * 0.25 / (1024 * 1024)).toFixed(2);
    previewSpecs.textContent = `Upload to S3: new-${file.name} • Lambda Output: compressed-${file.name} (1:1 Ratio)`;

    metaTitle.value = file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
    metaCamera.value = 'Fine Art Camera';
    metaLens.value = 'FE 35mm F1.4 GM';
    metaFocal.value = '35mm';
    metaAperture.value = 'ƒ/1.8';
    metaShutter.value = '1/500s';
    metaIso.value = 'ISO 200';
    metaLocation.value = 'Exhibition Gallery';
    metaTags.value = 'S3-Upload, Compressed';
  };
  reader.readAsDataURL(file);
}

async function performUpload() {
  if (!state.selectedFile) return;

  startUploadBtn.disabled = true;
  cancelUploadBtn.disabled = true;
  pipelineQueue.style.display = 'flex';

  // Step 1: Uploading to S3
  queueMetric.textContent = `Uploading as new-${state.selectedFile.name} to Amazon S3...`;
  progressBar.style.width = '35%';
  step1.className = 'pipeline-step active';

  const formData = new FormData();
  formData.append('photo', state.selectedFile);
  formData.append('title', metaTitle.value.trim());
  formData.append('camera', metaCamera.value.trim());
  formData.append('lens', metaLens.value.trim());
  formData.append('focalLength', metaFocal.value.trim());
  formData.append('aperture', metaAperture.value.trim());
  formData.append('shutterSpeed', metaShutter.value.trim());
  formData.append('iso', metaIso.value.trim());
  formData.append('location', metaLocation.value.trim());
  formData.append('tags', metaTags.value.trim());

  try {
    // Step 2 Animation: Lambda compression triggered
    setTimeout(() => {
      progressBar.style.width = '70%';
      queueMetric.textContent = `Lambda processing: 1:1 square crop, compressing, and saving as compressed-${state.selectedFile.name}...`;
      step1.className = 'pipeline-step done';
      step2.className = 'pipeline-step active';
    }, 600);

    const res = await fetch('/api/upload', {
      method: 'POST',
      body: formData
    });

    const data = await res.json();

    if (data.success) {
      progressBar.style.width = '100%';
      queueMetric.textContent = 'Metadata recorded in MySQL RDS table!';
      step2.className = 'pipeline-step done';
      step3.className = 'pipeline-step done';

      setTimeout(() => {
        showToast(`Uploaded "${data.photo.title}" to S3 & MySQL!`);
        closeUploadModal();
        loadPhotos();
      }, 700);
    } else {
      throw new Error(data.error || 'Upload failed');
    }
  } catch (err) {
    console.error('Upload failed:', err);
    queueMetric.textContent = `Upload issue: ${err.message}`;
    showToast(`Error: ${err.message}`, 'error');
    startUploadBtn.disabled = false;
    cancelUploadBtn.disabled = false;
  }
}

// Rescan S3 bucket manually
async function rescanS3Bucket() {
  showToast('Scanning S3 bucket for photos...');
  try {
    const res = await fetch('/api/sync-s3', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      state.photos = data.photos;
      applyFilters();
      showToast(`S3 Rescan complete! Found ${data.count} photo(s).`);
    }
  } catch (err) {
    showToast('Failed to rescan S3 bucket', 'error');
  }
}

// ==========================================================================
// Toast Notifications
// ==========================================================================

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = 'toast';
  const icon = type === 'error' ? 'error' : 'check_circle';
  const iconColor = type === 'error' ? '#f87171' : 'var(--color-primary-gold)';

  toast.innerHTML = `
    <span class="material-symbols-outlined" style="color: ${iconColor}; font-size: 18px;">${icon}</span>
    <span>${message}</span>
  `;

  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// ==========================================================================
// Event Bindings
// ==========================================================================

function bindEvents() {
  // Navigation Pills
  document.querySelectorAll('.nav-pill').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-pill').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const view = btn.dataset.view;
      if (view === 'favorites') {
        state.activeFilter = 'favorites';
      } else {
        state.activeFilter = 'all';
      }
      applyFilters();
    });
  });

  // Filter Chips
  document.querySelectorAll('.filter-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.filter-chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      state.activeFilter = chip.dataset.tag;
      applyFilters();
    });
  });

  // Reset Filter Button
  resetFilterBtn.addEventListener('click', () => {
    state.activeFilter = 'all';
    state.timelineFilter = 'all';
    document.querySelectorAll('.filter-chip').forEach((c) => c.classList.remove('active'));
    document.querySelector('.filter-chip[data-tag="all"]').classList.add('active');
    document.querySelectorAll('.rail-tick').forEach((r) => r.classList.remove('active'));
    document.querySelector('.rail-tick[data-filter="all"]').classList.add('active');
    applyFilters();
  });

  // Timeline Scrubber
  document.querySelectorAll('.rail-tick').forEach((tick) => {
    tick.addEventListener('click', () => {
      document.querySelectorAll('.rail-tick').forEach((t) => t.classList.remove('active'));
      tick.classList.add('active');
      state.timelineFilter = tick.dataset.filter;
      applyFilters();
    });
  });

  // Density Controls
  document.querySelectorAll('.density-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.density-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const cols = btn.dataset.cols;
      photoGrid.className = `photo-grid cols-${cols}`;
    });
  });

  // Live Search
  searchInput.addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    searchClearBtn.style.display = state.searchQuery ? 'flex' : 'none';
    applyFilters();
  });

  searchClearBtn.addEventListener('click', () => {
    searchInput.value = '';
    state.searchQuery = '';
    searchClearBtn.style.display = 'none';
    applyFilters();
  });

  // Infra Status Dropdown Toggle
  infraStatusPill.addEventListener('click', (e) => {
    e.stopPropagation();
    infraStatusPill.classList.toggle('open');
  });

  document.addEventListener('click', () => {
    infraStatusPill.classList.remove('open');
  });

  if (syncS3Btn) {
    syncS3Btn.addEventListener('click', (e) => {
      e.stopPropagation();
      rescanS3Bucket();
    });
  }

  // Selection Bar Actions
  deselectAllBtn.addEventListener('click', clearSelection);
  bulkDeleteBtn.addEventListener('click', deleteSelected);
  bulkFavBtn.addEventListener('click', () => {
    state.selectedIds.forEach((id) => toggleFavorite(id));
    clearSelection();
  });
  bulkDownloadBtn.addEventListener('click', () => {
    state.selectedIds.forEach((id) => {
      window.open(`/api/photos/${id}/image`, '_blank');
    });
  });

  // Upload Modal Triggers
  openUploadBtn.addEventListener('click', openUploadModal);
  closeUploadModalBtn.addEventListener('click', closeUploadModal);
  cancelUploadBtn.addEventListener('click', closeUploadModal);

  // Drag and Drop
  dropZone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      handleFileSelection(e.target.files[0]);
    }
  });

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelection(e.dataTransfer.files[0]);
    }
  });

  startUploadBtn.addEventListener('click', performUpload);

  // Lightbox Navigation
  closeLightboxBtn.addEventListener('click', closeLightbox);
  prevPhotoBtn.addEventListener('click', prevPhoto);
  nextPhotoBtn.addEventListener('click', nextPhoto);

  detailFavBtn.addEventListener('click', () => {
    const photo = state.filteredPhotos[state.lightboxIndex];
    if (photo) toggleFavorite(photo.id);
  });

  detailDownloadBtn.addEventListener('click', () => {
    const photo = state.filteredPhotos[state.lightboxIndex];
    if (photo) {
      window.open(`/api/photos/${photo.id}/image`, '_blank');
    }
  });

  detailDeleteBtn.addEventListener('click', async () => {
    const photo = state.filteredPhotos[state.lightboxIndex];
    if (!photo) return;
    if (!confirm(`Delete "${photo.title}" from S3 and MySQL?`)) return;

    try {
      await fetch(`/api/photos/${photo.id}`, { method: 'DELETE' });
      showToast(`Deleted from S3 and MySQL`);
      closeLightbox();
      await loadPhotos();
    } catch (e) {
      showToast('Deletion failed', 'error');
    }
  });

  // Toggle Drawer
  toggleDrawerBtn.addEventListener('click', () => {
    metadataDrawer.classList.toggle('closed');
  });
  closeDrawerBtn.addEventListener('click', () => {
    metadataDrawer.classList.add('closed');
  });

  // Keyboard Shortcuts
  document.addEventListener('keydown', (e) => {
    if (lightboxModal.classList.contains('active')) {
      if (e.key === 'Escape') closeLightbox();
      if (e.key === 'ArrowRight') nextPhoto();
      if (e.key === 'ArrowLeft') prevPhoto();
    } else if (uploadModal.classList.contains('active')) {
      if (e.key === 'Escape') closeUploadModal();
    }
  });
}

document.addEventListener('DOMContentLoaded', init);
