const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

// Ensure wasm directory is copied into dist/wasm
const wasmSrc = path.join(__dirname, "node_modules/@mediapipe/tasks-vision/wasm");
const wasmDest = path.join(__dirname, "dist/wasm");
if (fs.existsSync(wasmSrc)) {
    fs.mkdirSync(wasmDest, { recursive: true });
    fs.cpSync(wasmSrc, wasmDest, { recursive: true });
    console.log("WASM files copied to dist/wasm");
}

Promise.all([
    esbuild.build({
        entryPoints: ["src/models/faceDetector.js"],
        bundle: true,
        outfile: "dist/faceDetector.js",
        format: "iife",
        globalName: "ExamGuardVision",
        platform: "browser",
        sourcemap: true
    }),

    esbuild.build({
        entryPoints: ["src/models/headPoseEstimator.js"],
        bundle: true,
        outfile: "dist/headPoseEstimator.js",
        format: "iife",
        globalName: "ExamGuardHeadPose",
        platform: "browser",
        sourcemap: true
    }),

    esbuild.build({
        entryPoints: ["src/models/audioIndex.js"],
        bundle: true,
        outfile: "dist/audioAnalyzer.js",
        format: "iife",
        globalName: "ExamGuardAudio",
        platform: "browser",
        sourcemap: true
    })
])
.then(() => {
    console.log("BUILD SUCCESSFUL");
})
.catch((error) => {
    console.error("BUILD FAILED");
    console.error(error);
    process.exit(1);
});