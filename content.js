// content.js
console.log("PD Auto VEO3.1 Content Script Loaded");

let _jobCancelled = false;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "generateVideo") {
        console.log("Received generate request:", request.data);
        _jobCancelled = false;
        handleGeneration(request.data);
        sendResponse({ status: "started" });
    }
    if (request.action === "testDownload") {
        console.log("🧪 Test Download triggered");
        downloadLatestVideo().then(() => {
            console.log("🧪 Test Download complete");
        });
        sendResponse({ status: "started" });
    }
    if (request.action === "cancelJob") {
        _jobCancelled = true;
        removeFlowOverlay();
        console.log("🛑 Job cancelled");
        sendResponse({ status: "cancelled" });
    }
});

async function handleGeneration(data) {
    showFlowOverlay();
    try {
        // Step 1: กดเริ่ม / Start
        sendProgress(1, 'กำลังเริ่มต้น...');
        await clickStart();
        await new Promise(r => setTimeout(r, 1500));

        // Step 2: กดอัปโหลดรูปภาพ + inject file
        sendProgress(2, 'กำลังอัปโหลดรูปภาพ...');
        await clickUploadImage(data.imageData);
        await new Promise(r => setTimeout(r, 2000));

        // Step 3: เลือก Ratio + Quantity
        sendProgress(3, 'กำลังตั้งค่า Ratio + Quantity...');
        await selectRatioAndQuantity(data.ratio, data.quantity);
        await new Promise(r => setTimeout(r, 500));

        // Step 3.5: เลือก Veo Model
        if (data.veoModel) {
            sendProgress(3.5, 'กำลังเลือก Veo Model...');
            await selectModel(data.veoModel);
            await new Promise(r => setTimeout(r, 500));
        }

        // Step 4: ใส่ Prompt (Slate editor)
        if (data.script) {
            sendProgress(4, 'กำลังใส่ Prompt...');
            await setPromptSlate(data.script);
            await new Promise(r => setTimeout(r, 1000));
        }

        // Step 5: กด Generate (รอจนปุ่ม enabled)
        sendProgress(5, 'กำลัง Generate วิดีโอ...');
        await clickGenerateButton();

        // Step 6: รอวิดีโอสร้างเสร็จ
        sendProgress(6, 'รอวิดีโอสร้างเสร็จ...');
        await waitForVideoReady();

        // Step 7: ดาวน์โหลดวิดีโอ 720p
        sendProgress(7, 'กำลังดาวน์โหลดวิดีโอ...');
        await downloadLatestVideo();

        // Step 8: แจ้ง side panel ว่าเสร็จแล้ว (เปิด TikTok)
        removeFlowOverlay();
        chrome.runtime.sendMessage({ action: "videoReady" });
        console.log("✅ Notified side panel: videoReady");

    } catch (error) {
        console.error("Error during generation:", error);
        removeFlowOverlay();
        chrome.runtime.sendMessage({ action: "videoError", error: error.message });
    }
}

// ── Step 1: กดเริ่ม / Start ──────────────────────────────────────────────────
async function clickStart() {
    console.log("Step 1: Looking for Start button...");
    const xpath = '//div[@type="button" and (text()="เริ่ม" or text()="Start")]';

    for (let i = 0; i < 20; i++) {
        const el = getElementByXPath(xpath);
        if (el) {
            el.click();
            console.log("✅ Clicked Start button");
            return;
        }
        console.log("⏳ Start button not found, retrying...");
        await new Promise(r => setTimeout(r, 500));
    }
    console.warn("⚠️ Start button not found after retries");
}

// ── Step 2: block file input ทั้งที่มีอยู่แล้ว + ที่จะสร้างใหม่ แล้ว inject ──
async function clickUploadImage(imageData) {
    console.log("Step 2: Setting up file input blocker...");
    const xpath = '//button[.//i[contains(@class,"google-symbols") and normalize-space(text())="upload"]]';

    if (!imageData) { console.warn("⚠️ No imageData"); return; }

    const res = await fetch(imageData);
    const blob = await res.blob();
    const file = new File([blob], "product_image.png", { type: "image/png" });

    // รอปุ่ม Upload
    let btn = null;
    for (let i = 0; i < 20; i++) {
        btn = getElementByXPath(xpath);
        if (btn) break;
        await new Promise(r => setTimeout(r, 500));
    }
    if (!btn) { console.warn("⚠️ Upload button not found"); return; }

    // Block click event บน file input ด้วย capture phase (preventDefault)
    const blockPickerHandler = (e) => {
        if (e.target.type === 'file') {
            e.preventDefault();
            e.stopImmediatePropagation();
            console.log("🚫 Blocked file picker via event capture");
        }
    };
    document.addEventListener('click', blockPickerHandler, true);

    // Observer จับ input ที่จะสร้างใหม่
    const observer = new MutationObserver(() => {
        document.querySelectorAll('input[type="file"]').forEach(i => {
            if (!i._logged) { i._logged = true; console.log("🔒 New file input detected:", i); }
        });
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // กดปุ่ม
    btn.click();
    console.log("✅ Clicked Upload button");
    await new Promise(r => setTimeout(r, 800));
    observer.disconnect();

    // Remove block handler
    document.removeEventListener('click', blockPickerHandler, true);

    // Inject file
    const fileInput = document.querySelector('input[type="file"]');
    if (!fileInput) { console.warn("⚠️ File input not found after click"); return; }

    const dt = new DataTransfer();
    dt.items.add(file);
    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files')?.set;
    if (nativeSetter) nativeSetter.call(fileInput, dt.files);
    else fileInput.files = dt.files;

    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    fileInput.dispatchEvent(new Event('input', { bubbles: true }));
    console.log("✅ File injected — waiting for upload to complete...");

    // รอ image ใหม่โผล่ใน media list แล้วคลิก select
    await waitForUploadAndSelect();
}

// รอ upload เสร็จ → คลิก image ล่าสุดใน media library → รอ dialog ปิด
async function waitForUploadAndSelect() {
    // จำ src ของ item แรกก่อน upload
    const firstImgBefore = document.querySelector('[data-index="0"] img')?.src || '';
    console.log(`⏳ Waiting for new image to appear in media list...`);

    // รอจน img src ของ item[0] เปลี่ยน (= ภาพใหม่ขึ้นมาอยู่บนสุด)
    let newItem = null;
    for (let i = 0; i < 60; i++) {
        const firstImg = document.querySelector('[data-index="0"] img');
        if (firstImg && firstImg.src !== firstImgBefore) {
            newItem = document.querySelector('[data-index="0"]');
            console.log(`✅ New image detected at top of media list`);
            break;
        }
        await new Promise(r => setTimeout(r, 500));
    }

    if (!newItem) {
        console.warn("⚠️ Image src didn't change, clicking first item anyway");
        newItem = document.querySelector('[data-index="0"]');
    }

    if (newItem) {
        newItem.click();
        console.log("✅ Clicked newly uploaded image to select it");
    }

    // รอ dialog ปิด (sc-dbfb6b4a-0 หายออกจาก DOM หรือ Slate editor พร้อม)
    console.log("⏳ Waiting for dialog to close...");
    for (let i = 0; i < 30; i++) {
        const dialogStillOpen = document.querySelector('.sc-dbfb6b4a-0');
        if (!dialogStillOpen) {
            console.log("✅ Dialog closed");
            break;
        }
        await new Promise(r => setTimeout(r, 500));
    }

    await new Promise(r => setTimeout(r, 500));
}

// helper: human-like click
function humanClick(el) {
    ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(type => {
        el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, button: 0, buttons: 1, composed: true }));
    });
}

// ── Step 3: เลือก Ratio + Quantity จาก dropdown ─────────────────────────────
async function selectRatioAndQuantity(ratio, quantity) {
    console.log(`Step 3: Selecting ratio=${ratio}, quantity=${quantity}...`);

    // เปิด dropdown ด้วย human-like click
    const triggerBtn = document.querySelector('button.sc-46973129-1');
    if (!triggerBtn) { console.warn("⚠️ Dropdown trigger not found"); return; }

    humanClick(triggerBtn);
    console.log("✅ Clicked settings dropdown trigger");

    // รอ tabs โผล่ใน DOM (Radix portal)
    const ratioContentId = ratio === '16:9' ? 'LANDSCAPE' : 'PORTRAIT';
    const qty = String(parseInt(quantity) || 1);

    let ratioTab = null;
    for (let i = 0; i < 20; i++) {
        ratioTab = document.querySelector(`button[aria-controls$="-content-${ratioContentId}"]`);
        if (ratioTab) break;
        await new Promise(r => setTimeout(r, 200));
    }

    if (ratioTab) {
        humanClick(ratioTab);
        console.log(`✅ Selected ratio: ${ratioContentId}`);
        await new Promise(r => setTimeout(r, 300));
    } else {
        console.warn(`⚠️ Ratio tab not found: ${ratioContentId}`);
    }

    // Quantity — เฉพาะ tab ที่มี text "x{qty}" (กัน collision กับ LANDSCAPE/PORTRAIT ที่มี -content-1 บางกรณี)
    const qtyTab = Array.from(document.querySelectorAll(`button[role="tab"]`))
        .find(b => b.textContent.trim() === `x${qty}`);
    if (qtyTab) {
        humanClick(qtyTab);
        console.log(`✅ Selected quantity: x${qty}`);
        await new Promise(r => setTimeout(r, 300));
    } else {
        console.warn(`⚠️ Quantity tab not found: x${qty}`);
    }

    // ปิด dropdown
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise(r => setTimeout(r, 400));
    console.log("✅ Closed dropdown");
}

// ── Step 3.5: เลือก Veo Model ─────────────────────────────────────────────
async function selectModel(modelName) {
    if (!modelName) return;
    console.log(`Step 3.5: Selecting model: ${modelName}...`);

    // หาปุ่ม model จาก text content (stable กว่า class)
    const modelBtn = Array.from(document.querySelectorAll('button[aria-haspopup="menu"]'))
        .find(b => b.textContent.includes('Veo'));
    if (!modelBtn) { console.warn("⚠️ Model button not found"); return; }

    humanClick(modelBtn);
    await new Promise(r => setTimeout(r, 600));

    // หา menu item จาก text ตรงกับ modelName
    const items = document.querySelectorAll('[role="menuitem"] button');
    const target = Array.from(items).find(b => b.textContent.includes(modelName));
    if (target) {
        humanClick(target);
        console.log(`✅ Selected model: ${modelName}`);
    } else {
        console.warn(`⚠️ Model option not found: ${modelName}`);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    }
    await new Promise(r => setTimeout(r, 400));
}

// ── Step 4: ใส่ Prompt ในช่อง Slate editor ──────────────────────────────────
async function setPromptSlate(text) {
    console.log("Step 3: Looking for Slate editor...");

    // Target โดยตรงจาก data-slate-editor attribute
    let editable = null;
    for (let i = 0; i < 20; i++) {
        editable = document.querySelector('[data-slate-editor="true"][contenteditable="true"]');
        if (editable) break;
        console.log("⏳ Slate editor not found, retrying...");
        await new Promise(r => setTimeout(r, 500));
    }

    if (!editable) {
        console.warn("⚠️ Slate editor not found");
        return;
    }

    // Click + focus เพื่อให้ Slate ตั้ง internal selection
    editable.click();
    editable.focus();
    await new Promise(r => setTimeout(r, 300));

    // วาง cursor ที่ตำแหน่ง 0 ผ่าน Selection API
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(editable, 0);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    await new Promise(r => setTimeout(r, 100));

    // ยิง beforeinput ที่ Slate ฟังอยู่
    editable.dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: text,
    }));
    await new Promise(r => setTimeout(r, 200));

    // Fallback: execCommand ถ้า Slate ยังไม่รับ
    if (!editable.textContent.replace(/\uFEFF/g, '').trim()) {
        console.log("⚠️ Fallback: execCommand insertText");
        document.execCommand('insertText', false, text);
    }

    console.log("✅ Prompt inserted:", text.substring(0, 50) + "...");
    await new Promise(r => setTimeout(r, 500));
}

// ── Step 4: กด Generate ──────────────────────────────────────────────────────
async function clickGenerateButton() {
    console.log("Step 4: Waiting for Generate button (enabled)...");

    while (true) {
        const btn = Array.from(document.querySelectorAll('button')).find(b => {
            const icon = b.querySelector('i');
            return icon && icon.textContent.trim() === 'arrow_forward';
        });

        if (!btn) {
            console.log("⏳ Generate button not found yet, waiting...");
            await new Promise(r => setTimeout(r, 300));
            continue;
        }

        const disabled =
            btn.disabled ||
            btn.getAttribute('aria-disabled') === 'true' ||
            btn.className.toLowerCase().includes('disabled') ||
            getComputedStyle(btn).pointerEvents === 'none';

        if (disabled) {
            console.log("⛔ Generate button disabled, waiting...");
            await new Promise(r => setTimeout(r, 500));
            continue;
        }

        console.log("✅ Generate button ready, clicking...");
        ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(type => {
            btn.dispatchEvent(new MouseEvent(type, {
                bubbles: true, cancelable: true,
                view: window, button: 0, buttons: 1, composed: true
            }));
        });
        btn.focus();
        break;
    }
}

// ── Step 6: รอวิดีโอสร้างเสร็จ ────────────────────────────────────────────────
async function waitForVideoReady() {
    console.log("Step 6: Waiting for video generation to complete...");

    const MAX_WAIT_MS = 5 * 60 * 1000; // 5 นาที
    const start = Date.now();

    // จำจำนวน <video> ก่อนเริ่ม generate
    const videoBefore = document.querySelectorAll('video').length;

    await new Promise((resolve) => {
        const observer = new MutationObserver(() => {
            // วิธี 1: มี <video> ใหม่โผล่ (วิดีโอพร้อมเล่น)
            const videoNow = document.querySelectorAll('video').length;
            if (videoNow > videoBefore) {
                console.log(`✅ New video element detected (${videoBefore} → ${videoNow})`);
                observer.disconnect();
                resolve();
                return;
            }

            // วิธี 2: มีปุ่ม download / save โผล่
            const downloadBtn = document.querySelector('[aria-label*="download" i], [aria-label*="save" i], [title*="download" i]');
            if (downloadBtn) {
                console.log("✅ Download button detected");
                observer.disconnect();
                resolve();
                return;
            }

            // Timeout
            if (Date.now() - start > MAX_WAIT_MS) {
                console.warn("⚠️ Timeout waiting for video");
                observer.disconnect();
                resolve();
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });
    });

}

// ── Step 7: ดาวน์โหลดวิดีโอล่าสุด (hover → right-click → Download → 720p) ───
async function downloadLatestVideo() {
    console.log("Step 7: Downloading latest video...");

    // หา div[data-tile-id] แรกที่มี class sc-c462af31-0 (video tile, ไม่ใช่ image)
    // video tile = sc-c462af31-0 ddclZo / image tile = sc-5923b123-0 gUubWn
    let videoTile = null;
    for (let i = 0; i < 20; i++) {
        videoTile = document.querySelector('div[data-tile-id]:has(video)');
        if (videoTile) break;
        await new Promise(r => setTimeout(r, 500));
    }

    if (!videoTile) {
        console.warn("⚠️ No video tile found");
        return;
    }
    console.log("✅ Found video tile:", videoTile.dataset.tileId);

    // เก็บ video URL ไว้ใน storage สำหรับ TikTok upload
    const videoEl = videoTile.querySelector('video');
    if (videoEl?.src) {
        const absoluteUrl = new URL(videoEl.src, location.origin).href;
        chrome.storage.local.set({ lastVideoUrl: absoluteUrl });
        console.log("✅ Stored video URL:", absoluteUrl);
    }

    // Scroll เข้า view ก่อน
    videoTile.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await new Promise(r => setTimeout(r, 300));

    // Hover บน sc-7a78fdd8-0 (hover wrapper ที่ทำให้ overlay โผล่)
    const hoverEl = videoTile.querySelector('.sc-7a78fdd8-0') || videoTile;
    const rect = hoverEl.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    hoverEl.dispatchEvent(new PointerEvent('pointerenter', { bubbles: false, cancelable: true, view: window, clientX: cx, clientY: cy }));
    hoverEl.dispatchEvent(new MouseEvent('mouseenter',     { bubbles: false, cancelable: true, view: window, clientX: cx, clientY: cy }));
    hoverEl.dispatchEvent(new MouseEvent('mouseover',      { bubbles: true,  cancelable: true, view: window, clientX: cx, clientY: cy }));
    hoverEl.dispatchEvent(new MouseEvent('mousemove',      { bubbles: true,  cancelable: true, view: window, clientX: cx, clientY: cy }));
    console.log("✅ Hovered on video tile");
    await new Promise(r => setTimeout(r, 600));

    // Right-click บน inner span[data-state] ใน .sc-11801678-0
    // (outer span แสดงแค่ "ลบ" — inner span มี download)
    const innerSpan = videoTile.querySelector('.sc-11801678-0 > span[data-state]');
    const contextTrigger = innerSpan || videoTile.querySelector(':scope > span[data-state]') || videoTile;
    contextTrigger.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy, button: 2, buttons: 2
    }));
    console.log("✅ Right-clicked:", contextTrigger.className, '| data-state:', contextTrigger.dataset.state);
    await new Promise(r => setTimeout(r, 800));

    // หา "ดาวน์โหลด" menu item (icon google-symbols text = "download")
    let downloadItem = null;
    for (let i = 0; i < 20; i++) {
        downloadItem = Array.from(document.querySelectorAll('[role="menuitem"]'))
            .find(el => {
                const icon = el.querySelector('.google-symbols');
                return icon && icon.textContent.trim() === 'download';
            });
        if (downloadItem) break;
        await new Promise(r => setTimeout(r, 200));
    }

    if (!downloadItem) {
        console.warn("⚠️ Download menu item not found");
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        return;
    }

    downloadItem.click();
    console.log("✅ Clicked Download");
    await new Promise(r => setTimeout(r, 600));

    // หา 720p button
    let btn720 = null;
    for (let i = 0; i < 20; i++) {
        btn720 = Array.from(document.querySelectorAll('[role="menuitem"]'))
            .find(el => el.textContent.includes('720p'));
        if (btn720) break;
        await new Promise(r => setTimeout(r, 200));
    }

    if (!btn720) {
        console.warn("⚠️ 720p button not found");
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        return;
    }

    btn720.click();
    console.log("✅ Clicked 720p — download started");
    await new Promise(r => setTimeout(r, 1000));
}

// ── Progress reporting ────────────────────────────────────────────────────────
function sendProgress(step, text) {
    chrome.runtime.sendMessage({ action: 'progress', running: true, step, text })
        .catch(() => {}); // ignore error when popup is closed
    updateFlowOverlay(text);
}

// ── Flow Page Overlay ─────────────────────────────────────────────────────────
function showFlowOverlay() {
    if (document.getElementById('loki-flow-overlay')) return;

    // Inject keyframes once
    if (!document.getElementById('loki-flow-style')) {
        const style = document.createElement('style');
        style.id = 'loki-flow-style';
        style.textContent = '@keyframes lokiSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }';
        document.head.appendChild(style);
    }

    const overlay = document.createElement('div');
    overlay.id = 'loki-flow-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;font-family:sans-serif;';

    overlay.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;gap:16px;padding:32px 24px;text-align:center;">
            <div style="width:32px;height:32px;border:3px solid rgba(255,255,255,0.2);border-top:3px solid #F97316;border-radius:50%;animation:lokiSpin 0.8s linear infinite;flex-shrink:0;"></div>
            <div id="loki-flow-step" style="font-size:14px;color:#F97316;font-weight:500;">กำลังเริ่มต้น...</div>
            <div style="font-size:12px;color:#9CA3AF;">⚠️ ห้ามกดอะไร ระบบกำลังทำงาน</div>
        </div>
    `;

    document.body.appendChild(overlay);
}

function updateFlowOverlay(text) {
    const stepEl = document.getElementById('loki-flow-step');
    if (stepEl) stepEl.innerText = text || 'กำลังทำงาน...';
}

function removeFlowOverlay() {
    const overlay = document.getElementById('loki-flow-overlay');
    if (overlay) overlay.remove();
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function getElementByXPath(path) {
    return document.evaluate(path, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
}
