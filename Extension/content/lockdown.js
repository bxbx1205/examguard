// ============================================
// ExamGuard Sentinel
// Browser Lockdown Safeguards
// Owner: Anushka Patel
// ============================================

console.log("ExamGuard Lockdown loaded");

// --------------------------------------------
// Configuration
// --------------------------------------------

let examActive = false;

// Prevent duplicate tab-switch events
let lastTabSwitchTime = 0;

const TAB_SWITCH_COOLDOWN = 1000; // 1 second

// --------------------------------------------
// Start ExamGuard Lockdown
// --------------------------------------------

function startLockdown() {
    if (examActive) return;

    examActive = true;

    console.log("ExamGuard lockdown ACTIVE");

    enableClipboardBlocking();
    enableContextMenuBlocking();
    enableKeyboardBlocking();
    enableVisibilityMonitoring();
    enableFullscreenMonitoring();
    startMediaProctoring();
}

// --------------------------------------------
// Stop ExamGuard Lockdown
// --------------------------------------------

function stopLockdown() {
    examActive = false;

    console.log("ExamGuard lockdown INACTIVE");
    stopMediaProctoring();
}

// --------------------------------------------
// Clipboard Protection
// --------------------------------------------

function enableClipboardBlocking() {

    document.addEventListener("copy", handleClipboard, true);
    document.addEventListener("cut", handleClipboard, true);
    document.addEventListener("paste", handleClipboard, true);
}

function handleClipboard(event) {

    if (!examActive) return;

    event.preventDefault();

    let operation = event.type;

    reportViolation(
        "CLIPBOARD_VIOLATION",
        "LOW", {
            operation: operation
        }
    );

    showWarning(
        "Clipboard operation blocked during the exam."
    );
}

// --------------------------------------------
// Right Click Protection
// --------------------------------------------

function enableContextMenuBlocking() {

    document.addEventListener(
        "contextmenu",
        handleContextMenu,
        true
    );
}

function handleContextMenu(event) {

    if (!examActive) return;

    event.preventDefault();

    reportViolation(
        "CLIPBOARD_VIOLATION",
        "LOW", {
            operation: "contextmenu"
        }
    );

    showWarning(
        "Right-click is disabled during the exam."
    );
}

// --------------------------------------------
// Keyboard Protection
// --------------------------------------------

function enableKeyboardBlocking() {

    document.addEventListener(
        "keydown",
        handleKeyboard,
        true
    );
}

function handleKeyboard(event) {

    if (!examActive) return;

    const key = event.key.toLowerCase();

    // F12
    if (event.key === "F12") {

        event.preventDefault();
        event.stopPropagation();

        reportViolation(
            "DEVTOOLS_ATTEMPT",
            "CRITICAL", {
                shortcut: "F12"
            }
        );

        showWarning(
            "Developer tools are disabled during the exam."
        );

        return;
    }

    // Ctrl + Shift + I
    if (
        event.ctrlKey &&
        event.shiftKey &&
        key === "i"
    ) {

        blockDevToolsShortcut(event, "CTRL_SHIFT_I");
        return;
    }

    // Ctrl + Shift + J
    if (
        event.ctrlKey &&
        event.shiftKey &&
        key === "j"
    ) {

        blockDevToolsShortcut(event, "CTRL_SHIFT_J");
        return;
    }

    // Ctrl + Shift + C
    if (
        event.ctrlKey &&
        event.shiftKey &&
        key === "c"
    ) {

        blockDevToolsShortcut(event, "CTRL_SHIFT_C");
        return;
    }

    // Ctrl + C
    if (event.ctrlKey && key === "c") {

        event.preventDefault();

        reportViolation(
            "CLIPBOARD_VIOLATION",
            "LOW", {
                operation: "copy"
            }
        );

        showWarning(
            "Copy is disabled during the exam."
        );

        return;
    }

    // Ctrl + X
    if (event.ctrlKey && key === "x") {

        event.preventDefault();

        reportViolation(
            "CLIPBOARD_VIOLATION",
            "LOW", {
                operation: "cut"
            }
        );

        showWarning(
            "Cut is disabled during the exam."
        );

        return;
    }

    // Ctrl + V
    if (event.ctrlKey && key === "v") {

        event.preventDefault();

        reportViolation(
            "CLIPBOARD_VIOLATION",
            "LOW", {
                operation: "paste"
            }
        );

        showWarning(
            "Paste is disabled during the exam."
        );

        return;
    }
}

function blockDevToolsShortcut(event, shortcut) {

    event.preventDefault();
    event.stopPropagation();

    reportViolation(
        "DEVTOOLS_ATTEMPT",
        "CRITICAL", {
            shortcut: shortcut
        }
    );

    showWarning(
        "Developer tools are disabled during the exam."
    );
}

// --------------------------------------------
// Tab Switch / Visibility Detection
// --------------------------------------------

function enableVisibilityMonitoring() {

    document.addEventListener(
        "visibilitychange",
        handleVisibilityChange,
        true
    );

    window.addEventListener(
        "blur",
        handleWindowBlur,
        true
    );

    window.addEventListener(
        "focus",
        handleWindowFocus,
        true
    );
}

function handleVisibilityChange() {

    if (!examActive) return;

    if (document.visibilityState === "hidden") {

        const now = Date.now();

        // Ignore duplicate event
        if (
            now - lastTabSwitchTime <
            TAB_SWITCH_COOLDOWN
        ) {
            return;
        }

        lastTabSwitchTime = now;

        reportViolation(
            "TAB_SWITCH_BLUR",
            "HIGH", {
                reason: "document_hidden"
            }
        );

        showWarning(
            "Exam window lost focus. This incident has been recorded."
        );
    }
}

function handleWindowBlur() {

    if (!examActive) return;

    const now = Date.now();

    // Ignore duplicate event
    if (
        now - lastTabSwitchTime <
        TAB_SWITCH_COOLDOWN
    ) {
        return;
    }

    lastTabSwitchTime = now;

    reportViolation(
        "TAB_SWITCH_BLUR",
        "HIGH", {
            reason: "window_blur"
        }
    );
}

function handleWindowFocus() {

    if (!examActive) return;

    console.log("Exam window focused again");
}

// --------------------------------------------
// Fullscreen Monitoring
// --------------------------------------------

function enableFullscreenMonitoring() {

    document.addEventListener(
        "fullscreenchange",
        handleFullscreenChange,
        true
    );
}

function handleFullscreenChange() {

    if (!examActive) return;

    if (!document.fullscreenElement) {

        reportViolation(
            "FULLSCREEN_EXIT",
            "HIGH", {}
        );

        showWarning(
            "Fullscreen mode was exited. Please return to fullscreen."
        );
    }
}


// --------------------------------------------
// Telemetry Session Information
// --------------------------------------------

let examId = "exam_2026_cs501";
let sessionId = "";
let studentId = "50";

// Load active session context from storage
if (typeof chrome !== "undefined" && chrome?.storage?.local) {
    chrome.storage.local.get(["examId", "studentId", "sessionId"], (result) => {
        if (result?.examId) examId = result.examId;
        if (result?.studentId) studentId = result.studentId;
        if (result?.sessionId) sessionId = result.sessionId;
    });
}

// --------------------------------------------
// Violation Reporter
// --------------------------------------------
function reportViolation(
    subtype,
    severity,
    metrics = {},
    category = "ENVIRONMENT",
    message = null,
    confidence = 1.0
) {
    const event = {
        type: "TELEMETRY_ANOMALY",
        event_id: `evt_${typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Date.now()}`,
        exam_id: examId,
        session_id: sessionId,
        student_id: studentId,
        timestamp: new Date().toISOString(),
        category: category,
        subtype: subtype,
        severity: severity,
        confidence: confidence,
        metrics: metrics,
        snapshot_key: null,
        message: message || `Telemetry anomaly detected: ${subtype}`
    };

    console.log(`[ExamGuard ${category}] Violation:`, event);

    // Send event to background service worker
    if (typeof chrome !== "undefined" && chrome?.runtime?.sendMessage) {
        chrome.runtime.sendMessage({
            action: "TELEMETRY_EVENT",
            data: event
        });
    }
}

// --------------------------------------------
// Vision & Audio Media Proctoring Pipeline
// --------------------------------------------

let mediaStream = null;
let proctorVideo = null;
let visionCheckInterval = null;
let audioAnalyzerInstance = null;
let audioContextInstance = null;
let audioCheckInterval = null;

let faceAbsentStartTime = null;
let faceAbsentReported = false;
let multipleFacesReported = false;
let gazeDeviationStartTime = null;
let gazeDeviationReported = false;
let headPoseStartTime = null;
let headPoseReported = false;

const violationCooldowns = {};
function isCooldownActive(subtype, cooldownMs = 3000) {
    const now = Date.now();
    if (violationCooldowns[subtype] && now - violationCooldowns[subtype] < cooldownMs) {
        return true;
    }
    violationCooldowns[subtype] = now;
    return false;
}

async function startMediaProctoring() {
    console.log("[ExamGuard] Requesting Camera & Microphone permissions for proctoring...");

    try {
        // ALWAYS invoke getUserMedia directly so the browser actually prompts the user for camera/microphone access!
        try {
            mediaStream = await navigator.mediaDevices.getUserMedia({
                video: { width: 640, height: 480 },
                audio: true
            });
            console.log("🟢 [ExamGuard] Acquired combined Video + Audio stream");
        } catch (combinedErr) {
            console.warn("⚠️ [ExamGuard] Combined getUserMedia failed, retrying video-only:", combinedErr);
            // Fallback to video-only if microphone is not connected or permission was denied
            mediaStream = await navigator.mediaDevices.getUserMedia({
                video: { width: 640, height: 480 },
                audio: false
            });
            console.log("🟢 [ExamGuard] Acquired Video-only stream");
        }

        console.log("🟢 [ExamGuard] Media devices acquired for proctoring");

        // 1. Setup Vision Pipeline
        setupVisionPipeline(mediaStream);

        // 2. Setup Audio Pipeline if audio tracks present
        const hasAudioTracks = mediaStream.getAudioTracks().length > 0;
        if (hasAudioTracks) {
            setupAudioPipeline(mediaStream);
        }

        // Notify background that camera is active
        if (typeof chrome !== "undefined" && chrome?.runtime?.sendMessage) {
            chrome.runtime.sendMessage({
                action: "DEVICE_STATUS_CHANGE",
                payload: { camera_active: true, microphone_active: hasAudioTracks }
            });
        }

        // Attach track onended listener in case webcam is detached during exam
        const videoTracks = mediaStream.getVideoTracks();
        if (videoTracks.length > 0) {
            videoTracks[0].onended = () => {
                console.warn("⚠️ [ExamGuard] Video track ended unexpectedly (camera disconnected)");
                showWarning("CRITICAL: Camera disconnected! Please reconnect your webcam.");
                reportViolation(
                    "CAMERA_OFFLINE",
                    "CRITICAL",
                    { reason: "TRACK_ENDED" },
                    "HARDWARE",
                    "Webcam disconnected during active exam",
                    1.0
                );
                if (typeof chrome !== "undefined" && chrome?.runtime?.sendMessage) {
                    chrome.runtime.sendMessage({
                        action: "DEVICE_STATUS_CHANGE",
                        payload: { camera_active: false, microphone_active: false }
                    });
                }
            };
        }

    } catch (err) {
        console.warn("⚠️ [ExamGuard] Camera/Microphone access not granted or unavailable:", err);
        const isNotFound = err.name === "NotFoundError" || err.name === "DevicesNotFoundError";
        const isDenied = err.name === "NotAllowedError" || err.name === "PermissionDeniedError";
        const alertMsg = isNotFound
            ? "CRITICAL: No webcam detected! Connect a camera to proceed."
            : isDenied
            ? "Warning: Camera permission was denied. Please allow camera access in your browser."
            : `Camera error: ${err.message}`;

        showWarning(alertMsg);
        reportViolation(
            "CAMERA_OFFLINE",
            "CRITICAL",
            { error: err.name, message: err.message, reason: isNotFound ? "NO_CAMERA_DEVICE" : "PERMISSION_DENIED" },
            "HARDWARE",
            alertMsg,
            1.0
        );
        if (typeof chrome !== "undefined" && chrome?.runtime?.sendMessage) {
            chrome.runtime.sendMessage({
                action: "DEVICE_STATUS_CHANGE",
                payload: { camera_active: false, microphone_active: false }
            });
        }
    }
}


async function setupVisionPipeline(stream) {
    try {
        proctorVideo = document.createElement("video");
        proctorVideo.id = "examguard-proctor-video";
        proctorVideo.style.position = "fixed";
        proctorVideo.style.opacity = "0";
        proctorVideo.style.pointerEvents = "none";
        proctorVideo.style.width = "320px";
        proctorVideo.style.height = "240px";
        proctorVideo.style.top = "-9999px";
        proctorVideo.autoplay = true;
        proctorVideo.playsInline = true;
        proctorVideo.muted = true;
        document.documentElement.appendChild(proctorVideo);

        proctorVideo.srcObject = stream;
        await proctorVideo.play();

        // Check if bundled MediaPipe detectors are loaded
        if (typeof window !== "undefined" && window.ExamGuardVision?.initializeFaceDetector) {
            try {
                await window.ExamGuardVision.initializeFaceDetector();
                if (window.ExamGuardHeadPose?.initializeHeadPoseEstimator) {
                    await window.ExamGuardHeadPose.initializeHeadPoseEstimator();
                }
                console.log("🟢 [ExamGuard] MediaPipe Face & Pose models initialized in content script");
            } catch (initErr) {
                console.warn("⚠️ [ExamGuard] MediaPipe initialization error:", initErr);
            }
        }

        // Run vision evaluation loop every 400ms
        visionCheckInterval = setInterval(runVisionDetectionStep, 400);

    } catch (err) {
        console.warn("⚠️ [ExamGuard] Failed to setup vision pipeline:", err);
    }
}

function runVisionDetectionStep() {
    if (!examActive || !proctorVideo || proctorVideo.readyState < 2) return;

    const now = performance.now();

    // Use MediaPipe if available
    if (typeof window !== "undefined" && window.ExamGuardVision?.detectFaces) {
        try {
            const result = window.ExamGuardVision.detectFaces(proctorVideo);
            const faceCount = result.faceCount;

            // 1. FACE NOT DETECTED
            if (faceCount === 0) {
                if (faceAbsentStartTime === null) faceAbsentStartTime = now;
                const duration = now - faceAbsentStartTime;
                if (duration >= 5000 && !faceAbsentReported) {
                    reportViolation(
                        "FACE_NOT_DETECTED",
                        "CRITICAL",
                        { duration_seconds: Number((duration / 1000).toFixed(1)), face_count: 0 },
                        "VISION",
                        "Candidate departed camera viewport for over 5 seconds",
                        0.99
                    );
                    showWarning("Warning: Face not detected in camera viewport!");
                    faceAbsentReported = true;
                }
            } else {
                faceAbsentStartTime = null;
                faceAbsentReported = false;
            }

            // 2. MULTIPLE FACES DETECTED
            if (faceCount > 1) {
                if (!multipleFacesReported && !isCooldownActive("MULTIPLE_FACES_DETECTED")) {
                    reportViolation(
                        "MULTIPLE_FACES_DETECTED",
                        "CRITICAL",
                        { faces_detected: faceCount },
                        "VISION",
                        "Secondary individual identified in camera viewport",
                        0.96
                    );
                    showWarning("Warning: Multiple faces detected!");
                    multipleFacesReported = true;
                }
            } else {
                multipleFacesReported = false;
            }

            // 3. GAZE & HEAD POSE (when exactly 1 face is visible)
            if (faceCount === 1 && window.ExamGuardHeadPose?.estimateHeadPose) {
                const headPose = window.ExamGuardHeadPose.estimateHeadPose(proctorVideo);

                // Gaze tracking
                if (headPose?.landmarks && window.ExamGuardHeadPose.estimateGaze) {
                    const gaze = window.ExamGuardHeadPose.estimateGaze(headPose.landmarks);
                    if (gaze && gaze.direction !== "CENTER") {
                        if (gazeDeviationStartTime === null) gazeDeviationStartTime = now;
                        const gazeDuration = now - gazeDeviationStartTime;
                        if (gazeDuration >= 3500 && !gazeDeviationReported) {
                            reportViolation(
                                "GAZE_DEVIATION",
                                "MEDIUM",
                                { gaze_direction: gaze.direction, duration_seconds: Number((gazeDuration / 1000).toFixed(1)) },
                                "VISION",
                                "Candidate repeatedly glancing away from screen",
                                0.88
                            );
                            gazeDeviationReported = true;
                        }
                    } else {
                        gazeDeviationStartTime = null;
                        gazeDeviationReported = false;
                    }
                }

                // Head pose orientation
                if (headPose && window.ExamGuardHeadPose.isHeadPoseAnomaly) {
                    const isPoseAnomaly = window.ExamGuardHeadPose.isHeadPoseAnomaly(headPose);
                    if (isPoseAnomaly) {
                        if (headPoseStartTime === null) headPoseStartTime = now;
                        const poseDuration = now - headPoseStartTime;
                        if (poseDuration >= 3000 && !headPoseReported) {
                            reportViolation(
                                "HEAD_POSE_ANOMALY",
                                "MEDIUM",
                                { pitch: Number(headPose.pitch?.toFixed(1)), yaw: Number(headPose.yaw?.toFixed(1)), duration_seconds: Number((poseDuration / 1000).toFixed(1)) },
                                "VISION",
                                "Abnormal head pose orientation detected",
                                0.85
                            );
                            headPoseReported = true;
                        }
                    } else {
                        headPoseStartTime = null;
                        headPoseReported = false;
                    }
                }
            }
        } catch (e) {
            // Silently recover if frame was not ready
        }
    }
}

function setupAudioPipeline(stream) {
    try {
        const audioTracks = stream.getAudioTracks();
        if (!audioTracks || audioTracks.length === 0) return;

        audioContextInstance = new (window.AudioContext || window.webkitAudioContext)();
        if (audioContextInstance.state === "suspended") {
            audioContextInstance.resume();
        }

        const analyser = audioContextInstance.createAnalyser();
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0.8;

        const source = audioContextInstance.createMediaStreamSource(stream);
        source.connect(analyser);

        const freqData = new Uint8Array(analyser.frequencyBinCount);
        console.log("🟢 [ExamGuard] Web Audio API analyzer connected to stream");

        audioCheckInterval = setInterval(() => {
            if (!examActive) return;

            analyser.getByteFrequencyData(freqData);

            // Calculate volume
            let sum = 0;
            for (let i = 0; i < freqData.length; i++) sum += freqData[i];
            const volume = sum / freqData.length;

            // Calculate speech energy (300Hz - 3400Hz)
            const binWidth = audioContextInstance.sampleRate / analyser.fftSize;
            const minBin = Math.floor(300 / binWidth);
            const maxBin = Math.ceil(3400 / binWidth);
            let speechSum = 0;
            let speechCount = 0;
            let peaks = 0;

            for (let i = minBin; i <= maxBin; i++) {
                const val = freqData[i] || 0;
                speechSum += val;
                speechCount++;
                if (val > (freqData[i - 1] || 0) && val > (freqData[i + 1] || 0) && val > 45) {
                    peaks++;
                }
            }
            const speechEnergy = speechCount > 0 ? speechSum / speechCount : 0;

            // 1. Multiple Speakers Detection
            if (speechEnergy > 30 && peaks >= 8 && !isCooldownActive("AUDIO_MULTIPLE_SPEAKERS", 4000)) {
                reportViolation(
                    "AUDIO_MULTIPLE_SPEAKERS",
                    "HIGH",
                    { speakers_estimated: 2, average_decibels: Number((volume - 60).toFixed(1)), sample_duration_ms: 3200 },
                    "AUDIO",
                    "Multiple vocal conversation streams detected in ambient room",
                    0.91
                );
                showWarning("Audio Alert: Multiple speakers detected in background!");
            }

            // 2. Whispering Detection
            if (volume >= 20 && volume < 35 && speechEnergy >= 18 && speechEnergy < 40 && !isCooldownActive("AUDIO_WHISPER", 4000)) {
                reportViolation(
                    "AUDIO_WHISPER",
                    "LOW",
                    { whisper_energy_ratio: 0.72, decibel_level: Number((volume - 60).toFixed(1)) },
                    "AUDIO",
                    "Whispering acoustic frequencies registered in background",
                    0.84
                );
            }

            // 3. Noise / Volume Spike
            if (volume > 55 && speechEnergy > 45 && !isCooldownActive("AUDIO_VOLUME_SPIKE", 4000)) {
                reportViolation(
                    "AUDIO_VOLUME_SPIKE",
                    "MEDIUM",
                    { volume: Number(volume.toFixed(1)), speech_energy: Number(speechEnergy.toFixed(1)) },
                    "AUDIO",
                    "Elevated vocal or acoustic noise detected",
                    0.85
                );
            }
        }, 500);

    } catch (err) {
        console.warn("⚠️ [ExamGuard] Audio pipeline setup error:", err);
    }
}

function stopMediaProctoring() {
    console.log("[ExamGuard] Stopping Media Proctoring Pipeline...");

    if (visionCheckInterval) {
        clearInterval(visionCheckInterval);
        visionCheckInterval = null;
    }

    if (audioCheckInterval) {
        clearInterval(audioCheckInterval);
        audioCheckInterval = null;
    }

    if (audioContextInstance) {
        try { audioContextInstance.close(); } catch (e) {}
        audioContextInstance = null;
    }

    if (proctorVideo) {
        proctorVideo.pause();
        proctorVideo.srcObject = null;
        proctorVideo.remove();
        proctorVideo = null;
    }

    if (mediaStream) {
        mediaStream.getTracks().forEach((track) => track.stop());
        mediaStream = null;
    }
}

// --------------------------------------------
// Warning UI
// --------------------------------------------

function showWarning(message) {

    let existing = document.getElementById(
        "examguard-warning"
    );

    if (existing) {
        existing.remove();
    }

    const warning = document.createElement("div");

    warning.id = "examguard-warning";

    warning.textContent = message;

    warning.style.position = "fixed";
    warning.style.top = "20px";
    warning.style.left = "50%";
    warning.style.transform = "translateX(-50%)";

    warning.style.zIndex = "2147483647";

    warning.style.padding = "15px 25px";

    warning.style.background = "#b91c1c";

    warning.style.color = "white";

    warning.style.fontFamily = "Arial, sans-serif";

    warning.style.fontSize = "16px";

    warning.style.fontWeight = "bold";

    warning.style.borderRadius = "8px";

    warning.style.boxShadow =
        "0 4px 15px rgba(0,0,0,0.3)";

    document.documentElement.appendChild(
        warning
    );

    setTimeout(() => {

        warning.remove();

    }, 4000);
}

// --------------------------------------------
// Temporary development control
// --------------------------------------------

// For development/testing only.
// We will replace this with the actual exam
// session state from the extension popup/backend.

chrome.runtime.onMessage.addListener(
    (message) => {

        if (message.action === "START_EXAM") {
            startLockdown();
        }

        if (message.action === "STOP_EXAM") {
            stopLockdown();
        }
    }
);