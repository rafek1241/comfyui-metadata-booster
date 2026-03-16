import {
    getAvifMetadata,
    getPngMetadata,
    getWebpMetadata,
} from "../../scripts/pnginfo.js";

import { extractFilenameFromUrl } from "./media-target.js";
import { parseEmbeddedVideoMetadata } from "./video-metadata.js";

const SECTION_TITLES = [
    "Prompts",
    "Models and LoRAs",
    "Sampling and Noise",
    "Seeds and Steps",
    "Dimensions and Output",
    "Raw / Other",
];

const MODEL_INPUT_KEYS = new Set([
    "ckpt_name",
    "model_name",
    "unet_name",
    "clip_name",
    "clip_name1",
    "clip_name2",
    "vae_name",
    "lora_name",
    "control_net_name",
    "controlnet_name",
    "motion_model",
    "upscale_model",
    "upscaler_name",
    "style_model",
    "embedding",
]);

const SAMPLING_INPUT_KEYS = new Set([
    "sampler_name",
    "sampler",
    "scheduler",
    "cfg",
    "denoise",
    "eta",
]);

const STEP_INPUT_KEYS = new Set([
    "seed",
    "noise_seed",
    "seed_num",
    "steps",
    "start_at_step",
    "end_at_step",
    "last_step",
]);

const DIMENSION_INPUT_KEYS = new Set([
    "width",
    "height",
    "batch_size",
    "fps",
    "frame_rate",
    "frames",
    "length",
]);

const OUTPUT_INPUT_KEYS = new Set(["filename_prefix", "format", "codec", "subfolder"]);

function safeJsonParse(value) {
    if (typeof value !== "string") {
        return value;
    }

    const trimmed = value.trim();
    if (!trimmed) {
        return value;
    }

    const startsLikeJson =
        (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
        (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
        (trimmed.startsWith('"') && trimmed.endsWith('"'));

    if (!startsLikeJson) {
        return value;
    }

    try {
        return JSON.parse(trimmed);
    } catch {
        return value;
    }
}

function looksLikeComfyPromptGraph(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return false;
    }

    return Object.values(value).some(
        (node) =>
            node &&
            typeof node === "object" &&
            !Array.isArray(node) &&
            (typeof node.class_type === "string" ||
                typeof node._meta?.title === "string" ||
                (node.inputs && typeof node.inputs === "object")),
    );
}

function looksLikeComfyWorkflow(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return false;
    }

    return (
        Array.isArray(value.nodes) ||
        Array.isArray(value.links) ||
        value.last_node_id !== undefined ||
        value.last_link_id !== undefined
    );
}

function normalizeMetadataValue(value) {
    const parsed = safeJsonParse(value);
    if (!parsed || typeof parsed !== "object") {
        return parsed;
    }

    if (Array.isArray(parsed)) {
        return parsed.map((item) => normalizeMetadataValue(item));
    }

    return Object.fromEntries(
        Object.entries(parsed).map(([key, item]) => [key, normalizeMetadataValue(item)]),
    );
}

function findNestedComfyMetadata(value, collected = {}) {
    if (!value || typeof value !== "object") {
        return collected;
    }

    if (Array.isArray(value)) {
        for (const item of value) {
            findNestedComfyMetadata(item, collected);
            if (collected.prompt && collected.workflow) {
                return collected;
            }
        }
        return collected;
    }

    for (const [key, child] of Object.entries(value)) {
        const normalizedKey = String(key).toLowerCase();
        if (!collected.prompt && normalizedKey === "prompt" && looksLikeComfyPromptGraph(child)) {
            collected.prompt = child;
        }
        if (!collected.workflow && normalizedKey === "workflow" && looksLikeComfyWorkflow(child)) {
            collected.workflow = child;
        }

        if (child && typeof child === "object") {
            findNestedComfyMetadata(child, collected);
        }

        if (collected.prompt && collected.workflow) {
            return collected;
        }
    }

    return collected;
}

function normalizeRawMetadata(rawMetadata) {
    const normalized = {};
    for (const [key, value] of Object.entries(rawMetadata ?? {})) {
        normalized[key] = normalizeMetadataValue(value);
    }

    const embeddedComfyMetadata = findNestedComfyMetadata(normalized);
    if (embeddedComfyMetadata.prompt && !looksLikeComfyPromptGraph(normalized.prompt)) {
        normalized.prompt = embeddedComfyMetadata.prompt;
    }
    if (embeddedComfyMetadata.workflow && !looksLikeComfyWorkflow(normalized.workflow)) {
        normalized.workflow = embeddedComfyMetadata.workflow;
    }

    return normalized;
}

function mergeValues(existingValue, nextValue) {
    if (existingValue === undefined) {
        return nextValue;
    }

    if (JSON.stringify(existingValue) === JSON.stringify(nextValue)) {
        return existingValue;
    }

    if (Array.isArray(existingValue)) {
        if (!existingValue.some((item) => JSON.stringify(item) === JSON.stringify(nextValue))) {
            existingValue.push(nextValue);
        }
        return existingValue;
    }

    return [existingValue, nextValue];
}

function formatKeyLabel(key) {
    const normalized = String(key ?? "")
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    const specialLabels = {
        cfg: "CFG",
        ckpt: "Checkpoint",
        lora: "LoRA",
        vae: "VAE",
        fps: "FPS",
        id: "ID",
    };

    return normalized
        .split(" ")
        .map((part) => {
            const lower = part.toLowerCase();
            if (specialLabels[lower]) {
                return specialLabels[lower];
            }
            return lower.charAt(0).toUpperCase() + lower.slice(1);
        })
        .join(" ");
}

function previewKeyFromLabel(label) {
    return String(label ?? "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
}

function truncatePreviewText(value, limit = 180) {
    const text = String(value ?? "").replace(/\s+/g, " ").trim();
    if (!text) {
        return "";
    }
    return text.length > limit ? `${text.slice(0, limit - 1)}...` : text;
}

function previewValueFromMetadata(value) {
    if (value === undefined || value === null || value === "") {
        return null;
    }

    if (Array.isArray(value)) {
        const scalarItems = value.filter(
            (item) => typeof item === "string" || typeof item === "number" || typeof item === "boolean",
        );
        return scalarItems.length === value.length ? scalarItems.join(", ") : null;
    }

    if (typeof value === "object") {
        return null;
    }

    return value;
}

function formatDuration(seconds) {
    const numeric = Number(seconds);
    if (!Number.isFinite(numeric) || numeric < 0) {
        return null;
    }
    return `${numeric.toFixed(2)}s`;
}

function detectMediaFormat(blob, filename, bytes, requestedKind) {
    const lowerName = String(filename ?? "").toLowerCase();
    const mimeType = String(blob?.type ?? "").toLowerCase();
    const extension = lowerName.includes(".") ? lowerName.split(".").pop() : "";
    const isIsobmff = bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70;
    const brand = isIsobmff
        ? String.fromCharCode(bytes[8] ?? 0, bytes[9] ?? 0, bytes[10] ?? 0, bytes[11] ?? 0)
        : "";

    if (
        bytes[0] === 0x89 &&
        bytes[1] === 0x50 &&
        bytes[2] === 0x4e &&
        bytes[3] === 0x47
    ) {
        return { mediaKind: "image", format: "png", mimeType, supported: true };
    }

    if (
        bytes[0] === 0x52 &&
        bytes[1] === 0x49 &&
        bytes[2] === 0x46 &&
        bytes[3] === 0x46 &&
        bytes[8] === 0x57 &&
        bytes[9] === 0x45 &&
        bytes[10] === 0x42 &&
        bytes[11] === 0x50
    ) {
        return { mediaKind: "image", format: "webp", mimeType, supported: true };
    }

    if (isIsobmff && (brand === "avif" || brand === "avis" || extension === "avif")) {
        return { mediaKind: "image", format: "avif", mimeType, supported: true };
    }

    if (
        bytes[0] === 0x1a &&
        bytes[1] === 0x45 &&
        bytes[2] === 0xdf &&
        bytes[3] === 0xa3
    ) {
        const format = extension === "mkv" ? "mkv" : "webm";
        return { mediaKind: "video", format, mimeType, supported: true };
    }

    if (isIsobmff) {
        const format = extension || (mimeType.includes("quicktime") ? "mov" : "mp4");
        const supported = ["mp4", "mov", "m4v"].includes(format);
        return { mediaKind: requestedKind || "video", format, mimeType, supported };
    }

    if (mimeType.startsWith("image/")) {
        const format = extension || mimeType.split("/")[1] || "image";
        return {
            mediaKind: "image",
            format,
            mimeType,
            supported: ["png", "webp", "avif"].includes(format),
        };
    }

    if (mimeType.startsWith("video/")) {
        const format = extension || mimeType.split("/")[1] || "video";
        return {
            mediaKind: requestedKind || "video",
            format,
            mimeType,
            supported: ["mp4", "mov", "m4v", "webm", "mkv"].includes(format),
        };
    }

    return {
        mediaKind: requestedKind || "image",
        format: extension || "unknown",
        mimeType,
        supported: false,
    };
}

async function readImageMetadata(blob, filename, format) {
    const file = new File([blob], filename || `metadata.${format}`, {
        type: blob.type || `image/${format}`,
    });

    if (format === "png") {
        return (await getPngMetadata(file)) ?? {};
    }
    if (format === "webp") {
        return (await getWebpMetadata(file)) ?? {};
    }
    if (format === "avif") {
        return (await getAvifMetadata(file)) ?? {};
    }

    return {};
}

async function readImageDetails(blob) {
    if (typeof createImageBitmap === "function") {
        const bitmap = await createImageBitmap(blob);
        const details = {
            width: bitmap.width,
            height: bitmap.height,
        };
        bitmap.close?.();
        return details;
    }

    const objectUrl = URL.createObjectURL(blob);
    try {
        return await new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
            image.onerror = () => reject(new Error("Unable to read image dimensions."));
            image.src = objectUrl;
        });
    } finally {
        URL.revokeObjectURL(objectUrl);
    }
}

async function readVideoDetails(blob) {
    const objectUrl = URL.createObjectURL(blob);
    try {
        return await new Promise((resolve) => {
            const video = document.createElement("video");
            video.preload = "metadata";
            video.muted = true;
            video.onloadedmetadata = () =>
                resolve({
                    width: video.videoWidth || undefined,
                    height: video.videoHeight || undefined,
                    duration: Number.isFinite(video.duration) ? video.duration : undefined,
                });
            video.onerror = () => resolve({});
            video.src = objectUrl;
            video.load();
        });
    } finally {
        URL.revokeObjectURL(objectUrl);
    }
}

async function readIntrinsicDetails(blob, mediaKind) {
    try {
        if (mediaKind === "video") {
            return await readVideoDetails(blob);
        }
        return await readImageDetails(blob);
    } catch {
        return {};
    }
}

function createSectionState() {
    return new Map(SECTION_TITLES.map((title) => [title, new Map()]));
}

function addEntry(sectionState, sectionTitle, label, value) {
    if (!sectionState.has(sectionTitle)) {
        sectionState.set(sectionTitle, new Map());
    }

    if (value === undefined || value === null || value === "") {
        return;
    }

    const section = sectionState.get(sectionTitle);
    const existing = section.get(label);
    section.set(label, mergeValues(existing, value));
}

function setPreviewValue(preview, key, value, { overwrite = false } = {}) {
    if (value === undefined || value === null || value === "") {
        return;
    }

    const textValue = Array.isArray(value)
        ? value.map((item) => String(item)).join(", ")
        : String(value);

    if (!preview[key] || overwrite) {
        preview[key] = textValue;
        return;
    }

    if (preview[key] === textValue) {
        return;
    }

    const merged = new Set(
        `${preview[key]}, ${textValue}`
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean),
    );
    preview[key] = Array.from(merged).join(", ");
}

function rawSectionForKey(key) {
    const lower = String(key ?? "").toLowerCase();
    if (lower.includes("prompt")) {
        return "Prompts";
    }
    if (
        lower.includes("model") ||
        lower.includes("ckpt") ||
        lower.includes("lora") ||
        lower.includes("vae") ||
        lower.includes("control")
    ) {
        return "Models and LoRAs";
    }
    if (
        lower.includes("sampler") ||
        lower.includes("scheduler") ||
        lower === "cfg" ||
        lower.includes("denoise")
    ) {
        return "Sampling and Noise";
    }
    if (lower.includes("seed") || lower.includes("step")) {
        return "Seeds and Steps";
    }
    if (
        lower.includes("width") ||
        lower.includes("height") ||
        lower.includes("format") ||
        lower.includes("codec") ||
        lower.includes("subfolder")
    ) {
        return "Dimensions and Output";
    }
    return "Raw / Other";
}

function describePromptLabel(nodeName, promptCount) {
    const lower = String(nodeName ?? "").toLowerCase();
    if (lower.includes("negative")) {
        return "Negative Prompt";
    }
    if (lower.includes("positive")) {
        return "Prompt";
    }
    return promptCount === 0 ? "Prompt" : `Prompt ${promptCount + 1}`;
}

function describeModelLabel(key) {
    const labels = {
        ckpt_name: "Checkpoint",
        model_name: "Model",
        unet_name: "UNet",
        clip_name: "CLIP",
        clip_name1: "CLIP 1",
        clip_name2: "CLIP 2",
        vae_name: "VAE",
        lora_name: "LoRA",
        control_net_name: "ControlNet",
        controlnet_name: "ControlNet",
        motion_model: "Motion Model",
        upscale_model: "Upscale Model",
        upscaler_name: "Upscaler",
        style_model: "Style Model",
        embedding: "Embedding",
    };
    return labels[key] ?? formatKeyLabel(key);
}

function describeValueWithStrengths(key, value, inputs) {
    if (key !== "lora_name") {
        return value;
    }

    const details = [];
    if (inputs.strength_model !== undefined) {
        details.push(`model=${inputs.strength_model}`);
    }
    if (inputs.strength_clip !== undefined) {
        details.push(`clip=${inputs.strength_clip}`);
    }

    return details.length ? `${value} (${details.join(", ")})` : value;
}

function deriveFromPromptGraph(promptGraph, sectionState, preview) {
    const entries = Object.entries(promptGraph ?? {}).sort(([leftId], [rightId]) => {
        return Number(leftId) - Number(rightId);
    });

    let promptCount = 0;

    for (const [nodeId, nodeData] of entries) {
        if (!nodeData || typeof nodeData !== "object") {
            continue;
        }

        const nodeName = nodeData._meta?.title || nodeData.class_type || `Node ${nodeId}`;
        const inputs =
            nodeData.inputs && typeof nodeData.inputs === "object" ? nodeData.inputs : {};
        const descriptor = `${nodeName} ${nodeData.class_type ?? ""}`.toLowerCase();

        if (typeof inputs.text === "string" && /cliptext|textencode|prompt/.test(descriptor)) {
            const label = describePromptLabel(nodeName, promptCount);
            addEntry(sectionState, "Prompts", label, inputs.text);
            setPreviewValue(
                preview,
                label.toLowerCase().includes("negative") ? "negative_prompt" : "prompt",
                truncatePreviewText(inputs.text),
                { overwrite: label === "Negative Prompt" },
            );
            if (!label.toLowerCase().includes("negative")) {
                promptCount += 1;
            }
        }

        for (const [inputKey, inputValue] of Object.entries(inputs)) {
            if (
                inputValue === null ||
                inputValue === undefined ||
                typeof inputValue === "object"
            ) {
                continue;
            }

            if (MODEL_INPUT_KEYS.has(inputKey)) {
                const label = describeModelLabel(inputKey);
                const displayValue = describeValueWithStrengths(inputKey, inputValue, inputs);
                addEntry(sectionState, "Models and LoRAs", label, displayValue);
                if (label === "LoRA") {
                    setPreviewValue(preview, "loras", displayValue);
                } else {
                    setPreviewValue(preview, "model", displayValue);
                }
                continue;
            }

            if (SAMPLING_INPUT_KEYS.has(inputKey)) {
                const label = formatKeyLabel(inputKey);
                addEntry(sectionState, "Sampling and Noise", label, inputValue);
                setPreviewValue(preview, previewKeyFromLabel(label), inputValue);
                continue;
            }

            if (STEP_INPUT_KEYS.has(inputKey)) {
                const label = formatKeyLabel(inputKey);
                addEntry(sectionState, "Seeds and Steps", label, inputValue);
                setPreviewValue(preview, previewKeyFromLabel(label), inputValue);
                continue;
            }

            if (DIMENSION_INPUT_KEYS.has(inputKey)) {
                const label = formatKeyLabel(inputKey);
                addEntry(sectionState, "Dimensions and Output", label, inputValue);
                setPreviewValue(preview, previewKeyFromLabel(label), inputValue);
                continue;
            }

            if (OUTPUT_INPUT_KEYS.has(inputKey)) {
                const label = formatKeyLabel(inputKey);
                addEntry(sectionState, "Dimensions and Output", label, inputValue);
                setPreviewValue(preview, previewKeyFromLabel(label), inputValue);
            }
        }
    }
}

function deriveFromWorkflow(workflow, sectionState) {
    if (!workflow || typeof workflow !== "object") {
        return;
    }

    if (Array.isArray(workflow.nodes)) {
        addEntry(sectionState, "Dimensions and Output", "Workflow Nodes", workflow.nodes.length);
    }
    if (workflow.links && Array.isArray(workflow.links)) {
        addEntry(sectionState, "Dimensions and Output", "Workflow Links", workflow.links.length);
    }
    if (workflow.version !== undefined) {
        addEntry(sectionState, "Dimensions and Output", "Workflow Version", workflow.version);
    }
}

function finalizeSections(sectionState) {
    return SECTION_TITLES.map((title) => ({
        title,
        entries: Array.from(sectionState.get(title)?.entries() ?? []).map(([label, value]) => ({
            label,
            value,
        })),
    })).filter((section) => section.entries.length > 0);
}

function sectionsToClipboardObject(sections) {
    return Object.fromEntries(
        sections.map((section) => [
            section.title,
            Object.fromEntries(section.entries.map((entry) => [entry.label, entry.value])),
        ]),
    );
}

function buildNormalizedMetadata(source, formatInfo, intrinsicDetails, rawMetadata) {
    const normalizedRawMetadata = normalizeRawMetadata(rawMetadata);
    const sectionState = createSectionState();
    const preview = {};

    addEntry(sectionState, "Dimensions and Output", "Filename", source.filename);
    addEntry(sectionState, "Dimensions and Output", "Context", source.context);
    addEntry(sectionState, "Dimensions and Output", "Media Type", formatInfo.mediaKind);
    addEntry(sectionState, "Dimensions and Output", "Format", formatInfo.format.toUpperCase());

    setPreviewValue(preview, "filename", source.filename);
    setPreviewValue(preview, "format", formatInfo.format.toUpperCase());

    if (intrinsicDetails.width && intrinsicDetails.height) {
        const dimensions = `${intrinsicDetails.width}x${intrinsicDetails.height}`;
        addEntry(sectionState, "Dimensions and Output", "Dimensions", dimensions);
        addEntry(sectionState, "Dimensions and Output", "Width", intrinsicDetails.width);
        addEntry(sectionState, "Dimensions and Output", "Height", intrinsicDetails.height);
        setPreviewValue(preview, "dimensions", dimensions);
        setPreviewValue(preview, "width", intrinsicDetails.width);
        setPreviewValue(preview, "height", intrinsicDetails.height);
    }

    const duration = formatDuration(intrinsicDetails.duration);
    if (duration) {
        addEntry(sectionState, "Dimensions and Output", "Duration", duration);
        setPreviewValue(preview, "duration", duration);
    }

    for (const [key, value] of Object.entries(normalizedRawMetadata)) {
        addEntry(sectionState, rawSectionForKey(key), formatKeyLabel(key), value);
        const previewValue = previewValueFromMetadata(value);
        if (previewValue !== null) {
            setPreviewValue(preview, previewKeyFromLabel(key), previewValue);
        }

        if (key === "prompt" && value && typeof value === "object" && !Array.isArray(value)) {
            deriveFromPromptGraph(value, sectionState, preview);
        }
        if (key === "workflow" && value && typeof value === "object" && !Array.isArray(value)) {
            deriveFromWorkflow(value, sectionState);
        }
    }

    const sections = finalizeSections(sectionState);
    const hasEmbeddedMetadata = Object.keys(normalizedRawMetadata).length > 0;
    const statusMessage = !formatInfo.supported
        ? `Metadata Booster does not support embedded ${formatInfo.format.toUpperCase()} metadata yet.`
        : hasEmbeddedMetadata
            ? "Embedded metadata loaded."
            : "No embedded metadata found in this file.";

    if (!hasEmbeddedMetadata) {
        setPreviewValue(preview, "status", statusMessage, { overwrite: true });
    }

    return {
        source: {
            ...source,
            mimeType: formatInfo.mimeType,
            format: formatInfo.format,
            dimensions:
                intrinsicDetails.width && intrinsicDetails.height
                    ? {
                        width: intrinsicDetails.width,
                        height: intrinsicDetails.height,
                    }
                    : null,
            duration: intrinsicDetails.duration ?? null,
        },
        rawMetadata: normalizedRawMetadata,
        sections,
        preview,
        statusMessage,
        hasEmbeddedMetadata,
        clipboard: {
            source: {
                filename: source.filename,
                context: source.context,
                mediaKind: formatInfo.mediaKind,
                format: formatInfo.format,
                mimeType: formatInfo.mimeType,
                dimensions:
                    intrinsicDetails.width && intrinsicDetails.height
                        ? {
                            width: intrinsicDetails.width,
                            height: intrinsicDetails.height,
                        }
                        : null,
                duration: intrinsicDetails.duration ?? null,
                url: source.url,
            },
            status: statusMessage,
            preview,
            rawMetadata: normalizedRawMetadata,
            groupedMetadata: sectionsToClipboardObject(sections),
        },
    };
}

export function extractWorkflowFromMetadata(metadata) {
    const rawMetadata = metadata?.rawMetadata;
    if (!rawMetadata || typeof rawMetadata !== "object") {
        return null;
    }

    const normalizedRawMetadata = normalizeRawMetadata(rawMetadata);
    return looksLikeComfyWorkflow(normalizedRawMetadata.workflow)
        ? normalizedRawMetadata.workflow
        : null;
}

async function inspectSourceInternal(source) {
    const filename =
        source.filename || extractFilenameFromUrl(source.url || source.rawUrl) || "metadata-source";

    const response = await fetch(source.url || source.rawUrl, { cache: "no-store" });
    if (!response.ok) {
        throw new Error(`Unable to load media for metadata inspection (${response.status}).`);
    }

    const blob = await response.blob();
    const arrayBuffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    const formatInfo = detectMediaFormat(blob, filename, bytes, source.mediaKind);

    let rawMetadata = {};
    if (formatInfo.supported && formatInfo.mediaKind === "image") {
        rawMetadata = await readImageMetadata(blob, filename, formatInfo.format);
    } else if (formatInfo.supported && formatInfo.mediaKind === "video") {
        rawMetadata = parseEmbeddedVideoMetadata(arrayBuffer, formatInfo.format);
    }

    const intrinsicDetails = await readIntrinsicDetails(blob, formatInfo.mediaKind);

    return buildNormalizedMetadata(
        {
            ...source,
            filename,
        },
        formatInfo,
        intrinsicDetails,
        rawMetadata,
    );
}

export function createMetadataService() {
    const cache = new Map();

    return {
        async inspectSource(source) {
            const cacheKey = `${source.context}:${source.url || source.rawUrl}`;
            if (!cache.has(cacheKey)) {
                cache.set(
                    cacheKey,
                    inspectSourceInternal(source).catch((error) => {
                        cache.delete(cacheKey);
                        throw error;
                    }),
                );
            }

            return cache.get(cacheKey);
        },
    };
}
