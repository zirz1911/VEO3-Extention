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
    const { quantity, ratio } = data;
    const count = parseInt(quantity) || 1;

    // Run only once as requested
    console.log(`Starting generation (single run)...`);

    try {
        // 1. Set Prompt
        if (data.script) {
            await setPrompt(data.script);
        }

        // 2. Select "Frames to Video" Mode
        await selectMode("Frames to Video");

        console.log("Waiting for UI to update after mode selection...");
        await new Promise(r => setTimeout(r, 2000));

        // 3. Click Add File Button and Upload Image
        await clickAddFile(data.imageData);

        // 3.05 Select Crop Ratio (New step before Crop and Save)
        await selectCropRatio(data.ratio);

        // 3.1 Click Crop and Save (New step)
        await clickCropAndSave();

        // 3.2 Select Final Ratio in Settings (Combined step)
        await selectFinalRatio(data.ratio);

        // 3.3 Set Outputs per Prompt (New step)
        await setOutputsPerPrompt(count);

        // 4. Click Generate Button
        // User requested logic: Find by arrow_forward, check disabled, human-like click
        console.log("Waiting for Generate button (enabled check)...");

        while (true) {
            // Find button by icon 'arrow_forward'
            const btn = Array.from(document.querySelectorAll('button')).find(b => {
                const icon = b.querySelector('i');
                return icon && icon.textContent.trim() === 'arrow_forward';
            });

            if (!btn) {
                console.log('⏳ ยังไม่เจอปุ่ม Generate เลย รออีก 300ms…');
                await new Promise(r => setTimeout(r, 300));
                continue;
            }

            // Check if disabled
            const disabled =
                btn.disabled ||
                btn.getAttribute('aria-disabled') === 'true' ||
                btn.className.toLowerCase().includes('disabled') ||
                getComputedStyle(btn).pointerEvents === 'none';

            if (disabled) {
                console.log('⛔ ปุ่มเจอแล้วแต่ยัง disabled (รออัปโหลดเสร็จ) รออีก 500ms…');
                await new Promise(r => setTimeout(r, 500));
                continue;
            }

            console.log('✅ ปุ่มพร้อมแล้ว คลิกเลย!', btn);

            // Click like a human
            ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(type => {
                btn.dispatchEvent(new MouseEvent(type, {
                    bubbles: true,
                    cancelable: true,
                    view: window,
                    button: 0,
                    buttons: 1,
                    composed: true
                }));
            });

            btn.focus();
            break; // Exit loop after clicking
        }

    } catch (error) {
        console.error("Error during generation step:", error);
    }
}

async function setOutputsPerPrompt(count) {
    const target = String(count).trim();
    console.log(`Setting Outputs per Prompt: ${target}...`);

    // 1) Open Settings
    const settingsBtn = Array.from(document.querySelectorAll('button'))
        .find(btn => btn.innerHTML.includes('tune'));

    if (settingsBtn) {
        settingsBtn.click();
        console.log("Clicked Settings button (tune icon) for Outputs");
        await new Promise(r => setTimeout(r, 500));

        // 2) Open "Outputs per prompt" combobox
        const labelSpan = Array.from(document.querySelectorAll('span'))
            .find(el => /outputs per prompt|จำนวนเอาต์พุตต่อพรอมต์/i.test(el.textContent));

        const dropdownBtn = labelSpan?.closest('button');

        if (dropdownBtn) {
            dropdownBtn.click();
            console.log("Clicked Outputs per prompt dropdown");
            await new Promise(r => setTimeout(r, 500));

            // 3) Select option
            const listbox = document.querySelector('[role="listbox"][data-state="open"]');
            if (listbox) {
                const option = Array.from(listbox.querySelectorAll('[role="option"]'))
                    .find(opt => opt.textContent.trim() === target);

                if (option) {
                    option.click();
                    console.log(`Selected Output count: ${target}`);
                    await new Promise(r => setTimeout(r, 500));
                } else {
                    console.warn(`Option '${target}' not found`);
                }
            } else {
                console.warn("Outputs listbox not found");
            }

            // 4) Close Settings
            const settingsBtn2 = Array.from(document.querySelectorAll('button'))
                .find(btn => btn.innerHTML.includes('tune'));
            settingsBtn2?.click();
            console.log("Closed Settings after Outputs");
            await new Promise(r => setTimeout(r, 500));

        } else {
            console.warn("Outputs per prompt dropdown not found");
            // Close settings if we failed to find dropdown but opened settings
            const settingsBtn2 = Array.from(document.querySelectorAll('button'))
                .find(btn => btn.innerHTML.includes('tune'));
            settingsBtn2?.click();
        }
    } else {
        console.warn("Settings button not found for Outputs");
    }
}

async function selectFinalRatio(ratio) {
    console.log(`Selecting Final Ratio (via JS sequence): ${ratio}...`);

    // STEP 1: Open Settings
    const settingsBtn = Array.from(document.querySelectorAll('button'))
        .find(btn => btn.innerHTML.includes('tune'));

    if (settingsBtn) {
        settingsBtn.click();
        console.log("Clicked Settings button (tune icon)");
        await new Promise(r => setTimeout(r, 500)); // Wait for settings to open

        // STEP 2: Open Aspect Ratio Menu
        const ratioLabel = Array.from(document.querySelectorAll('span'))
            .find(el => /aspect ratio|สัดส่วนภาพ/i.test(el.textContent));

        const dropdownBtn = ratioLabel?.closest('button');

        if (dropdownBtn) {
            dropdownBtn.click();
            console.log("Clicked Aspect Ratio dropdown");
            await new Promise(r => setTimeout(r, 500)); // Wait for menu

            // STEP 3: Select Option
            let regex;
            if (ratio === "9:16") {
                regex = /portrait \(9:16\)|แนวตั้ง \(9:16\)/i;
            } else if (ratio === "16:9") {
                regex = /landscape \(16:9\)|แนวนอน \(16:9\)/i;
            } else if (ratio === "1:1") {
                regex = /square \(1:1\)|จัตุรัส \(1:1\)/i;
            }

            if (regex) {
                const optionSpan = Array.from(document.querySelectorAll('span'))
                    .find(el => regex.test(el.textContent));

                const clickable = optionSpan?.closest('[role="option"]') || optionSpan?.parentElement;

                if (clickable) {
                    clickable.click();
                    console.log(`Clicked Final Ratio Option for ${ratio}`);
                } else {
                    console.warn(`Option for ${ratio} not found`);
                }
            } else {
                console.warn(`Unsupported ratio: ${ratio}`);
            }

            await new Promise(r => setTimeout(r, 500)); // Wait before closing

            // STEP 4: Close Settings
            const settingsBtn2 = Array.from(document.querySelectorAll('button'))
                .find(btn => btn.innerHTML.includes('tune'));
            settingsBtn2?.click();
            console.log("Closed Settings");
            await new Promise(r => setTimeout(r, 500));

        } else {
            console.warn("Aspect Ratio dropdown button not found");
        }
    } else {
        console.warn("Settings button (tune icon) not found");
    }
}

async function selectCropRatio(ratio) {
    console.log(`Selecting Crop Ratio: ${ratio || 'Default'}...`);

    // Retry loop for the first element (the ratio dropdown trigger)
    // We search for a button with role="combobox" containing current ratio text
    let btn1 = null;

    for (let i = 0; i < 20; i++) {
        // Try to find by text content (most robust against dynamic IDs)
        const buttons = Array.from(document.querySelectorAll('button[role="combobox"]'));
        btn1 = buttons.find(b =>
            b.textContent.includes('Landscape') ||
            b.textContent.includes('Portrait') ||
            b.textContent.includes('Square') ||
            b.textContent.includes('16:9') ||
            b.textContent.includes('9:16') ||
            b.textContent.includes('1:1')
        );

        if (btn1) break;
        console.log("Waiting for Crop Ratio Button 1...");
        await new Promise(r => setTimeout(r, 500));
    }

    if (btn1) {
        btn1.click();
        console.log("Clicked Crop Ratio Button 1");
        await new Promise(r => setTimeout(r, 1000));

        // User provided logic for finding the option
        // Find the open listbox
        // Selector: [data-radix-popper-content-wrapper] [role="listbox"][data-state="open"]
        const listbox = document.querySelector('[data-radix-popper-content-wrapper] [role="listbox"][data-state="open"]');

        if (listbox) {
            const ratioMap = {
                "9:16": ["portrait", "แนวตั้ง"],
                "16:9": ["landscape", "แนวนอน"],
                "1:1": ["square", "จัตุรัส"]
            };
            const searchTerms = ratioMap[ratio] || ["portrait", "แนวตั้ง"];

            const option = Array.from(listbox.querySelectorAll('[role="option"]'))
                .find(opt => {
                    const text = opt.textContent.trim().toLowerCase();
                    return searchTerms.some(term => text.includes(term));
                });

            if (option) {
                option.click();
                console.log(`Clicked Crop Ratio Option: ${searchTerms[0]}`);
                await new Promise(r => setTimeout(r, 1000));
            } else {
                console.warn(`Crop Ratio Option not found for ${ratio}`);
            }
        } else {
            console.warn("Listbox not found or not open");
        }

    } else {
        console.warn("Crop Ratio Button 1 not found after waiting");
        return; // Stop if first button fails
    }
}

async function clickCropAndSave() {
    console.log("Waiting for Crop and save button...");
    // Retry for a few seconds as the modal might take time to appear
    for (let i = 0; i < 10; i++) {
        // Try user provided XPath first
        const xpath = '//*[@id="radix-:r19:"]/div[2]/div/button[3]';
        let btn = getElementByXPath(xpath);

        // Fallback to text search (case-insensitive)
        if (!btn) {
            btn = findElementByText('button', 'Crop and save') ||
                findElementByText('button', 'Crop and Save') ||
                findElementByText('div', 'Crop and save') ||
                findElementByText('span', 'Crop and save');
        }

        if (btn) {
            // If it's a span/div, click the parent button if possible
            const clickable = btn.tagName === 'BUTTON' ? btn : btn.closest('button') || btn;
            clickable.click();
            console.log("Clicked Crop and save");
            await new Promise(r => setTimeout(r, 2000)); // Wait for processing
            return;
        }
        await new Promise(r => setTimeout(r, 500));
    }
    console.warn("Crop and save button not found");
}

async function setPrompt(text) {
    const textarea = document.getElementById('PINHOLE_TEXT_AREA_ELEMENT_ID');
    if (textarea) {
        textarea.value = text;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        console.log("Set prompt text");
        await new Promise(r => setTimeout(r, 1000));
    } else {
        console.warn("Prompt textarea (PINHOLE_TEXT_AREA_ELEMENT_ID) not found");
    }
}

async function selectMode(modeName) {
    const dropdownTrigger = document.querySelector('button[role="combobox"]');

    if (dropdownTrigger) {
        dropdownTrigger.click();
        console.log("Clicked mode dropdown");
        await new Promise(r => setTimeout(r, 1000));

        let modeOption = null;
        const popupContent = document.getElementById('radix-:rf:') || document.getElementById('radix-:ri:');
        if (popupContent) {
            const firstDiv = popupContent.querySelector('div');
            if (firstDiv && firstDiv.children.length >= 2) {
                modeOption = firstDiv.children[1];
                console.log("Found mode option using user ID structure");
            }
        }

        if (!modeOption) {
            modeOption = findElementByText('div', modeName) ||
                findElementByText('span', modeName);
        }

        if (modeOption) {
            modeOption.click();
            console.log(`Selected mode: ${modeName}`);
            await new Promise(r => setTimeout(r, 1000));
        } else {
            console.warn(`Mode option '${modeName}' not found`);
        }
    } else {
        console.warn("Mode dropdown trigger (combobox) not found");
    }
}

async function clickAddFile(imageData) {
    // Find the 'add' icon and click its parent button
    // The user provided image shows <i ...>add</i>
    const addIcons = Array.from(document.querySelectorAll('i'));
    const addIcon = addIcons.find(el => el.textContent.trim() === 'add');

    if (addIcon) {
        const btn = addIcon.closest('button');
        if (btn) {
            btn.click();
            console.log("Clicked Add File button");
            await new Promise(r => setTimeout(r, 1000)); // Wait for file dialog/input to be ready

            // If we have image data, try to upload it
            if (imageData) {
                console.log("Attempting to upload image...");
                const fileInput = document.querySelector('input[type="file"]');
                if (fileInput) {
                    try {
                        // Convert base64 to Blob
                        const res = await fetch(imageData);
                        const blob = await res.blob();
                        const file = new File([blob], "product_image.png", { type: "image/png" });

                        // Create DataTransfer to set files
                        const dataTransfer = new DataTransfer();
                        dataTransfer.items.add(file);
                        fileInput.files = dataTransfer.files;

                        // Dispatch events
                        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
                        fileInput.dispatchEvent(new Event('input', { bubbles: true }));

                        console.log("Image uploaded successfully");
                        await new Promise(r => setTimeout(r, 2000)); // Wait for upload processing
                    } catch (err) {
                        console.error("Failed to upload image:", err);
                    }
                } else {
                    console.warn("File input element not found");
                }
            }
        } else {
            console.warn("Parent button for 'add' icon not found");
        }
    } else {
        console.warn("'add' icon not found");
    }
}

// Helper to find element by text content
function findElementByText(tag, text) {
    const elements = document.querySelectorAll(tag);
    for (let el of elements) {
        if (el.textContent.includes(text)) {
            return el;
        }
    }
    return null;
}

// Helper to find element by XPath
function getElementByXPath(path) {
    return document.evaluate(path, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
}
