const PREVIEW_PARAM_NAMES = [
    "preview",
    "format",
    "quality",
    "width",
    "height",
    "channel",
    "t",
];

function parseUrl(value) {
    try {
        return new URL(value, window.location.href);
    } catch {
        return null;
    }
}

function isComfyViewUrl(value) {
    if (!value) {
        return false;
    }

    if (String(value).startsWith("blob:")) {
        return true;
    }

    const url = parseUrl(value);
    return Boolean(url?.pathname.endsWith("/view") && url.searchParams.get("filename"));
}

function getMediaElementFromContainer(container) {
    if (container instanceof HTMLVideoElement || container instanceof HTMLImageElement) {
        return container;
    }

    return container?.querySelector?.("video, img") ?? null;
}

function getMediaUrlFromElement(element) {
    if (element instanceof HTMLVideoElement) {
        return (
            element.currentSrc ||
            element.src ||
            element.querySelector("source")?.src ||
            element.poster ||
            null
        );
    }

    if (element instanceof HTMLImageElement) {
        return element.currentSrc || element.src || null;
    }

    return null;
}

export function normalizeMediaUrl(value) {
    if (!value) {
        return null;
    }

    if (String(value).startsWith("blob:")) {
        return value;
    }

    const url = parseUrl(value);
    if (!url) {
        return null;
    }

    for (const name of PREVIEW_PARAM_NAMES) {
        url.searchParams.delete(name);
    }

    return url.toString();
}

export function extractFilenameFromUrl(value) {
    const url = parseUrl(value);
    if (!url) {
        return null;
    }

    const filename = url.searchParams.get("filename");
    if (filename) {
        return filename;
    }

    const segments = url.pathname.split("/").filter(Boolean);
    return segments.length ? decodeURIComponent(segments[segments.length - 1]) : null;
}

function buildResolvedSource(mediaElement, context, rootElement) {
    const rawUrl = getMediaUrlFromElement(mediaElement);
    if (!isComfyViewUrl(rawUrl)) {
        return null;
    }

    return {
        rawUrl,
        url: normalizeMediaUrl(rawUrl) ?? rawUrl,
        filename:
            extractFilenameFromUrl(rawUrl) ??
            `preview-${context === "asset-media" ? "asset" : "node"}`,
        mediaKind: mediaElement instanceof HTMLVideoElement ? "video" : "image",
        context,
        element: mediaElement,
        rootElement,
    };
}

export function resolveMediaSourceFromTarget(
    target,
    { assetOnly = false, allowContainerFallback = false } = {},
) {
    const element = target instanceof Element ? target : null;
    if (!element) {
        return null;
    }

    const assetCard = element.closest("[role='button'][data-selected]");
    if (assetCard) {
        const mediaElement =
            element.closest("video, img") ??
            (allowContainerFallback ? getMediaElementFromContainer(assetCard) : null);
        return mediaElement ? buildResolvedSource(mediaElement, "asset-media", assetCard) : null;
    }

    if (assetOnly) {
        return null;
    }

    const previewContainer = element.closest(".image-preview, .video-preview, .comfy-img-preview");
    if (!previewContainer) {
        return null;
    }

    const mediaElement =
        element.closest("video, img") ?? getMediaElementFromContainer(previewContainer);
    return mediaElement
        ? buildResolvedSource(mediaElement, "node-preview", previewContainer)
        : null;
}

export function resolveNodeImageSource(node) {
    if (!node?.imgs?.length) {
        return null;
    }

    const selectedIndex = Number.isInteger(node.imageIndex)
        ? node.imageIndex
        : Number.isInteger(node.overIndex)
            ? node.overIndex
            : 0;

    const image = node.imgs[selectedIndex] ?? node.imgs[0];
    if (!image?.src || !isComfyViewUrl(image.src)) {
        return null;
    }

    return {
        rawUrl: image.src,
        url: normalizeMediaUrl(image.src) ?? image.src,
        filename: extractFilenameFromUrl(image.src) ?? `node-${node.id ?? "preview"}.png`,
        mediaKind: "image",
        context: "node-menu",
        element: image,
        rootElement: null,
    };
}
