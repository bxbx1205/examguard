import { FaceDetector, FilesetResolver } from "@mediapipe/tasks-vision";

let faceDetector = null;

export async function initializeFaceDetector() {
    const wasmPath = (typeof chrome !== "undefined" && chrome?.runtime?.getURL)
        ? chrome.runtime.getURL("dist/wasm")
        : "../dist/wasm";

    const modelPath = (typeof chrome !== "undefined" && chrome?.runtime?.getURL)
        ? chrome.runtime.getURL("models/blaze_face_short_range.tflite")
        : "../models/blaze_face_short_range.tflite";

    const vision = await FilesetResolver.forVisionTasks(wasmPath);

    try {
        faceDetector = await FaceDetector.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath: modelPath,
                delegate: "GPU"
            },
            runningMode: "VIDEO",
            minDetectionConfidence: 0.5
        });
    } catch (gpuErr) {
        console.warn("GPU delegate failed for faceDetector, falling back to CPU:", gpuErr);
        faceDetector = await FaceDetector.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath: modelPath,
                delegate: "CPU"
            },
            runningMode: "VIDEO",
            minDetectionConfidence: 0.5
        });
    }

    console.log("MediaPipe Face Detector initialized");
}

export function detectFaces(videoElement) {
    if (!faceDetector) {
        throw new Error("Face detector is not initialized");
    }

    const result = faceDetector.detectForVideo(
        videoElement,
        performance.now()
    );

    const faceCount = result.detections.length;

    return {
        faceDetected: faceCount > 0,
        faceCount: faceCount,
        multipleFaces: faceCount > 1,
        detections: result.detections
    };
}