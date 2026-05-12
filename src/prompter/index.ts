// Teleprompter – polished, self-contained, D350 design system, dynamic layout

import Electrobun, { Electroview } from "electrobun/view";
import type { PhotoBoothRPC } from "../bun/index";

const rpc = Electroview.defineRPC<PhotoBoothRPC>({ handlers: { requests: {}, messages: {} } });
const electroview = new Electrobun.Electroview({ rpc });
const bunRpc = electroview.rpc!.request;
const USER_STORAGE_KEY = "studio.currentUserId";

document.body.style.cssText = "margin:0;padding:0;background:#0e120e;color:#d6dac8;height:100vh;width:100vw;font-family:Inter,system-ui;overflow:hidden";
const app = document.getElementById("app")!;
app.style.cssText = "height:100vh;width:100vw;display:flex;flex-direction:column";

app.innerHTML = `
  <!-- Top toolbar -->
  <div id="toolbar" style="display:flex;align-items:center;justify-content:space-between;padding:10px 16px;border-bottom:1px solid #2a2f28;background:#060906;flex-shrink:0;gap:12px;">
    <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0;">
      <div style="font-weight:600;white-space:nowrap;">Teleprompter</div>
      <select id="script-select" style="flex:1;max-width:220px;padding:6px 10px;background:#1a1f1a;color:#d6dac8;border:1px solid #2a2f28;border-radius:4px;font-size:13px;"></select>
      <button id="btn-new" class="tp-btn">New</button>
      <button id="btn-save" class="tp-btn">Save</button>
      <button id="btn-delete" class="tp-btn" style="color:#f66;display:none;">Delete</button>
    </div>

    <div style="display:flex;align-items:center;gap:12px;">
      <!-- Font -->
      <div style="display:flex;align-items:center;gap:6px;">
        <span style="font-size:12px;color:#969b8c;">Size</span>
        <button id="font-dec" class="tp-btn" style="padding:4px 8px;">−</button>
        <span id="font-val" style="min-width:42px;text-align:center;font-variant-numeric:tabular-nums;">28px</span>
        <button id="font-inc" class="tp-btn" style="padding:4px 8px;">+</button>
      </div>

      <!-- Line height -->
      <div style="display:flex;align-items:center;gap:6px;">
        <span style="font-size:12px;color:#969b8c;">Line</span>
        <input type="range" id="line-height" min="1.2" max="2.2" step="0.1" value="1.65" style="width:70px;">
      </div>

      <!-- Speed -->
      <div style="display:flex;align-items:center;gap:6px;">
        <span style="font-size:12px;color:#969b8c;">Speed</span>
        <input type="range" id="speed" min="5" max="150" value="40" style="width:90px;">
        <span id="speed-val" style="font-size:12px;min-width:28px;text-align:right;">40</span>
      </div>

      <!-- Auto scroll -->
      <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;">
        <input type="checkbox" id="auto-scroll">
        <span>Auto</span>
      </label>
      <button id="play-pause" class="tp-btn" style="padding:6px 14px;min-width:64px;">Play</button>

      <button id="btn-fit" class="tp-btn" title="Fit text to window">Fit</button>
      <button id="btn-reset" class="tp-btn">Reset</button>

      <div style="width:1px;height:24px;background:#2a2f28;margin:0 4px;"></div>

      <button id="btn-upload" class="tp-btn">Upload</button>
      <button id="btn-generate" class="tp-btn" style="background:#dd5e2e;color:#1a1a1a;border-color:#dd5e2e;">Generate</button>
    </div>
  </div>

  <!-- Script area -->
  <div style="flex:1;padding:24px 32px;background:#0a0c0a;min-height:0;display:flex;position:relative;">
    <textarea id="script" style="flex:1;width:100%;resize:none;border:1px solid #2a2f28;background:#0a0c0a;color:#d6dac8;font-family:'JetBrains Mono',monospace;font-size:28px;line-height:1.65;padding:24px;border-radius:4px;outline:none;box-sizing:border-box;"></textarea>
  </div>

  <!-- Status -->
  <div style="padding:8px 16px;border-top:1px solid #2a2f28;background:#060906;font-size:12px;color:#969b8c;flex-shrink:0;display:flex;justify-content:space-between;">
    <span id="status">Ready</span>
    <span id="info"></span>
  </div>
`;

const textarea = document.getElementById("script") as HTMLTextAreaElement;
const scriptSelect = document.getElementById("script-select") as HTMLSelectElement;
const statusEl = document.getElementById("status") as HTMLSpanElement;
const infoEl = document.getElementById("info") as HTMLSpanElement;

let currentScriptId: string | null = null;
let scrollInterval: number | null = null;
let isPlaying = false;

// === Helpers ===
function showStatus(msg: string, timeout = 2200) {
  statusEl.textContent = msg;
  if (timeout) setTimeout(() => statusEl.textContent = "Ready", timeout);
}

function currentUserId(): string | null {
  const queryUserId = new URLSearchParams(window.location.search).get("userId");
  if (queryUserId) return queryUserId;
  try {
    return localStorage.getItem(USER_STORAGE_KEY);
  } catch {
    return null;
  }
}

function requireUserId(): string | null {
  const userId = currentUserId();
  if (!userId) showStatus("Sign in from the Studio window first", 4000);
  return userId;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case "\"": return "&quot;";
      case "'": return "&#39;";
      default: return ch;
    }
  });
}

function updateInfo() {
  const words = textarea.value.trim().split(/\s+/).filter(Boolean).length;
  const chars = textarea.value.length;
  infoEl.textContent = `${words} words • ${chars} chars`;
}

textarea.addEventListener("input", () => {
  updateInfo();
  if (currentScriptId) {
    const userId = currentUserId();
    if (!userId) return;
    bunRpc.updateScript({
      userId,
      scriptId: currentScriptId,
      content: textarea.value,
    }).catch(() => {});
  }
});

// === Controls ===
const fontDec = document.getElementById("font-dec") as HTMLButtonElement;
const fontInc = document.getElementById("font-inc") as HTMLButtonElement;
const fontVal = document.getElementById("font-val") as HTMLSpanElement;
const lineHeightSlider = document.getElementById("line-height") as HTMLInputElement;
const speedSlider = document.getElementById("speed") as HTMLInputElement;
const speedVal = document.getElementById("speed-val") as HTMLSpanElement;
const autoCb = document.getElementById("auto-scroll") as HTMLInputElement;
const playPauseBtn = document.getElementById("play-pause") as HTMLButtonElement;
const btnFit = document.getElementById("btn-fit") as HTMLButtonElement;
const btnReset = document.getElementById("btn-reset") as HTMLButtonElement;
const btnUpload = document.getElementById("btn-upload") as HTMLButtonElement;
const btnGenerate = document.getElementById("btn-generate") as HTMLButtonElement;
const btnNew = document.getElementById("btn-new") as HTMLButtonElement;
const btnSave = document.getElementById("btn-save") as HTMLButtonElement;
const btnDelete = document.getElementById("btn-delete") as HTMLButtonElement;

function setFontSize(size: number) {
  const clamped = Math.max(14, Math.min(72, Math.round(size)));
  textarea.style.fontSize = clamped + "px";
  fontVal.textContent = clamped + "px";
  localStorage.setItem("weclank_prompter_fontsize", String(clamped));
}

fontDec.onclick = () => setFontSize(parseInt(textarea.style.fontSize) - 2);
fontInc.onclick = () => setFontSize(parseInt(textarea.style.fontSize) + 2);

lineHeightSlider.oninput = () => {
  textarea.style.lineHeight = lineHeightSlider.value;
};

speedSlider.oninput = () => {
  speedVal.textContent = speedSlider.value;
  if (isPlaying) {
    stopScroll();
    startScroll();
  }
};

function startScroll() {
  stopScroll();
  isPlaying = true;
  playPauseBtn.textContent = "Pause";
  const step = parseFloat(speedSlider.value) / 60;
  scrollInterval = window.setInterval(() => {
    if (textarea.scrollTop + textarea.clientHeight < textarea.scrollHeight - 2) {
      textarea.scrollTop += step;
    } else {
      stopScroll();
      isPlaying = false;
      playPauseBtn.textContent = "Play";
    }
  }, 16);
}

function stopScroll() {
  isPlaying = false;
  playPauseBtn.textContent = "Play";
  if (scrollInterval) {
    clearInterval(scrollInterval);
    scrollInterval = null;
  }
}

playPauseBtn.onclick = () => {
  if (isPlaying) stopScroll();
  else startScroll();
};

autoCb.onchange = () => {
  if (autoCb.checked) startScroll();
  else stopScroll();
};

btnReset.onclick = () => {
  textarea.scrollTop = 0;
  stopScroll();
  autoCb.checked = false;
};

// Fit text to window (simple heuristic)
btnFit.onclick = () => {
  const containerHeight = app.clientHeight - 120; // toolbar + status
  const containerWidth = app.clientWidth - 64;
  const textLength = textarea.value.length || 500;
  let size = Math.floor(Math.sqrt((containerHeight * containerWidth) / textLength) * 1.8);
  size = Math.max(16, Math.min(72, size));
  setFontSize(size);
  showStatus("Auto-fit applied");
};

// === Script management ===
async function loadScriptList() {
  const userId = requireUserId();
  if (!userId) return;
  try {
    const res = await bunRpc.listScripts({ userId });
    if (res.ok && res.scripts) {
      scriptSelect.innerHTML = '<option value="">-- New Script --</option>' +
        res.scripts.map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.title)}</option>`).join("");
    }
  } catch {
    showStatus("Could not load scripts");
  }
}

scriptSelect.onchange = async () => {
  if (!scriptSelect.value) {
    currentScriptId = null;
    textarea.value = "";
    btnDelete.style.display = "none";
    return;
  }
  const userId = requireUserId();
  if (!userId) return;
  try {
    const res = await bunRpc.loadScript({ userId, scriptId: scriptSelect.value });
    if (res.ok && res.script) {
      currentScriptId = res.script.id;
      textarea.value = res.script.content;
      btnDelete.style.display = "inline-block";
      updateInfo();
    }
  } catch {
    showStatus("Could not load script");
  }
};

btnNew.onclick = async () => {
  const userId = requireUserId();
  if (!userId) return;
  const title = prompt("Script title?", "New Script") || "New Script";
  try {
    const res = await bunRpc.saveScript({ userId, title, content: "" });
    if (res.ok && res.id) {
      currentScriptId = res.id;
      textarea.value = "";
      await loadScriptList();
      scriptSelect.value = res.id;
      btnDelete.style.display = "inline-block";
      showStatus("New script created");
    }
  } catch (e) {
    showStatus("Error creating script");
  }
};

btnSave.onclick = async () => {
  const userId = requireUserId();
  if (!userId) return;
  if (!currentScriptId) {
    const title = prompt("Save as...", "My Script") || "My Script";
    try {
      const res = await bunRpc.saveScript({ userId, title, content: textarea.value });
      if (res.ok && res.id) {
        currentScriptId = res.id;
        await loadScriptList();
        scriptSelect.value = res.id;
        btnDelete.style.display = "inline-block";
        showStatus("Saved");
      }
    } catch (e) {
      showStatus("Save failed");
    }
    return;
  }
  try {
    await bunRpc.updateScript({
      userId,
      scriptId: currentScriptId,
      content: textarea.value,
    });
    showStatus("Saved");
  } catch (e) {
    showStatus("Save failed");
  }
};

btnDelete.onclick = async () => {
  if (!currentScriptId) return;
  const userId = requireUserId();
  if (!userId) return;
  if (!confirm("Delete this script?")) return;
  try {
    await bunRpc.deleteScript({ userId, scriptId: currentScriptId });
    currentScriptId = null;
    textarea.value = "";
    btnDelete.style.display = "none";
    scriptSelect.value = "";
    await loadScriptList();
    showStatus("Deleted");
  } catch (e) {
    showStatus("Delete failed");
  }
};

// Upload
btnUpload.onclick = () => {
  const userId = requireUserId();
  if (!userId) return;
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".txt,.md";
  input.onchange = async () => {
    if (!input.files?.[0]) return;
    const content = await input.files[0].text();
    const title = input.files[0].name.replace(/\.[^.]+$/, "");
    try {
      const res = await bunRpc.saveScript({ userId, title, content });
      if (res.ok && res.id) {
        currentScriptId = res.id;
        textarea.value = content;
        await loadScriptList();
        scriptSelect.value = res.id;
        btnDelete.style.display = "inline-block";
        showStatus("Uploaded");
      }
    } catch (e) {
      showStatus("Upload failed");
    }
  };
  input.click();
};

// Generate
btnGenerate.onclick = async () => {
  const userId = requireUserId();
  if (!userId) return;
  const topic = prompt("What should the script be about?");
  if (!topic) return;
  showStatus("Generating...");
  try {
    const res = await bunRpc.generateScript({ userId, topic });
    if (res.ok && res.content) {
      textarea.value = res.content;
      const saveRes = await bunRpc.saveScript({
        userId,
        title: `Generated: ${topic}`,
        content: res.content,
      });
      if (saveRes.ok && saveRes.id) {
        currentScriptId = saveRes.id;
        await loadScriptList();
        scriptSelect.value = saveRes.id;
        btnDelete.style.display = "inline-block";
      }
      showStatus("Generated");
    } else {
      showStatus("Generation failed: " + (res.error || ""));
    }
  } catch (e) {
    showStatus("Generation error");
  }
};

// Dynamic resize handling
function handleResize() {
  // Keep textarea filling available space (flex already does most of it)
  // Could add more advanced logic here if needed
}

window.addEventListener("resize", handleResize);

// Initial setup
(async function init() {
  // Restore font size
  const saved = localStorage.getItem("weclank_prompter_fontsize");
  if (saved) setFontSize(parseInt(saved));
  else setFontSize(28);

  // Initial line height
  textarea.style.lineHeight = lineHeightSlider.value;

  await loadScriptList();
  updateInfo();

  // Keyboard shortcuts
  document.addEventListener("keydown", (e) => {
    if (e.code === "Space" && document.activeElement !== textarea) {
      e.preventDefault();
      if (isPlaying) stopScroll();
      else startScroll();
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      btnSave.click();
    }
  });

  showStatus("Ready");
})();
