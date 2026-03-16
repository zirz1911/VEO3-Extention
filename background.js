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

    } catch (e) {
        console.warn('⚠️ applyUiMode error — falling back to popup:', e);
        // fallback: ปล่อยให้ manifest default_popup ทำงาน
    }
}

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
        // TODO: เปิดใช้งานหลังทดสอบ download เสร็จ
        // const TIKTOK_URL = 'https://www.tiktok.com/tiktokstudio/upload?from=creator_center';
        // chrome.tabs.query({ url: 'https://www.tiktok.com/tiktokstudio/*' }, (tabs) => {
        //     if (tabs.length === 0) {
        //         chrome.tabs.create({ url: TIKTOK_URL, active: false });
        //     }
        // });
    }
    if (message.action === 'videoError') {
        chrome.storage.local.set({
            jobStatus: { running: false, error: message.error }
        });
    }
});
