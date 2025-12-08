document.addEventListener('DOMContentLoaded', () => {
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
        const hasImage = productImageInput.files.length > 0;
        const hasName = productNameInput.value.trim().length > 0;
        analyzeBtn.disabled = !(hasImage && hasName);
    };

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
            };
            reader.readAsDataURL(file);
        } else {
            validateForm();
        }
    });

    productNameInput.addEventListener('input', validateForm);

    removeImageBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        productImageInput.value = '';
        imagePreview.src = '';
        imagePreview.classList.add('hidden');
        uploadPlaceholder.classList.remove('hidden');
        removeImageBtn.classList.add('hidden');
        validateForm();
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

        // Gather form data
        const data = {
            productName: document.getElementById('productName').value,
            ratio: document.getElementById('ratioSelect').value,
            quantity: document.getElementById('quantitySelect').value,
            camera: document.querySelector('input[name="camera"]:checked').value,
            script: document.getElementById('scriptInput').value,
            imageData: null
        };

        // Read image if selected
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

        // Visual progress simulation
        let progress = 0;
        const interval = setInterval(() => {
            progress += 5;
            progressFill.style.width = `${progress}%`;

            if (progress >= 100) {
                clearInterval(interval);
                statusText.innerText = "เสร็จสิ้น!";
                setTimeout(() => {
                    statusBar.classList.add('hidden');
                    progressFill.style.width = '0%';
                    statusText.innerText = "กำลังสร้างวิดีโอ.. รอสักครู่";
                    createBtn.disabled = false;
                    cancelBtn.disabled = false;
                }, 2000);
            }
        }, 200);
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
