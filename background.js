// ── Import shared task-manager functions ──────────────────────────────────
importScripts('task-manager.js');

// Default popup is set in manifest.json (works on all platforms by default)
// On desktop: clear popup and use side panel instead

chrome.runtime.onInstalled.addListener(async () => {
    await applyUiMode();
});

chrome.runtime.onStartup.addListener(async () => {
    await applyUiMode();
});

async function applyUiMode() {
    // ถ้าไม่มี sidePanel API (mobile browsers) → ใช้ default_popup จาก manifest
    if (!chrome.sidePanel) {
        console.log('📱 No sidePanel API — using default popup');
        return;
    }

    try {
        const { os } = await chrome.runtime.getPlatformInfo();
        const isMobile = os === 'android' || os === 'ios';

        if (isMobile) {
            console.log('📱 Mobile detected — using popup');
            return; // ใช้ default_popup จาก manifest
        }

        // Desktop — เปิด side panel + ล้าง popup
        await chrome.action.setPopup({ popup: '' });
        await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
        console.log('🖥️ Desktop mode: side panel');

        // Scheduler alarm (ทุก 1 นาที)
        chrome.alarms.create('schedulerTick', { periodInMinutes: 1 });

    } catch (e) {
        console.warn('⚠️ applyUiMode error — falling back to popup:', e);
        // fallback: ปล่อยให้ manifest default_popup ทำงาน
    }
}

// ── Pending upload store (logo pre-processed in sidepanel before switching) ───
let pendingUpload = null;  // { base64: dataUrl, mimeType: string }

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'storePendingUpload') {
        pendingUpload = { base64: message.base64, mimeType: message.mimeType };
        sendResponse({ ok: true });
        return true;
    }
    if (message.action === 'consumePendingUpload') {
        const data = pendingUpload;
        pendingUpload = null;
        sendResponse({ data });
        return true;
    }
});

// ── Video fetch relay (cross-origin proxy for TikTok upload) ─────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'fetchVideoAsBase64') {
        fetch(message.url)
            .then(r => r.blob())
            .then(blob => {
                const reader = new FileReader();
                reader.onload = () => sendResponse({ base64: reader.result, type: blob.type });
                reader.readAsDataURL(blob);
            })
            .catch(err => sendResponse({ error: err.message }));
        return true; // keep channel open for async
    }
});

// ── Persist job state so popup can restore after close/reopen ────────────────
chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'progress') {
        chrome.storage.local.set({
            jobStatus: { running: true, step: message.step, text: message.text }
        });
    }
    if (message.action === 'videoReady') {
        chrome.storage.local.set({
            jobStatus: { running: false, done: true, text: 'เสร็จสิ้น!' }
        });
        const TIKTOK_URL = 'https://www.tiktok.com/tiktokstudio/upload?from=creator_center';
        chrome.tabs.query({ url: 'https://www.tiktok.com/tiktokstudio/*' }, (tabs) => {
            if (tabs.length === 0) {
                chrome.tabs.create({ url: TIKTOK_URL, active: false });
            }
        });
    }
    if (message.action === 'videoError') {
        chrome.storage.local.set({
            jobStatus: { running: false, error: message.error }
        });
    }
});

// ── Manual Task Trigger ───────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'runTaskNow') {
        chrome.storage.local.get('tasks', async ({ tasks = [] }) => {
            const task = tasks.find(t => t.id === message.taskId);
            if (!task) { sendResponse({ error: 'ไม่พบ Task' }); return; }

            const logEntry = {
                id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                taskId: task.id,
                scheduleId: 'manual',
                scheduledTime: 'manual',
                triggeredAt: Date.now(),
                finishedAt: null,
                status: 'running',
                error: null
            };
            await tmAppendLog(logEntry);
            console.log(`[Manual] Starting task "${task.name}"`);

            runTaskJob(task, logEntry.id)
                .then(() => sendResponse({ ok: true }))
                .catch(async (err) => {
                    console.error('[Manual] Job failed:', err);
                    await tmUpdateLog(logEntry.id, { status: 'failed', error: err.message, finishedAt: Date.now() });
                    sendResponse({ error: err.message });
                });
        });
        return true; // keep channel open for async
    }
});

// ── Scheduler Engine ─────────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'schedulerTick') {
        await runSchedulerTick().catch(e => console.error('[Scheduler] tick error:', e));
    }
});

async function runSchedulerTick() {
    const now = new Date();
    const HH  = String(now.getHours()).padStart(2, '0');
    const MM  = String(now.getMinutes()).padStart(2, '0');
    const currentTime = `${HH}:${MM}`;

    const { tasks = [], scheduleLogs = [] } = await chrome.storage.local.get(['tasks', 'scheduleLogs']);

    for (const task of tasks) {
        if (!task.isActive) continue;
        for (const schedule of (task.schedules || [])) {
            if (!schedule.isEnabled) continue;
            if (schedule.time !== currentTime) continue;
            if (tmHasRunToday(scheduleLogs, task.id, schedule.id)) continue;

            const logEntry = {
                id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                taskId: task.id,
                scheduleId: schedule.id,
                scheduledTime: schedule.time,
                triggeredAt: Date.now(),
                finishedAt: null,
                status: 'running',
                error: null
            };
            await tmAppendLog(logEntry);
            console.log(`[Scheduler] Starting task "${task.name}" at ${schedule.time}`);
            runTaskJob(task, logEntry.id).catch(async (err) => {
                console.error('[Scheduler] Job failed:', err);
                await tmUpdateLog(logEntry.id, { status: 'failed', error: err.message, finishedAt: Date.now() });
            });
        }
    }
}

// รอ tab โหลดเสร็จ (รองรับกรณี tab ถูก discard แล้วโหลดใหม่)
function bgWaitForTabComplete(tabId, timeoutMs = 30000) {
    return new Promise((resolve) => {
        chrome.tabs.get(tabId, (tab) => {
            if (tab && tab.status === 'complete') { resolve(); return; }
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

// Ping content script จนกว่าจะตอบ (retry ถ้า tab เพิ่งโหลดใหม่)
async function bgWaitForContentScript(tabId, retries = 20, delayMs = 1500) {
    for (let i = 0; i < retries; i++) {
        const ok = await new Promise(resolve => {
            chrome.tabs.sendMessage(tabId, { action: 'ping' }, res => {
                resolve(!chrome.runtime.lastError && res?.pong === true);
            });
        });
        if (ok) {
            console.log(`[Scheduler] Content script ready (attempt ${i + 1})`);
            return;
        }
        console.log(`[Scheduler] Waiting for content script... (${i + 1}/${retries})`);
        await new Promise(r => setTimeout(r, delayMs));
    }
    throw new Error('Content script ไม่ตอบสนอง — กรุณาโหลดหน้า labs.google ใหม่');
}

async function runTaskJob(task, logId) {
    const fd = task.formData || {};
    try {
        const keys = await chrome.storage.local.get(['chatgptApiKey', 'googleApiKey']);
        const model = fd.flowModel || 'gemini';

        // Generate caption
        const rawCaption = await bgCallAI(bgBuildCaptionPrompt(fd), model, keys.chatgptApiKey, keys.googleApiKey, 400);
        const caption = tmCleanCaption(rawCaption);

        // Find labs.google tab
        const flowTabs = await chrome.tabs.query({ url: 'https://labs.google/*' });
        if (flowTabs.length === 0) throw new Error('ไม่พบ labs.google tab — กรุณาเปิด Google Labs ก่อน');
        const tabId = flowTabs[0].id;
        // Reload ก่อนเสมอ เพื่อ reset state ของหน้า
        await chrome.tabs.reload(tabId);
        await bgWaitForTabComplete(tabId);
        await chrome.tabs.update(tabId, { active: true });
        try { await chrome.windows.update(flowTabs[0].windowId, { focused: true }); } catch (_) {}
        await bgWaitForContentScript(tabId);

        // Image generation
        await new Promise((resolve, reject) => {
            chrome.tabs.sendMessage(tabId, {
                action: 'testImageGen',
                prompt: bgBuildImagePrompt(fd),
                faceImageData: fd.faceDataUrl || null,
                productImageData: fd.imageDataUrl || null
            }, (res) => {
                if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                else resolve(res);
            });
        });

        // Wait imageReady
        const generatedImageData = await new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                chrome.runtime.onMessage.removeListener(imgL);
                reject(new Error('Image generation timed out'));
            }, 5 * 60 * 1000);
            const imgL = (msg) => {
                if (msg.action === 'imageReady') {
                    clearTimeout(timer);
                    chrome.runtime.onMessage.removeListener(imgL);
                    chrome.storage.local.get('lastGeneratedImageData', r => resolve(r.lastGeneratedImageData || null));
                }
                if (msg.action === 'videoError') {
                    clearTimeout(timer);
                    chrome.runtime.onMessage.removeListener(imgL);
                    reject(new Error(msg.error || 'Image failed'));
                }
            };
            chrome.runtime.onMessage.addListener(imgL);
        });

        // Auto-generate script with AI (every run, to avoid repetition)
        let expandedScript = '';
        try {
            expandedScript = (await bgCallAI(bgBuildScriptExpandPrompt(fd), model, keys.chatgptApiKey, keys.googleApiKey, 200)).trim();
            console.log('[Scheduler] Script generated:', expandedScript.substring(0, 80) + '...');
        } catch (e) {
            console.warn('[Scheduler] Script generation failed, using brief:', e.message);
            expandedScript = fd.script || '';
        }

        // Video generation
        await new Promise((resolve, reject) => {
            chrome.tabs.sendMessage(tabId, {
                action: 'generateVideo',
                data: {
                    productName: fd.productName || 'product',
                    ratio: fd.ratio || '9:16',
                    quantity: fd.quantity || '1',
                    veoModel: fd.veoModel || '',
                    camera: 'static',
                    script: bgBuildVideoPrompt(fd, expandedScript),
                    imageData: generatedImageData
                }
            }, (res) => {
                if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                else resolve(res);
            });
        });

        // Wait videoReady
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                chrome.runtime.onMessage.removeListener(vidL);
                reject(new Error('Video generation timed out'));
            }, 10 * 60 * 1000);
            const vidL = (msg) => {
                if (msg.action === 'videoReady') {
                    clearTimeout(timer);
                    chrome.runtime.onMessage.removeListener(vidL);
                    resolve();
                }
                if (msg.action === 'videoError') {
                    clearTimeout(timer);
                    chrome.runtime.onMessage.removeListener(vidL);
                    reject(new Error(msg.error || 'Video failed'));
                }
            };
            chrome.runtime.onMessage.addListener(vidL);
        });

        // TikTok upload
        const { lastVideoUrl } = await chrome.storage.local.get('lastVideoUrl');
        if (lastVideoUrl) {
            const TIKTOK_URL = 'https://www.tiktok.com/tiktokstudio/upload?from=creator_center';
            const tiktokTabs = await chrome.tabs.query({ url: 'https://www.tiktok.com/tiktokstudio/*' });
            let tiktokTabId;
            if (tiktokTabs.length > 0) {
                tiktokTabId = tiktokTabs[0].id;
                if (!tiktokTabs[0].url?.includes('/upload')) {
                    // อยู่หน้าอื่นของ TikTok Studio — navigate ไปหน้า upload
                    console.log('[Scheduler] TikTok tab not on upload page — navigating...');
                    await chrome.tabs.update(tiktokTabId, { url: TIKTOK_URL, active: true });
                    await new Promise(r => setTimeout(r, 5000));
                } else {
                    await chrome.tabs.update(tiktokTabId, { active: true });
                }
            } else {
                const newTab = await chrome.tabs.create({ url: TIKTOK_URL, active: true });
                tiktokTabId = newTab.id;
                await new Promise(r => setTimeout(r, 5000));
            }
            try { await chrome.scripting.executeScript({ target: { tabId: tiktokTabId }, files: ['tiktok_content.js'] }); } catch (_) {}
            await new Promise(r => setTimeout(r, 1500));
            await new Promise((resolve, reject) => {
                chrome.tabs.sendMessage(tiktokTabId, {
                    action: 'uploadVideo', videoUrl: lastVideoUrl, caption, productId: fd.productId || ''
                }, (res) => {
                    if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                    else resolve(res);
                });
            });

            // กลับไปหน้า Flow หลังอัปโหลดเสร็จ
            const flowTabs = await chrome.tabs.query({ url: 'https://labs.google/*' });
            if (flowTabs.length > 0) {
                await chrome.tabs.update(flowTabs[0].id, { active: true });
                console.log('[Scheduler] Switched back to Flow after upload');
            }
        }

        await tmUpdateLog(logId, { status: 'success', finishedAt: Date.now() });
        console.log(`[Scheduler] Task "${task.name}" completed successfully`);

    } catch (err) {
        await tmUpdateLog(logId, { status: 'failed', error: err.message, finishedAt: Date.now() });
        throw err;
    }
}

async function bgCallAI(prompt, model, chatgptKey, googleKey, maxTokens = 300) {
    if (model === 'chatgpt') {
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${chatgptKey}` },
            body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }], max_tokens: maxTokens })
        });
        const data = await res.json();
        if (data.choices?.length > 0) return data.choices[0].message.content.trim();
        throw new Error('ChatGPT API Error');
    }
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${googleKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });
    const data = await res.json();
    if (data.candidates?.length > 0 && data.candidates[0].content) return data.candidates[0].content.parts[0].text.trim();
    throw new Error('Gemini API Error');
}

function bgBuildImagePrompt(fd) {
    const gender = fd.gender1 === 'female' ? 'female' : 'male';
    return `Create a realistic candid smartphone photo of a ${gender} Thai person,
using the attached face reference for facial structure and features.

The person is ${fd.action1 || 'holding'} the ${fd.productName || 'product'} shown in the attached product image.

Setting: ${fd.location1 || ''}
Clothing: ${fd.outfit1 || ''}
Expression: ${fd.mood1 || ''}

Camera: shot on smartphone, auto white balance, slight noise in shadows,
not professionally lit. Slightly off-center framing, natural ambient light only.

Style: realistic, not retouched, visible skin texture, no studio lighting,
no perfect symmetry, JPEG compression artifacts, warm Thai daylight tone.
Photo looks like a genuine Shopee or TikTok customer review image.

--- STRICT RULES ---
- The product MUST match the attached product photo exactly in shape, color, size, and detail.
- Background must contain ONLY objects that naturally belong in ${fd.location1 || 'the setting'}.
- Hands and fingers must look natural. 5 fingers per hand, proper grip.
- No text, watermark, or logo unless specified.`;
}

function bgBuildScriptExpandPrompt(fd) {
    const language      = fd.language || 'Thai';
    const specialLine   = fd.specialAction ? `Special Action: ${fd.specialAction}\n` : '';
    const briefLine     = fd.script        ? `Script/Key Message idea: ${fd.script}\n` : '';
    return `You are writing a visual scene description for an 8-second product video in ${language} context.

Product: ${fd.productName || 'product'}
Main Action: ${fd.action2 || 'รีวิวสินค้าต่อหน้ากล้อง'}
${specialLine}${briefLine}
Write a concise 2-4 sentence visual scene description that:
- Describes ONLY what is visually happening (no dialogue, no subtitles, no text)
- Fits naturally within 8 seconds
- Starts with the action, builds interest, ends with product close-up
- Feels authentic and natural for ${language} TikTok UGC style
- Each run should have slightly different visual details to avoid repetition

Output ONLY the scene description. No labels, no explanation.`;
}

function bgBuildVideoPrompt(fd, expandedScript = '') {
    const gender        = fd.gender2 === 'female' ? 'female' : 'male';
    const language      = fd.language || 'Thai';
    const actionLine    = fd.specialAction ? `\nSpecial Action: ${fd.specialAction}` : '';
    const scriptLine    = expandedScript ? `\nScript: ${expandedScript}` : (fd.script ? `\nScript: ${fd.script}` : '');
    return `A ${gender} Thai person,
is ${fd.action2 || 'รีวิวสินค้าต่อหน้ากล้อง'} the ${fd.productName || 'product'}.
${actionLine}

Location: สุ่มตามประเภทตามสินค้า
${scriptLine}

Style: UGC smartphone footage, handheld slightly shaky,
natural ${language} daylight, no cinematic filter, no heavy color grading.
Looks like a real person filming themselves for ${fd.platform2 || 'TikTok'}.

Pacing: ${fd.pacing2 || ''}

--- STRICT RULES ---
- NO text, words, letters, numbers, subtitles, captions, overlays, or watermarks of any kind visible in the video.
- Do NOT render any on-screen graphics, title cards, or burnt-in captions.
- The video must be completely clean — visuals only, zero text.`;
}

function bgBuildCaptionPrompt(fd) {
    return `You are a Thai social media copywriter who writes casual, relatable
product captions for ${fd.platform3 || 'TikTok'}.

Product: ${fd.productName || 'product'}
Script/Key Message: ${fd.captionScript || fd.script || ''}${fd.specialAction ? '\nSpecial Action: ' + fd.specialAction : ''}
Target Audience: ${fd.audience3 || ''}

--- OUTPUT ---
Write ONLY the caption text. No labels, no headers, no version names, no explanations.
Just the caption itself, ready to paste directly.

Requirements:
- 2-3 lines max
- Start with ${fd.hookStyle3 || 'คำถาม'}
- End with CTA
- Include 2-5 hashtags (Thai + English mixed)

--- RULES ---
- เขียนภาษาไทยแบบพูด ไม่เป็นทางการ
- ห้ามใช้คำว่า "สุดยอด" "เหลือเชื่อ" "ดีที่สุด"
- ใช้คำแบบคนรีวิวจริง
- ห้ามมี label หรือ header ใดๆ ทั้งสิ้น`;
}
