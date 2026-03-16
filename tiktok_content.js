// tiktok_content.js
console.log("TikTok Content Script Loaded");

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'uploadVideo') {
        console.log("Upload request received, url:", request.videoUrl);
        uploadVideoToTikTok(request.videoUrl, request.caption, request.productId)
            .then(() => sendResponse({ status: 'done' }))
            .catch(err => {
                console.error("Upload error:", err);
                sendResponse({ error: err.message });
            });
        return true;
    }
});

async function dismissTutorialIfPresent() {
    const gotItBtn = Array.from(document.querySelectorAll('.react-joyride__tooltip button'))
        .find(b => b.textContent.trim() === 'Got it');
    if (gotItBtn) {
        gotItBtn.click();
        console.log("Dismissed tutorial tooltip");
        await new Promise(r => setTimeout(r, 500));
    }
}

async function uploadVideoToTikTok(videoUrl, request_caption, productId) {
    await dismissTutorialIfPresent();

    console.log("Fetching video via background...");
    const result = await chrome.runtime.sendMessage({
        action: 'fetchVideoAsBase64',
        url: videoUrl
    });

    if (result.error) throw new Error('Fetch failed: ' + result.error);

    const fetchRes = await fetch(result.base64);
    const blob = await fetchRes.blob();
    const file = new File([blob], 'video.mp4', { type: result.type || 'video/mp4' });
    console.log("File ready:", file.name, Math.round(file.size / 1024) + ' KB');

    let fileInput = document.querySelector('input[type="file"]');

    if (!fileInput) {
        const uploadBtn = document.querySelector('[data-e2e="select_video_button"]');
        if (!uploadBtn) throw new Error('Upload button not found');

        const blocker = (e) => {
            if (e.target.type === 'file') {
                e.preventDefault();
                e.stopImmediatePropagation();
            }
        };
        document.addEventListener('click', blocker, true);
        uploadBtn.click();
        console.log("Clicked upload button (file picker blocked)");
        await new Promise(r => setTimeout(r, 600));
        document.removeEventListener('click', blocker, true);

        fileInput = document.querySelector('input[type="file"]');
    }

    if (!fileInput) throw new Error('File input not found after click');
    console.log("Found file input");

    const dt = new DataTransfer();
    dt.items.add(file);
    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files')?.set;
    if (nativeSetter) nativeSetter.call(fileInput, dt.files);
    else fileInput.files = dt.files;

    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    fileInput.dispatchEvent(new Event('input', { bubbles: true }));
    console.log("File injected into TikTok upload");

    if (request_caption) {
        await new Promise(r => setTimeout(r, 2000));
        await setCaptionText(request_caption);
    }

    await new Promise(r => setTimeout(r, 1000));
    const addAnchorBtn = document.querySelector('.anchor-tag-container button');
    if (addAnchorBtn) {
        addAnchorBtn.click();
        console.log("Clicked Add (anchor)");
        await new Promise(r => setTimeout(r, 1000));
    } else {
        console.warn("Add (anchor) button not found -- skipping");
    }

    if (!await clickTUXButton('Next')) {
        console.warn("Next button not found -- skipping product flow");
        return;
    }
    await new Promise(r => setTimeout(r, 1000));

    if (productId) {
        await fillProductId(productId);
    }

    await clickTUXButton('Next');
    await new Promise(r => setTimeout(r, 3000));

    await clickTUXButton('Add', 30);
    console.log("Product flow complete");
}

// ---------------------------------------------------------------------------
// humanClickTUX — Robust React-compatible click for TikTok Studio (React 17+)
//
// Strategy (in order of attempt):
//   1. Dispatch a full pointer/mouse event sequence with real coordinates so
//      React's delegated listener at the root container picks it up.
//   2. If the element is hidden or has zero rect, try the React fiber tree
//      to find and invoke the onClick handler directly.
//   3. Fallback: el.click()
// ---------------------------------------------------------------------------

function getElementCenter(el) {
    const rect = el.getBoundingClientRect();
    return {
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2),
        rect: rect
    };
}

function buildMouseEventInit(el, extraProps = {}) {
    const { x, y } = getElementCenter(el);
    return {
        bubbles: true,
        cancelable: true,
        composed: true,          // crosses shadow DOM boundaries
        view: window,
        detail: 1,               // click count
        screenX: x,
        screenY: y,
        clientX: x,
        clientY: y,
        pageX: x + window.scrollX,
        pageY: y + window.scrollY,
        button: 0,               // left button
        buttons: 1,              // primary button pressed
        relatedTarget: null,
        ...extraProps
    };
}

function buildPointerEventInit(el, extraProps = {}) {
    return {
        ...buildMouseEventInit(el, extraProps),
        pointerId: 1,
        width: 1,
        height: 1,
        pressure: 0.5,
        tiltX: 0,
        tiltY: 0,
        pointerType: 'mouse',
        isPrimary: true
    };
}

/**
 * Dispatch the full browser event sequence that React 17+ listens for.
 * React attaches a single delegated listener at the root for each event type.
 * By dispatching real DOM events that bubble, React picks them up naturally.
 */
function dispatchFullClickSequence(el) {
    // Ensure the element is visible and in the viewport
    el.scrollIntoView({ block: 'nearest', behavior: 'instant' });

    const pointerInit = buildPointerEventInit(el);
    const mouseInit = buildMouseEventInit(el);

    // Full sequence: pointerdown -> mousedown -> pointerup -> mouseup -> click
    // This matches what a real user click produces.
    el.dispatchEvent(new PointerEvent('pointerdown', pointerInit));
    el.dispatchEvent(new MouseEvent('mousedown', mouseInit));

    el.dispatchEvent(new PointerEvent('pointerup', { ...pointerInit, pressure: 0, buttons: 0 }));
    el.dispatchEvent(new MouseEvent('mouseup', { ...mouseInit, buttons: 0 }));

    el.dispatchEvent(new PointerEvent('click', { ...pointerInit, pressure: 0, buttons: 0 }));
    el.dispatchEvent(new MouseEvent('click', { ...mouseInit, buttons: 0, detail: 1 }));
}

/**
 * Walk up the React fiber tree to find an onClick handler.
 * React 17+ uses __reactFiber$xxx on DOM nodes, and the fiber's
 * memoizedProps contains the onClick if one was passed as a prop.
 */
function tryReactFiberClick(el) {
    const fiberKey = Object.keys(el).find(k => k.startsWith('__reactFiber$'));
    if (!fiberKey) {
        console.log("[humanClickTUX] No __reactFiber$ key found on element");
        return false;
    }

    let fiber = el[fiberKey];
    // Walk up the fiber tree (up to 15 levels) looking for an onClick in memoizedProps
    for (let i = 0; i < 15 && fiber; i++) {
        const props = fiber.memoizedProps;
        console.log(`[humanClickTUX] fiber[${i}] type:`, typeof fiber.type === 'string' ? fiber.type : fiber.type?.name, '| hasOnClick:', !!(props?.onClick));
        if (props && typeof props.onClick === 'function') {
            console.log("[humanClickTUX] Found onClick on fiber at depth", i, "- tag:", fiber.type);
            // Build a synthetic-ish event that satisfies most React handler expectations
            const { x, y } = getElementCenter(el);
            const syntheticEvent = {
                type: 'click',
                target: el,
                currentTarget: fiber.stateNode || el,
                nativeEvent: new MouseEvent('click', buildMouseEventInit(el)),
                bubbles: true,
                cancelable: true,
                defaultPrevented: false,
                clientX: x,
                clientY: y,
                pageX: x + window.scrollX,
                pageY: y + window.scrollY,
                screenX: x,
                screenY: y,
                button: 0,
                buttons: 0,
                detail: 1,
                eventPhase: 3,  // bubbling
                timeStamp: Date.now(),
                isTrusted: false,
                preventDefault: () => { syntheticEvent.defaultPrevented = true; },
                stopPropagation: () => {},
                persist: () => {},
                isDefaultPrevented: () => syntheticEvent.defaultPrevented,
                isPropagationStopped: () => false,
            };
            try {
                props.onClick(syntheticEvent);
                return true;
            } catch (err) {
                console.warn("[humanClickTUX] Fiber onClick threw:", err);
                return false;
            }
        }
        fiber = fiber.return; // go up
    }
    return false;
}

/**
 * Try the __reactProps approach (React 17 createRoot style).
 * This is the old approach but improved: we build a proper event object.
 */
function tryReactPropsClick(el) {
    let node = el;
    for (let i = 0; i < 8; i++) {
        if (!node) break;
        const propsKey = Object.keys(node).find(k => k.startsWith('__reactProps$'));
        if (propsKey && typeof node[propsKey]?.onClick === 'function') {
            console.log("[humanClickTUX] Found onClick on __reactProps at depth", i);
            const { x, y } = getElementCenter(el);
            const nativeEvent = new MouseEvent('click', buildMouseEventInit(el));
            const syntheticEvent = {
                type: 'click',
                target: el,
                currentTarget: node,
                nativeEvent: nativeEvent,
                bubbles: true,
                cancelable: true,
                defaultPrevented: false,
                clientX: x,
                clientY: y,
                button: 0,
                detail: 1,
                timeStamp: Date.now(),
                preventDefault: () => {},
                stopPropagation: () => {},
                persist: () => {},
                isDefaultPrevented: () => false,
                isPropagationStopped: () => false,
            };
            try {
                node[propsKey].onClick(syntheticEvent);
                return true;
            } catch (err) {
                console.warn("[humanClickTUX] __reactProps onClick threw:", err);
            }
        }
        node = node.parentElement;
    }
    return false;
}

function humanClickTUX(el) {
    console.log("[humanClickTUX] Target:", el.tagName, el.className?.substring?.(0, 60));

    // --- Attempt 1: Dispatch a real, full pointer+mouse event sequence ---
    // This is the most reliable approach for React 17+ event delegation.
    // React's root listener will catch the bubbled events and process them
    // just like a real user click.
    try {
        dispatchFullClickSequence(el);
        console.log("[humanClickTUX] Dispatched full click sequence (pointer+mouse events)");
    } catch (err) {
        console.warn("[humanClickTUX] dispatchFullClickSequence failed:", err);
    }

    // We dispatch the real events above. In most cases that is sufficient.
    // But as a belt-and-suspenders approach, also try the fiber/props methods.
    // If the dispatched event already triggered the handler, calling it again
    // via fiber is usually harmless for navigation-type buttons (idempotent).
    // However, to avoid double-firing, we use a small delay and check if
    // the DOM changed (button disappeared = click worked).

    // Give React a microtask to process the dispatched events
    Promise.resolve().then(() => {
        // If the button is still in the DOM and still enabled, try fiber methods
        if (el.isConnected && el.getAttribute('aria-disabled') !== 'true') {
            // Check if DOM actually changed after the dispatched events
            // (give React one animation frame to re-render)
            requestAnimationFrame(() => {
                if (!el.isConnected) {
                    console.log("[humanClickTUX] Button removed from DOM - click succeeded via dispatch");
                    return;
                }
                // Button still there -- try fiber/props as backup
                console.log("[humanClickTUX] Button still in DOM, trying fiber/props backup...");
                if (!tryReactFiberClick(el)) {
                    if (!tryReactPropsClick(el)) {
                        // Final fallback
                        el.click();
                        console.log("[humanClickTUX] Final fallback: native .click()");
                    }
                }
            });
        }
    });
}

// ---------------------------------------------------------------------------
// clickTUXButton — Find and click a TUXButton by label text
// ---------------------------------------------------------------------------
async function clickTUXButton(label, retries = 15) {
    for (let i = 0; i < retries; i++) {
        const btn = Array.from(document.querySelectorAll('.TUXButton--primary'))
            .find(b => b.querySelector('.TUXButton-label')?.textContent.trim() === label
                    && b.getAttribute('aria-disabled') !== 'true');
        if (btn) {
            humanClickTUX(btn);
            console.log("Clicked TUXButton:", label);
            // Give the async backup attempts time to fire if needed
            await new Promise(r => setTimeout(r, 150));
            return true;
        }
        await new Promise(r => setTimeout(r, 300));
    }
    console.warn("TUXButton not found:", label);
    return false;
}

// ---------------------------------------------------------------------------
// simulateReactRadioClick — Click a radio button in React controlled component
//
// React controlled radio inputs need:
// 1. The native value setter to actually change the checked state
// 2. A real event sequence so React's delegation picks it up
// 3. Both 'click' and 'change' events for the controlled component to update
// ---------------------------------------------------------------------------
function simulateReactRadioClick(radio) {
    const { x, y } = getElementCenter(radio);
    const mouseInit = buildMouseEventInit(radio);

    // Focus first
    radio.focus();

    // Use native setter to force checked = true (React controlled components
    // override the setter, so we need the original HTMLInputElement setter)
    const nativeCheckedSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype, 'checked'
    )?.set;
    if (nativeCheckedSetter) {
        nativeCheckedSetter.call(radio, true);
    } else {
        radio.checked = true;
    }

    // Dispatch the full event sequence
    radio.dispatchEvent(new PointerEvent('pointerdown', buildPointerEventInit(radio)));
    radio.dispatchEvent(new MouseEvent('mousedown', mouseInit));
    radio.dispatchEvent(new PointerEvent('pointerup', { ...buildPointerEventInit(radio), pressure: 0, buttons: 0 }));
    radio.dispatchEvent(new MouseEvent('mouseup', { ...mouseInit, buttons: 0 }));
    radio.dispatchEvent(new MouseEvent('click', { ...mouseInit, buttons: 0 }));

    // React listens for 'change' on inputs via delegation
    radio.dispatchEvent(new Event('change', { bubbles: true }));
    radio.dispatchEvent(new Event('input', { bubbles: true }));

    // Also try the fiber approach for onChange
    const fiberKey = Object.keys(radio).find(k => k.startsWith('__reactFiber$'));
    if (fiberKey) {
        let fiber = radio[fiberKey];
        for (let i = 0; i < 10 && fiber; i++) {
            const props = fiber.memoizedProps;
            if (props && typeof props.onChange === 'function') {
                console.log("[radio] Found onChange on fiber at depth", i);
                try {
                    props.onChange({
                        type: 'change',
                        target: radio,
                        currentTarget: radio,
                        nativeEvent: new Event('change', { bubbles: true }),
                        bubbles: true,
                        preventDefault: () => {},
                        stopPropagation: () => {},
                        persist: () => {},
                    });
                } catch (err) {
                    console.warn("[radio] Fiber onChange threw:", err);
                }
                break;
            }
            fiber = fiber.return;
        }
    }

    // Also try __reactProps onChange
    let node = radio;
    for (let i = 0; i < 5; i++) {
        if (!node) break;
        const propsKey = Object.keys(node).find(k => k.startsWith('__reactProps$'));
        if (propsKey && typeof node[propsKey]?.onChange === 'function') {
            console.log("[radio] Found onChange on __reactProps at depth", i);
            try {
                node[propsKey].onChange({
                    type: 'change',
                    target: radio,
                    currentTarget: node,
                    nativeEvent: new Event('change', { bubbles: true }),
                    bubbles: true,
                    preventDefault: () => {},
                    stopPropagation: () => {},
                    persist: () => {},
                });
            } catch (err) {
                console.warn("[radio] __reactProps onChange threw:", err);
            }
            break;
        }
        node = node.parentElement;
    }

    console.log("[radio] Full click+change sequence dispatched, checked:", radio.checked);
}

// ---------------------------------------------------------------------------
// simulateReactInput — Type into a React controlled input
//
// React controlled inputs intercept the native value setter.
// We need the original HTMLInputElement.value setter + input event.
// ---------------------------------------------------------------------------
function simulateReactInput(input, value) {
    input.focus();

    const nativeValueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype, 'value'
    )?.set;

    if (nativeValueSetter) {
        nativeValueSetter.call(input, value);
    } else {
        input.value = value;
    }

    // React 17+ listens for 'input' events via delegation
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));

    // Also try fiber onChange
    const fiberKey = Object.keys(input).find(k => k.startsWith('__reactFiber$'));
    if (fiberKey) {
        let fiber = input[fiberKey];
        for (let i = 0; i < 10 && fiber; i++) {
            const props = fiber.memoizedProps;
            if (props && typeof props.onChange === 'function') {
                console.log("[input] Found onChange on fiber at depth", i);
                try {
                    props.onChange({
                        type: 'change',
                        target: input,
                        currentTarget: input,
                        nativeEvent: new Event('change', { bubbles: true }),
                        bubbles: true,
                        preventDefault: () => {},
                        stopPropagation: () => {},
                        persist: () => {},
                    });
                } catch (err) {
                    console.warn("[input] Fiber onChange threw:", err);
                }
                break;
            }
            fiber = fiber.return;
        }
    }
}

// ---------------------------------------------------------------------------
// fillProductId — Search for product and select radio button
// ---------------------------------------------------------------------------
async function fillProductId(productId) {
    console.log("Searching product:", productId);

    let searchInput = null;
    for (let i = 0; i < 20; i++) {
        searchInput = document.querySelector('input.TUXTextInputCore-input[placeholder="Search products"]');
        if (searchInput) break;
        await new Promise(r => setTimeout(r, 300));
    }
    if (!searchInput) { console.warn("Product search input not found"); return; }

    // Use the React-aware input simulation
    simulateReactInput(searchInput, productId);

    // Also dispatch Enter key
    const enterInit = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
    searchInput.dispatchEvent(new KeyboardEvent('keydown', enterInit));
    searchInput.dispatchEvent(new KeyboardEvent('keypress', enterInit));
    searchInput.dispatchEvent(new KeyboardEvent('keyup', enterInit));
    console.log("Typed product ID + Enter");

    // Wait for search results, then click radio button (retry 5 times)
    for (let attempt = 1; attempt <= 5; attempt++) {
        await new Promise(r => setTimeout(r, attempt === 1 ? 3500 : 2500));

        // Try multiple selectors for the radio -- TikTok may use different markup
        const radio = document.querySelector('input[type="radio"].TUXRadioStandalone-input')
                   || document.querySelector('input[type="radio"]');

        if (radio) {
            // คลิกที่ parent div .TUXRadioStandalone (React handler อยู่ที่นี่ ไม่ใช่ input)
            const radioWrapper = radio.closest('.TUXRadioStandalone') || radio;
            console.log("Clicking radio wrapper:", radioWrapper.className);
            humanClickTUX(radioWrapper);
            await new Promise(r => setTimeout(r, 200));
            // เรียก input events ด้วยเพื่อให้ครบ
            simulateReactRadioClick(radio);
            console.log("Clicked radio button (attempt " + attempt + "):",
                        radio.name?.substring(0, 40) || '(no name)',
                        "| wrapper checked:", radio.checked);
            await new Promise(r => setTimeout(r, 1500));
            return;
        }
        console.log("Radio not found (attempt " + attempt + "/5), retrying...");
    }
    console.warn("Radio button not found after 5 attempts");
}

// ---------------------------------------------------------------------------
// setCaptionText — Set caption in Draft.js editor
// ---------------------------------------------------------------------------
async function setCaptionText(text) {
    console.log("Setting caption...");

    let editor = null;
    for (let i = 0; i < 20; i++) {
        editor = document.querySelector('.public-DraftEditor-content[contenteditable="true"]');
        if (editor) break;
        await new Promise(r => setTimeout(r, 500));
    }

    if (!editor) {
        console.warn("Caption editor not found");
        return;
    }

    editor.focus();
    await new Promise(r => setTimeout(r, 200));

    document.execCommand('selectAll', false, null);
    await new Promise(r => setTimeout(r, 100));
    document.execCommand('insertText', false, text);

    console.log("Caption set:", text.substring(0, 50) + (text.length > 50 ? '...' : ''));
}
