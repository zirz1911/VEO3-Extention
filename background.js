chrome.runtime.onInstalled.addListener(async () => {
    await applyUiMode();
});

// Re-apply on startup (Kiwi Browser may not fire onInstalled every time)
chrome.runtime.onStartup.addListener(async () => {
    await applyUiMode();
});

async function applyUiMode() {
    const { os } = await chrome.runtime.getPlatformInfo();
    const isMobile = os === 'android' || os === 'ios';

    if (isMobile || !chrome.sidePanel) {
        // Mobile → Popup mode
        await chrome.action.setPopup({ popup: 'sidepanel.html' });
        console.log('📱 Mobile mode: popup');
    } else {
        // Desktop → Side Panel mode
        await chrome.action.setPopup({ popup: '' }); // ล้าง popup ให้ side panel รับแทน
        await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
        console.log('🖥️ Desktop mode: side panel');
    }
}
