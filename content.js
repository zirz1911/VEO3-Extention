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

// ── Step 2: inject file เข้า React file input (ใช้ native setter) ────────────
async function clickUploadImage(imageData) {
    console.log("Step 2: Injecting image via React-compatible file input...");

    if (!imageData) {
        console.warn("⚠️ No imageData provided");
        return;
    }

    // รอ file input ปรากฏใน DOM
    let fileInput = null;
    for (let i = 0; i < 20; i++) {
        fileInput = document.querySelector('input[type="file"]');
        if (fileInput) break;
        console.log("⏳ File input not found, retrying...");
        await new Promise(r => setTimeout(r, 500));
    }

    if (!fileInput) {
        console.warn("⚠️ File input not found");
        return;
    }

    try {
        const res = await fetch(imageData);
        const blob = await res.blob();
        const file = new File([blob], "product_image.png", { type: "image/png" });

        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);

        // ใช้ native property setter ของ HTMLInputElement เพื่อให้ React รับรู้
        const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files')?.set;
        if (nativeSetter) {
            nativeSetter.call(fileInput, dataTransfer.files);
            console.log("✅ Set files via native setter");
        } else {
            fileInput.files = dataTransfer.files;
        }

        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
        fileInput.dispatchEvent(new Event('input', { bubbles: true }));

        console.log("✅ Image injected successfully");
        await new Promise(r => setTimeout(r, 5000));
    } catch (err) {
        console.error("❌ Failed to inject image:", err);
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

    // หา contenteditable parent
    const editable = placeholder.closest('[contenteditable="true"]');
    if (!editable) {
        console.warn("⚠️ contenteditable parent not found");
        return;
    }

    // Click เพื่อ focus + วาง cursor
    editable.click();
    editable.focus();
    await new Promise(r => setTimeout(r, 300));

    // Select all content เดิมแล้วลบ
    document.execCommand('selectAll', false, null);
    await new Promise(r => setTimeout(r, 100));

    // ใส่ text ผ่าน beforeinput event (Slate รับ inputType='insertText')
    const inputEvent = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: text,
    });
    editable.dispatchEvent(inputEvent);
    await new Promise(r => setTimeout(r, 200));

    // Fallback: execCommand ถ้า beforeinput ไม่ work
    if (!editable.textContent.trim()) {
        console.log("⚠️ beforeinput fallback to execCommand");
        document.execCommand('insertText', false, text);
    }

    console.log("✅ Prompt inserted:", text.substring(0, 40) + "...");
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
