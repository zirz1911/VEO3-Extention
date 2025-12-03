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

    // Button Logic
    // Button Logic
    analyzeBtn.addEventListener('click', async () => {
        const productName = document.getElementById('productName').value || "สินค้า";
        const apiKey = "YOUR_OPENAI_API_KEY";

        analyzeBtn.innerHTML = '<span class="icon">⏳</span> Generating...';
        analyzeBtn.disabled = true;

        const prompt = `A high-quality cinematic commercial shot based on the attached reference image.
Recreate the scene with the same camera angle, subject position, lighting style, color tone, and atmosphere as shown in the image.
The person in the video should match the appearance and clothing style from the attached photo, acting naturally and confidently on camera.
The product being promoted is: “${productName}”.
Generate a short Thai spoken line (maximum 100 characters) that naturally introduces or recommends the product.
The person speaks this exact generated line clearly and warmly.
Use professional soft lighting, realistic textures, natural skin detail, and 4K commercial quality.
Shallow depth of field, smooth camera motion, and high dynamic range.
Overall look should be realistic, premium, and visually appealing.`;

        try {
            const response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
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
                const generatedText = data.choices[0].message.content.trim();
                document.getElementById('scriptInput').value = generatedText;
            } else {
                console.error("API Error:", data);
                alert("Failed to generate prompt. Please try again.");
            }

        } catch (error) {
            console.error("Fetch Error:", error);
            alert("Error connecting to AI service.");
        } finally {
            analyzeBtn.innerHTML = '<span class="icon">✨</span> Generate Prompt';
            analyzeBtn.disabled = false;
        }
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
});
