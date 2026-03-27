// content.js
console.log("PD Auto VEO3.1 Content Script Loaded");

// บน Orion/mobile chrome.runtime.sendMessage อาจ return undefined (callback-based)
// แทนที่จะเป็น Promise → ใช้ safeSendMessage ทุกครั้ง
function safeSendMessage(msg) {
    try {
        const result = chrome.runtime.sendMessage(msg);
        if (result && typeof result.catch === 'function') result.catch(() => {});
    } catch (e) { /* popup/sidepanel ปิดอยู่ — ไม่ต้อง error */ }
}

let _jobCancelled = false;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "generateVideo") {
        console.log("Received generate request:", request.data);
        _jobCancelled = false;
        handleGeneration(request.data);
        sendResponse({ status: "started" });
    }
    if (request.action === "testImageGen") {
        console.log("🧪 Test Image Gen triggered, prompt:", request.prompt?.substring(0, 60));
        _jobCancelled = false;
        handleImageGeneration({
            prompt:           request.prompt,
            faceImageData:    request.faceImageData,
            productImageData: request.productImageData
        });
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

// ── Image Generation Pipeline ─────────────────────────────────────────────────
async function handleImageGeneration(data) {
    showFlowOverlay();
    try {
        // Step 1: เปิด dropdown settings
        sendProgress(1, 'กำลังเปิดเมนู...');
        const triggerBtn = document.querySelector('button.sc-46973129-1');
        if (!triggerBtn) throw new Error('Settings trigger button not found');
        humanClick(triggerBtn);
        await new Promise(r => setTimeout(r, 700));

        // Step 2: เลือก "รูปภาพ" (IMAGE tab)
        sendProgress(2, 'เลือกประเภทรูปภาพ...');
        let imageTab = null;
        for (let i = 0; i < 20; i++) {
            imageTab = document.querySelector('button[aria-controls$="-content-IMAGE"]');
            if (imageTab) break;
            await new Promise(r => setTimeout(r, 200));
        }
        if (!imageTab) throw new Error('IMAGE tab not found');
        humanClick(imageTab);
        console.log('✅ Selected IMAGE tab');
        await new Promise(r => setTimeout(r, 300));

        // Step 3: เลือก "แนวตั้ง" (PORTRAIT tab)
        sendProgress(3, 'เลือกแนวตั้ง...');
        const portraitTab = document.querySelector('button[aria-controls$="-content-PORTRAIT"]');
        if (portraitTab) {
            humanClick(portraitTab);
            console.log('✅ Selected PORTRAIT tab');
        } else {
            console.warn('⚠️ PORTRAIT tab not found');
        }
        await new Promise(r => setTimeout(r, 300));

        // Step 4: เลือก x1
        sendProgress(4, 'เลือก x1...');
        const x1Tab = Array.from(document.querySelectorAll('button[role="tab"]'))
            .find(b => b.textContent.trim() === 'x1');
        if (x1Tab) {
            humanClick(x1Tab);
            console.log('✅ Selected x1');
        } else {
            console.warn('⚠️ x1 tab not found');
        }
        await new Promise(r => setTimeout(r, 300));

        // Step 5: เปิด model dropdown (ปุ่ม arrow_drop_down ภายใน panel)
        sendProgress(5, 'เลือกโมเดล...');
        const modelDropBtn = xpathFind(
            '//button[@aria-haspopup="menu"][.//i[normalize-space(text())="arrow_drop_down"]]'
        );
        if (modelDropBtn) {
            humanClick(modelDropBtn);
            console.log('✅ Clicked model dropdown');
            await new Promise(r => setTimeout(r, 500));

            // Step 6: เลือก model item แรก จาก menuitem
            const menuItem = document.querySelector('div[role="menuitem"] button');
            if (menuItem) {
                humanClick(menuItem);
                console.log('✅ Selected model:', menuItem.textContent.trim().substring(0, 40));
            } else {
                console.warn('⚠️ Model menu item not found');
                document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            }
            await new Promise(r => setTimeout(r, 400));
        } else {
            console.warn('⚠️ Model dropdown button not found');
        }

        // ปิด settings dropdown
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await new Promise(r => setTimeout(r, 600));

        // Step 6: กดปุ่ม + (add_2) ก่อน เพื่อเปิด prompt/upload area
        sendProgress(6, 'กดปุ่ม + เพื่อเปิด input area...');
        let addBtn = null;
        for (let i = 0; i < 20; i++) {
            addBtn = xpathFind('//button[@aria-haspopup="dialog"][.//i[normalize-space(text())="add_2"]]');
            if (addBtn) break;
            await new Promise(r => setTimeout(r, 300));
        }
        if (!addBtn) throw new Error('+ (add_2) button not found');
        humanClick(addBtn);
        console.log('✅ Clicked + button');
        await new Promise(r => setTimeout(r, 700));

        // Step 7: อัปโหลด Face Reference
        if (data.faceImageData) {
            sendProgress(7, 'อัปโหลด Face Reference...');
            await clickUploadImage(data.faceImageData);
            await new Promise(r => setTimeout(r, 800));
        }

        // Step 7.5: กด + อีกครั้งเพื่อเปิด dialog สำหรับรูปที่ 2
        if (data.productImageData) {
            sendProgress(7.5, 'เปิด dialog สำหรับ Product Image...');
            console.log('🔍 Looking for + button (2nd time)...');
            let addBtn2 = null;
            for (let i = 0; i < 20; i++) {
                // ลอง selector หลายแบบ เผื่อ aria-haspopup เปลี่ยนหลัง upload แรก
                addBtn2 = xpathFind('//button[@aria-haspopup="dialog"][.//i[normalize-space(text())="add_2"]]')
                    || xpathFind('//button[.//i[normalize-space(text())="add_2"]]');
                if (addBtn2) { console.log(`✅ Found + button on try ${i+1}`); break; }
                await new Promise(r => setTimeout(r, 300));
            }
            if (!addBtn2) throw new Error('+ (add_2) button not found for 2nd upload');
            robustClick(addBtn2);
            console.log('✅ robustClick + button (2nd time)');
            await new Promise(r => setTimeout(r, 700));

            sendProgress(7.6, 'อัปโหลด Product Image...');
            await clickUploadImage(data.productImageData);
            await new Promise(r => setTimeout(r, 800));
        }

        // Step 8: ใส่ Prompt
        if (data.prompt) {
            sendProgress(8, 'ใส่ Prompt...');
            await setPromptSlate(data.prompt);
            await new Promise(r => setTimeout(r, 500));
        }

        // Step 9: กด Generate (arrow_forward)
        sendProgress(9, 'กด Generate...');
        await clickGenerateButton();

        // Step 10: รอรูปสร้างเสร็จ
        sendProgress(10, 'รอรูปสร้างเสร็จ...');
        await waitForImageReady();

        // Step 11: ดาวน์โหลดรูป 2K
        sendProgress(11, 'กำลังดาวน์โหลดรูป...');
        await downloadLatestImage();

        removeFlowOverlay();
        safeSendMessage({ action: 'imageReady' });
        console.log('✅ Image download complete');

    } catch (error) {
        console.error('❌ Image generation error:', error);
        removeFlowOverlay();
        safeSendMessage({ action: 'videoError', error: error.message });
    }
}

async function handleGeneration(data) {
    showFlowOverlay();
    try {
        // Step 1: กดกลับก่อน (ออกจากหน้า image result)
        // ถ้าอยู่ใน /flow/project/[id] แล้ว ไม่ต้องกด back (จะออกไปหน้าแรก)
        sendProgress(1, 'เปลี่ยนเป็นโหมดวิดีโอ...');
        const onProjectPage = /\/flow\/project\/[a-zA-Z0-9-]+/.test(location.pathname);
        if (!onProjectPage) {
            const backBtn = xpathFind('//button[.//i[normalize-space(text())="arrow_back"]]');
            if (backBtn) {
                humanClick(backBtn);
                console.log('✅ Clicked back button');
                await new Promise(r => setTimeout(r, 800));
            } else {
                console.warn('⚠️ Back button not found — skipping');
            }
        } else {
            console.log('✅ Already on project page — skip back button');
        }

        // เปิด settings dropdown → เลือก VIDEO
        const triggerBtn = document.querySelector('button.sc-46973129-1');
        if (!triggerBtn) throw new Error('Settings trigger button not found');
        humanClick(triggerBtn);
        await new Promise(r => setTimeout(r, 700));

        let videoTab = null;
        for (let i = 0; i < 20; i++) {
            videoTab = document.querySelector('button[aria-controls$="-content-VIDEO"]');
            if (videoTab) break;
            await new Promise(r => setTimeout(r, 200));
        }
        if (!videoTab) throw new Error('VIDEO tab not found');
        humanClick(videoTab);
        console.log('✅ Selected VIDEO tab');
        await new Promise(r => setTimeout(r, 400));

        // ปิด dropdown
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await new Promise(r => setTimeout(r, 600));

        // เคลียร์ prompt เดิม (ล้างพรอมต์)
        const clearBtn = xpathFind('//button[.//span[normalize-space(text())="ล้างพรอมต์"]]')
            || xpathFind('//button[.//i[normalize-space(text())="close"]][contains(@class,"sc-d3791a4f")]');
        if (clearBtn) {
            humanClick(clearBtn);
            console.log('✅ Cleared old prompt');
            await new Promise(r => setTimeout(r, 500));
        } else {
            console.warn('⚠️ Clear prompt button not found — skipping');
        }

        // Step 2: เลือก Ratio + Quantity
        sendProgress(2, 'กำลังตั้งค่า Ratio + Quantity...');
        await selectRatioAndQuantity(data.ratio, data.quantity);
        await new Promise(r => setTimeout(r, 500));

        // Step 2.5: เลือก Veo Model
        if (data.veoModel) {
            sendProgress(2.5, 'กำลังเลือก Veo Model...');
            await selectModel(data.veoModel);
            await new Promise(r => setTimeout(r, 500));
        }

        // Step 3: อัปโหลดรูป (จาก image gen)
        if (data.imageData) {
            sendProgress(3, 'กำลังอัปโหลดรูปภาพ...');
            await clickUploadImage(data.imageData);
            await new Promise(r => setTimeout(r, 1000));
        }

        // Step 4: ใส่ Prompt (Slate editor) — ปิดไว้ ใส่เองด้วยมือ
        // if (data.script) { await setPromptSlate(data.script); }

        // Step 5: กด Generate (รอจนปุ่ม enabled)
        sendProgress(5, 'กำลัง Generate วิดีโอ...');
        await clickGenerateButton();

        // Step 6: รอวิดีโอสร้างเสร็จ
        sendProgress(6, 'รอวิดีโอสร้างเสร็จ...');
        await waitForVideoReady();

        // Step 7: ดาวน์โหลดวิดีโอ 720p
        sendProgress(7, 'กำลังดาวน์โหลดวิดีโอ...');
        await downloadLatestVideo();

        removeFlowOverlay();
        safeSendMessage({ action: "videoReady" });
        console.log("✅ Notified side panel: videoReady");

    } catch (error) {
        console.error("Error during generation:", error);
        removeFlowOverlay();
        safeSendMessage({ action: "videoError", error: error.message });
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

    // รอปุ่ม Upload — ถ้าไม่เจอให้กดปุ่ม เริ่ม ก่อน แล้วรออีกรอบ
    let btn = null;
    for (let i = 0; i < 20; i++) {
        btn = getElementByXPath(xpath);
        if (btn) break;
        await new Promise(r => setTimeout(r, 500));
    }
    if (!btn) {
        console.warn("⚠️ Upload button not found — clicking เริ่ม button first");
        const startBtn = document.querySelector('div[type="button"].sc-5496b68c-1');
        if (startBtn) {
            humanClick(startBtn);
            console.log("✅ Clicked เริ่ม button");
            await new Promise(r => setTimeout(r, 1000));
        } else {
            console.warn("⚠️ เริ่ม button not found either");
        }
        for (let i = 0; i < 20; i++) {
            btn = getElementByXPath(xpath);
            if (btn) break;
            await new Promise(r => setTimeout(r, 500));
        }
    }
    if (!btn) { console.warn("⚠️ Upload button still not found after เริ่ม click"); return; }

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

// ── รอรูปภาพสร้างเสร็จ ────────────────────────────────────────────────────────
async function waitForImageReady() {
    console.log('⏳ Waiting for image generation to complete...');
    const MAX_WAIT_MS = 3 * 60 * 1000; // 3 นาที
    const start = Date.now();

    // จำจำนวน image tile ก่อน generate
    const countBefore = document.querySelectorAll('.sc-5923b123-0[data-tile-id]').length;

    await new Promise((resolve) => {
        const observer = new MutationObserver(() => {
            const countNow = document.querySelectorAll('.sc-5923b123-0[data-tile-id]').length;
            if (countNow > countBefore) {
                console.log(`✅ New image tile detected (${countBefore} → ${countNow})`);
                observer.disconnect();
                resolve();
                return;
            }
            if (Date.now() - start > MAX_WAIT_MS) {
                console.warn('⚠️ Timeout waiting for image');
                observer.disconnect();
                resolve();
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    });

    await new Promise(r => setTimeout(r, 800));
}

// ── ดาวน์โหลดรูปภาพล่าสุด (คลิก tile → download → 2K) ───────────────────────
async function downloadLatestImage() {
    console.log('Step 11: Downloading latest image...');

    // หา image tile แรกใน virtuoso list
    let imageTile = null;
    for (let i = 0; i < 20; i++) {
        const firstRow = document.querySelector('[data-index="0"]');
        if (firstRow) imageTile = firstRow.querySelector('.sc-5923b123-0[data-tile-id]');
        if (!imageTile) imageTile = document.querySelector('.sc-5923b123-0[data-tile-id]');
        if (imageTile) break;
        await new Promise(r => setTimeout(r, 500));
    }
    if (!imageTile) { console.warn('⚠️ No image tile found'); return; }
    console.log('✅ Found image tile:', imageTile.dataset.tileId);

    // เก็บ image data ไว้ใน storage เพื่อใช้ใน video gen
    const imgEl = imageTile.querySelector('img');
    if (imgEl?.src) {
        try {
            const res = await fetch(imgEl.src);
            const blob = await res.blob();
            const b64 = await new Promise(resolve => {
                const reader = new FileReader();
                reader.onload = e => resolve(e.target.result);
                reader.readAsDataURL(blob);
            });
            chrome.storage.local.set({ lastGeneratedImageData: b64 });
            console.log('✅ Stored generated image data for video gen');
        } catch (e) { console.warn('⚠️ Could not store image data:', e); }
    }

    // คลิก <a> link ข้างใน เพื่อเปิดรูป
    imageTile.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await new Promise(r => setTimeout(r, 400));
    const link = imageTile.querySelector('a') || imageTile;
    robustClick(link);
    console.log('✅ Clicked image tile to open');
    await new Promise(r => setTimeout(r, 1000));

    // รอปุ่ม Download (icon "download")
    let downloadBtn = null;
    for (let i = 0; i < 20; i++) {
        downloadBtn = xpathFind(`//button[@aria-haspopup='menu'][.//i[normalize-space(text())='download']]`);
        if (downloadBtn) break;
        await new Promise(r => setTimeout(r, 300));
    }
    if (!downloadBtn) { console.warn('⚠️ Download button not found'); return; }
    robustClick(downloadBtn);
    console.log('✅ Clicked download button');
    await new Promise(r => setTimeout(r, 600));

    // เลือก 2K
    let btn2k = null;
    for (let i = 0; i < 20; i++) {
        btn2k = Array.from(document.querySelectorAll('[role="menuitem"]'))
            .find(el => el.textContent.includes('2K'));
        if (btn2k) break;
        await new Promise(r => setTimeout(r, 200));
    }
    if (!btn2k) {
        console.warn('⚠️ 2K option not found');
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        return;
    }
    btn2k.click();
    console.log('✅ Clicked 2K — image download started');
    await new Promise(r => setTimeout(r, 1000));
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

    // ── 1. หา video tile ล่าสุด จาก virtuoso data-index="0" ────────────────
    // video tile = sc-c462af31-0  |  image tile = sc-5923b123-0
    let videoTile = null;
    for (let i = 0; i < 20; i++) {
        // ลองหาจาก row แรกของ virtuoso list ก่อน
        const firstRow = document.querySelector('[data-index="0"]');
        if (firstRow) {
            videoTile = firstRow.querySelector('.sc-c462af31-0');
        }
        // fallback: หาทั่วหน้า
        if (!videoTile) {
            videoTile = document.querySelector('.sc-c462af31-0[data-tile-id]');
        }
        if (videoTile) break;
        await new Promise(r => setTimeout(r, 500));
    }
    if (!videoTile) { console.warn("⚠️ No video tile found"); return; }
    console.log("✅ Found video tile:", videoTile.dataset.tileId);

    // ── 2. เก็บ video URL ไว้ใน storage สำหรับ TikTok upload ─────────────────
    const videoEl = videoTile.querySelector('video');
    if (videoEl?.src) {
        const absoluteUrl = new URL(videoEl.src, location.origin).href;
        chrome.storage.local.set({ lastVideoUrl: absoluteUrl });
        console.log("✅ Stored video URL:", absoluteUrl);
    }

    // ── 3. Scroll + คลิก <a> เพื่อเปิดวิดีโอ ───────────────────────────────
    videoTile.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await new Promise(r => setTimeout(r, 400));

    // คลิก <button> ข้างใน <a> (play button ของ video tile)
    const openBtn = videoTile.querySelector('a button') || videoTile.querySelector('a') || videoTile;
    openBtn.click();
    console.log("✅ Clicked video tile to open:", openBtn.tagName);
    await new Promise(r => setTimeout(r, 1000));

    // ── 4. รอปุ่ม Download โผล่ ──────────────────────────────────────────────
    // <button aria-haspopup="menu"><i class="google-symbols">download</i>...</button>
    // หาด้วย XPath — ไม่ขึ้นกับภาษา UI (ใช้ icon name "download" ข้างใน <i>)
    let downloadBtn = null;
    for (let i = 0; i < 20; i++) {
        downloadBtn = xpathFind(
            `//button[@aria-haspopup='menu'][.//i[normalize-space(text())='download']]`
        );
        if (downloadBtn) break;
        await new Promise(r => setTimeout(r, 300));
    }

    if (!downloadBtn) {
        console.warn("⚠️ Download button not found");
        return;
    }
    console.log("✅ Found Download button via XPath:", downloadBtn.id);
    robustClick(downloadBtn);
    console.log("✅ robustClick → Download button");
    await new Promise(r => setTimeout(r, 600));

    // ── 5. หา 720p แล้วกด ───────────────────────────────────────────────────
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

// ── XPath helper ─────────────────────────────────────────────────────────────
function xpathFind(expr, context = document) {
    return document.evaluate(expr, context, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
}

// ── Robust React click helpers (port from tiktok_content.js) ─────────────────
function _getCenter(el) {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
}
function _mouseInit(el) {
    const { x, y } = _getCenter(el);
    return { bubbles: true, cancelable: true, composed: true, view: window, detail: 1,
             clientX: x, clientY: y, screenX: x, screenY: y, button: 0, buttons: 1 };
}
function _pointerInit(el) {
    return { ..._mouseInit(el), pointerId: 1, width: 1, height: 1, pressure: 0.5, pointerType: 'mouse', isPrimary: true };
}

function dispatchClickSeq(el) {
    el.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    const p = _pointerInit(el), m = _mouseInit(el);
    el.dispatchEvent(new PointerEvent('pointerdown', p));
    el.dispatchEvent(new MouseEvent('mousedown', m));
    el.dispatchEvent(new PointerEvent('pointerup', { ...p, pressure: 0, buttons: 0 }));
    el.dispatchEvent(new MouseEvent('mouseup', { ...m, buttons: 0 }));
    el.dispatchEvent(new MouseEvent('click', { ...m, buttons: 0 }));
}

function reactFiberClick(el) {
    const key = Object.keys(el).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactProps$'));
    if (!key) return false;
    let node = el[key.startsWith('__reactFiber') ? key : null] || el;
    let fiber = key.startsWith('__reactFiber') ? el[key] : null;
    // try __reactProps$ walk up DOM
    for (let n = el, i = 0; i < 8 && n; i++, n = n.parentElement) {
        const pk = Object.keys(n).find(k => k.startsWith('__reactProps$'));
        if (pk && typeof n[pk]?.onClick === 'function') {
            n[pk].onClick({ type: 'click', target: el, currentTarget: n,
                nativeEvent: new MouseEvent('click', _mouseInit(el)),
                bubbles: true, cancelable: true, defaultPrevented: false,
                preventDefault: () => {}, stopPropagation: () => {}, persist: () => {},
                isDefaultPrevented: () => false, isPropagationStopped: () => false,
                ..._getCenter(el) });
            return true;
        }
    }
    if (!fiber) return false;
    for (let i = 0; i < 15 && fiber; i++) {
        if (typeof fiber.memoizedProps?.onClick === 'function') {
            fiber.memoizedProps.onClick({ type: 'click', target: el,
                nativeEvent: new MouseEvent('click', _mouseInit(el)),
                bubbles: true, cancelable: true, defaultPrevented: false,
                preventDefault: () => {}, stopPropagation: () => {}, persist: () => {},
                isDefaultPrevented: () => false, isPropagationStopped: () => false,
                ..._getCenter(el) });
            return true;
        }
        fiber = fiber.return;
    }
    return false;
}

function robustClick(el) {
    dispatchClickSeq(el);
    if (!reactFiberClick(el)) el.click();
}

// ── Progress reporting ────────────────────────────────────────────────────────
function sendProgress(step, text) {
    safeSendMessage({ action: 'progress', running: true, step, text });
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
