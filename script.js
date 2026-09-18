// ============================================
// PDF READER PRO - SCRIPT PRINCIPAL
// ============================================

// Configuração do PDF.js
pdfjsLib.GlobalWorkerOptions.workerSrc = 
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// ============================================
// ESTADO GLOBAL
// ============================================
const state = {
    pdfDoc: null,
    currentPage: 1,
    totalPages: 0,
    scale: 1.0,
    fileName: '',
    rendering: false,
    renderTask: null,
    html5QrCode: null,
    history: JSON.parse(localStorage.getItem('pdfHistory') || '[]'),

    // Modo de leitura: 'single' (página única) ou 'continuous' (rolagem contínua)
    mode: localStorage.getItem('pdfReadMode') || 'single',
    // Dimensões da página 1 em escala 1, usadas para estimar o tamanho de todas
    // as páginas no modo contínuo antes de renderizá-las (assume páginas uniformes)
    pageAspect: null,
    // Um <div class="page-wrapper"> por página, indexado por (pageNum - 1)
    wrapperEls: [],
    // Páginas atualmente com canvas renderizado (modo contínuo)
    renderedSet: new Set(),
    observer: null,
    scrollRAF: null
};

// ============================================
// ELEMENTOS DOM
// ============================================
const $ = (id) => document.getElementById(id);

const els = {
    welcomeScreen: $('welcomeScreen'),
    viewer: $('viewer'),
    dropZone: $('dropZone'),
    fileInput: $('fileInput'),
    pdfContainer: $('pdfContainer'),
    pagesList: $('pagesList'),
    btnToggleMode: $('btnToggleMode'),
    pdfName: $('pdfName'),
    pdfPages: $('pdfPages'),
    totalPages: $('totalPages'),
    pageInput: $('pageInput'),
    zoomLevel: $('zoomLevel'),
    btnPrev: $('btnPrev'),
    btnNext: $('btnNext'),
    btnBack: $('btnBack'),
    btnZoomIn: $('btnZoomIn'),
    btnZoomOut: $('btnZoomOut'),
    btnFullscreen: $('btnFullscreen'),
    btnScan: $('btnScan'),
    btnScanPage: $('btnScanPage'),
    btnOpen: $('btnOpen'),
    btnMenu: $('btnMenu'),
    sidebar: $('sidebar'),
    overlay: $('overlay'),
    btnCloseSidebar: $('btnCloseSidebar'),
    scannerModal: $('scannerModal'),
    btnCloseScanner: $('btnCloseScanner'),
    qrReader: $('qrReader'),
    scanResult: $('scanResult'),
    resultText: $('resultText'),
    btnCopyResult: $('btnCopyResult'),
    btnOpenResult: $('btnOpenResult'),
    btnScanAllPages: $('btnScanAllPages'),
    btnScanCurrentPage: $('btnScanCurrentPage'),
    toast: $('toast')
};

// ============================================
// TOAST
// ============================================
function showToast(message, type = 'info', duration = 3000) {
    els.toast.textContent = message;
    els.toast.className = `toast ${type}`;
    els.toast.hidden = false;
    
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => {
        els.toast.hidden = true;
    }, duration);
}

// ============================================
// VERIFICAR SE É PDF (por tipo OU extensão)
// ============================================
function isPDF(file) {
    if (!file) return false;
    const byType = file.type === 'application/pdf';
    const byExt = file.name.toLowerCase().endsWith('.pdf');
    return byType || byExt;
}

// ============================================
// CARREGAMENTO DE PDF
// ============================================
async function loadPDF(file) {
    if (!file) {
        showToast('❌ Nenhum arquivo selecionado', 'error');
        return;
    }

    if (!isPDF(file)) {
        showToast('❌ Arquivo inválido. Selecione um PDF.', 'error');
        return;
    }

    showToast('📄 Carregando PDF...', 'info');
    state.fileName = file.name;

    try {
        const arrayBuffer = await file.arrayBuffer();
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        const pdf = await loadingTask.promise;

        state.pdfDoc = pdf;
        state.totalPages = pdf.numPages;
        state.currentPage = 1;
        state.scale = 1.0;

        addToHistory(file.name);

        els.pdfName.textContent = file.name;
        els.totalPages.textContent = pdf.numPages;
        els.pageInput.value = 1;
        els.pageInput.max = pdf.numPages;
        els.zoomLevel.textContent = '100%';

        els.welcomeScreen.hidden = true;
        els.viewer.hidden = false;

        await computeBaseAspect();

        if (state.mode === 'continuous') {
            buildContinuousMode();
            requestAnimationFrame(() => renderContinuousPage(1));
        } else {
            buildSingleMode();
            await renderSinglePage(1);
        }

        showToast(`✅ PDF carregado: ${pdf.numPages} páginas`, 'success');
    } catch (error) {
        console.error('Erro ao carregar PDF:', error);
        showToast('❌ Erro ao carregar PDF', 'error');
    }
}

// ============================================
// LAYOUT: MODO PÁGINA ÚNICA vs MODO CONTÍNUO
// ============================================
async function computeBaseAspect() {
    const page = await state.pdfDoc.getPage(1);
    const vp = page.getViewport({ scale: 1 });
    state.pageAspect = { width: vp.width, height: vp.height };
}

function clearPagesList() {
    if (state.observer) {
        state.observer.disconnect();
        state.observer = null;
    }
    els.pagesList.innerHTML = '';
    els.pagesList.classList.remove('continuous');
    state.wrapperEls = [];
    state.renderedSet.clear();
}

function buildSingleMode() {
    clearPagesList();
    const wrapper = document.createElement('div');
    wrapper.className = 'page-wrapper';
    wrapper.appendChild(document.createElement('canvas'));
    els.pagesList.appendChild(wrapper);
    state.wrapperEls[0] = wrapper;
}

function buildContinuousMode() {
    clearPagesList();
    els.pagesList.classList.add('continuous');

    const containerWidth = els.pdfContainer.clientWidth - 32;
    const aspect = state.pageAspect;
    const estWidth = containerWidth * state.scale;
    const estHeight = estWidth * (aspect.height / aspect.width);

    for (let i = 1; i <= state.totalPages; i++) {
        const wrapper = document.createElement('div');
        wrapper.className = 'page-wrapper';
        wrapper.dataset.pageNum = i;
        wrapper.style.width = Math.floor(estWidth) + 'px';
        wrapper.style.height = Math.floor(estHeight) + 'px';
        els.pagesList.appendChild(wrapper);
        state.wrapperEls[i - 1] = wrapper;
    }

    setupContinuousObserver();
}

function rebuildContinuousSizes() {
    const containerWidth = els.pdfContainer.clientWidth - 32;
    const aspect = state.pageAspect;
    const estWidth = containerWidth * state.scale;
    const estHeight = estWidth * (aspect.height / aspect.width);

    state.wrapperEls.forEach((wrapper) => {
        wrapper.style.width = Math.floor(estWidth) + 'px';
        wrapper.style.height = Math.floor(estHeight) + 'px';
        const canvas = wrapper.querySelector('canvas');
        if (canvas) canvas.remove();
    });
    state.renderedSet.clear();

    if (state.observer) {
        state.wrapperEls.forEach(w => state.observer.unobserve(w));
        state.wrapperEls.forEach(w => state.observer.observe(w));
    }
}

function setupContinuousObserver() {
    if (state.observer) state.observer.disconnect();

    state.observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            const pageNum = parseInt(entry.target.dataset.pageNum, 10);
            if (entry.isIntersecting) {
                renderContinuousPage(pageNum);
            } else {
                unrenderContinuousPage(pageNum, entry.target);
            }
        });
    }, {
        root: els.pdfContainer,
        rootMargin: '800px 0px',
        threshold: 0.01
    });

    state.wrapperEls.forEach(w => state.observer.observe(w));
}

async function renderContinuousPage(pageNum) {
    if (state.renderedSet.has(pageNum)) return;
    state.renderedSet.add(pageNum);

    try {
        const page = await state.pdfDoc.getPage(pageNum);
        const wrapper = state.wrapperEls[pageNum - 1];
        if (!wrapper) return;

        const dpr = window.devicePixelRatio || 1;
        const containerWidth = els.pdfContainer.clientWidth - 32;
        const baseViewport = page.getViewport({ scale: 1 });
        const scaleToFit = containerWidth / baseViewport.width;
        const finalScale = scaleToFit * state.scale;
        const viewport = page.getViewport({ scale: finalScale });

        let canvas = wrapper.querySelector('canvas');
        if (!canvas) {
            canvas = document.createElement('canvas');
            wrapper.appendChild(canvas);
        }
        const context = canvas.getContext('2d', { alpha: false });

        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = Math.floor(viewport.width) + 'px';
        canvas.style.height = Math.floor(viewport.height) + 'px';
        context.setTransform(dpr, 0, 0, dpr, 0, 0);

        wrapper.style.width = Math.floor(viewport.width) + 'px';
        wrapper.style.height = Math.floor(viewport.height) + 'px';

        await page.render({
            canvasContext: context,
            viewport: viewport,
            intent: 'display'
        }).promise;
    } catch (error) {
        if (error.name !== 'RenderingCancelledException') {
            console.error(`Erro ao renderizar página ${pageNum}:`, error);
        }
        state.renderedSet.delete(pageNum);
    }
}

function unrenderContinuousPage(pageNum, wrapper) {
    if (!state.renderedSet.has(pageNum)) return;
    state.renderedSet.delete(pageNum);
    const canvas = wrapper.querySelector('canvas');
    if (canvas) canvas.remove();
}

function updateCurrentPageFromScroll() {
    if (state.mode !== 'continuous' || state.wrapperEls.length === 0) return;

    const containerRect = els.pdfContainer.getBoundingClientRect();
    const centerY = containerRect.top + containerRect.height / 2;

    let closestPage = state.currentPage;
    let closestDist = Infinity;

    state.wrapperEls.forEach((wrapper, idx) => {
        const rect = wrapper.getBoundingClientRect();
        const dist = Math.abs((rect.top + rect.height / 2) - centerY);
        if (dist < closestDist) {
            closestDist = dist;
            closestPage = idx + 1;
        }
    });

    if (closestPage !== state.currentPage) {
        state.currentPage = closestPage;
        els.pdfPages.textContent = `Página ${closestPage} de ${state.totalPages}`;
        els.pageInput.value = closestPage;
        els.btnPrev.disabled = closestPage <= 1;
        els.btnNext.disabled = closestPage >= state.totalPages;
    }
}

// ============================================
// RENDERIZAÇÃO DE PÁGINA — MODO PÁGINA ÚNICA
// ============================================
async function renderSinglePage(pageNum) {
    if (!state.pdfDoc || state.rendering) return;

    if (state.renderTask) {
        try { state.renderTask.cancel(); } catch (e) {}
    }

    state.rendering = true;

    try {
        const page = await state.pdfDoc.getPage(pageNum);

        const dpr = window.devicePixelRatio || 1;
        const containerWidth = els.pdfContainer.clientWidth - 32;
        const containerHeight = els.pdfContainer.clientHeight - 32;

        const baseViewport = page.getViewport({ scale: 1 });

        const scaleWidth = containerWidth / baseViewport.width;
        const scaleHeight = containerHeight / baseViewport.height;
        const scaleToFit = Math.min(scaleWidth, scaleHeight);

        const finalScale = scaleToFit * state.scale;
        const viewport = page.getViewport({ scale: finalScale });

        const wrapper = state.wrapperEls[0];
        const canvas = wrapper ? wrapper.querySelector('canvas') : null;
        if (!canvas) { state.rendering = false; return; }

        const context = canvas.getContext('2d', { alpha: false });

        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = Math.floor(viewport.width) + 'px';
        canvas.style.height = Math.floor(viewport.height) + 'px';

        context.setTransform(dpr, 0, 0, dpr, 0, 0);

        const renderContext = {
            canvasContext: context,
            viewport: viewport,
            intent: 'display'
        };

        state.renderTask = page.render(renderContext);
        await state.renderTask.promise;

        state.currentPage = pageNum;
        els.pdfPages.textContent = `Página ${pageNum} de ${state.totalPages}`;
        els.pageInput.value = pageNum;
        els.btnPrev.disabled = pageNum <= 1;
        els.btnNext.disabled = pageNum >= state.totalPages;

        state.rendering = false;
    } catch (error) {
        if (error.name !== 'RenderingCancelledException') {
            console.error('Erro ao renderizar:', error);
        }
        state.rendering = false;
    }
}

async function renderPage(pageNum) {
    if (!state.pdfDoc) return;
    if (state.mode === 'continuous') {
        goToPage(pageNum);
        return;
    }
    await renderSinglePage(pageNum);
}

// ============================================
// ALTERNAR MODO DE LEITURA
// ============================================
function toggleReadingMode() {
    state.mode = state.mode === 'single' ? 'continuous' : 'single';
    localStorage.setItem('pdfReadMode', state.mode);
    updateToggleModeButton();

    if (!state.pdfDoc) return;

    const targetPage = state.currentPage;
    if (state.mode === 'continuous') {
        buildContinuousMode();
        requestAnimationFrame(() => goToPage(targetPage));
    } else {
        buildSingleMode();
        renderSinglePage(targetPage);
    }
}

function updateToggleModeButton() {
    const isContinuous = state.mode === 'continuous';
    els.btnToggleMode.classList.toggle('active', isContinuous);
    els.btnToggleMode.innerHTML = isContinuous
        ? '<i class="fas fa-file"></i>'
        : '<i class="fas fa-scroll"></i>';
    els.btnToggleMode.title = isContinuous
        ? 'Modo página única'
        : 'Modo contínuo (rolagem)';
}

// ============================================
// NAVEGAÇÃO
// ============================================
function nextPage() {
    if (state.currentPage < state.totalPages) {
        renderPage(state.currentPage + 1);
    }
}

function prevPage() {
    if (state.currentPage > 1) {
        renderPage(state.currentPage - 1);
    }
}

function goToPage(num) {
    const page = Math.max(1, Math.min(num, state.totalPages));

    if (state.mode === 'continuous') {
        const wrapper = state.wrapperEls[page - 1];
        if (wrapper) wrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
        state.currentPage = page;
        els.pdfPages.textContent = `Página ${page} de ${state.totalPages}`;
        els.pageInput.value = page;
        els.btnPrev.disabled = page <= 1;
        els.btnNext.disabled = page >= state.totalPages;
    } else {
        renderSinglePage(page);
    }
}

// ============================================
// ZOOM — botões, Ctrl+roda, e PINCH-TO-ZOOM
// ============================================

function setScale(newScale, { applyImmediately = true } = {}) {
    state.scale = Math.max(0.25, Math.min(4, +newScale.toFixed(2)));
    els.zoomLevel.textContent = Math.round(state.scale * 100) + '%';
    if (applyImmediately) applyZoomChange();
}

function applyZoomChange() {
    if (!state.pdfDoc) return;
    if (state.mode === 'continuous') {
        rebuildContinuousSizes();
    } else {
        renderSinglePage(state.currentPage);
    }
}

function zoomIn() {
    if (state.scale >= 4) return;
    setScale(state.scale + 0.25);
}

function zoomOut() {
    if (state.scale <= 0.25) return;
    setScale(state.scale - 0.25);
}

// ---- Ctrl + roda do mouse / pinça de trackpad (desktop) ----
let wheelZoomTimer = null;
els.pdfContainer.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const delta = -e.deltaY * 0.01;
    state.scale = Math.max(0.25, Math.min(4, +(state.scale + delta).toFixed(2)));
    els.zoomLevel.textContent = Math.round(state.scale * 100) + '%';

    clearTimeout(wheelZoomTimer);
    wheelZoomTimer = setTimeout(applyZoomChange, 150);
}, { passive: false });

// ============================================
// 👆 GESTOS DE TOQUE — PINCH, PAN e DOUBLE-TAP
// ============================================
// Implementado manualmente porque o navegador não faz "pinch-to-zoom" no
// conteúdo da página quando há overflow:hidden no body — ele só daria zoom
// no viewport inteiro. Aqui a pinça REDIMENSIONA o canvas, o que é o
// comportamento real de um leitor de PDF.

const touchState = {
    mode: null,            // 'pan' | 'pinch' | null
    startX: 0,
    startY: 0,
    scrollLeft: 0,
    scrollTop: 0,
    startDistance: 0,
    startScale: 1,
    pendingScale: 1,
    lastTap: 0,
    moved: false,
    pinching: false
};

function getTouchDistance(t1, t2) {
    const dx = t1.clientX - t2.clientX;
    const dy = t1.clientY - t2.clientY;
    return Math.hypot(dx, dy);
}

els.pdfContainer.addEventListener('touchstart', (e) => {
    // ====== DOIS DEDOS: PINCH ======
    if (e.touches.length === 2) {
        e.preventDefault();
        touchState.mode = 'pinch';
        touchState.pinching = false;
        touchState.startDistance = getTouchDistance(e.touches[0], e.touches[1]);
        touchState.startScale = state.scale;
        touchState.pendingScale = state.scale;
        return;
    }

    // ====== UM DEDO: PAN ou DOUBLE-TAP ======
    if (e.touches.length === 1) {
        touchState.mode = 'pan';
        touchState.moved = false;
        touchState.startX = e.touches[0].clientX;
        touchState.startY = e.touches[0].clientY;
        touchState.scrollLeft = els.pdfContainer.scrollLeft;
        touchState.scrollTop = els.pdfContainer.scrollTop;

        // Detecta double-tap: alterna entre 100% e 200%
        const now = Date.now();
        if (now - touchState.lastTap < 300) {
            e.preventDefault();
            const newScale = state.scale > 1.05 ? 1.0 : 2.0;
            setScale(newScale);
            touchState.lastTap = 0;
            touchState.mode = null;
            return;
        }
        touchState.lastTap = now;
    }
}, { passive: false });

els.pdfContainer.addEventListener('touchmove', (e) => {
    // ====== PINCH (dois dedos) ======
    if (touchState.mode === 'pinch' && e.touches.length === 2) {
        e.preventDefault();
        const distance = getTouchDistance(e.touches[0], e.touches[1]);
        const ratio = distance / touchState.startDistance;
        let newScale = touchState.startScale * ratio;
        newScale = Math.max(0.25, Math.min(4, newScale));

        touchState.pendingScale = newScale;
        touchState.pinching = true;
        touchState.moved = true;

        // Atualiza a % em tempo real (só o texto, não re-renderiza ainda)
        els.zoomLevel.textContent = Math.round(newScale * 100) + '%';
        return;
    }

    // ====== PAN (um dedo) ======
    if (touchState.mode === 'pan' && e.touches.length === 1) {
        const dx = e.touches[0].clientX - touchState.startX;
        const dy = e.touches[0].clientY - touchState.startY;

        // Só começa a arrastar se realmente moveu > 3px (evita bloquear taps)
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
            e.preventDefault();
            touchState.moved = true;
            els.pdfContainer.scrollLeft = touchState.scrollLeft - dx;
            els.pdfContainer.scrollTop = touchState.scrollTop - dy;
        }
    }
}, { passive: false });

els.pdfContainer.addEventListener('touchend', (e) => {
    // ====== FIM DO PINCH: aplica a nova escala ======
    if (touchState.mode === 'pinch') {
        if (touchState.pinching && Math.abs(touchState.pendingScale - state.scale) > 0.03) {
            setScale(touchState.pendingScale);
        }
        touchState.pinching = false;
    }

    // Se ainda há 1 dedo na tela (passou de 2 → 1), reinicia como pan
    if (e.touches.length === 1) {
        touchState.mode = 'pan';
        touchState.moved = false;
        touchState.startX = e.touches[0].clientX;
        touchState.startY = e.touches[0].clientY;
        touchState.scrollLeft = els.pdfContainer.scrollLeft;
        touchState.scrollTop = els.pdfContainer.scrollTop;
    } else if (e.touches.length === 0) {
        touchState.mode = null;
    }
}, { passive: true });

els.pdfContainer.addEventListener('touchcancel', () => {
    touchState.mode = null;
    touchState.pinching = false;
});

// Atualiza o indicador de página conforme rola no modo contínuo
els.pdfContainer.addEventListener('scroll', () => {
    if (state.mode !== 'continuous') return;
    if (state.scrollRAF) return;
    state.scrollRAF = requestAnimationFrame(() => {
        updateCurrentPageFromScroll();
        state.scrollRAF = null;
    });
});

// ============================================
// FULLSCREEN
// ============================================
function toggleFullscreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen?.();
        els.btnFullscreen.innerHTML = '<i class="fas fa-compress"></i>';
    } else {
        document.exitFullscreen?.();
        els.btnFullscreen.innerHTML = '<i class="fas fa-expand"></i>';
    }
}

// ============================================
// LEITURA DE QR CODE - CÂMERA
// ============================================
async function startCameraScanner() {
    if (state.html5QrCode) {
        try { await state.html5QrCode.stop(); } catch(e) {}
    }

    try {
        state.html5QrCode = new Html5Qrcode("qrReader");
        
        await state.html5QrCode.start(
            { facingMode: "environment" },
            {
                fps: 10,
                qrbox: { width: 250, height: 250 },
                aspectRatio: 1.0
            },
            (decodedText) => {
                onQRCodeFound(decodedText, 'camera');
            },
            () => {}
        );
    } catch (error) {
        console.error('Erro ao iniciar câmera:', error);
        showToast('❌ Não foi possível acessar a câmera', 'error');
    }
}

async function stopCameraScanner() {
    if (state.html5QrCode) {
        try {
            await state.html5QrCode.stop();
            state.html5QrCode.clear();
        } catch(e) {}
        state.html5QrCode = null;
    }
}

// ============================================
// QR CODE ENCONTRADO
// ============================================
function onQRCodeFound(text, source) {
    if (navigator.vibrate) navigator.vibrate(100);

    els.resultText.textContent = text;
    els.btnOpenResult.href = text;
    els.scanResult.hidden = false;

    showToast('✅ QR Code detectado!', 'success');
}

// ============================================
// LEITURA DE QR CODE - DENTRO DO PDF
// ============================================
async function scanPageForQR(pageNum) {
    if (!state.pdfDoc) {
        showToast('⚠️ Nenhum PDF carregado', 'error');
        return null;
    }

    try {
        const page = await state.pdfDoc.getPage(pageNum);
        
        const viewport = page.getViewport({ scale: 3.0 });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        await page.render({
            canvasContext: context,
            viewport: viewport
        }).promise;

        const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
        
        const qrCode = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: 'attemptBoth'
        });

        if (qrCode && qrCode.data) {
            return qrCode.data;
        }

        return null;
    } catch (error) {
        console.error(`Erro ao escanear página ${pageNum}:`, error);
        return null;
    }
}

async function scanCurrentPage() {
    showToast('🔍 Escaneando página atual...', 'info');
    
    const result = await scanPageForQR(state.currentPage);
    
    if (result) {
        onQRCodeFound(result, 'pdf');
    } else {
        showToast('❌ Nenhum QR Code encontrado nesta página', 'error');
    }
}

async function scanAllPages() {
    if (!state.pdfDoc) {
        showToast('⚠️ Nenhum PDF carregado', 'error');
        return;
    }

    showToast(`🔍 Escaneando ${state.totalPages} páginas...`, 'info');
    
    let found = 0;
    const results = [];

    for (let i = 1; i <= state.totalPages; i++) {
        showToast(`🔍 Escaneando página ${i}/${state.totalPages}...`, 'info', 1000);
        const result = await scanPageForQR(i);
        
        if (result) {
            found++;
            results.push({ page: i, data: result });
            console.log(`QR Code na página ${i}:`, result);
            
            if (found === 1) {
                onQRCodeFound(result, 'pdf');
            }
        }
        
        await new Promise(r => setTimeout(r, 100));
    }

    if (found > 0) {
        showToast(`✅ ${found} QR Code(s) encontrado(s)!`, 'success', 5000);
        if (found > 1) {
            console.log('Todos os QR Codes encontrados:', results);
        }
    } else {
        showToast('❌ Nenhum QR Code encontrado no PDF', 'error');
    }
}

// ============================================
// COPIAR RESULTADO
// ============================================
async function copyResult() {
    const text = els.resultText.textContent;
    try {
        await navigator.clipboard.writeText(text);
        showToast('✅ Copiado!', 'success');
    } catch (e) {
        showToast('❌ Erro ao copiar', 'error');
    }
}

// ============================================
// HISTÓRICO
// ============================================
function addToHistory(fileName) {
    state.history = state.history.filter(h => h.name !== fileName);
    state.history.unshift({
        name: fileName,
        date: new Date().toISOString()
    });
    state.history = state.history.slice(0, 10);
    localStorage.setItem('pdfHistory', JSON.stringify(state.history));
}

// ============================================
// MODAIS
// ============================================
function openScannerModal() {
    els.scannerModal.hidden = false;
    els.scanResult.hidden = true;
    startCameraScanner();
}

function closeScannerModal() {
    els.scannerModal.hidden = true;
    stopCameraScanner();
    els.scanResult.hidden = true;
}

function openSidebar() {
    els.sidebar.hidden = false;
    els.overlay.hidden = false;
}

function closeSidebar() {
    els.sidebar.hidden = true;
    els.overlay.hidden = true;
}

// ============================================
// TEMA
// ============================================
function toggleTheme() {
    document.body.classList.toggle('light-theme');
    const isLight = document.body.classList.contains('light-theme');
    localStorage.setItem('pdfTheme', isLight ? 'light' : 'dark');
}

if (localStorage.getItem('pdfTheme') === 'light') {
    document.body.classList.add('light-theme');
}

// ============================================
// EVENTOS
// ============================================

// Drag & Drop
els.dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    els.dropZone.classList.add('drag-over');
});

els.dropZone.addEventListener('dragleave', () => {
    els.dropZone.classList.remove('drag-over');
});

els.dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    els.dropZone.classList.remove('drag-over');
    
    const files = Array.from(e.dataTransfer.files);
    const pdf = files.find(f => isPDF(f));
    
    if (pdf) {
        loadPDF(pdf);
    } else {
        showToast('❌ Nenhum PDF encontrado', 'error');
    }
});

// Input de arquivo único
els.fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) loadPDF(file);
    e.target.value = '';
});

// Botões de navegação
els.btnNext.addEventListener('click', nextPage);
els.btnPrev.addEventListener('click', prevPage);
els.pageInput.addEventListener('change', (e) => goToPage(parseInt(e.target.value)));

// Zoom (botões)
els.btnZoomIn.addEventListener('click', zoomIn);
els.btnZoomOut.addEventListener('click', zoomOut);
els.btnFullscreen.addEventListener('click', toggleFullscreen);

// Modo de leitura
els.btnToggleMode.addEventListener('click', toggleReadingMode);
updateToggleModeButton();

// Scan QR
els.btnScan.addEventListener('click', openScannerModal);
els.btnScanPage.addEventListener('click', openScannerModal);
els.btnCloseScanner.addEventListener('click', closeScannerModal);
els.btnScanAllPages.addEventListener('click', scanAllPages);
els.btnScanCurrentPage.addEventListener('click', scanCurrentPage);
els.btnCopyResult.addEventListener('click', copyResult);

// Abrir arquivo
els.btnOpen.addEventListener('click', () => els.fileInput.click());
els.btnBack.addEventListener('click', () => {
    els.viewer.hidden = true;
    els.welcomeScreen.hidden = false;
    clearPagesList();
    if (state.pdfDoc) {
        state.pdfDoc.destroy();
        state.pdfDoc = null;
    }
});

// Menu
els.btnMenu.addEventListener('click', openSidebar);
els.btnCloseSidebar.addEventListener('click', closeSidebar);
els.overlay.addEventListener('click', closeSidebar);

// Navegação sidebar
document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
        const id = item.id;
        closeSidebar();
        
        switch(id) {
            case 'navOpen': els.fileInput.click(); break;
            case 'navScan': openScannerModal(); break;
            case 'navTheme': toggleTheme(); break;
            case 'navAbout': 
                showToast('📄 Leitor de PDF, grátis. Desenvolvedor: Pr Uanderley', 'info', 5000); 
                break;
            case 'navHistory':
                if (state.history.length === 0) {
                    showToast('📭 Histórico vazio', 'info');
                } else {
                    showToast(`📚 ${state.history.length} PDF(s) no histórico`, 'info');
                    console.log('Histórico:', state.history);
                }
                break;
        }
    });
});

// Tabs do scanner
document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        
        tab.classList.add('active');
        const target = tab.dataset.tab;
        $(target === 'camera' ? 'tabCamera' : 'tabPdf').classList.add('active');
        
        if (target === 'camera') {
            startCameraScanner();
        } else {
            stopCameraScanner();
        }
    });
});

// Atalhos de teclado
document.addEventListener('keydown', (e) => {
    if (els.viewer.hidden) return;
    
    switch(e.key) {
        case 'ArrowRight':
        case 'PageDown':
            nextPage();
            break;
        case 'ArrowLeft':
        case 'PageUp':
            prevPage();
            break;
        case '+':
        case '=':
            zoomIn();
            break;
        case '-':
            zoomOut();
            break;
        case 'Escape':
            if (!els.scannerModal.hidden) closeScannerModal();
            if (!els.sidebar.hidden) closeSidebar();
            break;
    }
});

// Re-renderiza ao redimensionar
let resizeTimeout;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        if (!state.pdfDoc || els.viewer.hidden) return;
        if (state.mode === 'continuous') {
            rebuildContinuousSizes();
        } else {
            renderSinglePage(state.currentPage);
        }
    }, 300);
});

// ============================================
// SERVICE WORKER
// ============================================
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js')
            .then(() => console.log('✅ Service Worker registrado'))
            .catch(err => console.log('❌ SW falhou:', err));
    });
}

// Prevenir zoom com gestos do iOS Safari (pinça do viewport).
// O pinch do conteúdo do PDF é tratado em JS (touchstart/touchmove/touchend)
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('gesturechange', (e) => e.preventDefault());
document.addEventListener('gestureend', (e) => e.preventDefault());

// ============================================
// INICIALIZAÇÃO
// ============================================
console.log('📄 PDF Reader Pro v1.1');
console.log('👨‍💻 Desenvolvedor: Pr Uanderley');
console.log('✨ Recursos: Pinch-to-zoom, pan, double-tap, QR Code, PWA');