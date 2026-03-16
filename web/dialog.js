import { ComfyDialog } from "../../scripts/ui.js";

import { extractWorkflowFromMetadata } from "./metadata-service.js";

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

function appendJsonDetails(container, value, summaryText) {
    const details = createElement("details", "metadata-booster-value-details");
    const summary = createElement("summary", "metadata-booster-value-summary", summaryText);
    const pre = createElement(
        "pre",
        "metadata-booster-value-pre",
        JSON.stringify(value, null, 2),
    );
    details.append(summary, pre);
    container.append(details);
}

function appendTextDetails(container, value, summaryText) {
    const details = createElement("details", "metadata-booster-value-details");
    const summary = createElement("summary", "metadata-booster-value-summary", summaryText);
    const pre = createElement("pre", "metadata-booster-value-pre", value);
    details.append(summary, pre);
    container.append(details);
}

function renderEntryValue(value) {
    const valueContainer = createElement("div", "metadata-booster-value");

    if (Array.isArray(value)) {
        const scalarItems = value.filter(
            (item) => typeof item === "string" || typeof item === "number" || typeof item === "boolean",
        );
        if (scalarItems.length === value.length) {
            const list = createElement("ul", "metadata-booster-value-list");
            for (const item of scalarItems) {
                list.append(createElement("li", "", String(item)));
            }
            valueContainer.append(list);
            return valueContainer;
        }

        appendJsonDetails(valueContainer, value, `Array (${value.length} items)`);
        return valueContainer;
    }

    if (value && typeof value === "object") {
        appendJsonDetails(valueContainer, value, "Show JSON");
        return valueContainer;
    }

    const text = String(value ?? "");
    if (text.includes("\n") || text.length > 220) {
        const summary = text.replace(/\s+/g, " ").trim();
        appendTextDetails(
            valueContainer,
            text,
            summary.length > 140 ? `${summary.slice(0, 139)}...` : summary,
        );
        return valueContainer;
    }

    valueContainer.textContent = text || "—";
    return valueContainer;
}

async function copyJsonToClipboard(payload) {
    if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard API is not available in this browser session.");
    }

    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
}

export class MetadataBoosterDialog extends ComfyDialog {
    constructor({ onOpenWorkflow } = {}) {
        super();
        this.onOpenWorkflow = onOpenWorkflow;
    }

    showMetadata(metadata) {
        this.show("");
        this.element.classList.add("metadata-booster-dialog", "comfy-settings");

        const content = createElement("div", "metadata-booster-dialog-content");
        const header = createElement("div", "metadata-booster-header");
        const titleGroup = createElement("div", "metadata-booster-header-copy");
        titleGroup.append(
            createElement("h2", "metadata-booster-title", metadata.source.filename || "Metadata Booster"),
            createElement(
                "div",
                "metadata-booster-subtitle",
                `${metadata.source.context} • ${metadata.source.mediaKind} • ${metadata.source.format.toUpperCase()}`,
            ),
        );

        const actionGroup = createElement("div", "metadata-booster-actions");
        const workflow = extractWorkflowFromMetadata(metadata);
        if (workflow && this.onOpenWorkflow) {
            const workflowButton = createElement(
                "button",
                "metadata-booster-button",
                "Open workflow in ...",
            );
            workflowButton.type = "button";
            workflowButton.onclick = async () => {
                const originalLabel = workflowButton.textContent;
                workflowButton.disabled = true;
                workflowButton.textContent = "Opening...";
                try {
                    await this.onOpenWorkflow({ metadata, workflow });
                    workflowButton.textContent = "Opened";
                    window.setTimeout(() => {
                        workflowButton.disabled = false;
                        workflowButton.textContent = originalLabel;
                    }, 1400);
                } catch (error) {
                    workflowButton.disabled = false;
                    workflowButton.textContent = originalLabel;
                    console.error("[Metadata Booster] Workflow import failed", error);
                    window.alert(
                        error?.message || "Failed to open the workflow in ComfyUI.",
                    );
                }
            };
            actionGroup.append(workflowButton);
        }

        const copyButton = createElement("button", "metadata-booster-button", "Copy JSON");
        copyButton.type = "button";
        copyButton.onclick = async () => {
            try {
                await copyJsonToClipboard(metadata.clipboard);
                copyButton.textContent = "Copied";
                window.setTimeout(() => {
                    copyButton.textContent = "Copy JSON";
                }, 1200);
            } catch (error) {
                console.error("[Metadata Booster] Clipboard copy failed", error);
                window.alert(error.message || "Failed to copy metadata to the clipboard.");
            }
        };
        actionGroup.append(copyButton);
        header.append(titleGroup, actionGroup);
        content.append(header);

        const status = createElement("div", "metadata-booster-status", metadata.statusMessage);
        if (metadata.hasEmbeddedMetadata) {
            status.dataset.state = "ok";
        } else {
            status.dataset.state = "empty";
        }
        content.append(status);

        for (const section of metadata.sections) {
            const sectionEl = createElement("section", "metadata-booster-section");
            sectionEl.append(createElement("h3", "metadata-booster-section-title", section.title));
            for (const entry of section.entries) {
                const row = createElement("div", "metadata-booster-row");
                row.append(
                    createElement("div", "metadata-booster-label", entry.label),
                    renderEntryValue(entry.value),
                );
                sectionEl.append(row);
            }
            content.append(sectionEl);
        }

        if (!metadata.sections.length) {
            content.append(
                createElement(
                    "div",
                    "metadata-booster-empty",
                    "No grouped metadata is available for this file.",
                ),
            );
        }

        this.textElement.replaceChildren(content);
    }

    showError(title, message) {
        this.show("");
        this.element.classList.add("metadata-booster-dialog", "comfy-settings");

        const content = createElement("div", "metadata-booster-dialog-content");
        content.append(
            createElement("h2", "metadata-booster-title", title),
            createElement("div", "metadata-booster-status", message),
        );
        this.textElement.replaceChildren(content);
    }
}
