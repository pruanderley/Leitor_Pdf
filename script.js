// ============================================
// LEITOR DE PDF - SCRIPT PRINCIPAL
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
    history: JSON.parse(localStorage.getItem('pdfHistory') || '[]')
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
    pdfCanvas: $('pdfCanvas'),
    pdfContainer: $('pdfContainer'),
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
// VERIFICAR SE É PDF
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

        await renderPage(1);

        showToast(`✅ PDF carregado: ${pdf.numPages} páginas`, 'success');
    } catch (error) {
        console.error('Erro ao carregar PDF:', error);
        showToast('❌ Erro ao carregar PDF', 'error');
    }
}

// ============================================
// RENDERIZAÇÃO DE PÁGINA (ALTA RESOLUÇÃO)
// ============================================
async function renderPage(pageNum) {
    if (!state.pdfDoc || state.rendering) return;

    if (state.renderTask) {
        try { state.renderTask.cancel(); } catch(e) {}
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

        const canvas = els.pdfCanvas;
        const context = canvas.getContext('2d', { alpha: false });
        
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = Math.floor(viewport.width) + 'px';
        canvas.style.height = Math.floor(viewport.height) + 'px';

        context.setTransform(dpr, 0, 0, dpr, 0, 0);

        const renderContext = {
            canvasContext: context,
            viewport: viewport,
            intent: 'display',
            enableWebGL: true
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
    renderPage(page);
}

// ============================================
// ZOOM
// ============================================
function zoomIn() {
    if (state.scale >= 4) return;
    state.scale = Math.min(4, state.scale + 0.25);
    els.zoomLevel.textContent = Math.round(state.scale * 100) + '%';
    renderPage(state.currentPage);
}

function zoomOut() {
    if (state.scale <= 0.25) return;
    state.scale = Math.max(0.25, state.scale - 0.25);
    els.zoomLevel.textContent = Math.round(state.scale * 100) + '%';
    renderPage(state.currentPage);
}

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

// Zoom
els.btnZoomIn.addEventListener('click', zoomIn);
els.btnZoomOut.addEventListener('click', zoomOut);
els.btnFullscreen.addEventListener('click', toggleFullscreen);

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
        if (state.pdfDoc && !els.viewer.hidden) {
            renderPage(state.currentPage);
        }
    }, 300);
});

// ============================================
// SERVICE WORKER (CORRIGIDO PARA GITHUB PAGES)
// ============================================
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js', { scope: './' })
            .then(registration => {
                console.log('✅ Service Worker registrado com sucesso');
                console.log('📍 Escopo:', registration.scope);
            })
            .catch(err => {
                console.error('❌ Service Worker falhou:', err);
            });
    });
}

// Prevenir zoom com gestos
document.addEventListener('gesturestart', (e) => e.preventDefault());

// ============================================
// INICIALIZAÇÃO
// ============================================
console.log('📄 Leitor de PDF v1.0');
console.log('👨‍💻 Desenvolvedor: Pr Uanderley');
console.log('✨ Recursos: Alta resolução, QR Code, Histórico, PWA');