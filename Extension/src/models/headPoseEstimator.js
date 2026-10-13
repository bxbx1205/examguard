import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

let faceLandmarker = null;

export async function initializeHeadPoseEstimator() {
    const wasmPath = (typeof chrome !== "undefined" && chrome?.runtime?.getURL)
        ? chrome.runtime.getURL("dist/wasm")
        : "../dist/wasm";

    const modelPath = (typeof chrome !== "undefined" && chrome?.runtime?.getURL)
        ? chrome.runtime.getURL("models/face_landmarker.task")
        : "../models/face_landmarker.task";

    const vision = await FilesetResolver.forVisionTasks(wasmPath);

    try {
        faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath: modelPath,
                delegate: "GPU"
            },
            runningMode: "VIDEO",
            numFaces: 2,
            outputFacialTransformationMatrixes: true
        });
    } catch (gpuErr) {
        console.warn("GPU delegate failed for faceLandmarker, falling back to CPU:", gpuErr);
        faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath: modelPath,
                delegate: "CPU"
            },
            runningMode: "VIDEO",
            numFaces: 2,
            outputFacialTransformationMatrixes: true
        });
    }

    console.log("Face Landmarker initialized");
}

export function estimateHeadPose(videoElement) {
    if (!faceLandmarker) {
        throw new Error("Face landmarker is not initialized");
    }

    const result = faceLandmarker.detectForVideo(
        videoElement,
        performance.now()
    );

    if (result.faceLandmarks.length === 0) {
        return null;
    }

    const transformationMatrix =
        result.facialTransformationMatrixes[0];

    return {
        ...calculateHeadPose(transformationMatrix),
        transformationMatrix,
        landmarks: result.faceLandmarks[0]
    };
}

function calculateHeadPose(matrix) {
    const m = matrix.data;

    const r00 = m[0];
    const r01 = m[1];
    const r02 = m[2];

    const r10 = m[4];
    const r11 = m[5];
    const r12 = m[6];

    const r20 = m[8];
    const r21 = m[9];
    const r22 = m[10];

    const pitch = Math.atan2(
        -r21,
        Math.sqrt(r20 * r20 + r22 * r22)
    ) * (180 / Math.PI);

    const yaw = Math.atan2(
        r20,
        r22
    ) * (180 / Math.PI);

    const roll = Math.atan2(
        r01,
        r11
    ) * (180 / Math.PI);

    return {
        pitch,
        yaw,
        roll
    };
}

export function isHeadPoseAnomaly(headPose) {
    if (!headPose) {
        return false;
    }

    const YAW_THRESHOLD = 20;
    const PITCH_THRESHOLD = 20;
    const ROLL_THRESHOLD = 20;

    return (
        Math.abs(headPose.yaw) > YAW_THRESHOLD ||
        Math.abs(headPose.pitch) > PITCH_THRESHOLD ||
        Math.abs(headPose.roll) > ROLL_THRESHOLD
    );
}

export function estimateGaze(landmarks) {
    if (!landmarks) {
        return null;
    }

    return calculateGaze(landmarks);
}

const LEFT_IRIS = [468, 469, 470, 471, 472];
const RIGHT_IRIS = [473, 474, 475, 476, 477];

function getIrisCenter(landmarks, indices) {
    let x = 0;
    let y = 0;

    for (const index of indices) {
        x += landmarks[index].x;
        y += landmarks[index].y;
    }

    return {
        x: x / indices.length,
        y: y / indices.length
    };
}

function calculateGaze(landmarks) {
    const leftIris = getIrisCenter(landmarks, LEFT_IRIS);
    const rightIris = getIrisCenter(landmarks, RIGHT_IRIS);

    // Left eye
    const leftEyeOuter = landmarks[33];
    const leftEyeInner = landmarks[133];

    // Right eye
    const rightEyeInner = landmarks[362];
    const rightEyeOuter = landmarks[263];

    const leftEyeWidth =
        Math.abs(leftEyeOuter.x - leftEyeInner.x);

    const rightEyeWidth =
        Math.abs(rightEyeOuter.x - rightEyeInner.x);

    const leftGazeX =
        (leftIris.x - Math.min(leftEyeOuter.x, leftEyeInner.x)) /
        leftEyeWidth;

    const rightGazeX =
        (rightIris.x - Math.min(rightEyeInner.x, rightEyeOuter.x)) /
        rightEyeWidth;

    const gazeX = (leftGazeX + rightGazeX) / 2;

    let direction = "CENTER";

    if (gazeX < 0.35) {
        direction = "RIGHT";
    }
    else if (gazeX > 0.65) {
        direction = "LEFT";
    }

    return {
        gazeX,
        direction
    };
}