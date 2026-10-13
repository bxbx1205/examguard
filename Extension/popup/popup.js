// ============================================================
// ExamGuard Sentinel
// Popup Controller
// ============================================================

const API_BASE_URL = "http://localhost:8080/api/v1";

// ------------------------------------------------------------
// DOM Elements
// ------------------------------------------------------------

const examKeyInput = document.getElementById("examKey");
const studentIdInput = document.getElementById("studentId");
const secretPinInput = document.getElementById("secretPin");
const loginButton = document.getElementById("loginButton");
const loginStatus = document.getElementById("loginStatus");
const statusElement = document.getElementById("status");
const startButton = document.getElementById("startExam");
const stopButton = document.getElementById("stopExam");
const testHardwareButton = document.getElementById("testHardware");

const cameraStatusIcon = document.getElementById("cameraStatusIcon");
const cameraStatusText = document.getElementById("cameraStatusText");
const micStatusIcon = document.getElementById("micStatusIcon");
const micStatusText = document.getElementById("micStatusText");

// ------------------------------------------------------------
// Update Exam Status
// ------------------------------------------------------------

function updateStatus(isActive) {
    if (isActive) {
        statusElement.textContent = "Exam Active";
        statusElement.className = "status active";
    } else {
        statusElement.textContent = "Exam Not Started";
        statusElement.className = "status inactive";
    }
}

// ------------------------------------------------------------
// Update Login Status
// ------------------------------------------------------------

function updateLoginStatus(message, success = false) {
    loginStatus.textContent = message;
    loginStatus.style.color = success ? "#10b981" : "#ef4444";
}

// ------------------------------------------------------------
// Hardware Diagnostics (Webcam & Microphone Detection)
// ------------------------------------------------------------

async function checkHardwareDevices() {
    try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
            if (cameraStatusText) cameraStatusText.textContent = "Media API unavailable";
            return;
        }

        const devices = await navigator.mediaDevices.enumerateDevices();
        const hasCamera = devices.some(d => d.kind === "videoinput");
        const hasMic = devices.some(d => d.kind === "audioinput");

        if (cameraStatusText && cameraStatusIcon) {
            if (hasCamera) {
                cameraStatusIcon.textContent = "📷";
                cameraStatusText.textContent = "Camera Ready";
                cameraStatusText.style.color = "#10b981";
            } else {
                cameraStatusIcon.textContent = "⚠️";
                cameraStatusText.textContent = "No Camera Detected";
                cameraStatusText.style.color = "#ef4444";
            }
        }

        if (micStatusText && micStatusIcon) {
            if (hasMic) {
                micStatusIcon.textContent = "🎙️";
                micStatusText.textContent = "Mic Ready";
                micStatusText.style.color = "#10b981";
            } else {
                micStatusIcon.textContent = "⚠️";
                micStatusText.textContent = "No Mic Detected";
                micStatusText.style.color = "#ef4444";
            }
        }
    } catch (e) {
        console.warn("[ExamGuard Popup] Device enumeration error:", e);
    }
}

// ------------------------------------------------------------
// Load Existing State
// ------------------------------------------------------------

chrome.storage.local.get(
    ["examActive", "authToken", "studentId", "examId", "studentName"],
    (result) => {
        updateStatus(result.examActive === true);

        if (result.authToken) {
            updateLoginStatus(
                `Logged in: ${result.studentName || "Student " + (result.studentId || "50")}`,
                true
            );
        } else {
            updateLoginStatus("Not logged in", false);
        }
    }
);

checkHardwareDevices();

// ------------------------------------------------------------
// Perform Student Login
// ------------------------------------------------------------

async function performLogin() {
    const examKey = examKeyInput.value.trim();
    const studentId = studentIdInput.value.trim();
    const secretPin = secretPinInput.value.trim();

    if (!examKey || !studentId || !secretPin) {
        updateLoginStatus("Please fill all fields.");
        throw new Error("Missing required fields");
    }

    loginButton.disabled = true;
    loginButton.textContent = "Logging in...";

    try {
        console.log("[ExamGuard Popup] Sending student login request");

        const response = await fetch(`${API_BASE_URL}/auth/student/login`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                exam_key: examKey,
                student_id: studentId,
                secret_pin: secretPin
            })
        });

        const data = await response.json();
        console.log("[ExamGuard Popup] Login response:", data);

        if (!response.ok || !data.success) {
            const errorMsg = data?.error?.message || "Invalid credentials";
            throw new Error(errorMsg);
        }

        if (!data.token) {
            throw new Error("Login succeeded but no token returned");
        }

        const student = data.student || {};
        await chrome.storage.local.set({
            authToken: data.token,
            studentId: student.student_id || studentId,
            examId: student.exam_id || examKey,
            studentName: student.name || `Student ${studentId}`
        });

        updateLoginStatus(`Logged in: ${student.name || studentId}`, true);
        console.log("[ExamGuard Popup] Login successful");
        return data;

    } catch (error) {
        console.error("[ExamGuard Popup] Login failed:", error);
        updateLoginStatus(error.message || "Login failed");
        throw error;
    } finally {
        loginButton.disabled = false;
        loginButton.textContent = "Login";
    }
}

loginButton.addEventListener("click", () => {
    performLogin().catch(() => {});
});

// ------------------------------------------------------------
// Test Hardware / Launch Proctoring Screen
// ------------------------------------------------------------

if (testHardwareButton) {
    testHardwareButton.addEventListener("click", () => {
        chrome.tabs.create({
            url: chrome.runtime.getURL("camera-test/index.html")
        });
    });
}

// ------------------------------------------------------------
// Start Exam
// ------------------------------------------------------------

startButton.addEventListener("click", async () => {
    console.log("[ExamGuard Popup] Start Exam clicked");

    let auth = await chrome.storage.local.get(["authToken", "examId", "studentId", "studentName"]);

    // If not yet logged in, attempt seamless auto-login with input credentials
    if (!auth.authToken) {
        try {
            await performLogin();
            auth = await chrome.storage.local.get(["authToken", "examId", "studentId", "studentName"]);
        } catch (loginErr) {
            updateLoginStatus("Please enter valid credentials to start exam.");
            return;
        }
    }

    try {
        // 1. Tell background service worker to connect authenticated WebSocket
        const bgResponse = await chrome.runtime.sendMessage({
            action: "START_EXAM"
        });
        console.log("[ExamGuard Popup] START_EXAM signaled to background:", bgResponse);

        // 2. Determine target tab for exam proctoring
        const tabs = await chrome.tabs.query({
            active: true,
            currentWindow: true
        });

        const activeTab = tabs[0];
        const tabUrl = activeTab?.url || "";
        const isRestrictedUrl = !tabUrl ||
            tabUrl.startsWith("chrome://") ||
            tabUrl.startsWith("chrome-extension://") ||
            tabUrl.startsWith("edge://") ||
            tabUrl.startsWith("about:") ||
            tabUrl.startsWith("view-source:");

        if (isRestrictedUrl) {
            // Cannot run content scripts on Chrome internal pages (e.g. chrome://extensions).
            // Launch dedicated exam proctoring portal tab where camera HUD & MediaPipe run live!
            console.log("[ExamGuard Popup] Internal tab detected. Launching dedicated proctoring portal...");
            await chrome.tabs.create({
                url: chrome.runtime.getURL("camera-test/index.html"),
                active: true
            });
        } else if (activeTab && activeTab.id) {
            // On regular web page (http:// or https://):
            try {
                await chrome.tabs.sendMessage(activeTab.id, {
                    action: "START_EXAM"
                });
                console.log("[ExamGuard Popup] Lockdown successfully activated on active tab:", activeTab.id);
            } catch (msgErr) {
                console.log("[ExamGuard Popup] Content script missing. Programmatically injecting lockdown into tab:", activeTab.id);
                try {
                    if (chrome.scripting && chrome.scripting.executeScript) {
                        await chrome.scripting.executeScript({
                            target: { tabId: activeTab.id },
                            files: [
                                "dist/faceDetector.js",
                                "dist/headPoseEstimator.js",
                                "dist/audioAnalyzer.js",
                                "content/lockdown.js"
                            ]
                        });
                        await chrome.tabs.sendMessage(activeTab.id, { action: "START_EXAM" });
                        console.log("[ExamGuard Popup] Programmatic script injection and lockdown start complete");
                    } else {
                        await chrome.tabs.create({
                            url: chrome.runtime.getURL("camera-test/index.html"),
                            active: true
                        });
                    }
                } catch (injectErr) {
                    console.warn("[ExamGuard Popup] Script injection fallback to proctoring portal:", injectErr);
                    await chrome.tabs.create({
                        url: chrome.runtime.getURL("camera-test/index.html"),
                        active: true
                    });
                }
            }
        }

        // 3. Persist active exam state
        await chrome.storage.local.set({ examActive: true });
        updateStatus(true);
        console.log("[ExamGuard Popup] Exam started successfully");

    } catch (error) {
        console.error("[ExamGuard Popup] Failed to start exam:", error);
        updateStatus(false);
    }
});

// ------------------------------------------------------------
// Stop Exam
// ------------------------------------------------------------

stopButton.addEventListener("click", async () => {
    console.log("[ExamGuard Popup] Stop Exam clicked");

    try {
        await chrome.runtime.sendMessage({
            action: "STOP_EXAM"
        });

        const tabs = await chrome.tabs.query({
            active: true,
            currentWindow: true
        });

        const tab = tabs[0];
        if (tab && tab.id) {
            try {
                await chrome.tabs.sendMessage(tab.id, { action: "STOP_EXAM" });
            } catch (e) {
                // Tab might have navigated or closed
            }
        }

        await chrome.storage.local.set({ examActive: false });
        updateStatus(false);
        console.log("[ExamGuard Popup] Exam stopped successfully");

    } catch (error) {
        console.error("[ExamGuard Popup] Failed to stop exam:", error);
    }
});