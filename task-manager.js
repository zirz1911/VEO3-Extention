// ── Task Manager — storage CRUD ───────────────────────────────────────────

async function tmGetTasks() {
    const r = await chrome.storage.local.get('tasks');
    return r.tasks || [];
}

async function tmSaveTask(task) {
    const tasks = await tmGetTasks();
    const idx = tasks.findIndex(t => t.id === task.id);
    if (idx >= 0) tasks[idx] = task;
    else tasks.push(task);
    await chrome.storage.local.set({ tasks });
}

async function tmDeleteTask(id) {
    const tasks = await tmGetTasks();
    await chrome.storage.local.set({ tasks: tasks.filter(t => t.id !== id) });
}

async function tmToggleTaskActive(id) {
    const tasks = await tmGetTasks();
    const task = tasks.find(t => t.id === id);
    if (!task) return false;
    task.isActive = !task.isActive;
    await chrome.storage.local.set({ tasks });
    return task.isActive;
}

async function tmGetLogs(taskId) {
    const r = await chrome.storage.local.get('scheduleLogs');
    const logs = r.scheduleLogs || [];
    return taskId ? logs.filter(l => l.taskId === taskId) : logs;
}

async function tmAppendLog(entry) {
    const r = await chrome.storage.local.get('scheduleLogs');
    const logs = r.scheduleLogs || [];
    logs.push(entry);
    await chrome.storage.local.set({ scheduleLogs: logs.slice(-200) });
}

async function tmUpdateLog(logId, patch) {
    const r = await chrome.storage.local.get('scheduleLogs');
    const logs = (r.scheduleLogs || []).map(l =>
        l.id === logId ? Object.assign({}, l, patch) : l
    );
    await chrome.storage.local.set({ scheduleLogs: logs });
}

function tmHasRunToday(logs, taskId, scheduleId) {
    const today = new Date();
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    return logs.some(l =>
        l.taskId === taskId &&
        l.scheduleId === scheduleId &&
        l.triggeredAt >= startOfDay &&
        (l.status === 'success' || l.status === 'running')
    );
}

function tmCleanCaption(text) {
    return text
        .replace(/^[*\s]*version\b[^\n]*/gim, '')
        .replace(/^\*{1,2}[^\n]+?\*{1,2}:?\s*$/gm, '')
        .replace(/^[A-Za-z0-9 \-–()\/]+:\s*$/gm, '')
        .replace(/^[-–—=\s]+$/gm, '')
        .replace(/\bvideo\b\s*$/im, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}
