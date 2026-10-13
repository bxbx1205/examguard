const video = document.getElementById("video");
const status = document.getElementById("status");
const headPoseStatus = document.getElementById("headPoseStatus") || document.createElement("p");
const cameraAlert = document.getElementById("cameraAlert");
const alertTitle = document.getElementById("alertTitle");
const alertDesc = document.getElementById("alertDesc");
const camStatus = document.getElementById("camStatus");
const micStatus = document.getElementById("micStatus");
const aiStatus = document.getElementById("aiStatus");
const telemetryLog = document.getElementById("telemetryLog");
const sessionBadge = document.getElementById("sessionBadge");

let headPoseAnomalyStartTime = null;
const HEAD_POSE_DURATION = 3000; // 3 seconds
let headPoseAnomalyReported = false;

let gazeDeviationStartTime = null;
const GAZE_DEVIATION_DURATION = 3500; // 3.5 seconds
let gazeDeviationReported = false;

let faceNotDetectedStartTime = null;
let faceNotDetectedReported = false;
const FACE_NOT_DETECTED_DURATION = 5000; // 5 seconds

let multipleFacesReported = false;
let audioContextInstance = null;
let audioCheckInterval = null;
const cooldownMap = new Map();

function isCooldownActive(key, cooldownMs = 5000) {
    const now = Date.now();
    const last = cooldownMap.get(key) || 0;
    if (now - last < cooldownMs) return true;
    cooldownMap.set(key, now);
    return false;
}

function addLog(msg, level = "ok") {
    console.log(`[ExamGuard Portal] ${msg}`);
    if (!telemetryLog) return;
    const entry = document.createElement("div");
    entry.className = `log-entry ${level}`;
    const time = new Date().toLocaleTimeString();
    entry.textContent = `[${time}] ${msg}`;
    telemetryLog.prepend(entry);
    while (telemetryLog.children.length > 25) {
        telemetryLog.removeChild(telemetryLog.lastChild);
    }
}

function showCameraAlert(title, message) {
    if (cameraAlert) {
        if (alertTitle) alertTitle.textContent = title;
        if (alertDesc) alertDesc.textContent = message;
        cameraAlert.classList.add("active");
    }
    if (sessionBadge) {
        sessionBadge.className = "badge badge-offline";
        sessionBadge.textContent = "Hardware Alert";
    }
}

function hideCameraAlert() {
    if (cameraAlert) cameraAlert.classList.remove("active");
    if (sessionBadge) {
        sessionBadge.className = "badge badge-live";
        sessionBadge.textContent = "Proctoring Active";
    }
}

// Helper to send telemetry frame to extension background worker & backend WebSocket
function reportVisionAnomaly(subtype, severity, confidence, metrics, message) {
    const event = {
        type: "TELEMETRY_ANOMALY",
        event_id: `evt_${typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Date.now()}`,
        category: "VISION",
        subtype: subtype,
        severity: severity,
        confidence: confidence,
        metrics: metrics,
        snapshot_key: null,
        message: message,
        timestamp: new Date().toISOString()
    };

    const level = severity === "CRITICAL" ? "crit" : severity === "HIGH" ? "warn" : "ok";
    addLog(`${subtype}: ${message}`, level);

    if (typeof chrome !== "undefined" && chrome?.runtime?.sendMessage) {
        chrome.runtime.sendMessage({
            action: "TELEMETRY_EVENT",
            data: event
        });
    }
}

function notifyDeviceStatus(cameraActive, micActive) {
    if (typeof chrome !== "undefined" && chrome?.runtime?.sendMessage) {
        chrome.runtime.sendMessage({
            action: "DEVICE_STATUS_CHANGE",
            payload: { camera_active: cameraActive, microphone_active: micActive }
        });
    }
}

async function startCamera() {
    try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            showCameraAlert("Media Unsupported", "Your browser environment does not support mediaDevices API.");
            if (camStatus) camStatus.innerHTML = '<span class="dot offline"></span> Unsupported';
            reportVisionAnomaly("CAMERA_OFFLINE", "CRITICAL", 1.0, { error: "NO_MEDIA_DEVICES" }, "Media devices API unavailable");
            notifyDeviceStatus(false, false);
            return;
        }

        if (camStatus) camStatus.innerHTML = '<span class="dot warning"></span> Requesting Camera...';
        if (micStatus) micStatus.innerHTML = '<span class="dot warning"></span> Requesting Mic...';

        // Attempt stream acquisition directly to trigger the browser permission prompt
        let stream = null;
        try {
            stream = await navigator.mediaDevices.getUserMedia({
                video: { width: 640, height: 480 },
                audio: true
            });
        } catch (initialErr) {
            console.warn("Combined getUserMedia failed, retrying video-only:", initialErr);
            stream = await navigator.mediaDevices.getUserMedia({
                video: { width: 640, height: 480 },
                audio: false
            });
        }

        hideCameraAlert();
        video.srcObject = stream;
        await video.play();

        const videoTracks = stream.getVideoTracks();
        const audioTracks = stream.getAudioTracks();
        const isCamActive = videoTracks.length > 0 && videoTracks[0].readyState === "live";
        const isMicActive = audioTracks.length > 0 && audioTracks[0].readyState === "live";

        if (camStatus) camStatus.innerHTML = isCamActive ? '<span class="dot online"></span> Active' : '<span class="dot offline"></span> Inactive';
        if (micStatus) micStatus.innerHTML = isMicActive ? '<span class="dot online"></span> Active' : '<span class="dot offline"></span> Inactive';

        notifyDeviceStatus(isCamActive, isMicActive);
        addLog(`Hardware online (Cam: ${isCamActive ? 'YES' : 'NO'}, Mic: ${isMicActive ? 'YES' : 'NO'})`, "ok");

        // Listen for hardware disconnect mid-session
        if (videoTracks.length > 0) {
            videoTracks[0].onended = () => {
                showCameraAlert("Camera Disconnected", "Webcam connection was lost during the exam.");
                if (camStatus) camStatus.innerHTML = '<span class="dot offline"></span> Disconnected';
                reportVisionAnomaly("CAMERA_OFFLINE", "CRITICAL", 1.0, { reason: "TRACK_ENDED" }, "Webcam stream terminated unexpectedly");
                notifyDeviceStatus(false, false);
            };
        }

        status.textContent = "Camera working. Initializing AI models...";

        // Initialize Audio Pipeline if microphone is active
        if (isMicActive) {
            initAudioPipeline(stream);
        }

        // Initialize MediaPipe Vision & Head Pose models
        try {
            if (aiStatus) aiStatus.innerHTML = '<span class="dot warning"></span> Loading Vision';
            await ExamGuardVision.initializeFaceDetector();
            addLog("MediaPipe Face Detector ready", "ok");

            if (aiStatus) aiStatus.innerHTML = '<span class="dot warning"></span> Loading Pose';
            await ExamGuardHeadPose.initializeHeadPoseEstimator();
            addLog("MediaPipe Head Pose Estimator ready", "ok");

            if (aiStatus) aiStatus.innerHTML = '<span class="dot online"></span> Models Live';
            status.textContent = "Face Detector + Head Pose ready";

            detectFaces();
        } catch (error) {
            console.error("MEDIAPIPE INITIALIZATION ERROR:", error);
            if (aiStatus) aiStatus.innerHTML = '<span class="dot offline"></span> Load Failed';
            status.textContent = "MediaPipe initialization failed - check Console";
            addLog(`AI initialization failed: ${error.message || error}`, "crit");
        }

    } catch (error) {
        console.error("Camera startup failed:", error);
        showCameraAlert("Camera Access Denied", error.message || "Failed to start webcam.");
        if (camStatus) camStatus.innerHTML = '<span class="dot offline"></span> Blocked';
        status.textContent = "Camera access error: " + (error.message || error);
        reportVisionAnomaly("CAMERA_OFFLINE", "CRITICAL", 1.0, { error: error.name, message: error.message }, "Camera access denied or unavailable");
        notifyDeviceStatus(false, false);
    }
}

function initAudioPipeline(stream) {
    try {
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
        addLog("Audio frequency analyzer connected", "ok");

        audioCheckInterval = setInterval(() => {
            analyser.getByteFrequencyData(freqData);

            let sum = 0;
            for (let i = 0; i < freqData.length; i++) sum += freqData[i];
            const volume = sum / freqData.length;

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

            if (speechEnergy > 30 && peaks >= 8 && !isCooldownActive("AUDIO_MULTIPLE_SPEAKERS", 5000)) {
                reportVisionAnomaly(
                    "AUDIO_MULTIPLE_SPEAKERS",
                    "HIGH",
                    0.91,
                    { speakers_estimated: 2, average_decibels: Number((volume - 60).toFixed(1)) },
                    "Multiple vocal streams detected in exam environment"
                );
            } else if (volume >= 22 && volume < 35 && speechEnergy >= 18 && speechEnergy < 40 && !isCooldownActive("AUDIO_WHISPER", 5000)) {
                reportVisionAnomaly(
                    "AUDIO_WHISPER",
                    "LOW",
                    0.72,
                    { average_decibels: Number((volume - 60).toFixed(1)) },
                    "Subtle whispered speech patterns detected"
                );
            }
        }, 1200);
    } catch (e) {
        console.warn("Audio pipeline initialization failed:", e);
    }
}

function detectFaces() {
    const result = ExamGuardVision.detectFaces(video);
    const faceCount = result.faceCount;
    const now = performance.now();

    // 1. FACE NOT DETECTED
    if (faceCount === 0) {
        status.textContent = "FACE_NOT_DETECTED";

        if (faceNotDetectedStartTime === null) {
            faceNotDetectedStartTime = now;
        }

        const duration = now - faceNotDetectedStartTime;

        if (
            duration >= FACE_NOT_DETECTED_DURATION &&
            !faceNotDetectedReported
        ) {
            reportVisionAnomaly(
                "FACE_NOT_DETECTED",
                "CRITICAL",
                0.99,
                {
                    duration_seconds: Number((duration / 1000).toFixed(2)),
                    last_seen_timestamp: new Date().toISOString()
                },
                "Candidate departed camera viewport for over 5 seconds"
            );
            faceNotDetectedReported = true;
        }
    } else {
        faceNotDetectedStartTime = null;
        faceNotDetectedReported = false;
    }

    // 2. MULTIPLE FACES DETECTED
    if (faceCount > 1) {
        status.textContent = "MULTIPLE_FACES_DETECTED";

        if (!multipleFacesReported) {
            reportVisionAnomaly(
                "MULTIPLE_FACES_DETECTED",
                "CRITICAL",
                0.96,
                {
                    faces_detected: faceCount
                },
                "Secondary individual identified in camera viewport"
            );
            multipleFacesReported = true;
        }
    } else {
        multipleFacesReported = false;

        if (faceCount === 1) {
            status.textContent = "NORMAL (1 Face Present)";
        }
    }

    // Only analyze gaze and head pose when exactly one face is visible.
    if (faceCount === 1) {
        const headPoseResult = ExamGuardHeadPose.estimateHeadPose(video);

        // 3. GAZE DEVIATION
        if (headPoseResult?.landmarks) {
            const gaze = ExamGuardHeadPose.estimateGaze(headPoseResult.landmarks);

            if (gaze && gaze.direction === "CENTER") {
                gazeDeviationStartTime = null;
                gazeDeviationReported = false;
            } else if (gaze) {
                if (gazeDeviationStartTime === null) {
                    gazeDeviationStartTime = now;
                }

                const duration = now - gazeDeviationStartTime;

                if (
                    duration >= GAZE_DEVIATION_DURATION &&
                    !gazeDeviationReported
                ) {
                    reportVisionAnomaly(
                        "GAZE_DEVIATION",
                        "MEDIUM",
                        0.88,
                        {
                            gaze_direction: gaze.direction,
                            gazeX: Number(gaze.gazeX.toFixed(2)),
                            duration_seconds: Number((duration / 1000).toFixed(2)),
                            head_pose: headPoseResult ? {
                                pitch: Number(headPoseResult.pitch.toFixed(1)),
                                yaw: Number(headPoseResult.yaw.toFixed(1)),
                                roll: Number(headPoseResult.roll.toFixed(1))
                            } : undefined
                        },
                        "Candidate repeatedly glancing away from screen"
                    );
                    gazeDeviationReported = true;
                }
            }
        } else {
            gazeDeviationStartTime = null;
            gazeDeviationReported = false;
        }

        // 4. HEAD POSE ANOMALY
        if (headPoseResult) {
            const anomaly = ExamGuardHeadPose.isHeadPoseAnomaly(headPoseResult);

            if (anomaly) {
                if (headPoseAnomalyStartTime === null) {
                    headPoseAnomalyStartTime = now;
                }

                const duration = now - headPoseAnomalyStartTime;

                if (duration >= HEAD_POSE_DURATION) {
                    headPoseStatus.textContent = "POSE: ANOMALY";
                    headPoseStatus.style.color = "#ef4444";

                    if (!headPoseAnomalyReported) {
                        reportVisionAnomaly(
                            "HEAD_POSE_ANOMALY",
                            "MEDIUM",
                            0.85,
                            {
                                pitch: Number(headPoseResult.pitch.toFixed(1)),
                                yaw: Number(headPoseResult.yaw.toFixed(1)),
                                roll: Number(headPoseResult.roll.toFixed(1)),
                                duration_seconds: Number((duration / 1000).toFixed(2))
                            },
                            "Abnormal head pose orientation detected"
                        );
                        headPoseAnomalyReported = true;
                    }
                } else {
                    headPoseStatus.textContent = "POSE: WARNING";
                    headPoseStatus.style.color = "#f59e0b";
                }
            } else {
                headPoseAnomalyStartTime = null;
                headPoseAnomalyReported = false;
                headPoseStatus.textContent = "POSE: NORMAL";
                headPoseStatus.style.color = "#10b981";
            }
        } else {
            headPoseAnomalyStartTime = null;
            headPoseAnomalyReported = false;
            headPoseStatus.textContent = "POSE: SCANNING";
            headPoseStatus.style.color = "#8b9bb4";
        }
    } else {
        // Reset pose and gaze timers when there isn't exactly one face.
        gazeDeviationStartTime = null;
        gazeDeviationReported = false;

        headPoseAnomalyStartTime = null;
        headPoseAnomalyReported = false;
        headPoseStatus.textContent = "POSE: NO TARGET";
        headPoseStatus.style.color = "#8b9bb4";
    }

    requestAnimationFrame(detectFaces);
}

startCamera();