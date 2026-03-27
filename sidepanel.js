// ── Auto Split: เปิด TikTok Studio ตอน extension โหลด ──────────────────────
async function ensureTikTokStudioOpen({ focus = false } = {}) {
    const TIKTOK_URL = 'https://www.tiktok.com/tiktokstudio/upload?from=creator_center';

    const existing = await chrome.tabs.query({ url: 'https://www.tiktok.com/tiktokstudio/*' });
    if (existing.length > 0) {
        console.log('TikTok Studio already open');
        if (focus) await chrome.tabs.update(existing[0].id, { active: true });
        return;
    }

    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab) {
        await chrome.tabs.update(activeTab.id, { url: TIKTOK_URL, active: true });
        console.log('Navigated current tab to TikTok Studio upload');
    } else {
        await chrome.tabs.create({ url: TIKTOK_URL, active: focus });
        console.log('TikTok Studio opened as new tab (fallback)');
    }
}

async function switchToTikTok() {
    const tabs = await chrome.tabs.query({ url: 'https://www.tiktok.com/tiktokstudio/*' });
    if (tabs.length > 0) {
        await chrome.tabs.update(tabs[0].id, { active: true });
        console.log('Switched to TikTok Studio');
    }
}

// inject tiktok_content.js แล้วเรียก uploadVideoToTikTok โดยตรง (ไม่ผ่าน message)
async function sendToTikTok(tabId, { videoUrl, caption, productId }) {
    // inject script เข้า isolated world
    await chrome.scripting.executeScript({ target: { tabId }, files: ['tiktok_content.js'] });
    await new Promise(r => setTimeout(r, 500));
    // เรียก function โดยตรงใน isolated world เดียวกัน
    await chrome.scripting.executeScript({
        target: { tabId },
        func: (url, cap, pid) => { uploadVideoToTikTok(url, cap, pid); },
        args: [videoUrl, caption || '', productId || '']
    });
}

async function switchToFlow() {
    const tabs = await chrome.tabs.query({ url: 'https://labs.google/*' });
    if (tabs.length > 0) {
        await chrome.tabs.update(tabs[0].id, { active: true });
        console.log('Switched to Flow');
    }
}

// ── Listen for messages from content script ───────────────────────────────
chrome.runtime.onMessage.addListener((message) => {
    const statusBar   = document.getElementById('statusBar');
    const statusText  = document.getElementById('statusText');
    const progressFill = document.querySelector('.progress-fill');
    const runBtn      = document.getElementById('runAllBtn');

    if (message.action === 'progress') {
        statusText.innerText = message.text || 'กำลังทำงาน...';
        const overlayStepText = document.getElementById('overlayStepText');
        if (overlayStepText) overlayStepText.innerText = message.text || 'กำลังทำงาน...';
    }

    if (message.action === 'videoReady') {
        progressFill.classList.remove('pulse');
        progressFill.style.transition = '';
        progressFill.style.width = '100%';
        statusText.innerText = "เสร็จสิ้น! กำลังเปิด TikTok...";

        chrome.storage.local.set({ jobStatus: { running: false, done: true, text: 'เสร็จสิ้น!' } });

        statusText.innerText = "ดาวน์โหลดเสร็จ! กำลังสลับไป TikTok...";
        setTimeout(async () => {
            try {
                // เปิด TikTok Studio tab (ถ้าไม่มีให้สร้างใหม่)
                await ensureTikTokStudioOpen({ focus: true });

                // รอ tab โหลด แล้วค่อย switch
                await new Promise(r => setTimeout(r, 3000));
                await switchToTikTok();

                // รออีกนิด ให้ content script พร้อม
                await new Promise(r => setTimeout(r, 2000));

                const { lastVideoUrl, formData } = await chrome.storage.local.get(['lastVideoUrl', 'formData']);
                const caption   = document.getElementById('captionInput').value.trim() || formData?.caption || '';
                const productId = document.getElementById('productIdInput').value.trim() || formData?.productId || '';

                if (!lastVideoUrl) {
                    console.warn("No lastVideoUrl — skipping auto upload");
                    statusText.innerText = "ไม่พบ URL วิดีโอ — อัปโหลดเองด้วยมือ";
                    return;
                }

                let tiktokTabs = await chrome.tabs.query({ url: 'https://www.tiktok.com/tiktokstudio/*' });
                if (tiktokTabs.length === 0) {
                    console.warn("TikTok tab not found — skipping upload");
                    statusText.innerText = "ไม่พบแท็บ TikTok Studio";
                    return;
                }

                // รอให้ tab โหลดเสร็จ (status === 'complete') ก่อนส่ง message
                statusText.innerText = "รอ TikTok Studio โหลด...";
                await new Promise((resolve) => {
                    const tabId = tiktokTabs[0].id;
                    chrome.tabs.get(tabId, (tab) => {
                        if (tab.status === 'complete') { resolve(); return; }
                        const listener = (id, info) => {
                            if (id === tabId && info.status === 'complete') {
                                chrome.tabs.onUpdated.removeListener(listener);
                                resolve();
                            }
                        };
                        chrome.tabs.onUpdated.addListener(listener);
                        // timeout 15s
                        setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); resolve(); }, 15000);
                    });
                });
                // รออีก 1 วิ ให้ content script inject เสร็จ
                await new Promise(r => setTimeout(r, 1000));

                statusText.innerText = "กำลังอัปโหลดไป TikTok...";
                sendToTikTok(tiktokTabs[0].id, {
                    action: 'uploadVideo',
                    videoUrl: lastVideoUrl,
                    caption,
                    productId
                }).catch(err => {
                    console.error("uploadVideo error:", err.message);
                    statusText.innerText = "Error: " + err.message;
                });
            } catch (err) {
                console.error("TikTok upload error:", err);
                statusText.innerText = "Error ไป TikTok: " + err.message;
            }
        }, 1000);

        setTimeout(() => {
            statusBar.classList.add('hidden');
            progressFill.style.width = '0%';
            statusText.innerText = "กำลังสร้างวิดีโอ.. รอสักครู่";
            if (runBtn) runBtn.disabled  = false;
            chrome.storage.local.remove('jobStatus');
            const automationOverlay = document.getElementById('automationOverlay');
            if (automationOverlay) automationOverlay.classList.add('hidden');
        }, 8000);
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
        if (runBtn) runBtn.disabled  = false;
        chrome.storage.local.set({ jobStatus: { running: false, error: message.error } });
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

function buildStep2Prompt() {
    const gender     = document.querySelector('input[name="gender2"]:checked')?.value === 'female' ? 'female' : 'male';
    const genderWord = gender === 'female' ? 'female' : 'male';
    const action     = document.getElementById('action2')?.value || '';
    const product    = document.getElementById('productName')?.value || 'product';
    const script     = document.getElementById('scriptInput')?.value || '';
    const platform   = document.getElementById('platform2')?.value || 'TikTok';
    const pacing     = document.getElementById('pacing2')?.value || '';

    return `A ${genderWord} Thai person,
is ${action} the ${product}.

Location: สุ่มตามประเภทตามสินค้า

Script/Key Message: ${script}

End with CTA: "สั่งซื้อได้เลย"

Style: UGC smartphone footage, handheld slightly shaky,
natural Thai daylight, no cinematic filter, no heavy color grading.
Looks like a real person filming themselves for ${platform}.

Pacing: ${pacing}

No text, captions, subtitles, or watermarks visible in the video.`;
}

function buildStep3Prompt() {
    const platform   = document.getElementById('platform3')?.value || 'TikTok';
    const product    = document.getElementById('productName')?.value || 'product';
    const script     = document.getElementById('captionScript')?.value || '';
    const audience   = document.getElementById('audience3')?.value || '';
    const hookStyle  = document.getElementById('hookStyle3')?.value || '';

    return `You are a Thai social media copywriter who writes casual, relatable
product captions for ${platform}.

Product: ${product}
Script/Key Message: ${script}
Target Audience: ${audience}

--- OUTPUT FORMAT ---

Write 1 caption variations:

**Version A - Short (TikTok/Reels):**
- 2-3 lines max
- Start with ${hookStyle}
- End with CTA
- Include 2-5 hashtags mixing:
  ${product} related + trending Thai hashtags + niche community hashtags

--- RULES ---
- เขียนภาษาไทยแบบพูด ไม่เป็นทางการ
- ห้ามใช้คำว่า "สุดยอด" "เหลือเชื่อ" "ดีที่สุด" (ฟังเหมือนโฆษณา)
- ใช้คำแบบคนรีวิวจริง เช่น "ใช้มาเดือนนึงแล้ว" "ตอนแรกไม่แน่ใจ" "บอกเลยว่าคุ้ม"
- Hashtag ต้องมีทั้งไทยและอังกฤษ
- ห้ามเกินจำนวน hashtag ที่กำหนด`;
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
    const statusBar     = document.getElementById('statusBar');
    const progressFill  = document.querySelector('.progress-fill');
    const statusText    = document.getElementById('statusText');
    const productNameInput = document.getElementById('productName');
    const flowUI  = document.getElementById('flowUI');
    const soraUI  = document.getElementById('soraUI');

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
    ['action2', 'scriptInput', 'platform2', 'pacing2', 'ratioSelect', 'quantitySelect', 'veoModelSelect'].forEach(id => {
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
            script:       document.getElementById('scriptInput').value,
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
        if (d.script)   document.getElementById('scriptInput').value    = d.script;
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
        try {
            const flowTabs = await chrome.tabs.query({ url: 'https://labs.google/*' });
            if (flowTabs.length > 0) chrome.tabs.sendMessage(flowTabs[0].id, { action: 'cancelJob' });
        } catch (e) { /* ignore */ }
        const automationOverlay = document.getElementById('automationOverlay');
        if (automationOverlay) automationOverlay.classList.add('hidden');
        statusBar.classList.add('hidden');
        progressFill.classList.remove('pulse');
        progressFill.style.width = '0%';
        statusText.innerText = 'กำลังสร้างวิดีโอ.. รอสักครู่';
        if (runAllBtn) runAllBtn.disabled = false;
        chrome.storage.local.remove('jobStatus');
        console.log('Automation cancelled by user');
    }

    document.getElementById('statusCancelBtn').addEventListener('click', cancelAutomation);
    document.getElementById('overlayCancelBtn').addEventListener('click', cancelAutomation);

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
            if (runAllBtn) runAllBtn.disabled = true;
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

    settingsBtn.addEventListener('click', () => {
        chrome.storage.local.get(['googleApiKey', 'chatgptApiKey'], (result) => {
            if (result.googleApiKey)  googleApiKeyInput.value  = result.googleApiKey;
            if (result.chatgptApiKey) chatgptApiKeyInput.value = result.chatgptApiKey;
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
        chrome.storage.local.set({
            googleApiKey:  googleApiKeyInput.value.trim(),
            chatgptApiKey: chatgptApiKeyInput.value.trim()
        }, () => {
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
                alert('ไม่พบ Video URL — รัน Test Download ก่อน');
                btn.innerText = '📤 Test TikTok';
                btn.disabled = false;
                return;
            }

            const caption   = document.getElementById('captionInput').value.trim();
            const productId = document.getElementById('productIdInput').value.trim();

            // เปิด/สลับไป TikTok Studio
            await ensureTikTokStudioOpen({ focus: true });
            await new Promise(r => setTimeout(r, 4000));
            await switchToTikTok();

            // หา tab
            const tiktokTabs = await chrome.tabs.query({ url: 'https://www.tiktok.com/tiktokstudio/*' });
            if (tiktokTabs.length === 0) {
                alert('ยังหา TikTok Studio tab ไม่เจอ');
                btn.innerText = '📤 Test TikTok';
                btn.disabled = false;
                return;
            }

            // inject + send
            await sendToTikTok(tiktokTabs[0].id, { action: 'uploadVideo', videoUrl: lastVideoUrl, caption, productId });

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
        runAllBtn.disabled = true;
        progressFill.style.transition = 'none';
        progressFill.style.width = '0%';
        progressFill.classList.add('pulse');
        statusText.innerText = 'กำลังสร้าง Caption...';
        chrome.storage.local.set({ jobStatus: { running: true, step: 0, text: 'กำลังสร้าง Caption...' } });

        try {
            // ── Step A: Build prompts ──────────────────────────────────────
            const imagePrompt = buildStep1Prompt();
            const videoPrompt = buildStep2Prompt();

            // ── Step B: Generate Caption with AI ──────────────────────────
            const captionPromptText = buildStep3Prompt();
            const generatedCaption  = await callAI(captionPromptText, selectedModel, chatgptKey, googleKey, 400);
            document.getElementById('captionInput').value = generatedCaption;
            saveFormData();

            // ── Step C: ตรวจ tab ──────────────────────────────────────────
            await switchToFlow();
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab) {
                alert("No active tab found.");
                runAllBtn.disabled = false;
                if (automationOverlay) automationOverlay.classList.add('hidden');
                statusBar.classList.add('hidden');
                return;
            }
            if (!tab.url || (!tab.url.includes("labs.google") && !tab.url.includes("google.com") && !tab.url.includes("aitestkitchen"))) {
                alert(`Incorrect website.\nDetected URL: ${tab.url}\n\nPlease open Google Labs (labs.google) first.`);
                statusText.innerText = "Incorrect website";
                runAllBtn.disabled = false;
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
                    runAllBtn.disabled = false;
                    statusBar.classList.add('hidden');
                    if (automationOverlay) automationOverlay.classList.add('hidden');
                } else {
                    console.log("Run All — video gen started:", response);
                }
            });

        } catch (error) {
            console.error("Run All error:", error);
            alert("Error: " + error.message);
            runAllBtn.disabled = false;
            if (automationOverlay) automationOverlay.classList.add('hidden');
            statusBar.classList.add('hidden');
            chrome.storage.local.remove('jobStatus');
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
});
