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

        // Adiciona ao histórico
        addToHistory(file.name);

        // Atualiza UI
        els.pdfName.textContent = file.name;
        els.totalPages.textContent = pdf.numPages;
        els.pageInput.value = 1;
        els.pageInput.max = pdf.numPages;
        els.zoomLevel.textContent = '100%';

        // Mostra viewer e esconde welcome
        els.welcomeScreen.hidden = true;
        els.viewer.hidden = false;

        // Guarda as dimensões da página 1 (assume páginas uniformes) para
        // calcular o layout do modo contínuo sem precisar abrir todas as páginas
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

// Pega as dimensões da página 1 em escala 1. É usado como referência para
// estimar a altura de TODAS as páginas no modo contínuo (assume documento
// com páginas de tamanho uniforme, o caso comum: livros, contratos, apostilas).
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
        // Reserva o espaço da página antes de renderizar, pra rolagem não pular
        wrapper.style.width = Math.floor(estWidth) + 'px';
        wrapper.style.height = Math.floor(estHeight) + 'px';
        els.pagesList.appendChild(wrapper);
        state.wrapperEls[i - 1] = wrapper;
    }

    setupContinuousObserver();
}

// Recalcula o tamanho estimado de cada página quando o zoom muda ou a tela
// é redimensionada, e força a re-renderização das páginas visíveis
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

    // Re-observar força o IntersectionObserver a reavaliar o que está visível
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
        // Pré-carrega ~800px antes/depois da área visível, pra rolar sem esperar
        rootMargin: '800px 0px',
        threshold: 0.01
    });

    state.wrapperEls.forEach(w => state.observer.observe(w));
}

// Renderiza uma página dentro do modo contínuo (alta resolução, igual ao modo único)
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

        // Ajusta o wrapper para o tamanho real (a estimativa pode ter um leve erro)
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

// Libera o canvas de páginas que saíram da área pré-carregada, pra economizar
// memória e CPU — essencial num notebook sem GPU dedicada
function unrenderContinuousPage(pageNum, wrapper) {
    if (!state.renderedSet.has(pageNum)) return;
    state.renderedSet.delete(pageNum);
    const canvas = wrapper.querySelector('canvas');
    if (canvas) canvas.remove();
}

// Atualiza o indicador de página com base em qual página está mais perto
// do centro da área visível durante a rolagem contínua
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
// RENDERIZAÇÃO DE PÁGINA — MODO PÁGINA ÚNICA (ALTA RESOLUÇÃO)
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

// Ponto único chamado pelo resto do app (histórico de chamadas preservado);
// decide se navega dentro do modo contínuo ou renderiza a página única
async function renderPage(pageNum) {
    if (!state.pdfDoc) return;
    if (state.mode === 'continuous') {
        goToPage(pageNum);
        return;
    }
    await renderSinglePage(pageNum);
}

// ============================================
// ALTERNAR MODO DE LEITURA (página única / contínuo)
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
// ZOOM
// ============================================

// Aplica a mudança de escala no modo atual: no modo único, apenas
// re-renderiza a página; no modo contínuo, recalcula o tamanho de todas
// as páginas e força novo carregamento das que estão visíveis
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
    state.scale = Math.min(4, +(state.scale + 0.25).toFixed(2));
    els.zoomLevel.textContent = Math.round(state.scale * 100) + '%';
    applyZoomChange();
}

function zoomOut() {
    if (state.scale <= 0.25) return;
    state.scale = Math.max(0.25, +(state.scale - 0.25).toFixed(2));
    els.zoomLevel.textContent = Math.round(state.scale * 100) + '%';
    applyZoomChange();
}

// Zoom por pinça (dois dedos) — dá feedback visual instantâneo com um
// transform de CSS (barato) e só re-renderiza em alta resolução quando o
// usuário solta os dedos, pra não pesar a CPU durante o gesto
let pinch = { active: false, startDist: 0, startScale: 1, currentScale: null };

function touchDist(touches) {
    return Math.hypot(
        touches[0].clientX - touches[1].clientX,
        touches[0].clientY - touches[1].clientY
    );
}

els.pdfContainer.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
        pinch.active = true;
        pinch.startDist = touchDist(e.touches);
        pinch.startScale = state.scale;
        pinch.currentScale = state.scale;

        const rect = els.pdfContainer.getBoundingClientRect();
        const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
        const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
        els.pagesList.style.transformOrigin = `${midX}px ${midY}px`;
    }
}, { passive: true });

els.pdfContainer.addEventListener('touchmove', (e) => {
    if (pinch.active && e.touches.length === 2) {
        e.preventDefault();
        const ratio = touchDist(e.touches) / pinch.startDist;
        const newScale = Math.max(0.25, Math.min(4, pinch.startScale * ratio));
        pinch.currentScale = newScale;

        // Prévia instantânea via CSS transform (sem re-renderizar o PDF)
        els.pagesList.style.transform = `scale(${newScale / pinch.startScale})`;
        els.zoomLevel.textContent = Math.round(newScale * 100) + '%';
    }
}, { passive: false });

function endPinch() {
    if (!pinch.active) return;
    pinch.active = false;
    els.pagesList.style.transform = '';
    if (pinch.currentScale) {
        state.scale = +pinch.currentScale.toFixed(2);
        applyZoomChange();
    }
}

els.pdfContainer.addEventListener('touchend', (e) => {
    if (e.touches.length < 2) endPinch();
});
els.pdfContainer.addEventListener('touchcancel', endPinch);

// Zoom com Ctrl + roda do mouse / pinça no trackpad (desktop)
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

// Atualiza o indicador de página conforme o usuário rola no modo contínuo
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
        
        // Renderiza em alta resolução para o scan
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

// Zoom
els.btnZoomIn.addEventListener('click', zoomIn);
els.btnZoomOut.addEventListener('click', zoomOut);
els.btnFullscreen.addEventListener('click', toggleFullscreen);

// Modo de leitura (página única / rolagem contínua)
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

// Prevenir zoom com gestos
document.addEventListener('gesturestart', (e) => e.preventDefault());

// ============================================
// INICIALIZAÇÃO
// ============================================
console.log('📄 PDF Reader Pro v1.0');
console.log('✨ Recursos: Alta resolução, QR Code, Histórico');