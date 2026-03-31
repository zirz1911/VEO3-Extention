// ── Cancellation flag ─────────────────────────────────────────────────────
let _cancelRequested = false;
function checkCancelled() {
    if (_cancelRequested) throw new Error('CANCELLED');
}

// ── FFmpeg: convert webm → mp4 ────────────────────────────────────────────
let _ffmpeg = null;

async function initFFmpeg() {
    if (_ffmpeg && _ffmpeg.isLoaded()) return _ffmpeg;
    const { createFFmpeg } = window.FFmpeg;
    _ffmpeg = createFFmpeg({
        corePath: chrome.runtime.getURL('ffmpeg/ffmpeg-core.js'),
        log: false
    });
    await _ffmpeg.load();
    return _ffmpeg;
}

async function convertWebmToMp4(webmBlob, onProgress) {
    const ffmpeg = await initFFmpeg();
    if (onProgress) ffmpeg.setProgress(onProgress);
    const { fetchFile } = window.FFmpeg;
    ffmpeg.FS('writeFile', 'input.webm', await fetchFile(webmBlob));
    await ffmpeg.run('-i', 'input.webm', '-c:v', 'copy', '-c:a', 'copy', '-movflags', '+faststart', 'output.mp4');
    const data = ffmpeg.FS('readFile', 'output.mp4');
    try { ffmpeg.FS('unlink', 'input.webm'); } catch (_) {}
    try { ffmpeg.FS('unlink', 'output.mp4'); } catch (_) {}
    return new Blob([data.buffer], { type: 'video/mp4' });
}

// helper: ส่ง progress ไปแสดงบนหน้า Flow
async function updateFlowTabOverlay(text) {
    try {
        const tabs = await chrome.tabs.query({ url: 'https://labs.google/*' });
        if (tabs.length > 0) chrome.tabs.sendMessage(tabs[0].id, { action: 'updateLogoProgress', text });
    } catch (_) {}
}

// ── Task Management State ─────────────────────────────────────────────────
let _taskEditMode = false;
let _editingTaskId = null;
let _editingSchedules = [];

// ── Auto Split: เปิด TikTok Studio ตอน extension โหลด ──────────────────────
async function ensureTikTokStudioOpen({ focus = false } = {}) {
    const TIKTOK_URL = 'https://www.tiktok.com/tiktokstudio/upload?from=creator_center';

    const existing = await chrome.tabs.query({ url: 'https://www.tiktok.com/tiktokstudio/*' });
    if (existing.length > 0) {
        const tab = existing[0];
        if (!tab.url?.includes('/upload')) {
            // อยู่หน้าอื่นของ TikTok Studio — navigate ไปหน้า upload
            console.log('TikTok Studio open but not on upload page — navigating...');
            await chrome.tabs.update(tab.id, { url: TIKTOK_URL, active: focus });
            await waitForTabComplete(tab.id);
        } else if (focus) {
            await chrome.tabs.update(tab.id, { active: true });
        }
        console.log('TikTok Studio ready on upload page');
        return;
    }

    // เปิด new tab เสมอ — ไม่ navigate tab labs.google
    await chrome.tabs.create({ url: TIKTOK_URL, active: focus });
    console.log('TikTok Studio opened as new tab');
}

async function switchToTikTok() {
    const tabs = await chrome.tabs.query({ url: 'https://www.tiktok.com/tiktokstudio/*' });
    if (tabs.length > 0) {
        await chrome.tabs.update(tabs[0].id, { active: true });
        console.log('Switched to TikTok Studio');
    }
}

// รอให้ tab โหลดเสร็จ
function waitForTabComplete(tabId, timeoutMs = 20000) {
    return new Promise((resolve) => {
        chrome.tabs.get(tabId, (tab) => {
            if (tab.status === 'complete') { resolve(); return; }
            const listener = (id, info) => {
                if (id === tabId && info.status === 'complete') {
                    chrome.tabs.onUpdated.removeListener(listener);
                    resolve();
                }
            };
            chrome.tabs.onUpdated.addListener(listener);
            setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); resolve(); }, timeoutMs);
        });
    });
}

// ส่ง message ไป TikTok tab — inject ก่อนถ้า sendMessage connection failed
async function sendToTikTok(tabId, message) {
    // รอ tab โหลดเสร็จก่อน
    await waitForTabComplete(tabId);
    await new Promise(r => setTimeout(r, 1500));

    // ลอง sendMessage ก่อน
    let lastError = null;
    const result = await new Promise(resolve => {
        chrome.tabs.sendMessage(tabId, message, res => {
            lastError = chrome.runtime.lastError || null;
            resolve(lastError ? null : (res || { ok: true }));
        });
    });

    // ถ้า content script ตอบกลับมาแล้ว (ไม่ว่าจะ ok หรือ error) — ไม่ต้อง inject
    if (result !== null) {
        if (result.error) throw new Error(result.error);
        return result;
    }

    // connection failed จริง → inject แล้วลองใหม่
    console.warn('sendMessage connection failed, injecting script:', lastError?.message);
    await chrome.scripting.executeScript({ target: { tabId }, files: ['tiktok_content.js'] });
    await new Promise(r => setTimeout(r, 1500));

    return new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tabId, message, res => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else if (res?.error) reject(new Error(res.error));
            else resolve(res || { ok: true });
        });
    });
}

// ── Canvas logo overlay (runs in sidepanel DOM context) ──────────────────────
async function spTestLogoOverlay(videoBlob, logoDataUrl, { sizePct = 15, padding = 20, logoPosFrac = null, onStatus } = {}) {
    onStatus?.('⏳ กำลังโหลด Logo...');
    const logoImg = await new Promise((res, rej) => {
        const img = new Image();
        img.onload = () => res(img);
        img.onerror = () => rej(new Error('โหลด Logo ไม่ได้'));
        img.src = logoDataUrl;
    });

    onStatus?.('⏳ กำลังโหลด Video metadata...');
    const video = document.createElement('video');
    video.playsInline = true;
    const videoObjectUrl = URL.createObjectURL(videoBlob);
    video.src = videoObjectUrl;
    await new Promise((res, rej) => {
        video.onloadedmetadata = res;
        video.onerror = () => rej(new Error('โหลด Video ไม่ได้'));
    });

    const W = video.videoWidth  || 720;
    const H = video.videoHeight || 1280;
    onStatus?.(`⏳ กำลัง Process ${W}x${H}...`);

    let logoW, logoX, logoY;
    if (logoPosFrac) {
        logoW = Math.round(W * logoPosFrac.wf);
        logoX = Math.round(W * logoPosFrac.xf);
        logoY = Math.round(H * logoPosFrac.yf);
    } else {
        logoW = Math.round(W * sizePct / 100);
        logoX = W - logoW - padding;
        logoY = H - Math.round(logoW * (logoImg.naturalHeight / logoImg.naturalWidth)) - padding;
    }
    const logoH = Math.round(logoW * (logoImg.naturalHeight / logoImg.naturalWidth));

    const canvas = document.createElement('canvas');
    canvas.width  = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    // Audio routing: video → AudioContext → MediaStreamDestination
    let audioCtx, audioStream;
    try {
        audioCtx  = new AudioContext();
        const src  = audioCtx.createMediaElementSource(video);
        const dest = audioCtx.createMediaStreamDestination();
        src.connect(dest);
        src.connect(audioCtx.destination);
        audioStream = dest.stream;
    } catch (e) {
        console.warn('[Logo] Audio routing failed, no audio:', e.message);
        audioStream = null;
    }

    // รวม video stream + audio stream
    const canvasStream = canvas.captureStream(30);
    const tracks = [...canvasStream.getVideoTracks()];
    if (audioStream) tracks.push(...audioStream.getAudioTracks());
    const combined = new MediaStream(tracks);

    const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
        .find(m => MediaRecorder.isTypeSupported(m)) || 'video/webm';
    const recorder = new MediaRecorder(combined, { mimeType, videoBitsPerSecond: 8_000_000 });
    const chunks = [];
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

    let animId;
    function drawFrame() {
        if (video.paused || video.ended) return;
        ctx.drawImage(video, 0, 0, W, H);
        ctx.drawImage(logoImg, logoX, logoY, logoW, logoH);
        animId = requestAnimationFrame(drawFrame);
    }

    return new Promise((res, rej) => {
        recorder.onstop = () => {
            cancelAnimationFrame(animId);
            if (audioCtx) audioCtx.close().catch(() => {});
            URL.revokeObjectURL(videoObjectUrl);
            res(new Blob(chunks, { type: mimeType }));
        };
        recorder.onerror = (e) => rej(e.error);

        recorder.start(100);
        video.play().catch(e => console.warn('[Logo] video.play():', e.message));

        let frameCount = 0;
        const progressTick = setInterval(() => {
            if (video.duration) {
                const pct = Math.round((video.currentTime / video.duration) * 100);
                onStatus?.(`⏳ Encoding... ${pct}% (${Math.round(video.currentTime)}s / ${Math.round(video.duration)}s)`);
            }
            frameCount++;
        }, 1000);

        video.onended = () => {
            clearInterval(progressTick);
            ctx.drawImage(video, 0, 0, W, H);
            ctx.drawImage(logoImg, logoX, logoY, logoW, logoH);
            setTimeout(() => recorder.stop(), 300);
        };

        requestAnimationFrame(drawFrame);
    });
}

// ── Logo pre-process BEFORE switching to TikTok (manual flow) ────────────────
async function prepareAndUploadToTikTok(videoUrl, caption, productId, statusEl) {
    const setStatus = (msg) => { if (statusEl) statusEl.innerText = msg; console.log('[PrepareUpload]', msg); };

    const logoSettings = await new Promise(r =>
        chrome.storage.local.get(['logoEnabled', 'logoDataUrl', 'logoSize', 'logoPadding', 'logoPosFrac'], r)
    );
    console.log('[PrepareUpload] logoEnabled:', logoSettings.logoEnabled, '| hasDataUrl:', !!logoSettings.logoDataUrl);

    let processedBase64 = null;
    let processedMimeType = null;

    // แสดง overlay บนหน้า Flow — บังไม่ให้ user กดระหว่าง process
    const flowTabs = await chrome.tabs.query({ url: 'https://labs.google/*' });
    const flowTabId = flowTabs[0]?.id || null;
    const sendToFlow = (text) => {
        setStatus(text);
        if (flowTabId) chrome.tabs.sendMessage(flowTabId, { action: 'updateLogoProgress', text });
    };
    if (flowTabId) chrome.tabs.sendMessage(flowTabId, { action: 'showLogoProgress', text: 'กำลังเตรียมไฟล์...' });

    if (logoSettings.logoEnabled && logoSettings.logoDataUrl) {
        // ถ้า logo enabled — ต้องเสร็จก่อนถึงจะ upload ได้ ห้าม catch แล้วข้าม
        checkCancelled();
        sendToFlow('⬇️ [1/4] กำลังดาวน์โหลดวิดีโอ...');
        const fetchResult = await new Promise((res, rej) =>
            chrome.runtime.sendMessage({ action: 'fetchVideoAsBase64', url: videoUrl }, (r) =>
                r?.error ? rej(new Error(r.error)) : res(r)
            )
        );
        checkCancelled();
        const fetchRes = await fetch(fetchResult.base64);
        const blob = await fetchRes.blob();
        const sizeMB = Math.round(blob.size / 1024 / 1024 * 10) / 10;
        sendToFlow(`✅ [2/4] โหลดแล้ว ${sizeMB} MB — กำลังใส่ Logo...`);

        checkCancelled();
        const webmBlob = await spTestLogoOverlay(blob, logoSettings.logoDataUrl, {
            sizePct:     logoSettings.logoSize    || 15,
            padding:     logoSettings.logoPadding || 20,
            logoPosFrac: logoSettings.logoPosFrac || null,
            onStatus:    sendToFlow
        });
        sendToFlow('🎬 [3/4] Logo เสร็จ! กำลัง Convert เป็น MP4...');
        console.log('[PrepareUpload] Logo done, converting webm→mp4...');

        checkCancelled();
        const mp4Blob = await convertWebmToMp4(webmBlob, ({ ratio }) => {
            const pct = Math.round((ratio || 0) * 100);
            sendToFlow(`🔄 [3/4] Converting MP4... ${pct}%`);
        });
        console.log('[PrepareUpload] MP4 ready, size:', Math.round(mp4Blob.size / 1024) + 'KB');

        sendToFlow('📦 [4/4] MP4 พร้อม! กำลัง encode...');
        const reader = new FileReader();
        processedBase64 = await new Promise(res => { reader.onload = () => res(reader.result); reader.readAsDataURL(mp4Blob); });
        processedMimeType = 'video/mp4';
        checkCancelled();
        sendToFlow('✅ พร้อมแล้ว! กำลังสลับไป TikTok...');
    } else {
        sendToFlow('📤 กำลังเปิด TikTok...');
    }

    checkCancelled();
    // ปิด overlay บนหน้า Flow
    if (flowTabId) chrome.tabs.sendMessage(flowTabId, { action: 'hideLogoProgress' });

    // เปิด/หา TikTok tab — ยังไม่สลับ focus
    await ensureTikTokStudioOpen({ focus: false });
    const tiktokTabs = await chrome.tabs.query({ url: 'https://www.tiktok.com/tiktokstudio/*' });
    if (tiktokTabs.length === 0) throw new Error('TikTok tab not found after open');

    // สลับมาหน้า TikTok — เฉพาะตอนนี้เท่านั้น หลัง logo + mp4 เสร็จแล้ว
    console.log('[PrepareUpload] Switching to TikTok now...');
    await chrome.tabs.update(tiktokTabs[0].id, { active: true });
    await sendToTikTok(tiktokTabs[0].id, {
        action: 'uploadVideo',
        videoUrl,
        caption,
        productId,
        processedBase64,
        processedMimeType
    });
}

async function switchToFlow() {
    const tabs = await chrome.tabs.query({ url: 'https://labs.google/*' });
    if (tabs.length > 0) {
        const tabId = tabs[0].id;
        // Reload ก่อนเสมอ เพื่อ reset state ของหน้า
        await chrome.tabs.reload(tabId);
        await waitForTabComplete(tabId);
        await chrome.tabs.update(tabId, { active: true });
        console.log('Switched to Flow (reloaded)');
    }
}

// ── Listen for messages from content script ───────────────────────────────
chrome.runtime.onMessage.addListener((message) => {
    const statusBar   = document.getElementById('statusBar');
    const statusText  = document.getElementById('statusText');
    const progressFill = document.querySelector('.progress-fill');
    const runBtn      = document.getElementById('runAllBtn');

    if (message.action === 'cancelAutomation') {
        _cancelRequested = true;
        const automationOverlay = document.getElementById('automationOverlay');
        if (automationOverlay) automationOverlay.classList.add('hidden');
        if (statusBar) statusBar.classList.add('hidden');
        if (progressFill) { progressFill.classList.remove('pulse'); progressFill.style.width = '0%'; }
        if (statusText) statusText.innerText = 'ยกเลิกแล้ว';
        const _runAllBtn = document.getElementById('runAllBtn');
        const _cancelBtn = document.getElementById('cancelTaskBtn');
        if (_runAllBtn) _runAllBtn.disabled = false;
        if (_cancelBtn) _cancelBtn.classList.add('hidden');
        chrome.storage.local.remove('jobStatus');
        chrome.storage.local.remove('sidepanelHandlingUpload');
        setTimeout(() => { _cancelRequested = false; }, 1000);
        console.log('Automation cancelled from Flow page');
    }

    if (message.action === 'progress') {
        statusText.innerText = message.text || 'กำลังทำงาน...';
        const overlayStepText = document.getElementById('overlayStepText');
        if (overlayStepText) overlayStepText.innerText = message.text || 'กำลังทำงาน...';
    }

    if (message.action === 'videoReady') {
        progressFill.classList.remove('pulse');
        progressFill.style.transition = '';
        progressFill.style.width = '100%';
        statusText.innerText = "วิดีโอพร้อม! กำลังใส่ Logo...";
        // แจ้ง background.js ว่า sidepanel กำลัง handle upload อยู่ — ห้ามสลับ tab เอง
        chrome.storage.local.set({ jobStatus: { running: true, text: 'กำลังใส่ Logo...' }, sidepanelHandlingUpload: true });

        const automationOverlay = document.getElementById('automationOverlay');

        (async () => {
            try {
                if (_cancelRequested) { console.log('[videoReady] cancelled — skip'); return; }
                const { lastVideoUrl, formData } = await chrome.storage.local.get(['lastVideoUrl', 'formData']);
                const caption   = document.getElementById('captionInput').value.trim() || formData?.caption || '';
                const productId = document.getElementById('productIdInput').value.trim() || formData?.productId || '';

                if (!lastVideoUrl) {
                    console.warn("No lastVideoUrl — skipping auto upload");
                    return;
                }

                // อยู่หน้า Flow จนกว่า logo เสร็จ + upload เสร็จ — แล้วค่อยสลับ
                await prepareAndUploadToTikTok(lastVideoUrl, caption, productId, statusText);
                statusText.innerText = "อัปโหลดเสร็จ! กลับไปหน้า Flow...";
                await switchToFlow();
            } catch (err) {
                if (err.message !== 'CANCELLED') {
                    console.error("TikTok flow error:", err);
                    statusText.innerText = "Error: " + err.message;
                }
            } finally {
                if (!_cancelRequested) await new Promise(r => setTimeout(r, 3000));
                statusBar.classList.add('hidden');
                progressFill.style.width = '0%';
                statusText.innerText = "กำลังสร้างวิดีโอ.. รอสักครู่";
                const _runAllBtn    = document.getElementById('runAllBtn');
                const _cancelBtn   = document.getElementById('cancelTaskBtn');
                if (_runAllBtn)  _runAllBtn.disabled = false;
                if (_cancelBtn) _cancelBtn.classList.add('hidden');
                chrome.storage.local.remove('jobStatus');
                chrome.storage.local.remove('sidepanelHandlingUpload');
                if (automationOverlay) automationOverlay.classList.add('hidden');
            }
        })();
    }

    if (message.action === 'imageReady') {
        statusText.innerText = 'สร้างรูปเสร็จ! ไปขั้นตอนวิดีโอ...';
        // ย้ายไป Step 2 อัตโนมัติ
        setTimeout(() => {
            const btn2 = document.getElementById('stepBtn2');
            if (btn2) btn2.click();
        }, 1000);
    }

    if (message.action === 'videoError') {
        progressFill.classList.remove('pulse');
        statusText.innerText = `Error: ${message.error}`;
        setRunning(false);
        chrome.storage.local.set({ jobStatus: { running: false, error: message.error } });
        chrome.storage.local.remove('sidepanelHandlingUpload');
        const automationOverlay = document.getElementById('automationOverlay');
        if (automationOverlay) automationOverlay.classList.add('hidden');
    }
});

// ── Prompt template builders ───────────────────────────────────────────────

function buildStep1Prompt() {
    const gender     = document.querySelector('input[name="gender1"]:checked')?.value === 'female' ? 'female' : 'male';
    const genderWord = gender === 'female' ? 'female' : 'male';
    const action     = document.getElementById('action1')?.value || 'holding';
    const location   = document.getElementById('location1')?.value || '';
    const outfit     = document.getElementById('outfit1')?.value || '';
    const mood       = document.getElementById('mood1')?.value || '';
    const product    = document.getElementById('productName')?.value || 'product';

    return `Create a realistic candid smartphone photo of a ${genderWord} Thai person,
using the attached face reference for facial structure and features.

The person is ${action} the ${product} shown in the attached product image.

Setting: ${location}

Clothing: ${outfit}

Expression: ${mood}

Camera: shot on smartphone, auto white balance, slight noise in shadows,
not professionally lit. Slightly off-center framing, natural ambient light only.

Style: realistic, not retouched, visible skin texture, no studio lighting,
no perfect symmetry, JPEG compression artifacts, warm Thai daylight tone.
Photo looks like a genuine Shopee or TikTok customer review image.

--- STRICT RULES ---
- The product in the image MUST match the attached product photo exactly
  in shape, color, size, and detail. Do NOT alter, redesign, or add extra parts to the product.
- Background must contain ONLY objects that naturally belong in ${location}.
  Do NOT generate random or unrelated props.
- Do NOT add any object that is not explicitly described in this prompt.
- Keep the background simple and clean.
  Only allow: walls, floor, sky, trees, fences, doors
  — things that already exist in a real ${location}.
- Do NOT generate floating objects, extra tools, random furniture,
  or decorations that feel out of place.
- Hands and fingers must look natural with correct anatomy.
  5 fingers per hand, proper grip on product.
- No text, watermark, or logo unless specified.`;
}

function buildStep2Prompt(expandedScript = '') {
    const gender        = document.querySelector('input[name="gender2"]:checked')?.value === 'female' ? 'female' : 'male';
    const genderWord    = gender === 'female' ? 'female' : 'male';
    const action        = document.getElementById('action2')?.value || '';
    const specialAction = document.getElementById('specialActionInput')?.value.trim() || '';
    const product       = document.getElementById('productName')?.value || 'product';
    const platform      = document.getElementById('platform2')?.value || 'TikTok';
    const pacing        = document.getElementById('pacing2')?.value || '';
    const language      = document.getElementById('languageSelect')?.value || 'Thai';

    const actionLine  = specialAction ? `\nSpecial Action: ${specialAction}` : '';
    const scriptLine  = expandedScript ? `\nScript: ${expandedScript}` : '[AI จะสร้าง Script อัตโนมัติตอนรัน]';

    return `A ${genderWord} Thai person,
is ${action} the ${product}.
${actionLine}

Location: สุ่มตามประเภทตามสินค้า
${scriptLine}

Style: UGC smartphone footage, handheld slightly shaky,
natural ${language} daylight, no cinematic filter, no heavy color grading.
Looks like a real person filming themselves for ${platform}.

Pacing: ${pacing}

--- STRICT RULES ---
- NO text, words, letters, numbers, subtitles, captions, overlays, or watermarks of any kind visible in the video.
- Do NOT render any on-screen graphics, title cards, or burnt-in captions.
- The video must be completely clean — visuals only, zero text.`;
}

// prompt ให้ AI เจน script จาก brief input
function buildScriptExpandPrompt() {
    const product       = document.getElementById('productName')?.value || 'product';
    const action        = document.getElementById('action2')?.value || '';
    const specialAction = document.getElementById('specialActionInput')?.value.trim() || '';
    const brief         = document.getElementById('scriptInput')?.value.trim() || '';
    const language      = document.getElementById('languageSelect')?.value || 'Thai';

    const specialLine = specialAction ? `Special Action: ${specialAction}\n` : '';
    const briefLine   = brief ? `Script/Key Message idea: ${brief}\n` : '';

    return `You are writing a visual scene description for an 8-second product video in ${language} context.

Product: ${product}
Main Action: ${action}
${specialLine}${briefLine}
Write a concise 2-4 sentence visual scene description that:
- Describes ONLY what is visually happening (no dialogue, no subtitles, no text)
- Fits naturally within 8 seconds
- Starts with the action, builds interest, ends with product close-up
- Feels authentic and natural for ${language} TikTok UGC style
- Each run should have slightly different visual details to avoid repetition
- Write the output in ${language} language

Output ONLY the scene description. No labels, no explanation.`;
}

function cleanCaption(text) {
    return text
        .replace(/^[*\s]*version\b[^\n]*/gim, '')
        .replace(/^\*{1,2}[^\n]+?\*{1,2}:?\s*$/gm, '')
        .replace(/^[A-Za-z0-9 \-–()\/]+:\s*$/gm, '')
        .replace(/^[-–—=\s]+$/gm, '')
        .replace(/\bvideo\b\s*$/im, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function buildStep3Prompt() {
    const platform   = document.getElementById('platform3')?.value || 'TikTok';
    const product    = document.getElementById('productName')?.value || 'product';
    const script     = document.getElementById('captionScript')?.value || '';
    const audience   = document.getElementById('audience3')?.value || '';
    const hookStyle  = document.getElementById('hookStyle3')?.value || '';
    const language   = document.getElementById('languageSelect')?.value || 'Thai';

    return `You are a social media copywriter who writes casual, relatable
product captions for ${platform}.

Product: ${product}
Script/Key Message: ${script}
Target Audience: ${audience}

--- OUTPUT ---
Write ONLY the caption text. No labels, no headers, no version names, no explanations.
Just the caption itself, ready to paste directly.

Requirements:
- 2-3 lines max
- Start with ${hookStyle}
- End with CTA
- Include 2-5 hashtags
- Write the output in ${language} language

--- RULES ---
- Write in casual, conversational tone (not formal)
- ห้ามใช้คำว่า "สุดยอด" "เหลือเชื่อ" "ดีที่สุด"
- ใช้คำแบบคนรีวิวจริง เช่น "ใช้มาเดือนนึงแล้ว" "ตอนแรกไม่แน่ใจ" "บอกเลยว่าคุ้ม"
- ห้ามมี label หรือ header ใดๆ ทั้งสิ้น`;
}

// ── DOMContentLoaded ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    // Element refs
    const productImageInput  = document.getElementById('productImageInput');
    const imagePreview       = document.getElementById('imagePreview');
    const uploadPlaceholder  = document.getElementById('uploadPlaceholder');
    const removeImageBtn     = document.getElementById('removeImageBtn');

    const faceImageInput      = document.getElementById('faceImageInput');
    const faceImagePreview    = document.getElementById('faceImagePreview');
    const faceUploadPlaceholder = document.getElementById('faceUploadPlaceholder');
    const removeFaceImageBtn  = document.getElementById('removeFaceImageBtn');

    const runAllBtn     = document.getElementById('runAllBtn');
    const cancelTaskBtn = document.getElementById('cancelTaskBtn');
    const statusBar     = document.getElementById('statusBar');
    const progressFill  = document.querySelector('.progress-fill');
    const statusText    = document.getElementById('statusText');
    const productNameInput = document.getElementById('productName');
    const flowUI  = document.getElementById('flowUI');
    const soraUI  = document.getElementById('soraUI');

    function setRunning(running) {
        if (runAllBtn) runAllBtn.disabled = running;
        if (cancelTaskBtn) cancelTaskBtn.classList.toggle('hidden', !running);
    }

    // ── Step navigation ──────────────────────────────────────────────────
    let currentStep = 1;

    function goToStep(step) {
        // Deactivate all
        document.querySelectorAll('.step-btn').forEach(btn => {
            btn.classList.remove('active');
            btn.classList.remove('done');
        });
        document.querySelectorAll('.step-panel').forEach(panel => {
            panel.classList.remove('active');
        });

        // Mark done steps
        for (let i = 1; i < step; i++) {
            const btn = document.getElementById(`stepBtn${i}`);
            if (btn) btn.classList.add('done');
        }

        // Activate current
        const activeBtn   = document.getElementById(`stepBtn${step}`);
        const activePanel = document.getElementById(`stepPanel${step}`);
        if (activeBtn)   activeBtn.classList.add('active');
        if (activePanel) activePanel.classList.add('active');

        currentStep = step;
    }

    document.querySelectorAll('.step-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const step = parseInt(btn.dataset.step, 10);
            goToStep(step);
        });
    });

    document.getElementById('goStep2Btn').addEventListener('click', () => {
        const g1 = document.querySelector('input[name="gender1"]:checked')?.value;
        if (g1) {
            const g2radio = document.querySelector(`input[name="gender2"][value="${g1}"]`);
            if (g2radio) g2radio.checked = true;
        }
        goToStep(2);
        updateStep2Prompt();
    });

    document.getElementById('backStep1Btn').addEventListener('click', () => goToStep(1));

    document.getElementById('backStep2Btn').addEventListener('click', () => goToStep(2));

    document.getElementById('goStep4Btn').addEventListener('click', () => goToStep(4));

    document.getElementById('backStep3Btn').addEventListener('click', () => goToStep(3));

    // ── Prompt auto-update ────────────────────────────────────────────────

    function updateStep1Prompt() {
        const el = document.getElementById('promptPreview1');
        if (el) el.value = buildStep1Prompt();
    }

    function updateStep2Prompt() {
        const el = document.getElementById('promptPreview2');
        if (el) el.value = buildStep2Prompt();
    }

    function updateStep3Prompt() {
        const el = document.getElementById('promptPreview3');
        if (el) el.value = buildStep3Prompt();
    }

    // Step 1 field listeners
    ['action1', 'location1', 'outfit1', 'mood1'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', () => { updateStep1Prompt(); saveFormData(); });
    });
    document.querySelectorAll('input[name="gender1"]').forEach(r => {
        r.addEventListener('change', () => { updateStep1Prompt(); saveFormData(); });
    });

    // Step 2 field listeners
    ['action2', 'specialActionInput', 'scriptInput', 'platform2', 'pacing2', 'ratioSelect', 'quantitySelect', 'veoModelSelect', 'languageSelect'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('change', () => { updateStep2Prompt(); saveFormData(); });
            el.addEventListener('input',  () => { updateStep2Prompt(); saveFormData(); });
        }
    });
    document.querySelectorAll('input[name="gender2"]').forEach(r => {
        r.addEventListener('change', () => { updateStep2Prompt(); saveFormData(); });
    });

    // Step 3 field listeners
    ['platform3', 'captionScript', 'audience3', 'hookStyle3'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('change', () => { updateStep3Prompt(); saveFormData(); });
            el.addEventListener('input',  () => { updateStep3Prompt(); saveFormData(); });
        }
    });

    // productName affects all steps
    productNameInput.addEventListener('input', () => {
        updateStep1Prompt();
        updateStep2Prompt();
        updateStep3Prompt();
        saveFormData();
    });

    // ── Step 2 → Step 3 data sync (via step btn click or goStep3Btn) ─────
    function syncStep2ToStep3() {
        const script = document.getElementById('scriptInput').value;
        const captionScriptEl = document.getElementById('captionScript');
        if (captionScriptEl && !captionScriptEl.value && script) {
            captionScriptEl.value = script;
        }
        const p2    = document.getElementById('platform2').value;
        const p3sel = document.getElementById('platform3');
        if (p3sel) {
            const opt = Array.from(p3sel.options).find(o => o.value === p2);
            if (opt) p3sel.value = p2;
        }
    }

    document.getElementById('stepBtn3').addEventListener('click', () => {
        syncStep2ToStep3();
        updateStep3Prompt();
    });

    document.getElementById('goStep3Btn').addEventListener('click', () => {
        syncStep2ToStep3();
        goToStep(3);
        updateStep3Prompt();
    });

    // ── Copy Prompt buttons ───────────────────────────────────────────────
    document.getElementById('copyPrompt1Btn').addEventListener('click', () => {
        const text = document.getElementById('promptPreview1').value;
        if (text) {
            navigator.clipboard.writeText(text).then(() => {
                const btn = document.getElementById('copyPrompt1Btn');
                const orig = btn.innerHTML;
                btn.innerHTML = '<span class="icon">✅</span> Copied!';
                setTimeout(() => { btn.innerHTML = orig; }, 1500);
            });
        }
    });

    // copyCaptionPromptBtn removed — caption generated automatically in runAll

    // ── Session persistence ───────────────────────────────────────────────
    function saveFormData() {
        const faceDataUrl = !faceImagePreview.classList.contains('hidden') && faceImagePreview.src
            ? faceImagePreview.src : null;
        const imageDataUrl = !imagePreview.classList.contains('hidden') && imagePreview.src
            ? imagePreview.src : null;

        chrome.storage.local.set({ formData: {
            productName:  productNameInput.value,
            ratio:        document.getElementById('ratioSelect').value,
            quantity:     document.getElementById('quantitySelect').value,
            veoModel:     document.getElementById('veoModelSelect').value,
            script:         document.getElementById('scriptInput').value,
            specialAction:  document.getElementById('specialActionInput').value,
            language:       document.getElementById('languageSelect').value,
            caption:      document.getElementById('captionInput').value,
            productId:    document.getElementById('productIdInput').value,
            captionScript: document.getElementById('captionScript').value,
            gender1:      document.querySelector('input[name="gender1"]:checked')?.value || 'male',
            action1:      document.getElementById('action1').value,
            location1:    document.getElementById('location1').value,
            outfit1:      document.getElementById('outfit1').value,
            mood1:        document.getElementById('mood1').value,
            gender2:      document.querySelector('input[name="gender2"]:checked')?.value || 'male',
            action2:      document.getElementById('action2').value,
            platform2:    document.getElementById('platform2').value,
            pacing2:      document.getElementById('pacing2').value,
            platform3:    document.getElementById('platform3').value,
            audience3:    document.getElementById('audience3').value,
            hookStyle3:   document.getElementById('hookStyle3').value,
            currentStep,
            faceDataUrl,
            imageDataUrl
        }});
    }

    function restoreFormData(d) {
        if (d.productName) productNameInput.value = d.productName;
        if (d.ratio)    document.getElementById('ratioSelect').value    = d.ratio;
        if (d.quantity) document.getElementById('quantitySelect').value = d.quantity;
        if (d.veoModel) document.getElementById('veoModelSelect').value = d.veoModel;
        if (d.script)         document.getElementById('scriptInput').value         = d.script;
        if (d.specialAction)  document.getElementById('specialActionInput').value  = d.specialAction;
        if (d.language)       document.getElementById('languageSelect').value       = d.language;
        if (d.caption)  document.getElementById('captionInput').value   = d.caption;
        if (d.productId) document.getElementById('productIdInput').value = d.productId;
        if (d.captionScript) document.getElementById('captionScript').value = d.captionScript;

        if (d.gender1) {
            const r = document.querySelector(`input[name="gender1"][value="${d.gender1}"]`);
            if (r) r.checked = true;
        }
        if (d.action1)   document.getElementById('action1').value   = d.action1;
        if (d.location1) document.getElementById('location1').value = d.location1;
        if (d.outfit1)   document.getElementById('outfit1').value   = d.outfit1;
        if (d.mood1)     document.getElementById('mood1').value     = d.mood1;

        if (d.gender2) {
            const r = document.querySelector(`input[name="gender2"][value="${d.gender2}"]`);
            if (r) r.checked = true;
        }
        if (d.action2)   document.getElementById('action2').value   = d.action2;
        if (d.platform2) document.getElementById('platform2').value = d.platform2;
        if (d.pacing2)   document.getElementById('pacing2').value   = d.pacing2;
        if (d.platform3) document.getElementById('platform3').value = d.platform3;
        if (d.audience3) document.getElementById('audience3').value = d.audience3;
        if (d.hookStyle3) document.getElementById('hookStyle3').value = d.hookStyle3;

        if (d.faceDataUrl) {
            faceImagePreview.src = d.faceDataUrl;
            faceImagePreview.classList.remove('hidden');
            faceUploadPlaceholder.classList.add('hidden');
            removeFaceImageBtn.classList.remove('hidden');
        }
        if (d.imageDataUrl) {
            imagePreview.src = d.imageDataUrl;
            imagePreview.classList.remove('hidden');
            uploadPlaceholder.classList.add('hidden');
            removeImageBtn.classList.remove('hidden');
        }

        if (d.currentStep && d.currentStep >= 1 && d.currentStep <= 4) {
            goToStep(d.currentStep);
        }

        updateStep1Prompt();
        updateStep2Prompt();
        updateStep3Prompt();
    }

    // ── Shared cancel logic ───────────────────────────────────────────────
    async function cancelAutomation() {
        _cancelRequested = true;
        try {
            const flowTabs = await chrome.tabs.query({ url: 'https://labs.google/*' });
            if (flowTabs.length > 0) chrome.tabs.sendMessage(flowTabs[0].id, { action: 'cancelJob' });
        } catch (e) { /* ignore */ }
        const automationOverlay = document.getElementById('automationOverlay');
        if (automationOverlay) automationOverlay.classList.add('hidden');
        statusBar.classList.add('hidden');
        progressFill.classList.remove('pulse');
        progressFill.style.width = '0%';
        statusText.innerText = 'ยกเลิกแล้ว';
        setRunning(false);
        chrome.storage.local.remove('jobStatus');
        chrome.storage.local.remove('sidepanelHandlingUpload');
        console.log('Automation cancelled by user');
        // reset flag หลัง 1 วิ เผื่อ finally block ที่ยังค้างอยู่ได้เห็น
        setTimeout(() => { _cancelRequested = false; }, 1000);
    }

    document.getElementById('statusCancelBtn').addEventListener('click', cancelAutomation);
    document.getElementById('overlayCancelBtn').addEventListener('click', cancelAutomation);
    document.getElementById('overlayCancelBig').addEventListener('click', cancelAutomation);
    if (cancelTaskBtn) cancelTaskBtn.addEventListener('click', cancelAutomation);

    // ── Restore state on popup open ───────────────────────────────────────
    chrome.storage.local.get(['jobStatus', 'formData'], (result) => {
        if (result.formData) restoreFormData(result.formData);
        else {
            updateStep1Prompt();
            updateStep2Prompt();
            updateStep3Prompt();
        }

        const js = result.jobStatus;
        if (js?.running) {
            statusBar.classList.remove('hidden');
            progressFill.classList.add('pulse');
            statusText.innerText = js.text || 'กำลังทำงาน...';
            setRunning(true);
            const automationOverlay = document.getElementById('automationOverlay');
            const overlayStepText   = document.getElementById('overlayStepText');
            if (automationOverlay) {
                if (overlayStepText) overlayStepText.innerText = js.text || 'กำลังทำงาน...';
                automationOverlay.classList.remove('hidden');
            }
        } else if (js?.done) {
            statusText.innerText = 'เสร็จสิ้น!';
            statusBar.classList.remove('hidden');
            setTimeout(() => {
                statusBar.classList.add('hidden');
                chrome.storage.local.remove('jobStatus');
            }, 3000);
        } else if (js?.error) {
            statusText.innerText = `${js.error}`;
            statusBar.classList.remove('hidden');
        }
    });

    // ── Product Image Upload ──────────────────────────────────────────────
    productImageInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (ev) => {
                imagePreview.src = ev.target.result;
                imagePreview.classList.remove('hidden');
                uploadPlaceholder.classList.add('hidden');
                removeImageBtn.classList.remove('hidden');
                saveFormData();
            };
            reader.readAsDataURL(file);
        }
    });

    removeImageBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        productImageInput.value = '';
        imagePreview.src = '';
        imagePreview.classList.add('hidden');
        uploadPlaceholder.classList.remove('hidden');
        removeImageBtn.classList.add('hidden');
        saveFormData();
    });

    // ── Face Image Upload ─────────────────────────────────────────────────
    faceImageInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (ev) => {
                faceImagePreview.src = ev.target.result;
                faceImagePreview.classList.remove('hidden');
                faceUploadPlaceholder.classList.add('hidden');
                removeFaceImageBtn.classList.remove('hidden');
                saveFormData();
            };
            reader.readAsDataURL(file);
        }
    });

    removeFaceImageBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        faceImageInput.value = '';
        faceImagePreview.src = '';
        faceImagePreview.classList.add('hidden');
        faceUploadPlaceholder.classList.remove('hidden');
        removeFaceImageBtn.classList.add('hidden');
        saveFormData();
    });

    // ── Platform Menu ─────────────────────────────────────────────────────
    const menuBtn      = document.getElementById('menuBtn');
    const platformMenu = document.getElementById('platformMenu');

    menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        platformMenu.classList.toggle('hidden');
    });

    document.querySelectorAll('.dropdown-item').forEach(item => {
        item.addEventListener('click', () => {
            const url  = item.dataset.url;
            const text = item.innerText;

            if (url) {
                chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                    if (tabs[0]) {
                        chrome.tabs.update(tabs[0].id, { url });
                        platformMenu.classList.add('hidden');
                    }
                });
            }

            if (text === 'SORA') {
                flowUI.classList.add('hidden');
                soraUI.classList.remove('hidden');
            } else {
                soraUI.classList.add('hidden');
                flowUI.classList.remove('hidden');
            }
        });
    });

    document.addEventListener('click', (e) => {
        if (!platformMenu.contains(e.target) && !menuBtn.contains(e.target)) {
            platformMenu.classList.add('hidden');
        }
    });

    // ── Settings ──────────────────────────────────────────────────────────
    const settingsBtn       = document.getElementById('settingsBtn');
    const settingsModal     = document.getElementById('settingsModal');
    const closeSettingsBtn  = document.getElementById('closeSettingsBtn');
    const saveSettingsBtn   = document.getElementById('saveSettingsBtn');
    const googleApiKeyInput = document.getElementById('googleApiKey');
    const chatgptApiKeyInput = document.getElementById('chatgptApiKey');

    // ── Logo upload wiring ────────────────────────────────────────────────
    const logoUploadArea    = document.getElementById('logoUploadArea');
    const logoFileInput     = document.getElementById('logoFileInput');
    const logoPreview       = document.getElementById('logoPreview');
    const logoUploadText    = document.getElementById('logoUploadText');
    const logoEnabledCb     = document.getElementById('logoEnabled');
    const logoEnabledLabel  = document.getElementById('logoEnabledLabel');
    const logoSizeInput     = document.getElementById('logoSize');
    const logoPaddingInput  = document.getElementById('logoPadding');
    const logoPreviewWrap   = document.getElementById('logoPreviewWrap');
    const logoPreviewCanvas = document.getElementById('logoPreviewCanvas');

    // Canvas constants
    const LC_W = 270, LC_H = 480;   // canvas resolution
    const HANDLE = 10;               // resize handle size px

    // Logo canvas state (canvas pixel space)
    let _lcImg = null;
    let _lcX = null, _lcY = null, _lcW = null;   // null = use default position
    let _lcDrag = null;  // { type:'move'|'resize', startMx, startMy, startX, startY, startW }

    function _lcDefaultPos(img) {
        const sizePct  = parseInt(logoSizeInput.value) || 15;
        const padPx    = parseInt(logoPaddingInput.value) || 20;
        const scale    = LC_W / 720;
        const w        = Math.round(720 * sizePct / 100 * scale);
        const h        = Math.round(w * (img.naturalHeight / img.naturalWidth));
        const pad      = Math.round(padPx * scale);
        return { x: LC_W - w - pad, y: LC_H - h - pad, w };
    }

    function _lcGetRect() {
        if (!_lcImg) return null;
        const w = _lcW !== null ? _lcW : _lcDefaultPos(_lcImg).w;
        const h = Math.round(w * (_lcImg.naturalHeight / _lcImg.naturalWidth));
        const x = _lcX !== null ? _lcX : _lcDefaultPos(_lcImg).x;
        const y = _lcY !== null ? _lcY : _lcDefaultPos(_lcImg).y;
        return { x, y, w, h };
    }

    function _lcDraw() {
        if (!_lcImg) return;
        logoPreviewCanvas.width  = LC_W;
        logoPreviewCanvas.height = LC_H;
        const ctx = logoPreviewCanvas.getContext('2d');

        // พื้นหลัง + grid
        ctx.fillStyle = '#111';
        ctx.fillRect(0, 0, LC_W, LC_H);
        ctx.strokeStyle = '#1e1e1e';
        ctx.lineWidth = 0.5;
        for (let x = 0; x <= LC_W; x += 27) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,LC_H); ctx.stroke(); }
        for (let y = 0; y <= LC_H; y += 27) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(LC_W,y); ctx.stroke(); }
        ctx.fillStyle = '#2a2a2a';
        ctx.font = '10px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('VIDEO  9:16', LC_W/2, LC_H/2);

        // วาด logo
        const r = _lcGetRect();
        ctx.drawImage(_lcImg, r.x, r.y, r.w, r.h);

        // outline + resize handle
        ctx.strokeStyle = 'oklch(0.85 0.20 142 / 0.7)';
        ctx.lineWidth = 1;
        ctx.strokeRect(r.x, r.y, r.w, r.h);
        ctx.fillStyle = 'oklch(0.85 0.20 142)';
        ctx.fillRect(r.x + r.w - HANDLE, r.y + r.h - HANDLE, HANDLE, HANDLE);

        logoPreviewWrap.classList.remove('hidden');
        logoPreviewWrap.style.display = 'flex';
    }

    function _lcCanvasCoords(e) {
        const rect = logoPreviewCanvas.getBoundingClientRect();
        const scaleX = LC_W / rect.width;
        const scaleY = LC_H / rect.height;
        return { mx: (e.clientX - rect.left) * scaleX, my: (e.clientY - rect.top) * scaleY };
    }

    logoPreviewCanvas.addEventListener('mousedown', (e) => {
        if (!_lcImg) return;
        const { mx, my } = _lcCanvasCoords(e);
        const r = _lcGetRect();
        // ensure state is populated
        if (_lcX === null) { _lcX = r.x; _lcY = r.y; _lcW = r.w; }
        const onHandle = mx >= r.x + r.w - HANDLE && mx <= r.x + r.w &&
                         my >= r.y + r.h - HANDLE && my <= r.y + r.h;
        const onLogo   = mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h;
        if (onHandle) {
            _lcDrag = { type:'resize', startMx:mx, startMy:my, startW:_lcW, startX:_lcX, startY:_lcY };
        } else if (onLogo) {
            _lcDrag = { type:'move', startMx:mx, startMy:my, startX:_lcX, startY:_lcY };
        }
        e.preventDefault();
    });

    logoPreviewCanvas.addEventListener('mousemove', (e) => {
        if (!_lcImg) return;
        const { mx, my } = _lcCanvasCoords(e);
        // cursor style
        const r = _lcGetRect();
        const onHandle = r && mx >= r.x + r.w - HANDLE && mx <= r.x + r.w &&
                                my >= r.y + r.h - HANDLE && my <= r.y + r.h;
        const onLogo   = r && mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h;
        logoPreviewCanvas.style.cursor = onHandle ? 'se-resize' : onLogo ? 'move' : 'default';

        if (!_lcDrag) return;
        const dx = mx - _lcDrag.startMx;
        const dy = my - _lcDrag.startMy;

        if (_lcDrag.type === 'move') {
            const newR = _lcGetRect();
            _lcX = Math.max(0, Math.min(LC_W - newR.w, _lcDrag.startX + dx));
            _lcY = Math.max(0, Math.min(LC_H - newR.h, _lcDrag.startY + dy));
        } else {
            // resize: maintain aspect ratio, drag corner
            const newW = Math.max(20, Math.min(LC_W - _lcX, _lcDrag.startW + dx));
            _lcW = newW;
            // sync size input (% of 720px video width)
            const newSizePct = Math.round((newW / LC_W) * 100);
            logoSizeInput.value = Math.max(5, Math.min(40, newSizePct));
        }
        _lcDraw();
        e.preventDefault();
    });

    document.addEventListener('mouseup', () => {
        if (_lcDrag && _lcX !== null) {
            // save position as fractions of canvas size
            const r = _lcGetRect();
            chrome.storage.local.set({ logoPosFrac: { xf: r.x / LC_W, yf: r.y / LC_H, wf: r.w / LC_W } });
        }
        _lcDrag = null;
    });

    function updateLogoPreviewCanvas() {
        if (!logoPreview.src || logoPreview.classList.contains('hidden')) return;
        if (_lcImg && _lcImg.src === logoPreview.src) {
            // same image — reset to default pos (size/padding changed via input)
            _lcX = null; _lcY = null; _lcW = null;
            _lcDraw();
            return;
        }
        const img = new Image();
        img.onload = () => {
            _lcImg = img;
            _lcX = null; _lcY = null; _lcW = null;
            _lcDraw();
        };
        img.src = logoPreview.src;
    }

    logoUploadArea.addEventListener('click', () => logoFileInput.click());
    logoFileInput.addEventListener('change', () => {
        const file = logoFileInput.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            logoPreview.src = e.target.result;
            logoPreview.classList.remove('hidden');
            logoUploadText.classList.add('hidden');
            _lcImg = null;   // force reload
            updateLogoPreviewCanvas();
        };
        reader.readAsDataURL(file);
    });
    logoSizeInput.addEventListener('input', () => { _lcX=null; _lcY=null; _lcW=null; updateLogoPreviewCanvas(); });
    logoPaddingInput.addEventListener('input', () => { _lcX=null; _lcY=null; _lcW=null; updateLogoPreviewCanvas(); });
    logoEnabledCb.addEventListener('change', () => {
        logoEnabledLabel.textContent = logoEnabledCb.checked ? 'On' : 'Off';
    });

    // ── Test Logo Overlay ────────────────────────────────────────────────────
    const testLogoFileInput  = document.getElementById('testLogoFileInput');
    const testLogoFileLabel  = document.getElementById('testLogoFileLabel');
    const testLogoBtn        = document.getElementById('testLogoBtn');
    const testLogoFileName   = document.getElementById('testLogoFileName');
    const testLogoStatus     = document.getElementById('testLogoStatus');
    let _testLogoVideoBlob   = null;

    testLogoFileInput.addEventListener('change', () => {
        const file = testLogoFileInput.files[0];
        if (!file) return;
        _testLogoVideoBlob = file;
        testLogoFileName.textContent = file.name + ' (' + Math.round(file.size / 1024 / 1024 * 10) / 10 + ' MB)';
        testLogoBtn.disabled = false;
        testLogoStatus.textContent = '';
    });

    testLogoBtn.addEventListener('click', async () => {
        if (!_testLogoVideoBlob) return;
        const logoSrc = logoPreview.src;
        if (!logoSrc || logoPreview.classList.contains('hidden')) {
            testLogoStatus.textContent = '⚠️ ยังไม่ได้อัปโหลด Logo';
            return;
        }
        testLogoBtn.disabled = true;
        testLogoStatus.textContent = '⏳ กำลังโหลด Logo...';
        try {
            const result = await spTestLogoOverlay(_testLogoVideoBlob, logoSrc, {
                sizePct:     parseInt(logoSizeInput.value)    || 15,
                padding:     parseInt(logoPaddingInput.value) || 20,
                logoPosFrac: (_lcX !== null) ? { xf: _lcX / LC_W, yf: _lcY / LC_H, wf: _lcW / LC_W } : null,
                onStatus:    (msg) => { testLogoStatus.textContent = msg; }
            });
            testLogoStatus.textContent = '✅ เสร็จแล้ว! กำลัง Download...';
            const url = URL.createObjectURL(result);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'logo_test_' + Date.now() + '.webm';
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 5000);
        } catch (err) {
            testLogoStatus.textContent = '❌ Error: ' + err.message;
        }
        testLogoBtn.disabled = false;
    });


    settingsBtn.addEventListener('click', () => {
        chrome.storage.local.get(['googleApiKey', 'chatgptApiKey', 'logoDataUrl', 'logoEnabled', 'logoSize', 'logoPadding', 'logoPosFrac'], (result) => {
            if (result.googleApiKey)  googleApiKeyInput.value  = result.googleApiKey;
            if (result.chatgptApiKey) chatgptApiKeyInput.value = result.chatgptApiKey;
            // logo
            if (result.logoDataUrl) {
                logoPreview.src = result.logoDataUrl;
                logoPreview.classList.remove('hidden');
                logoUploadText.classList.add('hidden');
            }
            const isOn = !!result.logoEnabled;
            logoEnabledCb.checked = isOn;
            logoEnabledLabel.textContent = isOn ? 'On' : 'Off';
            if (result.logoSize)    logoSizeInput.value    = result.logoSize;
            if (result.logoPadding) logoPaddingInput.value = result.logoPadding;
            // restore saved position fractions → canvas pixels
            if (result.logoPosFrac) {
                const f = result.logoPosFrac;
                _lcX = f.xf * LC_W;
                _lcY = f.yf * LC_H;
                _lcW = f.wf * LC_W;
            } else {
                _lcX = null; _lcY = null; _lcW = null;
            }
            // วาด preview ถ้ามี logo
            setTimeout(updateLogoPreviewCanvas, 50);
        });
        settingsModal.classList.remove('hidden');
    });

    closeSettingsBtn.addEventListener('click', () => {
        settingsModal.classList.add('hidden');
    });

    settingsModal.addEventListener('click', (e) => {
        if (e.target === settingsModal || e.target.classList.contains('modal-overlay')) {
            settingsModal.classList.add('hidden');
        }
    });

    saveSettingsBtn.addEventListener('click', () => {
        const toSave = {
            googleApiKey:  googleApiKeyInput.value.trim(),
            chatgptApiKey: chatgptApiKeyInput.value.trim(),
            logoEnabled:   logoEnabledCb.checked,
            logoSize:      parseInt(logoSizeInput.value) || 15,
            logoPadding:   parseInt(logoPaddingInput.value) || 20
        };
        if (_lcX !== null) {
            toSave.logoPosFrac = { xf: _lcX / LC_W, yf: _lcY / LC_H, wf: _lcW / LC_W };
        }
        // save logo dataUrl only if a new file was selected
        if (logoPreview.src && !logoPreview.classList.contains('hidden') && logoFileInput.files[0]) {
            toSave.logoDataUrl = logoPreview.src;
        }
        chrome.storage.local.set(toSave, () => {
            const orig = saveSettingsBtn.innerText;
            saveSettingsBtn.innerText = 'บันทึกแล้ว!';
            setTimeout(() => {
                saveSettingsBtn.innerText = orig;
                settingsModal.classList.add('hidden');
            }, 1000);
        });
    });

    // ── Test Image Button (Step 1) ────────────────────────────────────────
    document.getElementById('testImageBtn').addEventListener('click', async () => {
        const btn = document.getElementById('testImageBtn');
        btn.innerText = 'Testing...';
        btn.disabled = true;

        const prompt = document.getElementById('promptPreview1').value;
        if (!prompt) {
            alert('Prompt is empty');
            btn.innerText = '🧪 Test Image';
            btn.disabled = false;
            return;
        }

        // อ่าน face + product image data
        const faceData    = !faceImagePreview.classList.contains('hidden') && faceImagePreview.src
            ? faceImagePreview.src : null;
        const productData = !imagePreview.classList.contains('hidden') && imagePreview.src
            ? imagePreview.src : null;

        // ถ้ามีไฟล์ใหม่ใน input ให้อ่านใหม่
        const readFile = (file) => new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload  = (e) => resolve(e.target.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });

        let faceImageData    = faceData;
        let productImageData = productData;
        try {
            if (faceImageInput.files[0])    faceImageData    = await readFile(faceImageInput.files[0]);
            if (productImageInput.files[0]) productImageData = await readFile(productImageInput.files[0]);
        } catch (e) { console.warn('Image read error:', e); }

        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab) { alert('No active tab'); btn.innerText = '🧪 Test Image'; btn.disabled = false; return; }

            chrome.tabs.sendMessage(tab.id, {
                action: 'testImageGen',
                prompt,
                faceImageData,
                productImageData
            }, (response) => {
                if (chrome.runtime.lastError) alert('Error: ' + chrome.runtime.lastError.message);
                btn.innerText = '🧪 Test Image';
                btn.disabled = false;
            });
        } catch (err) {
            alert('Error: ' + err.message);
            btn.innerText = '🧪 Test Image';
            btn.disabled = false;
        }
    });

    // ── Test Video Button (Step 2) ────────────────────────────────────────
    document.getElementById('testVideoBtn').addEventListener('click', async () => {
        const btn = document.getElementById('testVideoBtn');
        btn.innerText = 'Testing...';
        btn.disabled = true;

        const prompt = document.getElementById('promptPreview2').value;
        if (!prompt) {
            alert('Prompt is empty');
            btn.innerText = '🧪 Test Video';
            btn.disabled = false;
            return;
        }

        // โหลด image จาก storage (จาก image gen ขั้นตอนก่อน)
        const stored = await new Promise(r => chrome.storage.local.get('lastGeneratedImageData', r));
        const imageData = stored.lastGeneratedImageData || null;
        if (!imageData) {
            alert('ไม่พบรูปภาพที่เจนไว้ — กรุณาเจนรูปก่อน (Step 1)');
            btn.innerText = '🧪 Test Video';
            btn.disabled = false;
            return;
        }

        const data = {
            script:   prompt,
            ratio:    document.getElementById('ratioSelect').value,
            quantity: document.getElementById('quantitySelect').value,
            veoModel: document.getElementById('veoModelSelect').value,
            imageData
        };

        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab) { alert('No active tab'); btn.innerText = '🧪 Test Video'; btn.disabled = false; return; }

            chrome.tabs.sendMessage(tab.id, { action: 'generateVideo', data }, () => {
                if (chrome.runtime.lastError) alert('Error: ' + chrome.runtime.lastError.message);
                btn.innerText = '🧪 Test Video';
                btn.disabled = false;
            });
        } catch (err) {
            alert('Error: ' + err.message);
            btn.innerText = '🧪 Test Video';
            btn.disabled = false;
        }
    });

    // ── Test TikTok Button ────────────────────────────────────────────────
    document.getElementById('testUploadBtn').addEventListener('click', async () => {
        const btn = document.getElementById('testUploadBtn');
        btn.innerText = '...';
        btn.disabled = true;

        try {
            const { lastVideoUrl } = await chrome.storage.local.get('lastVideoUrl');
            if (!lastVideoUrl) {
                alert('ไม่พบ Video URL');
                btn.innerText = '📤 Test TikTok';
                btn.disabled = false;
                return;
            }

            const caption   = cleanCaption(document.getElementById('captionInput').value);
            const productId = document.getElementById('productIdInput').value.trim();
            await prepareAndUploadToTikTok(lastVideoUrl, caption, productId, null);

        } catch (err) {
            alert('Error: ' + err.message);
        }

        btn.innerText = '📤 Test TikTok';
        btn.disabled = false;
    });

    // ── Test Download Button ──────────────────────────────────────────────
    document.getElementById('testDownloadBtn').addEventListener('click', async () => {
        const btn = document.getElementById('testDownloadBtn');
        btn.innerText = 'Downloading...';
        btn.disabled = true;

        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab || !tab.url?.includes('labs.google')) {
                alert('Please open labs.google first');
                btn.innerText = 'Test Download';
                btn.disabled = false;
                return;
            }
            chrome.tabs.sendMessage(tab.id, { action: 'testDownload' }, (res) => {
                if (chrome.runtime.lastError) alert('Error: ' + chrome.runtime.lastError.message);
            });

            setTimeout(() => { btn.innerText = 'Test Download'; btn.disabled = false; }, 5000);
        } catch (err) {
            alert('Error: ' + err.message);
            btn.innerText = 'Test Download';
            btn.disabled = false;
        }
    });


    // ── Test Logo Download Button ─────────────────────────────────────────
    // ดาวน์โหลดวิดีโอล่าสุดจาก lastVideoUrl + ใส่ Logo + save ไฟล์ (ไม่เปลือง credit)
    document.getElementById('testLogoDownloadBtn').addEventListener('click', async () => {
        const btn = document.getElementById('testLogoDownloadBtn');
        const statusEl = document.getElementById('testLogoDownloadStatus');
        const setStatus = (msg) => { statusEl.textContent = msg; console.log('[TestLogoDownload]', msg); };

        btn.disabled = true;
        setStatus('');

        try {
            const { lastVideoUrl, logoEnabled, logoDataUrl, logoSize, logoPadding, logoPosFrac } =
                await new Promise(r => chrome.storage.local.get(['lastVideoUrl', 'logoEnabled', 'logoDataUrl', 'logoSize', 'logoPadding', 'logoPosFrac'], r));

            if (!lastVideoUrl) { setStatus('❌ ยังไม่มีวิดีโอ — รัน Flow ก่อน'); btn.disabled = false; return; }

            // debug: แสดงสถานะ logo settings
            console.log('[TestLogoDownload] logoEnabled:', logoEnabled, '| hasDataUrl:', !!logoDataUrl);

            if (!logoEnabled) { setStatus('⚠️ Logo ยังไม่ได้เปิด — เปิดใน Settings ก่อน'); btn.disabled = false; return; }
            if (!logoDataUrl)  { setStatus('⚠️ ยังไม่ได้อัปโหลด Logo Image ใน Settings'); btn.disabled = false; return; }

            setStatus('⬇️ กำลังดาวน์โหลดวิดีโอ...');
            const fetchResult = await new Promise((res, rej) =>
                chrome.runtime.sendMessage({ action: 'fetchVideoAsBase64', url: lastVideoUrl }, (r) =>
                    r?.error ? rej(new Error(r.error)) : res(r)
                )
            );
            const fetchRes = await fetch(fetchResult.base64);
            const blob = await fetchRes.blob();
            setStatus(`✅ ดาวน์โหลดแล้ว ${Math.round(blob.size/1024/1024*10)/10} MB — กำลังใส่ Logo...`);

            const processed = await spTestLogoOverlay(blob, logoDataUrl, {
                sizePct:     logoSize    || 15,
                padding:     logoPadding || 20,
                logoPosFrac: logoPosFrac || null,
                onStatus:    setStatus
            });

            setStatus('🔄 กำลัง Convert เป็น MP4...');
            const mp4Blob = await convertWebmToMp4(processed, ({ ratio }) => {
                setStatus(`🔄 Converting MP4... ${Math.round((ratio || 0) * 100)}%`);
            });
            setStatus('✅ เสร็จ! กำลัง Download...');
            const url = URL.createObjectURL(mp4Blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'logo_preview_' + Date.now() + '.mp4';
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 5000);
            setStatus(`✅ Done ${Math.round(mp4Blob.size/1024/1024*10)/10} MB (mp4)`);
        } catch (err) {
            setStatus('❌ ' + err.message);
            console.error('[TestLogoDownload]', err);
        }
        btn.disabled = false;
    });

    // ── Shared AI call helper ─────────────────────────────────────────────
    async function callAI(prompt, selectedModel, chatgptKey, googleKey, maxTokens = 300) {
        if (selectedModel === 'chatgpt') {
            const response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${chatgptKey}` },
                body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: prompt }], max_tokens: maxTokens })
            });
            const data = await response.json();
            if (data.choices?.length > 0) return data.choices[0].message.content.trim();
            throw new Error("ChatGPT API Error: " + JSON.stringify(data));
        } else if (selectedModel === 'gemini') {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${googleKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
            });
            const data = await response.json();
            if (data.candidates?.length > 0 && data.candidates[0].content) return data.candidates[0].content.parts[0].text.trim();
            throw new Error("Gemini API Error: " + JSON.stringify(data));
        }
        throw new Error("Unknown AI model: " + selectedModel);
    }

    // ── Run All (Step 4) ──────────────────────────────────────────────────
    runAllBtn.addEventListener('click', async () => {
        if (_taskEditMode) {
            await saveTaskFromForm();
            return;
        }
        const selectedModel  = document.querySelector('input[name="flowModel"]:checked').value;
        const productName    = document.getElementById('productName').value || "Product";

        const keys = await new Promise(resolve => chrome.storage.local.get(['chatgptApiKey', 'googleApiKey'], resolve));
        const chatgptKey = keys.chatgptApiKey;
        const googleKey  = keys.googleApiKey;

        if (selectedModel === 'chatgpt' && !chatgptKey) {
            alert("Please enter ChatGPT API Key in Settings.");
            settingsBtn.click();
            return;
        }
        if (selectedModel === 'gemini' && !googleKey) {
            alert("Please enter Google API Key in Settings.");
            settingsBtn.click();
            return;
        }

        const automationOverlay = document.getElementById('automationOverlay');
        const overlayStepText   = document.getElementById('overlayStepText');
        if (automationOverlay) {
            if (overlayStepText) overlayStepText.innerText = 'กำลังสร้าง Caption...';
            automationOverlay.classList.remove('hidden');
        }
        statusBar.classList.remove('hidden');
        setRunning(true);
        progressFill.style.transition = 'none';
        progressFill.style.width = '0%';
        progressFill.classList.add('pulse');
        statusText.innerText = 'กำลังสร้าง Caption...';
        // ตั้ง flag ทันที ก่อน flow เริ่ม — ป้องกัน runTaskJob race condition
        chrome.storage.local.set({ jobStatus: { running: true, step: 0, text: 'กำลังสร้าง Caption...' }, sidepanelHandlingUpload: true });

        try {
            // ── Step A: Build image prompt ────────────────────────────────
            const imagePrompt = buildStep1Prompt();

            // ── Step B: Auto-generate Script with AI (every run) ──────────
            if (overlayStepText) overlayStepText.innerText = 'กำลังสร้าง Script...';
            statusText.innerText = 'กำลังสร้าง Script...';
            let expandedScript = '';
            try {
                expandedScript = (await callAI(buildScriptExpandPrompt(), selectedModel, chatgptKey, googleKey, 200)).trim();
                console.log('[Script] Generated:', expandedScript);
            } catch (e) {
                console.warn('[Script] AI failed, using brief:', e.message);
                expandedScript = document.getElementById('scriptInput')?.value.trim() || '';
            }
            const videoPrompt = buildStep2Prompt(expandedScript);

            // ── Step C: Generate Caption with AI ──────────────────────────
            const captionPromptText = buildStep3Prompt();
            const rawCaption = await callAI(captionPromptText, selectedModel, chatgptKey, googleKey, 400);
            console.log('[Caption] rawCaption:', JSON.stringify(rawCaption));
            // ตัด label/header ที่ AI ส่งมาเกิน เช่น "Version A:", "**Short:**", บรรทัดว่าง ฯลฯ
            const generatedCaption = cleanCaption(rawCaption);
            console.log('[Caption] generatedCaption:', JSON.stringify(generatedCaption));
            document.getElementById('captionInput').value = generatedCaption;
            saveFormData();

            // ── Step C: ตรวจ tab ──────────────────────────────────────────
            await switchToFlow();
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab) {
                alert("No active tab found.");
                setRunning(false);
                if (automationOverlay) automationOverlay.classList.add('hidden');
                statusBar.classList.add('hidden');
                return;
            }
            if (!tab.url || (!tab.url.includes("labs.google") && !tab.url.includes("google.com") && !tab.url.includes("aitestkitchen"))) {
                alert(`Incorrect website.\nDetected URL: ${tab.url}\n\nPlease open Google Labs (labs.google) first.`);
                statusText.innerText = "Incorrect website";
                setRunning(false);
                if (automationOverlay) automationOverlay.classList.add('hidden');
                return;
            }

            // ── Step D: อ่าน face + product image ────────────────────────
            const readFile = (file) => new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload  = (e) => resolve(e.target.result);
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });
            let faceImageData    = (!faceImagePreview.classList.contains('hidden') && faceImagePreview.src) ? faceImagePreview.src : null;
            let productImageData = (!imagePreview.classList.contains('hidden') && imagePreview.src) ? imagePreview.src : null;
            try {
                if (faceImageInput.files[0])    faceImageData    = await readFile(faceImageInput.files[0]);
                if (productImageInput.files[0]) productImageData = await readFile(productImageInput.files[0]);
            } catch (e) { console.warn('Image read error:', e); }

            // ── Step E: สร้างรูปก่อน ──────────────────────────────────────
            if (overlayStepText) overlayStepText.innerText = 'กำลังสร้างรูปภาพ...';
            statusText.innerText = 'กำลังสร้างรูปภาพ... รอสักครู่';
            chrome.storage.local.set({ jobStatus: { running: true, step: 1, text: 'กำลังสร้างรูปภาพ...' } });

            await new Promise((resolve, reject) => {
                chrome.tabs.sendMessage(tab.id, {
                    action: 'testImageGen',
                    prompt: imagePrompt,
                    faceImageData,
                    productImageData
                }, (response) => {
                    if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                    else resolve(response);
                });
            });

            // ── Step F: รอ imageReady → โหลดรูปจาก storage ───────────────
            if (overlayStepText) overlayStepText.innerText = 'รอรูปภาพสร้างเสร็จ...';
            const generatedImageData = await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('Image generation timed out (5 min)')), 5 * 60 * 1000);
                const listener = (message) => {
                    if (message.action === 'imageReady') {
                        clearTimeout(timeout);
                        chrome.runtime.onMessage.removeListener(listener);
                        chrome.storage.local.get('lastGeneratedImageData', (stored) => {
                            resolve(stored.lastGeneratedImageData || null);
                        });
                    }
                    if (message.action === 'videoError') {
                        clearTimeout(timeout);
                        chrome.runtime.onMessage.removeListener(listener);
                        reject(new Error(message.error || 'Image generation failed'));
                    }
                };
                chrome.runtime.onMessage.addListener(listener);
            });

            // ── Step G: สร้างวิดีโอ ───────────────────────────────────────
            if (overlayStepText) overlayStepText.innerText = 'กำลังเริ่มสร้างวิดีโอ...';
            statusText.innerText = 'กำลังสร้างวิดีโอ... รอสักครู่';
            chrome.storage.local.set({ jobStatus: { running: true, step: 2, text: 'กำลังสร้างวิดีโอ...' } });

            const videoData = {
                productName,
                ratio:    document.getElementById('ratioSelect').value,
                quantity: document.getElementById('quantitySelect').value,
                veoModel: document.getElementById('veoModelSelect').value,
                camera:   'static',
                script:   videoPrompt,
                imageData: generatedImageData
            };

            chrome.tabs.sendMessage(tab.id, { action: "generateVideo", data: videoData }, (response) => {
                if (chrome.runtime.lastError) {
                    console.error("Error sending message:", chrome.runtime.lastError);
                    statusText.innerText = "Error: Please refresh the Google Labs page";
                    alert("Connection failed. Please refresh the Google Labs page and try again.");
                    setRunning(false);
                    statusBar.classList.add('hidden');
                    if (automationOverlay) automationOverlay.classList.add('hidden');
                    chrome.storage.local.remove('sidepanelHandlingUpload');
                } else {
                    console.log("Run All — video gen started:", response);
                }
            });

        } catch (error) {
            console.error("Run All error:", error);
            alert("Error: " + error.message);
            setRunning(false);
            if (automationOverlay) automationOverlay.classList.add('hidden');
            statusBar.classList.add('hidden');
            chrome.storage.local.remove('jobStatus');
            chrome.storage.local.remove('sidepanelHandlingUpload');
        }
    });


    // ── SORA Image Upload ─────────────────────────────────────────────────
    const soraImageUploadArea  = document.getElementById('soraImageUploadArea');
    const soraImageInput       = document.getElementById('soraImageInput');
    const soraImagePreview     = document.getElementById('soraImagePreview');
    const soraUploadPlaceholder = document.getElementById('soraUploadPlaceholder');
    const soraRemoveImageBtn   = document.getElementById('soraRemoveImageBtn');

    soraImageUploadArea.addEventListener('click', (e) => {
        if (e.target !== soraRemoveImageBtn && !soraRemoveImageBtn.contains(e.target)) {
            soraImageInput.click();
        }
    });

    soraImageInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (ev) => {
                soraImagePreview.src = ev.target.result;
                soraImagePreview.classList.remove('hidden');
                soraUploadPlaceholder.classList.add('hidden');
                soraRemoveImageBtn.classList.remove('hidden');
            };
            reader.readAsDataURL(file);
        }
    });

    soraRemoveImageBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        soraImageInput.value = '';
        soraImagePreview.src = '';
        soraImagePreview.classList.add('hidden');
        soraUploadPlaceholder.classList.remove('hidden');
        soraRemoveImageBtn.classList.add('hidden');
    });

    // ── SORA Logic ────────────────────────────────────────────────────────
    const soraGeneratePromptBtn = document.getElementById('soraGeneratePromptBtn');
    const soraGenerateBtn       = document.getElementById('soraGenerateBtn');

    soraGeneratePromptBtn.addEventListener('click', async () => {
        const character     = document.getElementById('soraCharacter').value.trim();
        const decide        = document.getElementById('soraDecide').value.trim();
        const style         = document.getElementById('soraStyle').value;
        const ratio         = document.getElementById('soraRatio').value;
        const selectedModel = document.querySelector('input[name="soraModel"]:checked').value;
        const language      = document.getElementById('soraLanguageSelect').value;

        soraGeneratePromptBtn.innerText = 'Generating...';
        soraGeneratePromptBtn.disabled  = true;

        const systemPrompt = "You are an expert video prompt engineer.";
        let userPrompt = `Generate a single, continuous paragraph describing a video based on these details:
Style: ${style}
Ratio: ${ratio}
Decide/Description: ${decide}
Spoken Language: ${language}
`;
        if (character) userPrompt += `Character: ${character}\n`;
        userPrompt += "\nOutput ONLY the prompt description. Do not use 'Scene 1', 'Cut to', or bullet points. Keep it simple and direct.";

        chrome.storage.local.get(['chatgptApiKey', 'googleApiKey'], async (result) => {
            const chatgptKey = result.chatgptApiKey;
            const googleKey  = result.googleApiKey;

            if (selectedModel === 'chatgpt' && !chatgptKey) {
                alert("Please set your ChatGPT API Key in settings.");
                soraGeneratePromptBtn.innerText = 'Generate Prompt';
                soraGeneratePromptBtn.disabled  = false;
                return;
            }
            if (selectedModel === 'gemini' && !googleKey) {
                alert("Please set your Google API Key in settings.");
                soraGeneratePromptBtn.innerText = 'Generate Prompt';
                soraGeneratePromptBtn.disabled  = false;
                return;
            }

            try {
                let generatedText = "";

                if (selectedModel === 'chatgpt') {
                    const response = await fetch('https://api.openai.com/v1/chat/completions', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${chatgptKey}` },
                        body: JSON.stringify({
                            model: "gpt-4o-mini",
                            messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
                            max_tokens: 300
                        })
                    });
                    const data = await response.json();
                    if (data.choices?.length > 0) generatedText = data.choices[0].message.content.trim();
                    else throw new Error("ChatGPT Error: " + JSON.stringify(data));

                } else if (selectedModel === 'gemini') {
                    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${googleKey}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ contents: [{ parts: [{ text: systemPrompt + "\n\n" + userPrompt }] }] })
                    });
                    const data = await response.json();
                    if (data.candidates?.length > 0 && data.candidates[0].content) generatedText = data.candidates[0].content.parts[0].text.trim();
                    else throw new Error("Gemini Error: " + JSON.stringify(data));
                }

                if (generatedText) document.getElementById('soraPromptInput').value = generatedText;

            } catch (error) {
                console.error(error);
                alert("Error generating prompt: " + error.message);
            }

            soraGeneratePromptBtn.innerText = 'Generate Prompt';
            soraGeneratePromptBtn.disabled  = false;
        });
    });

    soraGenerateBtn.addEventListener('click', () => {
        const prompt = document.getElementById('soraPromptInput').value;
        if (prompt) {
            navigator.clipboard.writeText(prompt).then(() => {
                alert("Prompt copied to clipboard!");
            });
        }
    });

    // Initial prompt render
    updateStep1Prompt();
    updateStep2Prompt();
    updateStep3Prompt();

    // ── Task Management ────────────────────────────────────────────────────

    function showTaskList() {
        _taskEditMode = false;
        _editingTaskId = null;
        _editingSchedules = [];
        document.getElementById('taskListView').classList.remove('hidden');
        document.getElementById('flowUI').classList.add('hidden');
        document.getElementById('taskFormHeader').classList.add('hidden');
        document.getElementById('scheduleSection').classList.add('hidden');
        runAllBtn.textContent = '🚀 เริ่มทำงาน';
        renderTaskList();
    }

    function showTaskForm(task = null) {
        _taskEditMode = true;
        document.getElementById('taskListView').classList.add('hidden');
        document.getElementById('flowUI').classList.remove('hidden');
        document.getElementById('taskFormHeader').classList.remove('hidden');
        document.getElementById('scheduleSection').classList.remove('hidden');
        runAllBtn.textContent = '💾 บันทึก Task';

        if (task) {
            _editingTaskId = task.id;
            _editingSchedules = JSON.parse(JSON.stringify(task.schedules || []));
            document.getElementById('taskNameInput').value = task.name || '';
            if (task.formData) restoreFormData(task.formData);
        } else {
            _editingTaskId = null;
            _editingSchedules = [];
            document.getElementById('taskNameInput').value = '';
        }

        renderScheduleSlots();
        goToStep(1);
    }

    async function renderTaskList() {
        const tasks = await tmGetTasks();
        const container = document.getElementById('taskListContainer');
        const empty     = document.getElementById('taskListEmpty');

        if (tasks.length === 0) {
            container.innerHTML = '';
            empty.classList.remove('hidden');
            return;
        }
        empty.classList.add('hidden');

        const logs = await tmGetLogs();

        container.innerHTML = tasks.map(task => {
            const taskLogs   = logs.filter(l => l.taskId === task.id);
            const lastLog    = taskLogs[taskLogs.length - 1];
            const schedTimes = (task.schedules || []).filter(s => s.isEnabled).map(s => s.time).join(', ') || '-';
            const badge = `<label class="task-toggle" title="${task.isActive ? 'คลิกเพื่อหยุด' : 'คลิกเพื่อเปิด'}">
                <input type="checkbox" class="task-toggle-input" data-id="${task.id}" ${task.isActive ? 'checked' : ''}>
                <span class="task-toggle-track"><span class="task-toggle-thumb"></span></span>
                <span class="task-toggle-label">${task.isActive ? 'Active' : 'Paused'}</span>
            </label>`;
            const lastRun = lastLog
                ? `${lastLog.status === 'success' ? '✅' : lastLog.status === 'running' ? '🔄' : '❌'} ${new Date(lastLog.triggeredAt).toLocaleString('th-TH', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}`
                : 'ยังไม่เคยรัน';

            return `<div class="task-card" data-id="${task.id}">
                <div class="task-card-row">
                    <span class="task-card-name">${task.name || 'ไม่มีชื่อ'}</span>
                    ${badge}
                </div>
                <div class="task-card-meta">🛒 ${task.formData?.productName || '-'}</div>
                <div class="task-card-meta">⏰ ${schedTimes}</div>
                <div class="task-card-meta" style="font-size:11px">${lastRun}</div>
                <div class="task-card-actions">
                    <button class="btn btn-ghost task-edit-btn" data-id="${task.id}" style="flex:1;font-size:11px;padding:6px">✏️ แก้ไข</button>
                    <button class="btn btn-ghost task-run-btn" data-id="${task.id}" style="flex:1;font-size:11px;padding:6px;color:var(--primary);border-color:oklch(0.65 0.18 142 / 0.4)">▶ Run</button>
                    <button class="btn btn-ghost task-delete-btn" data-id="${task.id}" style="flex:0 0 36px;font-size:11px;padding:6px;color:#EF4444;border-color:#EF444433">🗑</button>
                </div>
            </div>`;
        }).join('');

        container.querySelectorAll('.task-edit-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const all = await tmGetTasks();
                const t = all.find(t => t.id === btn.dataset.id);
                if (t) showTaskForm(t);
            });
        });
        container.querySelectorAll('.task-toggle-input').forEach(cb => {
            cb.addEventListener('change', async () => {
                await tmToggleTaskActive(cb.dataset.id);
                renderTaskList();
            });
        });
        container.querySelectorAll('.task-run-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (btn.disabled) return;
                btn.disabled = true;
                btn.innerText = '⏳';
                chrome.runtime.sendMessage({ action: 'runTaskNow', taskId: btn.dataset.id }, (res) => {
                    btn.disabled = false;
                    if (res?.error) {
                        btn.innerText = '❌';
                        btn.title = res.error;
                        setTimeout(() => { btn.innerText = '▶ Run'; btn.title = ''; }, 4000);
                    } else {
                        btn.innerText = '✅';
                        setTimeout(() => { btn.innerText = '▶ Run'; renderTaskList(); }, 2000);
                    }
                });
            });
        });
        container.querySelectorAll('.task-delete-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (confirm('ลบ Task นี้?')) {
                    await tmDeleteTask(btn.dataset.id);
                    renderTaskList();
                }
            });
        });
    }

    function renderScheduleSlots() {
        const list = document.getElementById('scheduleSlotList');
        if (!list) return;

        if (_editingSchedules.length === 0) {
            list.innerHTML = '<div style="color:var(--text-muted);font-size:12px;padding:4px 0">ยังไม่มีการตั้งเวลา</div>';
            return;
        }

        list.innerHTML = _editingSchedules.map((s, i) => `
            <div class="schedule-slot">
                <span class="schedule-slot-time">${s.time}</span>
                <input type="checkbox" class="sched-cb" data-idx="${i}" ${s.isEnabled ? 'checked' : ''} style="accent-color:var(--primary);cursor:pointer;width:16px;height:16px">
                <span class="sched-cb-label">${s.isEnabled ? 'เปิด' : 'ปิด'}</span>
                <button class="btn btn-ghost sched-del-btn" data-idx="${i}" style="width:auto;padding:4px 8px;font-size:12px;color:#EF4444;border-color:#EF444433;margin-left:auto">✕</button>
            </div>
        `).join('');

        list.querySelectorAll('.sched-cb').forEach(cb => {
            cb.addEventListener('change', () => {
                _editingSchedules[+cb.dataset.idx].isEnabled = cb.checked;
                renderScheduleSlots();
            });
        });
        list.querySelectorAll('.sched-del-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                _editingSchedules.splice(+btn.dataset.idx, 1);
                renderScheduleSlots();
            });
        });
    }

    async function saveTaskFromForm() {
        const name = document.getElementById('taskNameInput')?.value?.trim();
        if (!name) {
            alert('กรุณาใส่ชื่อ Task');
            document.getElementById('taskNameInput')?.focus();
            return;
        }

        const facePreview = document.getElementById('faceImagePreview');
        const imgPreview  = document.getElementById('imagePreview');
        const fd = {
            productName:   document.getElementById('productName')?.value || '',
            ratio:         document.getElementById('ratioSelect')?.value || '9:16',
            quantity:      document.getElementById('quantitySelect')?.value || '1',
            veoModel:      document.getElementById('veoModelSelect')?.value || '',
            script:        document.getElementById('scriptInput')?.value || '',
            caption:       document.getElementById('captionInput')?.value || '',
            productId:     document.getElementById('productIdInput')?.value || '',
            captionScript: document.getElementById('captionScript')?.value || '',
            gender1:       document.querySelector('input[name="gender1"]:checked')?.value || 'male',
            action1:       document.getElementById('action1')?.value || '',
            location1:     document.getElementById('location1')?.value || '',
            outfit1:       document.getElementById('outfit1')?.value || '',
            mood1:         document.getElementById('mood1')?.value || '',
            gender2:       document.querySelector('input[name="gender2"]:checked')?.value || 'male',
            action2:       document.getElementById('action2')?.value || '',
            platform2:     document.getElementById('platform2')?.value || 'TikTok',
            pacing2:       document.getElementById('pacing2')?.value || '',
            platform3:     document.getElementById('platform3')?.value || 'TikTok',
            audience3:     document.getElementById('audience3')?.value || '',
            hookStyle3:    document.getElementById('hookStyle3')?.value || '',
            flowModel:     document.querySelector('input[name="flowModel"]:checked')?.value || 'gemini',
            faceDataUrl:   (facePreview && !facePreview.classList.contains('hidden') && facePreview.src) ? facePreview.src : null,
            imageDataUrl:  (imgPreview && !imgPreview.classList.contains('hidden') && imgPreview.src) ? imgPreview.src : null,
        };

        const now = Date.now();
        const existing = _editingTaskId ? (await tmGetTasks()).find(t => t.id === _editingTaskId) : null;
        const task = {
            id:        _editingTaskId || `task_${now}`,
            name,
            isActive:  existing ? existing.isActive : true,
            createdAt: existing ? existing.createdAt : now,
            updatedAt: now,
            formData:  fd,
            schedules: _editingSchedules
        };

        await tmSaveTask(task);
        showTaskList();
    }

    // ── Wire up task buttons ───────────────────────────────────────────────
    document.getElementById('addTaskBtn').addEventListener('click', () => showTaskForm());
    document.getElementById('backToTaskListBtn').addEventListener('click', showTaskList);
    document.getElementById('addScheduleSlotBtn').addEventListener('click', () => {
        const time = document.getElementById('newScheduleTime').value;
        if (!time) return;
        if (_editingSchedules.some(s => s.time === time)) { alert('มีเวลานี้อยู่แล้ว'); return; }
        _editingSchedules.push({ id: `sched_${Date.now()}`, time, isEnabled: true });
        renderScheduleSlots();
    });

    // ── Init: show task list ───────────────────────────────────────────────
    showTaskList();
});
