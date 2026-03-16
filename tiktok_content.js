// tiktok_content.js
console.log("TikTok Content Script Loaded");

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'uploadVideo') {
        console.log("📤 Upload request received, url:", request.videoUrl);
        uploadVideoToTikTok(request.videoUrl)
            .then(() => sendResponse({ status: 'done' }))
            .catch(err => {
                console.error("❌ Upload error:", err);
                sendResponse({ error: err.message });
            });
        return true;
    }
});

async function uploadVideoToTikTok(videoUrl) {
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
}
