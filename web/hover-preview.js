import { resolveMediaSourceFromTarget } from "./media-target.js";
import { getSettingsState, subscribeSettings } from "./settings.js";

function createPreviewRow(label, value) {
    const row = document.createElement("div");
    row.className = "metadata-booster-hover-row";

    const labelEl = document.createElement("div");
    labelEl.className = "metadata-booster-hover-label";
    labelEl.textContent = label;

    const valueEl = document.createElement("div");
    valueEl.className = "metadata-booster-hover-value";
    valueEl.textContent = value;

    row.append(labelEl, valueEl);
    return row;
}

function prettyFieldLabel(field) {
    return field
        .replace(/_/g, " ")
        .replace(/\b\w/g, (character) => character.toUpperCase());
}

export class MetadataBoosterHoverPreview {
    constructor({ inspectSource }) {
        this.inspectSource = inspectSource;
        this.settings = getSettingsState();
        this.activeAnchor = null;
        this.pendingAnchor = null;
        this.pendingTimer = null;
        this.requestToken = 0;

        document.querySelectorAll(".metadata-booster-hover").forEach((element) => element.remove());
        this.element = document.createElement("div");
        this.element.className = "metadata-booster-hover";
        this.element.style.display = "none";
        document.body.appendChild(this.element);
    }

    setup() {
        if (this.isSetup) {
            return;
        }

        this.unsubscribeSettings = subscribeSettings((settings) => {
            this.settings = settings;
            if (!settings.assetsPreviewEnabled) {
                this.hide();
            }
        });

        this.boundMouseOver = (event) => this.handleMouseOver(event);
        this.boundMouseMove = () => this.handleMouseMove();
        this.boundMouseOut = (event) => this.handleMouseOut(event);
        this.boundFocusIn = (event) => this.handleFocusIn(event);
        this.boundFocusOut = (event) => this.handleFocusOut(event);
        this.boundPointerDown = (event) => {
            if (!this.element.contains(event.target)) {
                this.hide();
            }
        };
        this.boundKeyDown = (event) => {
            if (event.key === "Escape") {
                this.hide();
            }
        };
        this.boundBlur = () => this.hide();
        this.boundScroll = () => this.hide();

        document.addEventListener("mouseover", this.boundMouseOver, true);
        document.addEventListener("mousemove", this.boundMouseMove, true);
        document.addEventListener("mouseout", this.boundMouseOut, true);
        document.addEventListener("focusin", this.boundFocusIn, true);
        document.addEventListener("focusout", this.boundFocusOut, true);
        document.addEventListener("pointerdown", this.boundPointerDown, true);
        document.addEventListener("keydown", this.boundKeyDown, true);
        window.addEventListener("blur", this.boundBlur);
        window.addEventListener("scroll", this.boundScroll, true);

        this.isSetup = true;
    }

    queuePreview(source, anchor) {
        window.clearTimeout(this.pendingTimer);
        this.pendingAnchor = anchor;
        this.pendingTimer = window.setTimeout(() => {
            void this.showPreview(source, anchor).catch((error) => {
                console.error("[Metadata Booster] Hover preview failed", error);
                if (this.activeAnchor === anchor) {
                    this.element.replaceChildren(
                        createPreviewRow("Status", error?.message || "Failed to load metadata."),
                    );
                    this.element.style.display = "block";
                    this.position(anchor);
                }
            });
        }, 220);
    }

    handleMouseOver(event) {
        if (!this.settings.assetsPreviewEnabled) {
            return;
        }

        const source = resolveMediaSourceFromTarget(event.target, {
            assetOnly: true,
            allowContainerFallback: true,
        });
        if (!source) {
            return;
        }

        const anchor = source.rootElement?.closest?.("[role='button'][data-selected]") ?? source.rootElement;
        if (anchor === this.activeAnchor) {
            return;
        }

        this.queuePreview(source, anchor);
    }

    handleMouseMove() {
        if (this.activeAnchor) {
            this.position(this.activeAnchor);
        }
    }

    handleMouseOut(event) {
        const relatedTarget = event.relatedTarget;
        if (this.pendingAnchor?.contains?.(relatedTarget)) {
            return;
        }
        if (this.activeAnchor?.contains?.(relatedTarget)) {
            return;
        }
        this.hide();
    }

    handleFocusIn(event) {
        if (!this.settings.assetsPreviewEnabled) {
            return;
        }

        const source = resolveMediaSourceFromTarget(event.target, {
            assetOnly: true,
            allowContainerFallback: true,
        });
        if (!source) {
            return;
        }

        const anchor = source.rootElement?.closest?.("[role='button'][data-selected]") ?? source.rootElement;
        this.queuePreview(source, anchor);
    }

    handleFocusOut(event) {
        if (this.activeAnchor?.contains?.(event.relatedTarget)) {
            return;
        }
        this.hide();
    }

    position(anchor) {
        const padding = 16;
        const rect = anchor.getBoundingClientRect();
        const width = this.element.offsetWidth || 320;
        const height = this.element.offsetHeight || 160;

        let left = rect.right + padding;
        if (left + width > window.innerWidth - padding) {
            left = rect.left - width - padding;
        }
        left = Math.max(padding, left);

        const top = Math.min(
            Math.max(padding, rect.top),
            Math.max(padding, window.innerHeight - height - padding),
        );

        this.element.style.left = `${left}px`;
        this.element.style.top = `${top}px`;
    }

    async showPreview(source, anchor) {
        this.requestToken += 1;
        const token = this.requestToken;
        this.activeAnchor = anchor;
        this.pendingAnchor = null;

        this.element.replaceChildren(
            createPreviewRow("Metadata Booster", "Loading metadata..."),
        );
        this.element.style.display = "block";
        this.position(anchor);

        const metadata = await this.inspectSource(source);
        if (token !== this.requestToken || this.activeAnchor !== anchor) {
            return;
        }

        const rows = [];
        for (const field of this.settings.assetsPreviewFields) {
            const value = metadata.preview[field];
            if (value) {
                rows.push(createPreviewRow(prettyFieldLabel(field), value));
            }
        }

        if (!rows.length) {
            rows.push(createPreviewRow("Status", metadata.statusMessage));
        }

        const title = document.createElement("div");
        title.className = "metadata-booster-hover-title";
        title.textContent = metadata.source.filename || "Metadata Booster";

        const content = document.createElement("div");
        content.className = "metadata-booster-hover-content";
        content.append(...rows.slice(0, 8));

        this.element.replaceChildren(title, content);
        this.element.style.display = "block";
        this.position(anchor);
    }

    hide() {
        window.clearTimeout(this.pendingTimer);
        this.pendingAnchor = null;
        this.activeAnchor = null;
        this.requestToken += 1;
        this.element.style.display = "none";
    }

    dispose() {
        this.hide();
        this.unsubscribeSettings?.();
        this.unsubscribeSettings = null;

        if (this.isSetup) {
            document.removeEventListener("mouseover", this.boundMouseOver, true);
            document.removeEventListener("mousemove", this.boundMouseMove, true);
            document.removeEventListener("mouseout", this.boundMouseOut, true);
            document.removeEventListener("focusin", this.boundFocusIn, true);
            document.removeEventListener("focusout", this.boundFocusOut, true);
            document.removeEventListener("pointerdown", this.boundPointerDown, true);
            document.removeEventListener("keydown", this.boundKeyDown, true);
            window.removeEventListener("blur", this.boundBlur);
            window.removeEventListener("scroll", this.boundScroll, true);
            this.isSetup = false;
        }

        this.element.remove();
    }
}
