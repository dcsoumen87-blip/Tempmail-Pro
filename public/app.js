const $ = (id) => document.getElementById(id);

let currentInbox = null;
let refreshTimer = null;
let countdownTimer = null;
let otpValue = null;

function showToast(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.add("show");

  setTimeout(() => {
    toast.classList.remove("show");
  }, 2500);
}

function formatTime(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const hours = String(Math.floor(seconds / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
  const secs = String(seconds % 60).padStart(2, "0");

  return `${hours}:${minutes}:${secs}`;
}

async function apiRequest(url, options = {}) {
  const response = await fetch(url, options);

  if (response.status === 204) {
    return null;
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }

  return data;
}

function resetOtp() {
  otpValue = null;
  $("otpCode").textContent = "------";
  $("copyOtpBtn").disabled = true;
}

function stopTimers() {
  clearInterval(refreshTimer);
  clearInterval(countdownTimer);

  refreshTimer = null;
  countdownTimer = null;
}

function resetInbox() {
  currentInbox = null;
  stopTimers();
  resetOtp();

  $("emailAddress").textContent = "Generate an email to start";
  $("timer").textContent = "--:--:--";
  $("copyEmailBtn").disabled = true;
  $("refreshBtn").disabled = true;
  $("deleteBtn").disabled = true;

  $("inboxStatus").textContent =
    "Generate an email to check your inbox.";

  $("messageList").replaceChildren();
}

async function generateEmail() {
  const button = $("generateBtn");

  button.disabled = true;
  button.textContent = "Generating...";

  try {
    if (currentInbox) {
      await apiRequest(`/api/inboxes/${encodeURIComponent(currentInbox.id)}`, {
        method: "DELETE"
      }).catch(() => {});
    }

    const inbox = await apiRequest("/api/inboxes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({})
    });

    currentInbox = inbox;
    resetOtp();

    $("emailAddress").textContent = inbox.address;
    $("copyEmailBtn").disabled = false;
    $("refreshBtn").disabled = false;
    $("deleteBtn").disabled = false;

    $("inboxStatus").textContent = "Checking for incoming messages...";

    startCountdown();
    await loadInbox();

    refreshTimer = setInterval(() => {
      loadInbox().catch((error) => showToast(error.message));
    }, 10000);

    showToast("Temporary email created!");
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
    button.textContent = "＋ Generate Email";
  }
}

function startCountdown() {
  clearInterval(countdownTimer);

  const tick = () => {
    if (!currentInbox) return;

    const remaining = currentInbox.expiresAt - Date.now();

    $("timer").textContent = formatTime(remaining);

    if (remaining <= 0) {
      resetInbox();
      $("inboxStatus").textContent = "Inbox expired. Generate a new email.";
      showToast("Inbox expired");
    }
  };

  tick();
  countdownTimer = setInterval(tick, 1000);
}

async function loadInbox() {
  if (!currentInbox) return;

  const inboxId = currentInbox.id;

  const data = await apiRequest(
    `/api/inboxes/${encodeURIComponent(inboxId)}/messages`
  );

  if (!currentInbox || currentInbox.id !== inboxId) return;

  const messages = data.messages || [];

  $("inboxStatus").textContent = messages.length
    ? `${messages.length} message(s) received`
    : "No messages yet. Checking automatically.";

  const list = $("messageList");
  list.replaceChildren();

  if (messages.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "Your inbox is empty.";
    list.appendChild(empty);
    resetOtp();
    return;
  }

  // Auto-detect OTP from the newest message that has one
  const latestOtp = messages.find((m) => m.otp)?.otp;
  if (latestOtp && latestOtp !== otpValue) {
    otpValue = latestOtp;
    $("otpCode").textContent = latestOtp;
    $("copyOtpBtn").disabled = false;
    showToast("OTP detected!");
  }

  for (const message of messages) {
    const card = document.createElement("div");
    card.className = "message";

    const subject = document.createElement("strong");
    subject.textContent = message.subject || "(No subject)";

    const sender = document.createElement("p");
    sender.className = "muted";
    sender.textContent = `From: ${message.from}`;

    const preview = document.createElement("p");
    preview.textContent = message.intro || "";

    const openButton = document.createElement("button");
    openButton.textContent = "Open message";

    openButton.addEventListener("click", () => {
      readMessage(message.id);
    });

    card.append(subject, sender, preview, openButton);
    list.appendChild(card);
  }
}

async function readMessage(messageId) {
  if (!currentInbox) return;

  try {
    const inboxId = currentInbox.id;

    const message = await apiRequest(
      `/api/inboxes/${encodeURIComponent(inboxId)}/messages/${encodeURIComponent(messageId)}`
    );

    if (!currentInbox || currentInbox.id !== inboxId) return;

    const otp = message.otp;

    $("inboxStatus").textContent =
      `Opened: ${message.subject || "(No subject)"}`;

    if (otp) {
      otpValue = otp;
      $("otpCode").textContent = otp;
      $("copyOtpBtn").disabled = false;
      showToast("Possible OTP detected!");
    } else {
      resetOtp();
      showToast("No recognizable OTP found.");
    }
  } catch (error) {
    showToast(error.message);
  }
}

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
    showToast("Copied!");
  } catch {
    showToast("Copy failed. Please copy manually.");
  }
}

$("generateBtn").addEventListener("click", generateEmail);

$("copyEmailBtn").addEventListener("click", () => {
  if (currentInbox) copyText(currentInbox.address);
});

$("copyOtpBtn").addEventListener("click", () => {
  if (otpValue) copyText(otpValue);
});

$("refreshBtn").addEventListener("click", () => {
  loadInbox()
    .then(() => showToast("Inbox refreshed"))
    .catch((error) => showToast(error.message));
});

$("deleteBtn").addEventListener("click", async () => {
  if (!currentInbox) return;

  const id = currentInbox.id;

  try {
    await apiRequest(`/api/inboxes/${encodeURIComponent(id)}`, {
      method: "DELETE"
    });
  } catch {}

  resetInbox();
  showToast("Inbox deleted");
});

$("themeBtn").addEventListener("click", () => {
  document.body.classList.toggle("dark");

  const dark = document.body.classList.contains("dark");

  $("themeBtn").textContent = dark ? "☀️" : "🌙";

  localStorage.setItem("tempmail-theme", dark ? "dark" : "light");
});

if (localStorage.getItem("tempmail-theme") === "dark") {
  document.body.classList.add("dark");
  $("themeBtn").textContent = "☀️";
}
