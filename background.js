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
