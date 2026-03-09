import { app } from "../../scripts/app.js";

import { extractFilenameFromUrl, normalizeMediaUrl } from "./media-target.js";
import { getSettingsState, subscribeSettings } from "./settings.js";

const SIDEBAR_TAB_ID = "MetadataBooster.SidebarBrowser";
const GENERATED_SCAN_INTERVAL = 1500;
const SIDEBAR_VISIBILITY_INTERVAL = 150;
const IMAGE_OUTPUT_PATTERNS = [
    /(^|[^a-z])saveimage([^a-z]|$)/i,
    /(^|[^a-z])previewimage([^a-z]|$)/i,
    /save[\s_-]*image/i,
    /preview[\s_-]*image/i,
    /image[\s_-]*save/i,
    /image[\s_-]*preview/i,
];
const VIDEO_OUTPUT_PATTERNS = [
    /(^|[^a-z])savevideo([^a-z]|$)/i,
    /(^|[^a-z])previewvideo([^a-z]|$)/i,
    /save[\s_-]*video/i,
    /preview[\s_-]*video/i,
    /video[\s_-]*save/i,
    /video[\s_-]*preview/i,
];

const IMAGE_EXTENSIONS = new Set([
    "png",
    "jpg",
    "jpeg",
    "webp",
    "avif",
    "gif",
    "bmp",
    "tif",
    "tiff",
]);

const VIDEO_EXTENSIONS = new Set([
    "mp4",
    "mov",
    "m4v",
    "webm",
    "mkv",
    "avi",
    "wmv",
]);

function createElement(tagName, className, textContent) {
    const element = document.createElement(tagName);
    if (className) {
        element.className = className;
    }
    if (textContent !== undefined) {
        element.textContent = textContent;
    }
    return element;
}

function parseUrl(value) {
    try {
        return new URL(value, window.location.href);
    } catch {
        return null;
    }
}

function pluralize(count, singular, plural = `${singular}s`) {
    return `${count} ${count === 1 ? singular : plural}`;
}

function getFileExtension(fileName) {
    const name = String(fileName ?? "");
    const index = name.lastIndexOf(".");
    return index === -1 ? "" : name.slice(index + 1).toLowerCase();
}

function isSupportedPreviewUrl(value) {
    if (!value) {
        return false;
    }

    if (String(value).startsWith("blob:")) {
        return true;
    }

    const url = parseUrl(value);
    return Boolean(url?.pathname.endsWith("/view") && url.searchParams.get("filename"));
}

function normalizePreviewUrl(value) {
    if (!isSupportedPreviewUrl(value)) {
        return null;
    }

    return normalizeMediaUrl(value) ?? String(value);
}

function getSidebarManager() {
    return app.extensionManager?.sidebarTab ?? app.extensionManager ?? null;
}

function getActiveSidebarTabId() {
    const sidebarManager = getSidebarManager();
    const activeSidebarTab = app.extensionManager?.activeSidebarTab;
    return (
        sidebarManager?.activeSidebarTabId ??
        app.extensionManager?.sidebarTab?.activeSidebarTab?.id ??
        (typeof activeSidebarTab === "string" ? activeSidebarTab : activeSidebarTab?.id) ??
        null
    );
}

function getGraphNodes() {
    return app.graph?._nodes ?? app.canvas?.graph?._nodes ?? [];
}

function getNodeClassNames(node) {
    return Array.from(
        new Set(
            [
                node?.type,
                node?.comfyClass,
                node?.constructor?.comfyClass,
                node?.constructor?.nodeData?.name,
                node?.title,
            ]
                .map((value) => String(value ?? "").trim())
                .filter(Boolean),
        ),
    );
}

function matchesOutputPattern(node, patterns) {
    return getNodeClassNames(node).some((name) => patterns.some((pattern) => pattern.test(name)));
}

function isTrackedOutputNode(node, mediaKind) {
    return mediaKind === "video"
        ? matchesOutputPattern(node, VIDEO_OUTPUT_PATTERNS)
        : matchesOutputPattern(node, IMAGE_OUTPUT_PATTERNS);
}

function getMediaElementFromContainer(container) {
    if (container instanceof HTMLImageElement || container instanceof HTMLVideoElement) {
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

function createLocalItemId(index) {
    if (typeof crypto?.randomUUID === "function") {
        return `metadata-browser-local-${index}-${crypto.randomUUID()}`;
    }

    return `metadata-browser-local-${index}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createGeneratedItemId(key) {
    const slug = key
        .replace(/[^a-z0-9]+/gi, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 160);
    return `metadata-browser-generated-${slug || "item"}`;
}

function resolveMediaKind(file) {
    const mimeType = String(file?.type ?? "").toLowerCase();
    if (mimeType.startsWith("image/")) {
        return "image";
    }
    if (mimeType.startsWith("video/")) {
        return "video";
    }

    const extension = getFileExtension(file?.name);
    if (IMAGE_EXTENSIONS.has(extension)) {
        return "image";
    }
    if (VIDEO_EXTENSIONS.has(extension)) {
        return "video";
    }

    return null;
}

function resolveMediaKindFromUrl(rawUrl, fallbackKind = null) {
    const filename = extractFilenameFromUrl(rawUrl) ?? rawUrl;
    const extension = getFileExtension(filename);
    if (IMAGE_EXTENSIONS.has(extension)) {
        return "image";
    }
    if (VIDEO_EXTENSIONS.has(extension)) {
        return "video";
    }

    return fallbackKind;
}

function showToast(severity, summary, detail) {
    if (app.extensionManager?.toast?.add) {
        app.extensionManager.toast.add({
            severity,
            summary,
            detail,
            life: 3500,
        });
        return;
    }

    if (severity === "error") {
        console.error(summary, detail);
    } else {
        console.log(summary, detail);
    }
}

function toSidebarSource(item, element) {
    return {
        rawUrl: item.rawUrl,
        url: item.url,
        filename: item.filename,
        mediaKind: item.mediaKind,
        context: item.sourceType === "generated" ? "sidebar-generated" : "sidebar-browser",
        element,
        rootElement: element,
    };
}

async function readDirectoryEntries(reader) {
    return new Promise((resolve, reject) => {
        reader.readEntries(resolve, reject);
    });
}

async function entryToFiles(entry, pathPrefix = "") {
    if (!entry) {
        return [];
    }

    if (entry.isFile) {
        return new Promise((resolve) => {
            entry.file(
                (file) => {
                    resolve([
                        {
                            file,
                            relativePath: pathPrefix ? `${pathPrefix}/${file.name}` : file.name,
                        },
                    ]);
                },
                () => resolve([]),
            );
        });
    }

    if (!entry.isDirectory) {
        return [];
    }

    const reader = entry.createReader();
    const children = [];
    while (true) {
        const batch = await readDirectoryEntries(reader);
        if (!batch.length) {
            break;
        }
        children.push(...batch);
    }

    const nextPrefix = pathPrefix ? `${pathPrefix}/${entry.name}` : entry.name;
    const nested = await Promise.all(children.map((child) => entryToFiles(child, nextPrefix)));
    return nested.flat();
}

async function transferItemsToFiles(dataTransfer) {
    const items = Array.from(dataTransfer?.items ?? []);
    if (items.length && items.some((item) => typeof item.webkitGetAsEntry === "function")) {
        const nested = await Promise.all(
            items
                .filter((item) => item.kind === "file")
                .map((item) => entryToFiles(item.webkitGetAsEntry())),
        );
        return nested.flat();
    }

    return Array.from(dataTransfer?.files ?? []).map((file) => ({
        file,
        relativePath: file.webkitRelativePath || file.name,
    }));
}

function makeGeneratedItem({ rawUrl, mediaKind, nodeLabel }) {
    const url = normalizePreviewUrl(rawUrl);
    if (!url) {
        return null;
    }

    const filename = extractFilenameFromUrl(rawUrl) ?? `${nodeLabel}-${mediaKind}`;
    const resolvedKind = resolveMediaKindFromUrl(filename, mediaKind);
    if (!resolvedKind) {
        return null;
    }

    const key = `${resolvedKind}::${url}`;
    return {
        id: createGeneratedItemId(key),
        key,
        sourceType: "generated",
        rawUrl,
        url,
        previewUrl: rawUrl,
        filename,
        mediaKind: resolvedKind,
        relativePath: `${nodeLabel} · live output`,
        extension: getFileExtension(filename).toUpperCase() || resolvedKind.toUpperCase(),
        revokeOnDispose: false,
    };
}

function collectGeneratedPreviewItems() {
    const seen = new Set();
    const items = [];

    const appendGeneratedItem = (candidate) => {
        if (!candidate || seen.has(candidate.key)) {
            return;
        }

        seen.add(candidate.key);
        items.push(candidate);
    };

    for (const node of getGraphNodes()) {
        const nodeLabel = String(node?.title || node?.type || `Node ${node?.id ?? "preview"}`);

        if (isTrackedOutputNode(node, "image")) {
            for (const preview of Array.isArray(node?.imgs) ? node.imgs : []) {
                const rawUrl =
                    typeof preview === "string"
                        ? preview
                        : preview?.currentSrc || preview?.src || null;
                appendGeneratedItem(
                    makeGeneratedItem({
                        rawUrl,
                        mediaKind: resolveMediaKindFromUrl(rawUrl, "image"),
                        nodeLabel,
                    }),
                );
            }
        }

        const videoElement = getMediaElementFromContainer(node?.videoContainer);
        if (videoElement && isTrackedOutputNode(node, "video")) {
            const rawUrl = getMediaUrlFromElement(videoElement);
            appendGeneratedItem(
                makeGeneratedItem({
                    rawUrl,
                    mediaKind: videoElement instanceof HTMLVideoElement ? "video" : "image",
                    nodeLabel,
                }),
            );
        }
    }

    items.sort((left, right) => {
        return left.relativePath.localeCompare(right.relativePath, undefined, {
            numeric: true,
            sensitivity: "base",
        });
    });

    return items;
}

export class MetadataBoosterSidebarBrowser {
    constructor({ onShowMetadata }) {
        this.onShowMetadata = onShowMetadata;
        this.settings = getSettingsState();
        this.localItems = [];
        this.generatedItems = [];
        this.dismissedGeneratedKeys = new Set();
        this.generatedSignature = "";
        this.selectedId = null;
        this.isDragActive = false;
        this.suppressOpenUntil = 0;
        this.isViewerOpen = false;
        this.status = "Drop a file or folder to inspect embedded metadata.";
        this.statusState = "idle";

        this.element = createElement("div", "metadata-booster-browser");
        document.querySelectorAll(".metadata-booster-browser-viewer").forEach((element) => element.remove());
        this.viewerElement = this.createViewer();
        this.element.addEventListener("dragenter", (event) => this.handleDragEnter(event));
        this.element.addEventListener("dragover", (event) => this.handleDragOver(event));
        this.element.addEventListener("dragleave", (event) => this.handleDragLeave(event));
        this.element.addEventListener("drop", (event) => {
            void this.handleDrop(event);
        });

        this.unsubscribeSettings = subscribeSettings((settings) => {
            this.settings = settings;
            if (!settings.sidebarBrowserAutoGeneratedEnabled && this.generatedItems.length) {
                this.generatedItems = [];
                this.generatedSignature = "";
            }
            if (settings.sidebarBrowserAutoGeneratedEnabled) {
                this.refreshGeneratedItems({ force: true });
            }
            this.render();
            this.syncActiveVisibility();
        });

        this.visibilityTimer = window.setInterval(
            () => this.syncActiveVisibility(),
            SIDEBAR_VISIBILITY_INTERVAL,
        );
        this.generatedScanTimer = window.setInterval(
            () => this.refreshGeneratedItems(),
            GENERATED_SCAN_INTERVAL,
        );
        this.boundViewerKeyDown = (event) => {
            if (event.key === "Escape") {
                this.closeViewer();
            }
        };
        document.addEventListener("keydown", this.boundViewerKeyDown);

        this.refreshGeneratedItems({ force: true });
        this.render();
    }

    mount(container) {
        this.container = container;
        if (this.element.parentElement !== container) {
            container.replaceChildren(this.element);
        }
        this.syncActiveVisibility();
        this.render();
    }

    unmount() {
        this.element.style.display = "none";
        this.element.inert = true;
        this.element.remove();
        this.container = null;
    }

    dispose() {
        window.clearInterval(this.visibilityTimer);
        window.clearInterval(this.generatedScanTimer);
        this.visibilityTimer = null;
        this.generatedScanTimer = null;

        if (this.boundViewerKeyDown) {
            document.removeEventListener("keydown", this.boundViewerKeyDown);
            this.boundViewerKeyDown = null;
        }

        this.unsubscribeSettings?.();
        this.unsubscribeSettings = null;

        this.closeViewer();
        this.revokeObjectUrls();
        this.localItems = [];
        this.generatedItems = [];
        this.generatedSignature = "";
        this.dismissedGeneratedKeys.clear();
        this.unmount();
        this.viewerElement?.remove();
        this.viewerElement = null;
        this.viewerTitleElement = null;
        this.viewerBodyElement = null;
    }

    createViewer() {
        const overlay = createElement("div", "metadata-booster-browser-viewer");
        overlay.hidden = true;
        overlay.onclick = (event) => {
            if (event.target === overlay) {
                this.closeViewer();
            }
        };

        const content = createElement("div", "metadata-booster-browser-viewer-content");
        const closeButton = createElement("button", "metadata-booster-browser-viewer-close");
        closeButton.type = "button";
        closeButton.setAttribute("aria-label", "Close full size preview");
        closeButton.title = "Close";
        closeButton.append(createElement("i", "pi pi-times"));
        closeButton.onclick = (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.closeViewer();
        };

        const title = createElement("div", "metadata-booster-browser-viewer-title");
        const body = createElement("div", "metadata-booster-browser-viewer-body");
        content.append(closeButton, title, body);
        overlay.append(content);
        document.body.append(overlay);

        this.viewerTitleElement = title;
        this.viewerBodyElement = body;
        return overlay;
    }

    openViewer(item) {
        if (!this.viewerElement) {
            return;
        }

        this.viewerTitleElement.textContent = item.filename;
        this.viewerBodyElement.replaceChildren();

        if (item.mediaKind === "video") {
            const video = document.createElement("video");
            video.src = item.url;
            video.controls = true;
            video.autoplay = true;
            video.loop = true;
            video.playsInline = true;
            this.viewerBodyElement.append(video);
        } else {
            const image = document.createElement("img");
            image.src = item.url;
            image.alt = item.filename;
            this.viewerBodyElement.append(image);
        }

        this.viewerElement.hidden = false;
        this.viewerElement.dataset.open = "true";
        this.isViewerOpen = true;
    }

    closeViewer() {
        if (!this.viewerElement || !this.isViewerOpen) {
            return;
        }

        this.viewerElement.hidden = true;
        this.viewerElement.dataset.open = "false";
        this.viewerBodyElement.replaceChildren();
        this.isViewerOpen = false;
    }

    syncActiveVisibility() {
        const isActive = getActiveSidebarTabId() === SIDEBAR_TAB_ID;
        this.element.style.display = isActive ? "grid" : "none";
        this.element.inert = !isActive;
    }

    getItems() {
        return [...this.generatedItems, ...this.localItems];
    }

    revokeObjectUrls(items = this.localItems) {
        for (const item of items) {
            if (item.revokeOnDispose) {
                URL.revokeObjectURL(item.previewUrl);
            }
        }
    }

    replaceItems(fileEntries) {
        this.revokeObjectUrls();

        const seen = new Set();
        const nextItems = [];
        for (const entry of fileEntries) {
            const mediaKind = resolveMediaKind(entry.file);
            if (!mediaKind) {
                continue;
            }

            const dedupeKey = [
                entry.relativePath || entry.file.name,
                entry.file.size,
                entry.file.lastModified,
            ].join("::");
            if (seen.has(dedupeKey)) {
                continue;
            }

            seen.add(dedupeKey);
            const rawUrl = URL.createObjectURL(entry.file);
            nextItems.push({
                id: createLocalItemId(nextItems.length),
                key: `local::${dedupeKey}`,
                sourceType: "local",
                file: entry.file,
                filename: entry.file.name,
                mediaKind,
                relativePath: entry.relativePath || entry.file.name,
                rawUrl,
                url: rawUrl,
                previewUrl: rawUrl,
                extension: getFileExtension(entry.file.name).toUpperCase() || mediaKind.toUpperCase(),
                revokeOnDispose: true,
            });
        }

        nextItems.sort((left, right) => {
            return left.relativePath.localeCompare(right.relativePath, undefined, {
                numeric: true,
                sensitivity: "base",
            });
        });

        this.localItems = nextItems;
        if (!this.selectedId || !this.getItems().some((item) => item.id === this.selectedId)) {
            this.selectedId = this.getItems()[0]?.id ?? null;
        }
    }

    refreshGeneratedItems({ force = false } = {}) {
        if (!this.settings.sidebarBrowserAutoGeneratedEnabled) {
            return;
        }

        const nextItems = collectGeneratedPreviewItems().filter(
            (item) => !this.dismissedGeneratedKeys.has(item.key),
        );
        const nextSignature = nextItems.map((item) => item.key).join("\n");

        if (!force && nextSignature === this.generatedSignature) {
            return;
        }

        this.generatedItems = nextItems;
        this.generatedSignature = nextSignature;
        if (!this.selectedId || !this.getItems().some((item) => item.id === this.selectedId)) {
            this.selectedId = this.getItems()[0]?.id ?? null;
        }
        this.render();
    }

    handleDragEnter(event) {
        event.preventDefault();
        event.stopPropagation();
        if (!this.settings.sidebarBrowserEnabled) {
            return;
        }
        if (!this.isDragActive) {
            this.isDragActive = true;
            this.render();
        }
    }

    handleDragOver(event) {
        event.preventDefault();
        event.stopPropagation();
        if (!this.settings.sidebarBrowserEnabled) {
            return;
        }
        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = "copy";
        }
    }

    handleDragLeave(event) {
        event.stopPropagation();
        if (this.element.contains(event.relatedTarget)) {
            return;
        }

        if (this.isDragActive) {
            this.isDragActive = false;
            this.render();
        }
    }

    async handleDrop(event) {
        event.preventDefault();
        event.stopPropagation();
        this.isDragActive = false;
        this.suppressOpenUntil = performance.now() + 500;

        if (!this.settings.sidebarBrowserEnabled) {
            this.render();
            return;
        }

        this.status = "Reading dropped media...";
        this.statusState = "loading";
        this.render();

        try {
            const droppedEntries = await transferItemsToFiles(event.dataTransfer);
            const supportedEntries = droppedEntries.filter((entry) => resolveMediaKind(entry.file));

            if (!supportedEntries.length) {
                this.status = "No supported image or video files were found in the drop.";
                this.statusState = "error";
                showToast(
                    "warn",
                    "Metadata Browser",
                    "Drop images or videos, or a folder containing them.",
                );
                this.render();
                return;
            }

            this.replaceItems(supportedEntries);

            const skippedCount = droppedEntries.length - supportedEntries.length;
            const visibleCount = this.getItems().length;
            this.status = skippedCount
                ? `Loaded ${pluralize(supportedEntries.length, "media file")}; skipped ${pluralize(skippedCount, "unsupported item")}. ${pluralize(visibleCount, "item")} now visible.`
                : `Loaded ${pluralize(supportedEntries.length, "media file")}. ${pluralize(visibleCount, "item")} now visible.`;
            this.statusState = "idle";
        } catch (error) {
            console.error("[Metadata Booster] Failed to load dropped media", error);
            this.status = error?.message || "Failed to read the dropped files.";
            this.statusState = "error";
            showToast("error", "Metadata Browser", this.status);
        }

        this.render();

        window.setTimeout(() => {
            if (performance.now() >= this.suppressOpenUntil) {
                this.suppressOpenUntil = 0;
            }
        }, 550);
    }

    clearItems() {
        this.revokeObjectUrls();
        for (const item of this.generatedItems) {
            this.dismissedGeneratedKeys.add(item.key);
        }

        this.localItems = [];
        this.generatedItems = [];
        this.generatedSignature = "";
        this.selectedId = null;
        this.status = this.settings.sidebarBrowserAutoGeneratedEnabled
            ? "Cleared dropped media and hid current live outputs. New outputs will appear automatically."
            : "Drop a file or folder to inspect embedded metadata.";
        this.statusState = "idle";
        this.render();
    }

    async openItem(item, cardElement) {
        this.selectedId = item.id;
        this.render();
        await this.onShowMetadata(toSidebarSource(item, cardElement));
    }

    renderHeader() {
        const header = createElement("div", "metadata-booster-browser-header");
        header.append(
            createElement("p", "metadata-booster-browser-kicker", "Metadata Booster"),
        );

        const heading = createElement("div", "metadata-booster-browser-heading");
        const copy = createElement("div", "metadata-booster-browser-heading-copy");
        const totalItems = this.getItems().length;
        copy.append(
            createElement("h2", "metadata-booster-browser-title", "Metadata Browser"),
            createElement(
                "p",
                "metadata-booster-browser-summary",
                this.settings.sidebarBrowserEnabled
                    ? totalItems
                        ? `${pluralize(totalItems, "item")} ready. ${pluralize(this.generatedItems.length, "live output")} tracked, ${pluralize(this.localItems.length, "dropped file")} loaded.`
                        : this.settings.sidebarBrowserAutoGeneratedEnabled
                            ? "Drop local media here or let save and preview output nodes populate this browser while workflows run."
                            : "Drop a local file or folder here to build a browsable metadata gallery."
                    : "Sidebar browser is disabled in settings.",
            ),
        );

        const clearButton = createElement("button", "metadata-booster-button metadata-booster-browser-clear");
        clearButton.type = "button";
        clearButton.title = "Clear Metadata Browser";
        clearButton.setAttribute("aria-label", "Clear Metadata Browser");
        clearButton.disabled = !totalItems;
        clearButton.onclick = () => this.clearItems();

        const clearIcon = createElement("i", "pi pi-refresh");
        clearIcon.setAttribute("aria-hidden", "true");
        clearButton.append(clearIcon);

        heading.append(copy, clearButton);
        header.append(heading);

        return header;
    }

    renderStatus() {
        const status = createElement("div", "metadata-booster-browser-status", this.status);
        if (this.statusState !== "idle") {
            status.dataset.state = this.statusState;
        }
        return status;
    }

    renderDisabledState() {
        const disabled = createElement("section", "metadata-booster-browser-disabled");
        disabled.append(
            createElement(
                "h3",
                "metadata-booster-browser-disabled-title",
                "Sidebar browser is disabled",
            ),
            createElement(
                "p",
                "metadata-booster-browser-disabled-copy",
                "Enable the Metadata Browser sidebar setting to load dropped media and active workflow previews here.",
            ),
        );
        return disabled;
    }

    renderDropzone() {
        const dropzone = createElement("section", "metadata-booster-browser-dropzone");
        dropzone.dataset.active = this.isDragActive ? "true" : "false";
        dropzone.append(
            createElement(
                "h3",
                "metadata-booster-browser-dropzone-title",
                "Drop a file or folder here",
            ),
            createElement(
                "p",
                "metadata-booster-browser-dropzone-copy",
                "Images and videos are loaded into a local gallery. Save and preview output nodes can also appear here automatically. Click a tile to open metadata, or use the loop icon to inspect it full size.",
            ),
            this.renderStatus(),
        );
        return dropzone;
    }

    renderEmptyState() {
        const empty = createElement("section", "metadata-booster-browser-empty");
        empty.append(
            createElement(
                "h3",
                "metadata-booster-browser-empty-title",
                this.settings.sidebarBrowserAutoGeneratedEnabled
                    ? "No media loaded yet"
                    : "No local media loaded yet",
            ),
            createElement(
                "p",
                "metadata-booster-browser-empty-copy",
                this.settings.sidebarBrowserAutoGeneratedEnabled
                    ? "Drop a folder from Explorer to load images and videos, or leave the browser open while save and preview nodes generate outputs to capture them automatically."
                    : "Drop a folder from Explorer to load all supported images and videos at once, or drop individual files to inspect them one by one.",
            ),
        );
        return empty;
    }

    renderGrid() {
        const grid = createElement("div", "metadata-booster-browser-grid");

        for (const item of this.getItems()) {
            const card = createElement("button", "metadata-booster-browser-card");
            card.type = "button";
            card.dataset.selected = this.selectedId === item.id ? "true" : "false";

            const thumb = createElement("div", "metadata-booster-browser-thumb");
            if (item.mediaKind === "video") {
                const video = document.createElement("video");
                video.src = item.previewUrl;
                video.preload = "metadata";
                video.muted = true;
                video.playsInline = true;
                thumb.append(video);
            } else {
                const image = document.createElement("img");
                image.src = item.previewUrl;
                image.alt = item.filename;
                image.loading = "lazy";
                thumb.append(image);
            }

            thumb.append(
                createElement(
                    "span",
                    "metadata-booster-browser-badge",
                    item.mediaKind === "video" ? "Video" : "Image",
                ),
            );

            const thumbAction = createElement(
                "button",
                "metadata-booster-browser-thumb-action",
            );
            thumbAction.type = "button";
            thumbAction.title = item.mediaKind === "video" ? "Open full size player" : "Open full size preview";
            thumbAction.setAttribute(
                "aria-label",
                item.mediaKind === "video" ? "Open full size player" : "Open full size preview",
            );
            thumbAction.append(createElement("i", "pi pi-search-plus"));
            thumbAction.onclick = (event) => {
                event.preventDefault();
                event.stopPropagation();
                this.openViewer(item);
            };
            thumb.append(thumbAction);

            const copy = createElement("div", "metadata-booster-browser-card-copy");
            copy.append(
                createElement("div", "metadata-booster-browser-card-title", item.filename),
                createElement("div", "metadata-booster-browser-card-path", item.relativePath),
                createElement(
                    "div",
                    "metadata-booster-browser-card-meta",
                    item.sourceType === "generated" ? `${item.extension} · Live` : item.extension,
                ),
            );

            card.append(thumb, copy);
            card.onclick = (event) => {
                if (this.suppressOpenUntil && performance.now() < this.suppressOpenUntil) {
                    event.preventDefault();
                    event.stopPropagation();
                    return;
                }
                void this.openItem(item, card);
            };
            grid.append(card);
        }

        return grid;
    }

    render() {
        const children = [this.renderHeader()];

        if (!this.settings.sidebarBrowserEnabled) {
            children.push(this.renderDisabledState());
            this.element.replaceChildren(...children);
            this.syncActiveVisibility();
            return;
        }

        children.push(this.renderDropzone());
        if (this.getItems().length) {
            children.push(this.renderGrid());
        } else {
            children.push(this.renderEmptyState());
        }

        this.element.replaceChildren(...children);
        this.syncActiveVisibility();
    }
}
