function createMenuButton(text, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "metadata-booster-menu-button";
    button.textContent = text;
    button.onclick = onClick;
    return button;
}

export class MetadataBoosterMenu {
    constructor({ onShowMetadata, onCopyMetadata }) {
        this.onShowMetadata = onShowMetadata;
        this.onCopyMetadata = onCopyMetadata;
        this.currentSource = null;

        this.element = document.createElement("div");
        this.element.className = "metadata-booster-menu";
        this.element.style.display = "none";

        const rootItem = document.createElement("div");
        rootItem.className = "metadata-booster-menu-item metadata-booster-menu-item--submenu";
        rootItem.tabIndex = -1;
        rootItem.append(
            document.createTextNode("PNG Info"),
            Object.assign(document.createElement("span"), {
                className: "metadata-booster-menu-arrow",
                textContent: "▶",
            }),
        );

        this.submenu = document.createElement("div");
        this.submenu.className = "metadata-booster-submenu";
        this.submenu.append(
            createMenuButton("Show PNG Info", () => {
                const source = this.currentSource;
                this.hide();
                if (source) {
                    void this.onShowMetadata(source);
                }
            }),
            createMenuButton("Copy metadata to clipboard", () => {
                const source = this.currentSource;
                this.hide();
                if (source) {
                    void this.onCopyMetadata(source);
                }
            }),
        );

        rootItem.append(this.submenu);
        this.element.append(rootItem);
        document.body.appendChild(this.element);

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

        document.addEventListener("pointerdown", this.boundPointerDown, true);
        document.addEventListener("keydown", this.boundKeyDown, true);
        window.addEventListener("blur", this.boundBlur);
        window.addEventListener("scroll", this.boundScroll, true);
    }

    show(event, source) {
        this.currentSource = source;
        this.element.style.display = "block";
        this.element.classList.remove("metadata-booster-menu--flip");
        this.submenu.classList.remove("metadata-booster-submenu--left");

        const padding = 12;
        const menuWidth = this.element.offsetWidth || 160;
        const menuHeight = this.element.offsetHeight || 40;
        const left = Math.min(event.clientX, window.innerWidth - menuWidth - padding);
        const top = Math.min(event.clientY, window.innerHeight - menuHeight - padding);

        this.element.style.left = `${Math.max(padding, left)}px`;
        this.element.style.top = `${Math.max(padding, top)}px`;

        window.requestAnimationFrame(() => {
            const rect = this.element.getBoundingClientRect();
            const submenuRect = this.submenu.getBoundingClientRect();
            if (rect.right + submenuRect.width > window.innerWidth - padding) {
                this.element.classList.add("metadata-booster-menu--flip");
                this.submenu.classList.add("metadata-booster-submenu--left");
            }
        });
    }

    hide() {
        this.currentSource = null;
        this.element.style.display = "none";
        this.element.classList.remove("metadata-booster-menu--flip");
        this.submenu.classList.remove("metadata-booster-submenu--left");
    }

    dispose() {
        document.removeEventListener("pointerdown", this.boundPointerDown, true);
        document.removeEventListener("keydown", this.boundKeyDown, true);
        window.removeEventListener("blur", this.boundBlur);
        window.removeEventListener("scroll", this.boundScroll, true);
        this.hide();
        this.element.remove();
    }
}
