const API_KEY = "";
const MODEL = "gemini-3.5-flash";
const API_URL = ``;

const GREETING_HTML = 
`<img src="ai-image.png" alt="" class="avatar ai-avatar">
  <div class="ai-chat-area">Hello! How can I help you?</div>`;

const promptInput = document.querySelector("#prompt");
const chatContainer = document.querySelector("#chatContainer");
const submitBtn = document.querySelector("#submit");
const imageBtn = document.querySelector("#image");
const imageInput = document.querySelector("#imageInput");
const imagePreview = document.querySelector("#imagePreview");
const previewImg = document.querySelector("#previewImg");
const removeImageBtn = document.querySelector("#removeImage");
const clearChatBtn = document.querySelector("#clearChat");

let chatHistory = [];
let pendingImage = null; 
let isSending = false;

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function scrollToBottom() {
  chatContainer.scrollTo({ top: chatContainer.scrollHeight, behavior: "smooth" });
}
function createChatBox(html, className) {
  const div = document.createElement("div");
  div.innerHTML = html;
  div.className = className;
  return div;
}
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]); // strip data: prefix
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
function renderMarkdown(raw) {
  let text = escapeHtml(raw);
  text = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => `<pre><code>${code.trim()}</code></pre>`);
  text = text.replace(/`([^`]+)`/g, "<code>$1</code>");
  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
  text = text.replace(/(^|[^_])_([^_\n]+)_(?!_)/g, "$1<em>$2</em>");
  text = text.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
  );
  text = text.replace(/^### (.*)$/gm, "<h3>$1</h3>");
  text = text.replace(/^## (.*)$/gm, "<h2>$1</h2>");
  text = text.replace(/^# (.*)$/gm, "<h1>$1</h1>");
  text = text.replace(/(^|\n)((?:- .*(?:\n|$))+)/g, (_, lead, block) => {
    const items = block.trim().split("\n").map((l) => `<li>${l.replace(/^- /, "")}</li>`).join("");
    return `${lead}<ul>${items}</ul>`;
  });
  text = text.replace(/(^|\n)((?:\d+\. .*(?:\n|$))+)/g, (_, lead, block) => {
    const items = block.trim().split("\n").map((l) => `<li>${l.replace(/^\d+\. /, "")}</li>`).join("");
    return `${lead}<ol>${items}</ol>`;
  });

  const blocks = text.split(/\n{2,}/).map((block) => {
    if (/<pre>/.test(block)) return block;

    const isBlockLine = (l) => /^\s*<(h1|h2|h3|ul|ol)/.test(l);
    let out = "";
    let buffer = [];
    const flush = () => {
      if (buffer.length) {
        out += `<p>${buffer.join("<br>")}</p>`;
        buffer = [];
      }
    };
    block.split("\n").forEach((line) => {
      if (isBlockLine(line)) {
        flush();
        out += line;
      } else if (line.trim() === "") {
        flush();
      } else {
        buffer.push(line);
      }
    });
    flush();
    return out;
  });

  return blocks.join("");
}

function appendUserMessage(text, image) {
  const safeText = text ? escapeHtml(text) : "";
  const imageHtml = image ? `<img src="${image.previewUrl}" alt="Attached image" class="attached-image">` : "";
  const textHtml = safeText ? `<p>${safeText}</p>` : "";

  const html = `
    <img src="user-image.png" alt="" class="avatar user-avatar">
    <div class="user-chat-area">${imageHtml}${textHtml}</div>
  `;
  chatContainer.appendChild(createChatBox(html, "user-chat-box"));
  scrollToBottom();
}

function appendLoadingBox() {
  const html = `
    <img src="ai-image.png" alt="" class="avatar ai-avatar">
    <div class="ai-chat-area"><div class="spinner"></div></div>
  `;
  const box = createChatBox(html, "ai-chat-box");
  chatContainer.appendChild(box);
  scrollToBottom();
  return box;
}

function renderAiMessage(box, text) {
  box.querySelector(".ai-chat-area").innerHTML = renderMarkdown(text);
  scrollToBottom();
}

function renderAiError(box, message) {
  box.querySelector(".ai-chat-area").innerHTML = `<p class="error-text">${escapeHtml(message)}</p>`;
  scrollToBottom();
}

async function generateResponse() {
  if (!API_KEY || API_KEY === "") {
    throw new Error("No API key set. Open project.js and set your Gemini API key.");
  }

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": API_KEY,
    },
    body: JSON.stringify({ contents: chatHistory }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Gemini API error (${res.status}). ${detail}`.trim());
  }

  const data = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map((p) => p.text || "").join("").trim();

  if (!text) throw new Error("The API returned an empty response.");
  return text;
}
async function sendMessage() {
  const text = promptInput.value.trim();
  if (!text && !pendingImage) return;
  if (isSending) return;

  isSending = true;
  submitBtn.disabled = true;

  appendUserMessage(text, pendingImage);

  const parts = [];
  if (text) parts.push({ text });
  if (pendingImage) {
    parts.push({ inline_data: { mime_type: pendingImage.mimeType, data: pendingImage.data } });
  }
  chatHistory.push({ role: "user", parts });

  promptInput.value = "";
  clearPendingImage();

  const aiBox = appendLoadingBox();

  try {
    const responseText = await generateResponse();
    chatHistory.push({ role: "model", parts: [{ text: responseText }] });
    renderAiMessage(aiBox, responseText);
  } catch (err) {
    console.error(err);
    // Roll back the failed turn so a retry doesn't confuse the model with a
    // dangling, unanswered user message.
    chatHistory.pop();
    renderAiError(aiBox, "Sorry — I couldn't reach the AI just now. Please try again.");
  } finally {
    isSending = false;
    submitBtn.disabled = false;
    promptInput.focus();
  }
}
function clearPendingImage() {
  pendingImage = null;
  imageInput.value = "";
  imagePreview.hidden = true;
  previewImg.src = "";
}
imageBtn.addEventListener("click", () => imageInput.click());
imageInput.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    alert("Please choose an image file.");
    imageInput.value = "";
    return;
  }
  const base64 = await fileToBase64(file);
  pendingImage = {
    mimeType: file.type,
    data: base64,
    previewUrl: URL.createObjectURL(file),
  };
  previewImg.src = pendingImage.previewUrl;
  imagePreview.hidden = false;
});
removeImageBtn.addEventListener("click", clearPendingImage);
clearChatBtn.addEventListener("click", () => {
  if (chatHistory.length === 0) return;
  if (!confirm("Clear the entire conversation? This can't be undone.")) return;

  chatHistory = [];
  clearPendingImage();
  chatContainer.innerHTML = "";
  chatContainer.appendChild(createChatBox(GREETING_HTML, "ai-chat-box"));
});
submitBtn.addEventListener("click", sendMessage);
promptInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    sendMessage();
  }
});
