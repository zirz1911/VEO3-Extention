// ── Auto Split: เปิด TikTok Studio ตอน extension โหลด ──────────────────────
async function ensureTikTokStudioOpen({ focus = false } = {}) {
    const TIKTOK_URL = 'https://www.tiktok.com/tiktokstudio/upload?from=creator_center';

    const existing = await chrome.tabs.query({ url: 'https://www.tiktok.com/tiktokstudio/*' });
    if (existing.length > 0) {
        console.log('✅ TikTok Studio already open');
        if (focus) await chrome.tabs.update(existing[0].id, { active: true });
        return;
    }

    // เปิดเป็น tab ใหม่ใน window เดิม
    await chrome.tabs.create({ url: TIKTOK_URL, active: focus });
    console.log('✅ TikTok Studio opened as new tab');
}

async function switchToTikTok() {
    const tabs = await chrome.tabs.query({ url: 'https://www.tiktok.com/tiktokstudio/*' });
    if (tabs.length > 0) {
        await chrome.tabs.update(tabs[0].id, { active: true });
        console.log('✅ Switched to TikTok Studio');
    }
}

async function switchToFlow() {
    const tabs = await chrome.tabs.query({ url: 'https://labs.google/*' });
    if (tabs.length > 0) {
        await chrome.tabs.update(tabs[0].id, { active: true });
        console.log('✅ Switched to Flow');
    }
}

// ── Listen for videoReady from content script ────────────────────────────────
chrome.runtime.onMessage.addListener((message) => {
    const statusBar  = document.getElementById('statusBar');
    const statusText = document.getElementById('statusText');
    const progressFill = document.querySelector('.progress-fill');
    const createBtn  = document.getElementById('createBtn');
    const cancelBtn  = document.getElementById('cancelBtn');

    if (message.action === 'progress') {
        statusText.innerText = message.text || 'กำลังทำงาน...';
    }

    if (message.action === 'videoReady') {
        progressFill.classList.remove('pulse');
        progressFill.style.transition = '';
        progressFill.style.width = '100%';
        statusText.innerText = "เสร็จสิ้น! กำลังเปิด TikTok...";

        chrome.storage.local.set({ jobStatus: { running: false, done: true, text: 'เสร็จสิ้น!' } });

        // TODO: เปิดใช้งานหลังทดสอบ download เสร็จ
        // setTimeout(async () => {
        //     await ensureTikTokStudioOpen({ focus: false });
        //     await switchToTikTok();
        // }, 3000);

        setTimeout(() => {
            statusBar.classList.add('hidden');
            progressFill.style.width = '0%';
            statusText.innerText = "กำลังสร้างวิดีโอ.. รอสักครู่";
            createBtn.disabled = false;
            cancelBtn.disabled = false;
            chrome.storage.local.remove('jobStatus');
        }, 3000);
    }

    if (message.action === 'videoError') {
        progressFill.classList.remove('pulse');
        statusText.innerText = `❌ Error: ${message.error}`;
        createBtn.disabled = false;
        cancelBtn.disabled = false;
        chrome.storage.local.set({ jobStatus: { running: false, error: message.error } });
    }
});

function isPopupMode() {
    return !chrome.sidePanel || document.body.classList.contains('popup-mode');
}

document.addEventListener('DOMContentLoaded', () => {
    // Side panel เท่านั้นที่ auto-open TikTok — popup ไม่ทำ (จะปิดตัวเอง)
    if (!isPopupMode()) {
        ensureTikTokStudioOpen();
    }

    // ── TikTok Button ────────────────────────────────────────────────────────
    document.getElementById('tiktokBtn').addEventListener('click', () => {
        ensureTikTokStudioOpen({ focus: true });
    });

    // ── Test Upload Button ───────────────────────────────────────────────────
    document.getElementById('testUploadBtn').addEventListener('click', async () => {
        const btn = document.getElementById('testUploadBtn');
        btn.innerText = '⏳ Uploading...';
        btn.disabled = true;

        try {
            const { lastVideoUrl } = await chrome.storage.local.get('lastVideoUrl');
            if (!lastVideoUrl) {
                alert('ยังไม่มี video URL — กด Test Download ก่อน');
                btn.innerText = '📤 Test Upload';
                btn.disabled = false;
                return;
            }

            const tiktokTabs = await chrome.tabs.query({ url: 'https://www.tiktok.com/tiktokstudio/*' });
            if (tiktokTabs.length === 0) {
                alert('ไม่พบหน้า TikTok Studio — กรุณาเปิดหน้านั้นก่อน');
                btn.innerText = '📤 Test Upload';
                btn.disabled = false;
                return;
            }

            const caption = document.getElementById('scriptInput').value.trim();
            const productId = document.getElementById('productIdInput').value.trim();
            chrome.tabs.sendMessage(tiktokTabs[0].id, { action: 'uploadVideo', videoUrl: lastVideoUrl, caption, productId }, (res) => {
                if (chrome.runtime.lastError) {
                    alert('Error: ' + chrome.runtime.lastError.message);
                }
            });

            setTimeout(() => {
                btn.innerText = '📤 Test Upload';
                btn.disabled = false;
            }, 15000);

        } catch (err) {
            alert('Error: ' + err.message);
            btn.innerText = '📤 Test Upload';
            btn.disabled = false;
        }
    });

    // ── Test Download Button ─────────────────────────────────────────────────
    document.getElementById('testDownloadBtn').addEventListener('click', async () => {
        const btn = document.getElementById('testDownloadBtn');
        btn.innerText = '⏳ Downloading...';
        btn.disabled = true;

        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab || !tab.url?.includes('labs.google')) {
                alert('กรุณาเปิดหน้า labs.google ก่อน');
                return;
            }
            chrome.tabs.sendMessage(tab.id, { action: 'testDownload' }, (res) => {
                if (chrome.runtime.lastError) {
                    alert('Error: ' + chrome.runtime.lastError.message);
                }
            });

            // รอ 5 วิ แล้ว reset ปุ่ม
            setTimeout(() => {
                btn.innerText = '🧪 Test Download';
                btn.disabled = false;
            }, 5000);
        } catch (err) {
            alert('Error: ' + err.message);
            btn.innerText = '🧪 Test Download';
            btn.disabled = false;
        }
    });
    const imageUploadArea = document.getElementById('imageUploadArea');
    const productImageInput = document.getElementById('productImageInput');
    const imagePreview = document.getElementById('imagePreview');
    const uploadPlaceholder = document.getElementById('uploadPlaceholder');
    const removeImageBtn = document.getElementById('removeImageBtn');

    const analyzeBtn = document.getElementById('analyzeBtn');
    const createBtn = document.getElementById('createBtn');
    const cancelBtn = document.getElementById('cancelBtn');
    const statusBar = document.getElementById('statusBar');
    const progressFill = document.querySelector('.progress-fill');
    const statusText = document.getElementById('statusText');

    // Image Upload Logic
    imageUploadArea.addEventListener('click', (e) => {
        if (e.target !== removeImageBtn && !removeImageBtn.contains(e.target)) {
            productImageInput.click();
        }
    });

    // Validation Logic
    const productNameInput = document.getElementById('productName');
    const flowUI = document.getElementById('flowUI');
    const soraUI = document.getElementById('soraUI');

    const validateForm = () => {
        const hasImage = productImageInput.files.length > 0 ||
            (!imagePreview.classList.contains('hidden') && !!imagePreview.src);
        const hasName = productNameInput.value.trim().length > 0;
        analyzeBtn.disabled = !(hasImage && hasName);
    };

    // ── Session persistence: save form + restore on popup reopen ─────────────
    function saveFormData() {
        const imageDataUrl = !imagePreview.classList.contains('hidden') && imagePreview.src
            ? imagePreview.src : null;
        chrome.storage.local.set({ formData: {
            productName: productNameInput.value,
            ratio: document.getElementById('ratioSelect').value,
            quantity: document.getElementById('quantitySelect').value,
            veoModel: document.getElementById('veoModelSelect').value,
            camera: document.querySelector('input[name="camera"]:checked')?.value || 'static',
            script: document.getElementById('scriptInput').value,
            language: document.getElementById('languageSelect').value,
            productId: document.getElementById('productIdInput').value,
            imageDataUrl
        }});
    }

    function restoreFormData(d) {
        if (d.productName) productNameInput.value = d.productName;
        if (d.ratio) document.getElementById('ratioSelect').value = d.ratio;
        if (d.quantity) document.getElementById('quantitySelect').value = d.quantity;
        if (d.veoModel) document.getElementById('veoModelSelect').value = d.veoModel;
        if (d.camera) {
            const r = document.querySelector(`input[name="camera"][value="${d.camera}"]`);
            if (r) r.checked = true;
        }
        if (d.script) document.getElementById('scriptInput').value = d.script;
        if (d.language) document.getElementById('languageSelect').value = d.language;
        if (d.productId) document.getElementById('productIdInput').value = d.productId;
        if (d.imageDataUrl) {
            imagePreview.src = d.imageDataUrl;
            imagePreview.classList.remove('hidden');
            uploadPlaceholder.classList.add('hidden');
            removeImageBtn.classList.remove('hidden');
        }
        validateForm();
    }

    // Restore state when popup opens
    chrome.storage.local.get(['jobStatus', 'formData'], (result) => {
        if (result.formData) restoreFormData(result.formData);
        const js = result.jobStatus;
        if (js?.running) {
            statusBar.classList.remove('hidden');
            progressFill.classList.add('pulse');
            statusText.innerText = js.text || 'กำลังทำงาน...';
            createBtn.disabled = true;
            cancelBtn.disabled = true;
        } else if (js?.done) {
            statusText.innerText = 'เสร็จสิ้น! ✅';
            statusBar.classList.remove('hidden');
            setTimeout(() => {
                statusBar.classList.add('hidden');
                chrome.storage.local.remove('jobStatus');
            }, 3000);
        } else if (js?.error) {
            statusText.innerText = `❌ ${js.error}`;
            statusBar.classList.remove('hidden');
        }
    });

    productImageInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                imagePreview.src = e.target.result;
                imagePreview.classList.remove('hidden');
                uploadPlaceholder.classList.add('hidden');
                removeImageBtn.classList.remove('hidden');
                validateForm();
                saveFormData();
            };
            reader.readAsDataURL(file);
        } else {
            validateForm();
        }
    });

    productNameInput.addEventListener('input', () => { validateForm(); saveFormData(); });

    removeImageBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        productImageInput.value = '';
        imagePreview.src = '';
        imagePreview.classList.add('hidden');
        uploadPlaceholder.classList.remove('hidden');
        removeImageBtn.classList.add('hidden');
        validateForm();
        saveFormData();
    });

    // SORA Image Upload Logic
    const soraImageUploadArea = document.getElementById('soraImageUploadArea');
    const soraImageInput = document.getElementById('soraImageInput');
    const soraImagePreview = document.getElementById('soraImagePreview');
    const soraUploadPlaceholder = document.getElementById('soraUploadPlaceholder');
    const soraRemoveImageBtn = document.getElementById('soraRemoveImageBtn');

    soraImageUploadArea.addEventListener('click', (e) => {
        if (e.target !== soraRemoveImageBtn && !soraRemoveImageBtn.contains(e.target)) {
            soraImageInput.click();
        }
    });

    soraImageInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                soraImagePreview.src = e.target.result;
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

    // Button Logic

    // Platform Menu Logic
    const menuBtn = document.getElementById('menuBtn');
    const platformMenu = document.getElementById('platformMenu');
    const menuItems = document.querySelectorAll('.dropdown-item');

    // Toggle Menu
    menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        platformMenu.classList.toggle('hidden');
    });

    // Handle Menu Item Click
    menuItems.forEach(item => {
        item.addEventListener('click', () => {
            const url = item.dataset.url;
            const text = item.innerText;

            if (url) {
                chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                    if (tabs[0]) {
                        chrome.tabs.update(tabs[0].id, { url: url });
                        platformMenu.classList.add('hidden');
                    }
                });
            }

            // UI Switching Logic
            if (text === 'SORA') {
                flowUI.classList.add('hidden');
                soraUI.classList.remove('hidden');
            } else {
                // Default to Flow for others (Flow, Meta)
                soraUI.classList.add('hidden');
                flowUI.classList.remove('hidden');
            }
        });
    });

    // Close Menu when clicking outside
    document.addEventListener('click', (e) => {
        if (!platformMenu.contains(e.target) && !menuBtn.contains(e.target)) {
            platformMenu.classList.add('hidden');
        }
    });

    // Settings Logic
    const settingsBtn = document.getElementById('settingsBtn');
    const settingsModal = document.getElementById('settingsModal');
    const closeSettingsBtn = document.getElementById('closeSettingsBtn');
    const saveSettingsBtn = document.getElementById('saveSettingsBtn');
    const googleApiKeyInput = document.getElementById('googleApiKey');
    const chatgptApiKeyInput = document.getElementById('chatgptApiKey');

    // Open Settings
    settingsBtn.addEventListener('click', () => {
        // Load saved keys
        chrome.storage.local.get(['googleApiKey', 'chatgptApiKey'], (result) => {
            if (result.googleApiKey) googleApiKeyInput.value = result.googleApiKey;
            if (result.chatgptApiKey) chatgptApiKeyInput.value = result.chatgptApiKey;
        });
        settingsModal.classList.remove('hidden');
    });

    // Close Settings
    closeSettingsBtn.addEventListener('click', () => {
        settingsModal.classList.add('hidden');
    });

    // Close if clicking outside modal content
    settingsModal.addEventListener('click', (e) => {
        if (e.target === settingsModal || e.target.classList.contains('modal-overlay')) {
            settingsModal.classList.add('hidden');
        }
    });

    // Save Settings
    saveSettingsBtn.addEventListener('click', () => {
        const googleApiKey = googleApiKeyInput.value.trim();
        const chatgptApiKey = chatgptApiKeyInput.value.trim();

        chrome.storage.local.set({
            googleApiKey: googleApiKey,
            chatgptApiKey: chatgptApiKey
        }, () => {
            // Visual feedback
            const originalText = saveSettingsBtn.innerText;
            saveSettingsBtn.innerText = 'บันทึกแล้ว!';
            setTimeout(() => {
                saveSettingsBtn.innerText = originalText;
                settingsModal.classList.add('hidden');
            }, 1000);
        });
    });

    // Button Logic
    analyzeBtn.addEventListener('click', async () => {
        const productName = document.getElementById('productName').value || "Product";
        const selectedModel = document.querySelector('input[name="flowModel"]:checked').value;

        // Get API Keys from storage
        chrome.storage.local.get(['chatgptApiKey', 'googleApiKey'], async (result) => {
            const chatgptKey = result.chatgptApiKey;
            const googleKey = result.googleApiKey;

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

            analyzeBtn.innerHTML = '<span class="icon">⏳</span> Generating...';
            analyzeBtn.disabled = true;

            const language = document.getElementById('languageSelect').value;

            const prompt = `Create a single, concise video prompt based on the attached reference image.
Describe the visual scene in one continuous paragraph.
Focus on the subject, action, lighting, and atmosphere matched from the image.
The product is: “${productName}”.
Include a short ${language} spoken line (max 100 chars) for the character.
Do not use scene numbers, lists, or camera directions like "Scene 1". Just the visual description.`;

            try {
                let generatedText = "";

                if (selectedModel === 'chatgpt') {
                    const response = await fetch('https://api.openai.com/v1/chat/completions', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${chatgptKey}`
                        },
                        body: JSON.stringify({
                            model: "gpt-4o-mini",
                            messages: [
                                {
                                    role: "user",
                                    content: prompt
                                }
                            ],
                            max_tokens: 300
                        })
                    });
                    const data = await response.json();
                    if (data.choices && data.choices.length > 0) {
                        generatedText = data.choices[0].message.content.trim();
                    } else {
                        throw new Error("ChatGPT API Error: " + JSON.stringify(data));
                    }
                } else if (selectedModel === 'gemini') {
                    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${googleKey}`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            contents: [{
                                parts: [{
                                    text: prompt
                                }]
                            }]
                        })
                    });
                    const data = await response.json();
                    if (data.candidates && data.candidates.length > 0 && data.candidates[0].content) {
                        generatedText = data.candidates[0].content.parts[0].text.trim();
                    } else {
                        throw new Error("Gemini API Error: " + JSON.stringify(data));
                    }
                }

                if (generatedText) {
                    document.getElementById('scriptInput').value = generatedText;
                    saveFormData();
                }

            } catch (error) {
                console.error("Fetch Error:", error);
                alert("Error connecting to AI service: " + error.message);
            } finally {
                analyzeBtn.innerHTML = '<span class="icon">✨</span> Generate Prompt';
                analyzeBtn.disabled = false;
            }
        });
    });

    createBtn.addEventListener('click', async () => {
        // ... (Existing logic for create video - assumes translation of alerts inside if any)
        // Note: create Video logic seems to rely on content script which might need translation too, 
        // but focusing on sidepanel strings here.
        statusText.innerText = "Processing...";
        statusBar.classList.remove('hidden');
        // ...
    });

    createBtn.addEventListener('click', async () => {
        statusBar.classList.remove('hidden');
        createBtn.disabled = true;
        cancelBtn.disabled = true;
        chrome.storage.local.set({ jobStatus: { running: true, step: 0, text: 'กำลังเริ่มต้น...' } });

        // สลับไปหน้า Flow ให้ content script ทำงานได้
        await switchToFlow();

        // Gather form data
        const data = {
            productName: document.getElementById('productName').value,
            ratio: document.getElementById('ratioSelect').value,
            quantity: document.getElementById('quantitySelect').value,
            veoModel: document.getElementById('veoModelSelect').value,
            camera: document.querySelector('input[name="camera"]:checked').value,
            script: document.getElementById('scriptInput').value,
            imageData: null
        };

        // Read image if selected, fallback to restored session image
        const file = productImageInput.files[0];
        if (file) {
            try {
                data.imageData = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = (e) => resolve(e.target.result);
                    reader.onerror = (e) => reject(e);
                    reader.readAsDataURL(file);
                });
            } catch (err) {
                console.error("Error reading image:", err);
            }
        } else if (imagePreview.src && !imagePreview.classList.contains('hidden')) {
            data.imageData = imagePreview.src; // restored from session
        }

        // Send message to content script
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

            if (!tab) {
                alert("No active tab found.");
                createBtn.disabled = false;
                cancelBtn.disabled = false;
                return;
            }

            if (!tab.url || (!tab.url.includes("labs.google") && !tab.url.includes("google.com") && !tab.url.includes("aitestkitchen"))) {
                alert(`Incorrect website.\nDetected URL: ${tab.url}\n\nPlease use this extension on Google Labs (labs.google) or AI Test Kitchen.`);
                statusText.innerText = "Incorrect website";
                createBtn.disabled = false;
                cancelBtn.disabled = false;
                return;
            }

            chrome.tabs.sendMessage(tab.id, {
                action: "generateVideo",
                data: data
            }, (response) => {
                if (chrome.runtime.lastError) {
                    console.error("Error sending message:", chrome.runtime.lastError);
                    statusText.innerText = "Error: Please refresh the Google Labs page";
                    alert("Connection failed. Please refresh the Google Labs page and try again.");

                    // Reset buttons
                    createBtn.disabled = false;
                    cancelBtn.disabled = false;
                    statusBar.classList.add('hidden');
                } else {
                    console.log("Generation started:", response);
                }
            });
        } catch (err) {
            console.error("Extension error:", err);
            statusText.innerText = "Extension Error";
            createBtn.disabled = false;
            cancelBtn.disabled = false;
        }

        // Progress bar — pulse ไปเรื่อยๆ จนกว่าจะได้รับ videoReady
        progressFill.style.transition = 'none';
        progressFill.style.width = '0%';
        progressFill.classList.add('pulse');
        statusText.innerText = "กำลังสร้างวิดีโอ.. รอสักครู่";
    });

    cancelBtn.addEventListener('click', () => {
        // Reset form or close
        console.log("Cancelled");
    });

    // --- SORA LOGIC ---
    const soraGeneratePromptBtn = document.getElementById('soraGeneratePromptBtn');
    const soraGenerateBtn = document.getElementById('soraGenerateBtn');
    const soraCancelBtn = document.getElementById('soraCancelBtn');

    soraGeneratePromptBtn.addEventListener('click', async () => {
        const character = document.getElementById('soraCharacter').value.trim();
        const decide = document.getElementById('soraDecide').value.trim();
        const style = document.getElementById('soraStyle').value;
        const ratio = document.getElementById('soraRatio').value;
        const selectedModel = document.querySelector('input[name="soraModel"]:checked').value;

        const language = document.getElementById('soraLanguageSelect').value;

        soraGeneratePromptBtn.innerText = 'Generating...';
        soraGeneratePromptBtn.disabled = true;

        // Construct Prompt
        let systemPrompt = "You are an expert video prompt engineer.";
        let userPrompt = `Generate a single, continuous paragraph describing a video based on these details:
Style: ${style}
Ratio: ${ratio}
Decide/Description: ${decide}
Spoken Language: ${language}
`;
        if (character) {
            userPrompt += `Character: ${character}\n`;
        }

        userPrompt += "\nOutput ONLY the prompt description. Do not use 'Scene 1', 'Cut to', or bullet points. Keep it simple and direct.";

        // API Call
        chrome.storage.local.get(['chatgptApiKey', 'googleApiKey'], async (result) => {
            const chatgptKey = result.chatgptApiKey;
            const googleKey = result.googleApiKey;

            if (selectedModel === 'chatgpt' && !chatgptKey) {
                alert("Please set your ChatGPT API Key in settings.");
                soraGeneratePromptBtn.innerText = 'Generate Prompt';
                soraGeneratePromptBtn.disabled = false;
                return;
            }
            if (selectedModel === 'gemini' && !googleKey) {
                alert("Please set your Google API Key in settings.");
                soraGeneratePromptBtn.innerText = 'Generate Prompt';
                soraGeneratePromptBtn.disabled = false;
                return;
            }

            try {
                let generatedText = "";

                if (selectedModel === 'chatgpt') {
                    const response = await fetch('https://api.openai.com/v1/chat/completions', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${chatgptKey}`
                        },
                        body: JSON.stringify({
                            model: "gpt-4o-mini",
                            messages: [
                                { role: "system", content: systemPrompt },
                                { role: "user", content: userPrompt }
                            ],
                            max_tokens: 300
                        })
                    });
                    const data = await response.json();
                    if (data.choices && data.choices.length > 0) {
                        generatedText = data.choices[0].message.content.trim();
                    } else {
                        throw new Error("ChatGPT Error: " + JSON.stringify(data));
                    }
                } else if (selectedModel === 'gemini') {
                    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${googleKey}`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            contents: [{
                                parts: [{
                                    text: systemPrompt + "\n\n" + userPrompt
                                }]
                            }]
                        })
                    });
                    const data = await response.json();
                    if (data.candidates && data.candidates.length > 0 && data.candidates[0].content) {
                        generatedText = data.candidates[0].content.parts[0].text.trim();
                    } else {
                        throw new Error("Gemini Error: " + JSON.stringify(data));
                    }
                }

                if (generatedText) {
                    document.getElementById('soraPromptInput').value = generatedText;
                }

            } catch (error) {
                console.error(error);
                alert("Error generating prompt: " + error.message);
            }

            soraGeneratePromptBtn.innerText = 'Generate Prompt';
            soraGeneratePromptBtn.disabled = false;
        });
    });

    soraGenerateBtn.addEventListener('click', () => {
        // Logic to send prompt to SORA web via content script (placeholder for now as user only requested UI + Prompt Gen)
        console.log("SORA Generate Clicked");
        const prompt = document.getElementById('soraPromptInput').value;
        if (prompt) {
            // Copy to clipboard or auto-fill if we had the content script logic
            navigator.clipboard.writeText(prompt).then(() => {
                alert("Prompt copied to clipboard!");
            });
        }
    });
});
