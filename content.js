// content.js
console.log("PD Auto VEO3.1 Content Script Loaded");

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "generateVideo") {
        console.log("Received generate request:", request.data);
        handleGeneration(request.data);
        sendResponse({ status: "started" });
    }
});

async function handleGeneration(data) {
    try {
        // Step 1: กดเริ่ม / Start
        await clickStart();
        await new Promise(r => setTimeout(r, 1500));

        // Step 2: กดอัปโหลดรูปภาพ + inject file
        await clickUploadImage(data.imageData);
        await new Promise(r => setTimeout(r, 2000));

        // Step 3: ใส่ Prompt (Slate editor)
        if (data.script) {
            await setPromptSlate(data.script);
            await new Promise(r => setTimeout(r, 1000));
        }

        // Step 4: กด Generate (รอจนปุ่ม enabled)
        // await clickGenerateButton(); // 🔒 ปิดไว้ชั่วคราว — ทดสอบ upload ก่อน

    } catch (error) {
        console.error("Error during generation:", error);
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
    // นับจำนวน item เดิมก่อน upload
    const countBefore = document.querySelectorAll('[data-index]').length;
    console.log(`⏳ Media items before upload: ${countBefore}`);

    // รอ item ใหม่โผล่ (max 30s)
    let newItem = null;
    for (let i = 0; i < 60; i++) {
        const items = document.querySelectorAll('[data-index]');
        if (items.length > countBefore) {
            // item แรก (index 0) = ล่าสุด
            newItem = items[0];
            console.log(`✅ New media item detected (${items.length} items)`);
            break;
        }
        await new Promise(r => setTimeout(r, 500));
    }

    if (!newItem) {
        console.warn("⚠️ No new media item detected, trying first item anyway");
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

// ── Step 3: ใส่ Prompt ในช่อง Slate editor ──────────────────────────────────
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

// ── Helpers ──────────────────────────────────────────────────────────────────
function getElementByXPath(path) {
    return document.evaluate(path, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
}
