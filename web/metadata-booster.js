import { app } from "../../scripts/app.js";

import { MetadataBoosterDialog } from "./dialog.js";
import { MetadataBoosterHoverPreview } from "./hover-preview.js";
import { resolveMediaSourceFromTarget, resolveNodeImageSource } from "./media-target.js";
import { createMetadataService } from "./metadata-service.js";
import { MetadataBoosterMenu } from "./menu.js";
import { MetadataBoosterSidebarBrowser } from "./sidebar-browser.js";
import { EXTENSION_SETTINGS, syncSettingsFromStore } from "./settings.js";

const EXTENSION_NAME = "comfy.metadata-booster";
const NODE_MENU_PATCHED = Symbol("metadata-booster-node-menu");
const STYLE_ID = "metadata-booster-styles";

let controller = null;

function ensureStyles() {
    if (document.getElementById(STYLE_ID)) {
        return;
    }

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
        .metadata-booster-menu,
        .metadata-booster-hover {
            position: fixed;
            z-index: 100000;
            font-family: Inter, system-ui, sans-serif;
        }

        .metadata-booster-menu {
            min-width: 164px;
            border-radius: 10px;
            border: 1px solid rgba(255, 255, 255, 0.08);
            background: rgba(22, 24, 29, 0.97);
            box-shadow: 0 14px 32px rgba(0, 0, 0, 0.45);
            color: #f3f4f6;
            overflow: visible;
        }

        .metadata-booster-menu-item {
            position: relative;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 16px;
            padding: 10px 12px;
            font-size: 13px;
            cursor: default;
            user-select: none;
        }

        .metadata-booster-menu-arrow {
            color: rgba(255, 255, 255, 0.75);
        }

        .metadata-booster-submenu {
            position: absolute;
            top: -8px;
            left: calc(100% - 4px);
            min-width: 220px;
            display: none;
            padding: 8px;
            border-radius: 10px;
            border: 1px solid rgba(255, 255, 255, 0.08);
            background: rgba(22, 24, 29, 0.99);
            box-shadow: 0 14px 32px rgba(0, 0, 0, 0.45);
        }

        .metadata-booster-menu-item:hover > .metadata-booster-submenu,
        .metadata-booster-menu-item:focus-within > .metadata-booster-submenu {
            display: block;
        }

        .metadata-booster-submenu--left {
            left: auto;
            right: calc(100% - 4px);
        }

        .metadata-booster-menu-button,
        .metadata-booster-button {
            width: 100%;
            border: 0;
            border-radius: 8px;
            padding: 9px 10px;
            background: transparent;
            color: inherit;
            text-align: left;
            font: inherit;
            cursor: pointer;
        }

        .metadata-booster-menu-button:hover,
        .metadata-booster-menu-button:focus-visible,
        .metadata-booster-button:hover,
        .metadata-booster-button:focus-visible {
            background: rgba(255, 255, 255, 0.09);
            outline: none;
        }

        .metadata-booster-hover {
            max-width: 340px;
            min-width: 240px;
            padding: 12px;
            border-radius: 12px;
            background: rgba(16, 18, 22, 0.97);
            border: 1px solid rgba(255, 255, 255, 0.08);
            box-shadow: 0 18px 36px rgba(0, 0, 0, 0.45);
            color: #f3f4f6;
            pointer-events: none;
        }

        .metadata-booster-hover-title {
            margin-bottom: 8px;
            font-size: 13px;
            font-weight: 700;
            word-break: break-word;
        }

        .metadata-booster-hover-content {
            display: grid;
            gap: 6px;
        }

        .metadata-booster-hover-row {
            display: grid;
            gap: 2px;
        }

        .metadata-booster-hover-label {
            font-size: 11px;
            color: rgba(255, 255, 255, 0.66);
            text-transform: uppercase;
            letter-spacing: 0.04em;
        }

        .metadata-booster-hover-value {
            font-size: 12px;
            line-height: 1.4;
            word-break: break-word;
        }

        .metadata-booster-dialog .comfy-modal-content,
        .metadata-booster-dialog .comfy-modal {
            max-width: min(1100px, 92vw);
        }

        .metadata-booster-dialog,
        .metadata-booster-dialog.comfy-modal,
        .metadata-booster-dialog .comfy-modal,
        .metadata-booster-dialog .comfy-modal-content {
            z-index: 2147483000 !important;
        }

        .metadata-booster-dialog .comfy-modal-content {
            position: relative;
        }

        .metadata-booster-dialog-content {
            display: grid;
            gap: 16px;
            min-width: min(960px, 86vw);
            max-width: min(1024px, 86vw);
            padding: 8px 0;
        }

        .metadata-booster-header {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 16px;
        }

        .metadata-booster-header-copy {
            display: grid;
            gap: 6px;
        }

        .metadata-booster-title {
            margin: 0;
            font-size: 24px;
            line-height: 1.2;
        }

        .metadata-booster-subtitle {
            color: var(--descrip-text);
            font-size: 13px;
            text-transform: capitalize;
        }

        .metadata-booster-actions {
            display: flex;
            gap: 8px;
        }

        .metadata-booster-button {
            width: auto;
            min-width: 116px;
            padding: 10px 14px;
            background: var(--comfy-input-bg);
        }

        .metadata-booster-status {
            border-radius: 10px;
            padding: 12px 14px;
            background: rgba(59, 130, 246, 0.14);
            color: var(--fg-color);
            line-height: 1.45;
        }

        .metadata-booster-status[data-state="empty"] {
            background: rgba(234, 179, 8, 0.14);
        }

        .metadata-booster-section {
            display: grid;
            gap: 8px;
            padding: 14px;
            border-radius: 12px;
            background: var(--comfy-input-bg);
        }

        .metadata-booster-section-title {
            margin: 0 0 4px;
            font-size: 15px;
        }

        .metadata-booster-row {
            display: grid;
            grid-template-columns: minmax(180px, 240px) minmax(0, 1fr);
            gap: 12px;
            align-items: start;
            border-top: 1px solid rgba(255, 255, 255, 0.06);
            padding-top: 10px;
        }

        .metadata-booster-row:first-of-type {
            border-top: 0;
            padding-top: 0;
        }

        .metadata-booster-label {
            font-weight: 600;
            color: var(--descrip-text);
            word-break: break-word;
        }

        .metadata-booster-value,
        .metadata-booster-empty {
            line-height: 1.5;
            word-break: break-word;
        }

        .metadata-booster-value-list {
            margin: 0;
            padding-left: 18px;
        }

        .metadata-booster-value-details {
            border-radius: 8px;
            background: rgba(255, 255, 255, 0.04);
            padding: 8px 10px;
        }

        .metadata-booster-value-summary {
            cursor: pointer;
            font-weight: 600;
        }

        .metadata-booster-value-pre {
            margin: 10px 0 0;
            white-space: pre-wrap;
            word-break: break-word;
            max-height: 320px;
            overflow: auto;
        }

        .metadata-booster-empty {
            padding: 16px;
            border-radius: 12px;
            background: var(--comfy-input-bg);
        }

        .metadata-booster-browser {
            display: grid;
            gap: 14px;
            padding: 10px;
            color: var(--fg-color);
        }

        .metadata-booster-browser-header {
            display: grid;
            gap: 8px;
        }

        .metadata-booster-browser-kicker {
            margin: 0;
            font-size: 11px;
            letter-spacing: 0.16em;
            text-transform: uppercase;
            color: var(--descrip-text);
        }

        .metadata-booster-browser-heading {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
        }

        .metadata-booster-browser-title {
            margin: 0;
            font-size: 22px;
            line-height: 1.1;
        }

        .metadata-booster-browser-summary {
            margin: 0;
            color: var(--descrip-text);
            font-size: 13px;
            line-height: 1.45;
        }

        .metadata-booster-browser-clear {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 38px;
            min-width: 38px;
            height: 38px;
            padding: 0;
            border-radius: 999px;
        }

        .metadata-booster-browser-clear:disabled {
            opacity: 0.45;
            cursor: not-allowed;
        }

        .metadata-booster-browser-dropzone,
        .metadata-booster-browser-empty,
        .metadata-booster-browser-disabled {
            position: relative;
            display: grid;
            gap: 8px;
            padding: 18px;
            border-radius: 16px;
            border: 1px dashed rgba(255, 255, 255, 0.16);
            background:
                radial-gradient(circle at top right, rgba(59, 130, 246, 0.22), transparent 42%),
                linear-gradient(180deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0.02));
            overflow: hidden;
        }

        .metadata-booster-browser-dropzone[data-active="true"] {
            border-color: rgba(96, 165, 250, 0.8);
            box-shadow: inset 0 0 0 1px rgba(96, 165, 250, 0.25);
        }

        .metadata-booster-browser-dropzone-title,
        .metadata-booster-browser-empty-title,
        .metadata-booster-browser-disabled-title {
            margin: 0;
            font-size: 15px;
            font-weight: 700;
        }

        .metadata-booster-browser-dropzone-copy,
        .metadata-booster-browser-empty-copy,
        .metadata-booster-browser-disabled-copy {
            margin: 0;
            color: var(--descrip-text);
            line-height: 1.45;
            font-size: 13px;
        }

        .metadata-booster-browser-status {
            display: inline-flex;
            align-items: center;
            width: fit-content;
            max-width: 100%;
            padding: 5px 9px;
            border-radius: 999px;
            background: rgba(59, 130, 246, 0.14);
            font-size: 12px;
            line-height: 1.3;
        }

        .metadata-booster-browser-status[data-state="error"] {
            background: rgba(239, 68, 68, 0.16);
        }

        .metadata-booster-browser-status[data-state="loading"] {
            background: rgba(234, 179, 8, 0.16);
        }

        .metadata-booster-browser-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(152px, 1fr));
            gap: 12px;
        }

        .metadata-booster-browser-card {
            display: grid;
            gap: 10px;
            padding: 10px;
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 16px;
            background: rgba(255, 255, 255, 0.03);
            text-align: left;
            color: inherit;
            cursor: pointer;
            transition: transform 0.14s ease, border-color 0.14s ease, background 0.14s ease;
        }

        .metadata-booster-browser-card:hover,
        .metadata-booster-browser-card:focus-visible,
        .metadata-booster-browser-card[data-selected="true"] {
            outline: none;
            transform: translateY(-1px);
            border-color: rgba(96, 165, 250, 0.52);
            background: rgba(59, 130, 246, 0.08);
        }

        .metadata-booster-browser-thumb {
            position: relative;
            aspect-ratio: 1;
            border-radius: 12px;
            overflow: hidden;
            background: rgba(0, 0, 0, 0.3);
        }

        .metadata-booster-browser-thumb-action {
            position: absolute;
            top: 8px;
            right: 8px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 34px;
            height: 34px;
            padding: 0;
            border: 0;
            border-radius: 999px;
            background: rgba(15, 23, 42, 0.76);
            color: #f8fafc;
            opacity: 0;
            transform: translateY(-4px);
            transition: opacity 0.14s ease, transform 0.14s ease, background 0.14s ease;
            cursor: pointer;
        }

        .metadata-booster-browser-card:hover .metadata-booster-browser-thumb-action,
        .metadata-booster-browser-card:focus-visible .metadata-booster-browser-thumb-action,
        .metadata-booster-browser-thumb-action:focus-visible {
            opacity: 1;
            transform: translateY(0);
            outline: none;
        }

        .metadata-booster-browser-thumb-action:hover,
        .metadata-booster-browser-thumb-action:focus-visible {
            background: rgba(37, 99, 235, 0.9);
        }

        .metadata-booster-browser-thumb img,
        .metadata-booster-browser-thumb video {
            width: 100%;
            height: 100%;
            object-fit: cover;
            display: block;
        }

        .metadata-booster-browser-badge {
            position: absolute;
            right: 8px;
            bottom: 8px;
            padding: 4px 7px;
            border-radius: 999px;
            background: rgba(15, 23, 42, 0.76);
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 0.08em;
            text-transform: uppercase;
        }

        .metadata-booster-browser-card-copy {
            display: grid;
            gap: 4px;
            min-width: 0;
        }

        .metadata-booster-browser-card-title,
        .metadata-booster-browser-card-path {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .metadata-booster-browser-card-title {
            font-size: 13px;
            font-weight: 700;
        }

        .metadata-booster-browser-card-path {
            font-size: 12px;
            color: var(--descrip-text);
        }

        .metadata-booster-browser-card-meta {
            font-size: 11px;
            letter-spacing: 0.06em;
            text-transform: uppercase;
            color: rgba(255, 255, 255, 0.72);
        }

        .metadata-booster-browser-viewer {
            position: fixed;
            inset: 0;
            z-index: 2147482500;
            display: grid;
            place-items: center;
            padding: 28px;
            background: rgba(2, 6, 23, 0.82);
            backdrop-filter: blur(8px);
        }

        .metadata-booster-browser-viewer[hidden] {
            display: none;
        }

        .metadata-booster-browser-viewer-content {
            position: relative;
            display: grid;
            gap: 12px;
            width: min(92vw, 1280px);
            max-height: min(92vh, 960px);
            padding: 18px;
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 18px;
            background: rgba(15, 23, 42, 0.94);
            box-shadow: 0 24px 60px rgba(0, 0, 0, 0.48);
        }

        .metadata-booster-browser-viewer-close {
            position: absolute;
            top: 14px;
            right: 14px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 38px;
            height: 38px;
            padding: 0;
            border: 0;
            border-radius: 999px;
            background: rgba(255, 255, 255, 0.08);
            color: #f8fafc;
            cursor: pointer;
        }

        .metadata-booster-browser-viewer-close:hover,
        .metadata-booster-browser-viewer-close:focus-visible {
            background: rgba(37, 99, 235, 0.9);
            outline: none;
        }

        .metadata-booster-browser-viewer-title {
            max-width: calc(100% - 56px);
            font-size: 14px;
            font-weight: 700;
            line-height: 1.4;
            word-break: break-word;
        }

        .metadata-booster-browser-viewer-body {
            display: grid;
            place-items: center;
            min-height: 0;
            overflow: auto;
            border-radius: 12px;
            background: rgba(255, 255, 255, 0.03);
        }

        .metadata-booster-browser-viewer-body img,
        .metadata-booster-browser-viewer-body video {
            max-width: 100%;
            max-height: min(78vh, 860px);
            object-fit: contain;
            display: block;
        }
    `;
    document.head.appendChild(style);
}

function sanitizeWorkflowFilename(filename) {
    const stem = String(filename ?? "")
        .replace(/\.[^.]+$/, "")
        .replace(/[^a-z0-9._-]+/gi, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 120);

    return `${stem || "workflow"}.json`;
}

function cloneWorkflowPayload(workflow) {
    if (typeof structuredClone === "function") {
        return structuredClone(workflow);
    }

    return JSON.parse(JSON.stringify(workflow));
}

async function readJsonResponse(response, fallbackMessage) {
    let payload = null;

    try {
        payload = await response.json();
    } catch {
        payload = null;
    }

    if (!response.ok) {
        throw new Error(
            payload?.error || `${fallbackMessage} (${response.status})`,
        );
    }

    return payload ?? {};
}

class MetadataBoosterController {
    constructor() {
        ensureStyles();
        syncSettingsFromStore();
        this.service = createMetadataService();
        this.dialog = new MetadataBoosterDialog({
            onOpenWorkflow: ({ metadata, workflow }) => this.openWorkflow(metadata, workflow),
        });
        this.menu = new MetadataBoosterMenu({
            onShowMetadata: (source) => this.showMetadata(source),
            onCopyMetadata: (source) => this.copyMetadata(source),
        });
        this.hoverPreview = new MetadataBoosterHoverPreview({
            inspectSource: (source) => this.inspectSource(source),
        });
        this.sidebarBrowser = new MetadataBoosterSidebarBrowser({
            onShowMetadata: (source) => this.showMetadata(source),
        });
        this.boundContextMenu = this.handleContextMenu.bind(this);
    }

    setup() {
        if (this.isSetup) {
            return;
        }

        document.addEventListener("contextmenu", this.boundContextMenu, true);
        this.hoverPreview.setup();
        this.registerSidebarTab();
        this.isSetup = true;
    }

    dispose() {
        if (!this.isSetup) {
            return;
        }

        document.removeEventListener("contextmenu", this.boundContextMenu, true);
        this.dialog.close?.();
        this.menu.dispose?.();
        this.hoverPreview.dispose?.();
        this.sidebarBrowser.dispose?.();
        this.isSetup = false;
    }

    registerSidebarTab() {
        if (this.isSidebarRegistered) {
            return;
        }

        app.extensionManager?.registerSidebarTab?.({
            id: "MetadataBooster.SidebarBrowser",
            icon: "pi pi-images",
            title: "Metadata",
            tooltip: "Metadata Browser",
            type: "custom",
            render: (element) => {
                this.sidebarBrowser.mount(element);
                return () => {
                    this.sidebarBrowser.unmount(element);
                };
            },
        });
        this.isSidebarRegistered = true;
    }

    async inspectSource(source) {
        return this.service.inspectSource(source);
    }

    async showMetadata(source) {
        try {
            const metadata = await this.inspectSource(source);
            this.dialog.showMetadata(metadata);
        } catch (error) {
            console.error("[Metadata Booster] Failed to show metadata", error);
            this.dialog.showError(
                "Metadata Booster",
                error?.message || "Failed to inspect metadata for this file.",
            );
        }
    }

    async copyMetadata(source) {
        try {
            const metadata = await this.inspectSource(source);
            if (!navigator.clipboard?.writeText) {
                throw new Error("Clipboard API is not available in this browser session.");
            }
            await navigator.clipboard.writeText(JSON.stringify(metadata.clipboard, null, 2));
        } catch (error) {
            console.error("[Metadata Booster] Failed to copy metadata", error);
            this.dialog.showError(
                "Clipboard error",
                error?.message || "Failed to copy metadata to the clipboard.",
            );
        }
    }

    async openWorkflow(metadata, workflow) {
        if (!workflow || typeof workflow !== "object" || Array.isArray(workflow)) {
            throw new Error("This metadata entry does not contain a valid ComfyUI workflow.");
        }

        if (typeof app.loadGraphData !== "function") {
            throw new Error("ComfyUI workflow loading API is not available in this session.");
        }

        const response = await fetch("/metadata-booster/save-workflow", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                workflow,
                filename: sanitizeWorkflowFilename(metadata?.source?.filename),
            }),
        });
        const saved = await readJsonResponse(
            response,
            "Failed to save the extracted workflow JSON",
        );

        await app.loadGraphData(
            cloneWorkflowPayload(workflow),
            true,
            true,
            saved.fileName || sanitizeWorkflowFilename(metadata?.source?.filename),
        );

        return saved;
    }

    handleContextMenu(event) {
        const source = resolveMediaSourceFromTarget(event.target);
        if (!source) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        this.menu.show(event, source);
    }
}

function getController() {
    if (!controller) {
        controller = new MetadataBoosterController();
    }
    return controller;
}

function createSubmenuItem(title, callback) {
    return {
        title,
        content: title,
        callback,
    };
}

function patchNodePreviewMenu(nodeType) {
    if (nodeType.prototype[NODE_MENU_PATCHED]) {
        return;
    }

    const originalGetExtraMenuOptions = nodeType.prototype.getExtraMenuOptions;
    nodeType.prototype.getExtraMenuOptions = function getExtraMenuOptionsPatched() {
        const result = originalGetExtraMenuOptions?.apply?.(this, arguments);
        const options = arguments[1];

        if (!Array.isArray(options) || options.some((option) => option?.content === "PNG Info")) {
            return result;
        }

        const source = resolveNodeImageSource(this);
        if (!source) {
            return result;
        }

        let insertIndex = options.findIndex((option) => option?.content === "Save Image");
        insertIndex = insertIndex === -1 ? 0 : insertIndex + 1;

        options.splice(insertIndex, 0, {
            content: "PNG Info",
            has_submenu: true,
            submenu: {
                options: [
                    createSubmenuItem("Show PNG Info", () => {
                        void getController().showMetadata(source);
                    }),
                    createSubmenuItem("Copy metadata to clipboard", () => {
                        void getController().copyMetadata(source);
                    }),
                ],
            },
        });

        return result;
    };

    nodeType.prototype[NODE_MENU_PATCHED] = true;
}

app.registerExtension({
    name: EXTENSION_NAME,
    settings: EXTENSION_SETTINGS,
    setup() {
        getController().setup();
    },
    cleanup() {
        controller?.dispose();
        controller = null;
    },
    beforeRegisterNodeDef(nodeType) {
        patchNodePreviewMenu(nodeType);
    },
});
