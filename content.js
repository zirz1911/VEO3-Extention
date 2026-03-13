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
        await clickGenerateButton();

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

// ── Step 2: กดอัปโหลดรูปภาพ + inject file ──────────────────────────────────
async function clickUploadImage(imageData) {
    console.log("Step 2: Looking for Upload Image button...");
    const xpath = '//button[.//span[normalize-space(text())="อัปโหลดรูปภาพ" or normalize-space(text())="Upload Image"]]';

    let btn = null;
    for (let i = 0; i < 20; i++) {
        btn = getElementByXPath(xpath);
        if (btn) break;
        console.log("⏳ Upload button not found, retrying...");
        await new Promise(r => setTimeout(r, 500));
    }

    if (!btn) {
        console.warn("⚠️ Upload Image button not found");
        return;
    }

    btn.click();
    console.log("✅ Clicked Upload Image button");
    await new Promise(r => setTimeout(r, 1000));

    if (!imageData) return;

    // Inject image into file input
    const fileInput = document.querySelector('input[type="file"]');
    if (fileInput) {
        try {
            const res = await fetch(imageData);
            const blob = await res.blob();
            const file = new File([blob], "product_image.png", { type: "image/png" });

            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(file);
            fileInput.files = dataTransfer.files;

            fileInput.dispatchEvent(new Event('change', { bubbles: true }));
            fileInput.dispatchEvent(new Event('input', { bubbles: true }));

            console.log("✅ Image injected successfully");
            await new Promise(r => setTimeout(r, 2000));
        } catch (err) {
            console.error("❌ Failed to inject image:", err);
        }
    } else {
        console.warn("⚠️ File input not found after clicking Upload");
    }
}

// ── Step 3: ใส่ Prompt ในช่อง Slate editor ──────────────────────────────────
async function setPromptSlate(text) {
    console.log("Step 3: Looking for Prompt input (Slate)...");
    const xpath = '//span[@data-slate-placeholder="true" and (contains(text(),"คุณต้องการสร้างอะไร") or contains(text(),"What do you want to create"))]';

    let placeholder = null;
    for (let i = 0; i < 20; i++) {
        placeholder = getElementByXPath(xpath);
        if (placeholder) break;
        console.log("⏳ Prompt placeholder not found, retrying...");
        await new Promise(r => setTimeout(r, 500));
    }

    if (!placeholder) {
        console.warn("⚠️ Prompt placeholder not found");
        return;
    }

    // Find the nearest contenteditable parent
    const editable = placeholder.closest('[contenteditable="true"]');
    if (!editable) {
        console.warn("⚠️ contenteditable parent not found");
        return;
    }

    // Focus and replace content
    editable.focus();
    await new Promise(r => setTimeout(r, 300));

    // Select all and insert text (works with Slate)
    document.execCommand('selectAll', false, null);
    document.execCommand('insertText', false, text);

    console.log("✅ Prompt set via execCommand");
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
