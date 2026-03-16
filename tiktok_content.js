// tiktok_content.js
console.log("TikTok Content Script Loaded");

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'uploadVideo') {
        console.log("📤 Upload request received, url:", request.videoUrl);
        uploadVideoToTikTok(request.videoUrl, request.caption, request.productId)
            .then(() => sendResponse({ status: 'done' }))
            .catch(err => {
                console.error("❌ Upload error:", err);
                sendResponse({ error: err.message });
            });
        return true;
    }
});

async function dismissTutorialIfPresent() {
    const gotItBtn = Array.from(document.querySelectorAll('.react-joyride__tooltip button'))
        .find(b => b.textContent.trim() === 'Got it');
    if (gotItBtn) {
        gotItBtn.click();
        console.log("✅ Dismissed tutorial tooltip");
        await new Promise(r => setTimeout(r, 500));
    }
}

async function uploadVideoToTikTok(videoUrl, request_caption, productId) {
    // Step 0: ปิด tutorial popup ถ้ามี
    await dismissTutorialIfPresent();

    // Step 1: ดึง video ผ่าน background (cross-origin proxy)
    console.log("📥 Fetching video via background...");
    const result = await chrome.runtime.sendMessage({
        action: 'fetchVideoAsBase64',
        url: videoUrl
    });

    if (result.error) throw new Error('Fetch failed: ' + result.error);

    // Step 2: base64 → Blob → File
    const fetchRes = await fetch(result.base64);
    const blob = await fetchRes.blob();
    const file = new File([blob], 'video.mp4', { type: result.type || 'video/mp4' });
    console.log("✅ File ready:", file.name, Math.round(file.size / 1024) + ' KB');

    // Step 3: หา file input — ถ้าไม่มีให้ click ปุ่ม upload แต่ block file picker
    let fileInput = document.querySelector('input[type="file"]');

    if (!fileInput) {
        const uploadBtn = document.querySelector('[data-e2e="select_video_button"]');
        if (!uploadBtn) throw new Error('Upload button not found');

        // Block file picker ก่อน click
        const blocker = (e) => {
            if (e.target.type === 'file') {
                e.preventDefault();
                e.stopImmediatePropagation();
            }
        };
        document.addEventListener('click', blocker, true);
        uploadBtn.click();
        console.log("✅ Clicked upload button (file picker blocked)");
        await new Promise(r => setTimeout(r, 600));
        document.removeEventListener('click', blocker, true);

        fileInput = document.querySelector('input[type="file"]');
    }

    if (!fileInput) throw new Error('File input not found after click');
    console.log("✅ Found file input");

    // Step 4: Inject file
    const dt = new DataTransfer();
    dt.items.add(file);
    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files')?.set;
    if (nativeSetter) nativeSetter.call(fileInput, dt.files);
    else fileInput.files = dt.files;

    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    fileInput.dispatchEvent(new Event('input', { bubbles: true }));
    console.log("✅ File injected into TikTok upload");

    // Step 5: ใส่ caption ถ้ามี
    if (request_caption) {
        await new Promise(r => setTimeout(r, 2000)); // รอ editor โหลด
        await setCaptionText(request_caption);
    }

    // Step 6: กด Add (ปุ่มใน .anchor-tag-container)
    await new Promise(r => setTimeout(r, 1000));
    const addAnchorBtn = document.querySelector('.anchor-tag-container button');
    if (addAnchorBtn) {
        addAnchorBtn.click();
        console.log("✅ Clicked Add (anchor)");
        await new Promise(r => setTimeout(r, 1000));
    } else {
        console.warn("⚠️ Add (anchor) button not found — skipping");
    }

    // Step 7: กด Next (TUXButton--primary)
    if (!await clickTUXButton('Next')) {
        console.warn("⚠️ Next button not found — skipping product flow");
        return;
    }
    await new Promise(r => setTimeout(r, 1000));

    // Step 8: กรอก Product ID แล้วกด Enter
    if (productId) {
        await fillProductId(productId);
    }

    // Step 9: กด Next
    await clickTUXButton('Next');
    await new Promise(r => setTimeout(r, 1000));

    // Step 10: กด Add (TUXButton--primary)
    await clickTUXButton('Add');
    console.log("✅ Product flow complete");
}

// ── Helper: คลิก TUXButton--primary ตาม label ────────────────────────────────
async function clickTUXButton(label, retries = 15) {
    for (let i = 0; i < retries; i++) {
        const btn = Array.from(document.querySelectorAll('.TUXButton--primary'))
            .find(b => b.querySelector('.TUXButton-label')?.textContent.trim() === label
                    && b.getAttribute('aria-disabled') !== 'true');
        if (btn) {
            btn.click();
            console.log(`✅ Clicked TUXButton: ${label}`);
            return true;
        }
        await new Promise(r => setTimeout(r, 300));
    }
    console.warn(`⚠️ TUXButton "${label}" not found`);
    return false;
}

// ── Helper: กรอก Product ID + Enter + รอ + คลิก Radio ────────────────────────
async function fillProductId(productId) {
    console.log("🔍 Searching product:", productId);

    // หา search input
    let searchInput = null;
    for (let i = 0; i < 20; i++) {
        searchInput = document.querySelector('input.TUXTextInputCore-input[placeholder="Search products"]');
        if (searchInput) break;
        await new Promise(r => setTimeout(r, 300));
    }
    if (!searchInput) { console.warn("⚠️ Product search input not found"); return; }

    searchInput.focus();
    searchInput.value = productId;
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    searchInput.dispatchEvent(new KeyboardEvent('keyup',   { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    console.log("✅ Typed product ID + Enter");

    // รอผลค้นหา แล้วคลิก Radio Button (retry 5 ครั้ง)
    for (let attempt = 1; attempt <= 5; attempt++) {
        await new Promise(r => setTimeout(r, attempt === 1 ? 3500 : 2500));
        const radio = document.querySelector('input[type="radio"].TUXRadioStandalone-input');
        if (radio) {
            radio.click();
            console.log(`✅ Clicked radio button (attempt ${attempt}):`, radio.name?.substring(0, 40));
            return;
        }
        console.log(`⏳ Radio not found (attempt ${attempt}/5), retrying...`);
    }
    console.warn("⚠️ Radio button not found after 5 attempts");
}

async function setCaptionText(text) {
    console.log("📝 Setting caption...");

    let editor = null;
    for (let i = 0; i < 20; i++) {
        editor = document.querySelector('.public-DraftEditor-content[contenteditable="true"]');
        if (editor) break;
        await new Promise(r => setTimeout(r, 500));
    }

    if (!editor) {
        console.warn("⚠️ Caption editor not found");
        return;
    }

    editor.focus();
    await new Promise(r => setTimeout(r, 200));

    // Select all แล้ว replace ด้วย text ใหม่
    document.execCommand('selectAll', false, null);
    await new Promise(r => setTimeout(r, 100));
    document.execCommand('insertText', false, text);

    console.log("✅ Caption set:", text.substring(0, 50) + (text.length > 50 ? '...' : ''));
}
