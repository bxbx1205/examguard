// ============================================================
// ExamGuard Sentinel
// Background Service Worker
// Owner: Anushka Patel
// ============================================================

console.log(
    "[ExamGuard] Background service worker running"
);

// ------------------------------------------------------------
// Backend Configuration
// ------------------------------------------------------------

const WS_BASE_URL =
    "ws://localhost:8080/ws/telemetry";

const DEFAULT_EXAM_ID =
    "exam_2026_cs501";

const DEFAULT_STUDENT_ID =
    "50";

// ------------------------------------------------------------
// WebSocket State
// ------------------------------------------------------------

let socket = null;
let sessionId = null;
let reconnectTimer = null;
let heartbeatTimer = null;
let activeExamId = DEFAULT_EXAM_ID;
let activeStudentId = DEFAULT_STUDENT_ID;
const pendingTelemetry = [];

// ------------------------------------------------------------
// Connect to Backend
// ------------------------------------------------------------

async function connectWebSocket() {
    if (socket && socket.readyState === WebSocket.OPEN) {
        console.log("[ExamGuard] WebSocket already connected");
        return;
    }

    // Get auth credentials from Chrome storage
    const auth = await chrome.storage.local.get([
        "authToken",
        "examId",
        "studentId"
    ]);

    const authToken = auth.authToken || "dev_token";
    activeExamId = auth.examId || DEFAULT_EXAM_ID;
    activeStudentId = auth.studentId || DEFAULT_STUDENT_ID;

    const url = `${WS_BASE_URL}?token=${encodeURIComponent(authToken)}&exam_id=${encodeURIComponent(activeExamId)}`;

    console.log("[ExamGuard] Connecting to authenticated WebSocket:", url);

    socket = new WebSocket(url);

    socket.addEventListener("open", () => {
        console.log("[ExamGuard] WebSocket connected to", WS_BASE_URL);
        sendSessionInit();

        // Flush any queued telemetry events
        while (pendingTelemetry.length > 0) {
            const queued = pendingTelemetry.shift();
            sendTelemetry(queued);
        }
    });


    socket.addEventListener(
        "message",
        (event) => {

            console.log(
                "[ExamGuard] Backend message:",
                event.data
            );

            handleBackendMessage(
                event.data
            );
        }
    );


    socket.addEventListener(
        "error",
        (error) => {

            console.error(
                "[ExamGuard] WebSocket error:",
                error
            );
        }
    );


    socket.addEventListener(
        "close",
        (event) => {

            console.warn(
                "[ExamGuard] WebSocket closed:",
                event.code,
                event.reason
            );

            stopHeartbeat();

            socket = null;
            sessionId = null;

            chrome.storage.local.get(
                ["examActive"],
                (result) => {

                    if (
                        result.examActive === true
                    ) {
                        scheduleReconnect();
                    }
                }
            );
        }
    );
}

// ------------------------------------------------------------
// SESSION_INIT
// ------------------------------------------------------------

async function sendSessionInit() {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        console.warn("[ExamGuard] Cannot send SESSION_INIT: socket not open");
        return;
    }

    const auth = await chrome.storage.local.get([
        "examId",
        "studentId",
        "studentName"
    ]);

    activeExamId = auth.examId || activeExamId || DEFAULT_EXAM_ID;
    activeStudentId = auth.studentId || activeStudentId || DEFAULT_STUDENT_ID;

    const message = {
        type: "SESSION_INIT",
        event_id: `init_${crypto.randomUUID()}`,
        exam_id: activeExamId,
        student_id: activeStudentId,
        timestamp: new Date().toISOString(),
        payload: {
            client_version: "1.0.0",
            student_name: auth.studentName || `Student ${activeStudentId}`,
            browser: navigator.userAgent.includes("Edg") ? "Edge" : "Chrome",
            screen_resolution: "1920x1080",
            capabilities: {
                camera: true,
                microphone: true,
                mediapipe_loaded: true,
                audio_worklet_loaded: true
            }
        }
    };

    console.log("[ExamGuard] Sending SESSION_INIT:", message);
    socket.send(JSON.stringify(message));
}

// ------------------------------------------------------------
// Backend Message Handler
// ------------------------------------------------------------

function handleBackendMessage(
    rawMessage
) {

    let message;

    try {

        message =
            JSON.parse(rawMessage);

    } catch (error) {

        console.error(
            "[ExamGuard] Invalid backend JSON:",
            error
        );

        return;
    }

    switch (message.type) {

        case "SESSION_INIT_ACK":

            handleSessionInitAck(
                message
            );

            break;

        case "HEARTBEAT_PONG":

            console.log(
                "[ExamGuard] HEARTBEAT_PONG received"
            );

            break;

        case "COMMAND":

            handleCommand(
                message
            );

            break;

        default:

            console.log(
                "[ExamGuard] Unhandled backend message:",
                message.type
            );
    }
}

// ------------------------------------------------------------
// SESSION_INIT_ACK
// ------------------------------------------------------------

function handleSessionInitAck(message) {
    console.log("[ExamGuard] SESSION_INIT_ACK received:", message);
    sessionId = message.session_id;
    if (message.student_id) {
        activeStudentId = message.student_id;
    }
    console.log("[ExamGuard] Session ID:", sessionId);

    chrome.storage.local.set({
        sessionId: sessionId,
        examId: activeExamId,
        studentId: activeStudentId
    });

    startHeartbeat();
}

// ------------------------------------------------------------
// Heartbeat
// ------------------------------------------------------------

function startHeartbeat() {
    stopHeartbeat();
    heartbeatTimer = setInterval(() => {
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            return;
        }

        const heartbeat = {
            type: "HEARTBEAT_PING",
            student_id: activeStudentId || DEFAULT_STUDENT_ID,
            timestamp: new Date().toISOString()
        };

        socket.send(JSON.stringify(heartbeat));
        console.log("[ExamGuard] HEARTBEAT_PING sent:", heartbeat);
    }, 5000);
}

function stopHeartbeat() {
    if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
    }
}

// ------------------------------------------------------------
// Backend Commands
// ------------------------------------------------------------

function handleCommand(
    message
) {

    console.log(
        "[ExamGuard] Command received:",
        message
    );

    switch (message.action) {

        case "PROCTOR_WARNING":

            showProctorWarning(
                message.message ||
                "Please follow the exam rules."
            );

            break;

        case "LOCK_EXAM":

            sendCommandToActiveTab(
                "LOCK_EXAM"
            );

            break;

        case "TERMINATE_EXAM":

            sendCommandToActiveTab(
                "TERMINATE_EXAM"
            );

            break;

        default:

            console.warn(
                "[ExamGuard] Unknown command:",
                message.action
            );
    }
}

// ------------------------------------------------------------
// Send command to current exam tab
// ------------------------------------------------------------

async function sendCommandToActiveTab(
    action
) {

    const tabs =
        await chrome.tabs.query({
            active: true,
            currentWindow: true
        });

    const tab = tabs[0];

    if (!tab || !tab.id) {

        console.warn(
            "[ExamGuard] Active exam tab not found"
        );

        return;
    }

    try {

        await chrome.tabs.sendMessage(
            tab.id, {
                action: action
            }
        );

    } catch (error) {

        console.error(
            "[ExamGuard] Failed to send command to tab:",
            error
        );
    }
}

// ------------------------------------------------------------
// Warning from backend
// ------------------------------------------------------------

function showProctorWarning(
    message
) {

    sendCommandToActiveTab(
        "PROCTOR_WARNING"
    );

    console.warn(
        "[ExamGuard] PROCTOR WARNING:",
        message
    );
}

// ------------------------------------------------------------
// Forward telemetry to backend
// ------------------------------------------------------------

function sendTelemetry(telemetry) {
    if (!telemetry) return;

    // Standardize event frame strictly per API documentation Section 4.3
    const event = {
        type: "TELEMETRY_ANOMALY",
        event_id: telemetry.event_id || (typeof crypto !== "undefined" && crypto.randomUUID ? `evt_${crypto.randomUUID()}` : `evt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`),
        exam_id: telemetry.exam_id || activeExamId || DEFAULT_EXAM_ID,
        session_id: telemetry.session_id || sessionId || `sess_${activeExamId}_stud_${activeStudentId}`,
        student_id: telemetry.student_id || activeStudentId || DEFAULT_STUDENT_ID,
        timestamp: telemetry.timestamp || new Date().toISOString(),
        category: telemetry.category || "ENVIRONMENT",
        subtype: telemetry.subtype || "ANOMALY_EVENT",
        severity: telemetry.severity || "LOW",
        confidence: typeof telemetry.confidence === "number" ? Number(telemetry.confidence.toFixed(2)) : 1.0,
        metrics: telemetry.metrics || {},
        snapshot_key: telemetry.snapshot_key !== undefined ? telemetry.snapshot_key : null,
        message: telemetry.message || `Anomaly detected: ${telemetry.subtype}`
    };

    if (!socket || socket.readyState !== WebSocket.OPEN) {
        console.warn("[ExamGuard] WebSocket not connected. Queuing telemetry frame:", event.subtype);
        pendingTelemetry.push(event);
        connectWebSocket();
        return;
    }

    try {
        socket.send(JSON.stringify(event));
        console.log("[ExamGuard] Telemetry transmitted to /ws/telemetry:", event);
    } catch (err) {
        console.error("[ExamGuard] Failed to send telemetry frame:", err);
        pendingTelemetry.push(event);
    }
}

// ------------------------------------------------------------
// Reconnect
// ------------------------------------------------------------

function scheduleReconnect() {

    if (reconnectTimer) {
        return;
    }

    reconnectTimer =
        setTimeout(
            () => {

                reconnectTimer = null;

                connectWebSocket();

            },
            3000
        );
}

// ------------------------------------------------------------
// Messages from content script / popup
// ------------------------------------------------------------

chrome.runtime.onMessage.addListener(
    (message) => {

        if (
            message.action ===
            "TELEMETRY_EVENT"
        ) {

            console.log(
                "[ExamGuard] Telemetry received:",
                message.data
            );

            sendTelemetry(
                message.data
            );
        }

        if (
            message.action ===
            "START_EXAM"
        ) {

            console.log(
                "[ExamGuard] Start exam requested"
            );

            if (socket && socket.readyState === WebSocket.OPEN) {
                sendSessionInit();
            } else {
                connectWebSocket();
            }
        }

        if (
            message.action ===
            "DEVICE_STATUS_CHANGE"
        ) {
            console.log("[ExamGuard] Device status change:", message.payload);
            if (message.payload?.camera_active === false) {
                sendTelemetry({
                    category: "HARDWARE",
                    subtype: "CAMERA_OFFLINE",
                    severity: "CRITICAL",
                    confidence: 1.0,
                    message: "Candidate camera stream is offline"
                });
            }
        }

        if (
            message.action ===
            "STOP_EXAM"
        ) {

            console.log(
                "[ExamGuard] Stop exam requested"
            );

            stopHeartbeat();

            if (
                socket &&
                socket.readyState ===
                WebSocket.OPEN
            ) {

                socket.close(
                    1000,
                    "Exam stopped"
                );
            }

            socket = null;
            sessionId = null;
        }
    }
);